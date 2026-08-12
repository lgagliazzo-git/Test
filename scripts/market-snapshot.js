const path = require("path");
const os = require("os");
const fs = require("fs");
const { chromium } = require("playwright");
const { sendText, sendImage, requireEnv, WindowClosedError } = require("./whatsapp");

const TIMEOUT_MS = 15000;
const BCB_CDI_SERIES = 4389; // Taxa CDI anualizada, base 252
// gaglidom.cloud (domínio próprio) deu erro de certificado TLS
// (net::ERR_CERT_COMMON_NAME_INVALID) rodando de dentro do GitHub Actions —
// problema de infraestrutura do domínio custom, sem relação com o widget.
// A URL github.io do próprio GitHub Pages tem certificado sempre válido e
// serve o mesmo arquivo, então usa essa pra não depender do domínio custom.
const WIDGET_URL = "https://lgagliazzo-git.github.io/Test/market-widget.html";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout (${label})`)), ms)),
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await withTimeout(fetch(url, { headers: { "User-Agent": BROWSER_UA } }), TIMEOUT_MS, url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Tenta de novo em falhas transitórias (5xx, timeout). Não insiste em 4xx,
// que é bloqueio/símbolo errado e não melhora com repetição.
async function withRetry(fn, { attempts = 3, baseDelayMs = 800 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const permanent = /HTTP 4\d\d/.test(err.message);
      if (permanent || i === attempts - 1) break;
      await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

// CDI não é um instrumento negociado em bolsa — não existe símbolo pra ele
// em widgets de mercado (TradingView etc). É uma taxa publicada pelo BCB,
// então continua vindo por API mesmo na versão com print.
async function fetchCdi() {
  const json = await withRetry(() =>
    getJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${BCB_CDI_SERIES}/dados/ultimos/1?formato=json`)
  );
  const raw = json?.[0]?.valor;
  if (raw === undefined) throw new Error("série sem valor");
  return Number(String(raw).replace(",", "."));
}

function fmtNumber(value) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function stamp() {
  return new Date()
    .toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
    .replace(":", "h");
}

// Print de um widget de mercado embutido (TradingView) em vez de somar
// cotações de várias APIs sem chave — essas vinham sendo bloqueadas
// (HTTP 429) ou travando (timeout) de dentro do GitHub Actions. Precisa
// carregar de uma origem pública real: o widget faz uma checagem própria
// de origem ("sheriff") contra a URL da página, e rejeita silenciosamente
// (sem erro de JS, sem 4xx visível) tanto file:// quanto http://localhost
// — confirmado nos dois testes anteriores. market-widget.html por isso
// mora na raiz do site, publicado em gaglidom.cloud como qualquer outra
// página, sem o gate de senha (não tem informação nenhuma do usuário).
async function captureSnapshot(stampText) {
  const browser = await chromium.launch();
  try {
    // A checagem "sheriff" do widget bloqueou tanto localhost quanto o
    // domínio real (gaglidom.cloud) do mesmo jeito -- não é sobre origem,
    // é impressão digital de automação. O navegador headless do Playwright
    // manda User-Agent com "HeadlessChrome", o sinal mais comum e mais
    // checado por esse tipo de bloqueio; troca por um Chrome normal.
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, userAgent: BROWSER_UA });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    page.on("pageerror", (err) => console.error(`Erro na página do widget: ${err.message}`));
    page.on("requestfailed", (req) =>
      console.error(`Requisição falhou: ${req.url()} — ${req.failure()?.errorText}`)
    );
    page.on("response", (res) => {
      if (res.url().includes("tradingview")) console.log(`Resposta ${res.status()} — ${res.url()}`);
    });
    await page.goto(WIDGET_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate((text) => {
      document.getElementById("stamp").textContent = `Snapshot ${text} BRT`;
    }, stampText);

    // Agora que o <script> está dentro do container, o iframe do widget é
    // criado lá dentro e esse seletor finalmente casa.
    await page.waitForSelector(".tradingview-widget-container iframe", { timeout: 30000 });
    // O iframe monta antes de receber as cotações (chegam por websocket, sem
    // evento público de "pronto"), então espera fixa pra popular os números.
    await page.waitForTimeout(8000);

    // O Playwright lê iframe de outra origem (opera via CDP, não pelo JS da
    // página), então dá pra registrar o que o widget realmente mostrou. É
    // como eu confiro se algum símbolo veio sem cotação sem abrir a imagem.
    try {
      const frame = page.frames().find((f) => f.url().includes("embed-widget/market-overview"));
      if (frame) {
        const texto = (await frame.locator("body").innerText()).replace(/\s*\n\s*/g, " | ");
        console.log(`Conteúdo do widget: ${texto}`);
      }
    } catch (err) {
      console.error(`Não consegui ler o conteúdo do widget: ${err.message}`);
    }

    const outputPath = path.join(os.tmpdir(), "gaglidom-market-snapshot.png");
    const card = page.locator("#card");
    // Sem conseguir abrir a imagem daqui (a rede do sandbox não alcança o
    // link de artifact do GitHub), altura do card e tamanho do arquivo são a
    // prova de que o widget entrou no print: só o título dava ~100px/~7KB.
    const box = await card.boundingBox();
    await card.screenshot({ path: outputPath });
    const kb = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`Card renderizado: ${Math.round(box.width)}x${Math.round(box.height)}px — PNG ${kb}KB`);
    if (box.height < 200) {
      throw new Error(`card com ${Math.round(box.height)}px de altura — widget não entrou no print`);
    }
    return outputPath;
  } finally {
    await browser.close();
  }
}

async function main() {
  requireEnv();
  const stampText = stamp();

  let cdi = null;
  try {
    cdi = await fetchCdi();
  } catch (err) {
    console.error(`Falha no CDI: ${err.message}`);
  }

  const caption = [
    `⚡ *GAGLIDOM CLOSE — ${stampText}*`,
    `CDI: ${cdi === null ? "—" : `${fmtNumber(cdi)}% a.a.`}`,
    "",
    "_Informações educacionais. Não constituem recomendação de investimento._",
  ].join("\n");

  // Modo de teste: gera o print e loga o diagnóstico, mas não manda nada pro
  // WhatsApp. Cada execução de teste chegava como mensagem real no celular.
  const dryRun = process.env.DRY_RUN === "true";

  try {
    const screenshotPath = await captureSnapshot(stampText);
    console.log(`Print gerado em ${screenshotPath}`);
    if (dryRun) {
      console.log("DRY_RUN ativo — print gerado, nada enviado ao WhatsApp.");
      return;
    }
    const result = await sendImage(screenshotPath, caption);
    console.log(`Enviado. id: ${result.messages?.[0]?.id || "(sem id)"}`);
  } catch (err) {
    if (dryRun) throw err;
    if (err instanceof WindowClosedError) {
      console.log("Janela de 24h fechada — mande qualquer mensagem ao bot para reabrir.");
      return;
    }
    // Se o print falhar por algum motivo, ainda vale mandar o que se tem
    // (CDI) em texto, em vez de não mandar nada.
    console.error(`Falha ao gerar/enviar o print: ${err.message}`);
    try {
      await sendText(`${caption}\n\n_(print do mercado indisponível hoje)_`, { previewUrl: false });
    } catch (fallbackErr) {
      if (fallbackErr instanceof WindowClosedError) {
        console.log("Janela de 24h fechada — mande qualquer mensagem ao bot para reabrir.");
        return;
      }
      throw fallbackErr;
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
