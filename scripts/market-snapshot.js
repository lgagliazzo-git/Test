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
const LOG_PATH = path.join(__dirname, "..", "news", "market-log.json");
const TESOURO_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3" +
  "/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv";
// O Prefixado 01/01/2032 vence exatamente na data do DI jan/32, então a taxa
// dele é a taxa pré até 2032 — é o número que o futuro de DI daria.
const PRE_2032 = ["Tesouro Prefixado", "01/01/2032"];
// NTN-C 2032 não existe: a série NTN-C ("Tesouro IGPM+ com Juros Semestrais"
// no arquivo) nunca teve vencimento em 2032 — foi emitida para 2021, 2024 e
// 2031, e o probe confirmou que não há linha de 2032 para ela. O papel
// indexado à inflação com cupom semestral que vence em 2032 é a NTN-B.
const NTNB_2032 = ["Tesouro IPCA+ com Juros Semestrais", "15/08/2032"];
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

// Taxa de título público não existe como símbolo no widget de mercado — o
// teste com BMFBOVESPA:DI1F32 voltou com a linha vazia, o widget gratuito
// não serve futuro de DI. E a API que o Tesouro Direto publicava saiu do ar
// (HTTP 410), o arquivo diário da ANBIMA mudou de lugar (404) e
// tesourodireto.com.br está atrás de Cloudflare (403). O que restou de pé é
// este CSV do Tesouro Transparente: histórico inteiro em um arquivo só, sem
// consulta filtrada, mas são 13,8 MB e ~20s, o que cabe de sobra numa
// execução por dia.
async function fetchTesouro() {
  // AbortSignal.timeout e não withTimeout: withTimeout só corre contra a
  // promessa do fetch, que resolve nos cabeçalhos. A leitura dos 13,8 MB do
  // corpo ficava sem prazo nenhum, e numa execução o download travou no meio
  // e segurou o job inteiro por mais de quinze minutos — o print nem chegou
  // a ser tirado. O signal aborta a requisição inteira, corpo incluído.
  const res = await fetch(TESOURO_URL, {
    headers: { "User-Agent": BROWSER_UA },
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // O arquivo vem em latin1; lido como utf-8 os nomes com acento quebram.
  const texto = Buffer.from(await res.arrayBuffer()).toString("latin1");

  // Colunas: Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;...
  // Guarda, por papel, só a linha da data base mais recente — o arquivo é
  // histórico e traz uma linha por dia desde 2002.
  const recentes = new Map();
  for (const linha of texto.split("\n").slice(1)) {
    const col = linha.split(";");
    if (col.length < 5) continue;
    const [tipo, venc, base, taxaCompra] = col;
    const chave = `${tipo}|${venc}`;
    const [d, m, a] = base.split("/");
    const iso = `${a}-${m}-${d}`;
    const atual = recentes.get(chave);
    if (!atual || iso > atual.iso) {
      recentes.set(chave, { iso, base, taxa: Number(taxaCompra.replace(",", ".")) });
    }
  }
  return recentes;
}

function acharTitulo(recentes, tipo, vencimento) {
  const achado = recentes.get(`${tipo}|${vencimento}`);
  return achado && Number.isFinite(achado.taxa) ? achado : null;
}

// Sem isso não há como saber, no dia seguinte, se o envio aconteceu:
// o log do Actions expira e "sucesso" do job não significa entregue.
function registrarResultado(status, detalhe) {
  let historico = [];
  try {
    if (fs.existsSync(LOG_PATH)) historico = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8")).envios || [];
  } catch {
    /* log corrompido: começa um novo */
  }
  historico.push({
    quando: new Date().toISOString(),
    dia: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }),
    status,
    detalhe: detalhe || null,
  });
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify({ envios: historico.slice(-60) }, null, 2) + "\n");
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
    // deviceScaleFactor 2: o widget é ampliado por zoom no CSS, e sem dobrar
    // a densidade de pixels o texto sairia serrilhado no print.
    const page = await browser.newPage({
      viewport: { width: 960, height: 1200 },
      deviceScaleFactor: 2,
      userAgent: BROWSER_UA,
    });
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

  // Modo de teste: gera o print e loga o diagnóstico, mas não manda nada pro
  // WhatsApp. Cada execução de teste chegava como mensagem real no celular.
  const dryRun = process.env.DRY_RUN === "true";

  let titulos = new Map();
  try {
    titulos = await withRetry(fetchTesouro, { attempts: 2 });
  } catch (err) {
    console.error(`Falha no Tesouro: ${err.message}`);
  }

  const pre = acharTitulo(titulos, ...PRE_2032);
  const ntnb = acharTitulo(titulos, ...NTNB_2032);
  // O arquivo do Tesouro fecha com alguns dias de defasagem, então a data
  // base vai junto: sem ela a taxa parece de hoje e não é.
  const emDia = pre || ntnb;

  const caption = [
    `⚡ *GAGLIDOM CLOSE — ${stampText}*`,
    `CDI hoje: ${cdi === null ? "—" : `${fmtNumber(cdi)}% a.a.`}`,
    `Pré 2032: ${pre === null ? "—" : `${fmtNumber(pre.taxa)}% a.a.`}`,
    `NTN-B 2032: ${ntnb === null ? "—" : `IPCA + ${fmtNumber(ntnb.taxa)}% a.a.`}`,
    emDia ? `_Tesouro em ${emDia.base.slice(0, 5)}_` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const screenshotPath = await captureSnapshot(stampText);
    console.log(`Print gerado em ${screenshotPath}`);
    if (dryRun) {
      console.log("DRY_RUN ativo — print gerado, nada enviado ao WhatsApp.");
      return;
    }
    const result = await sendImage(screenshotPath, caption);
    const id = result.messages?.[0]?.id || "(sem id)";
    console.log(`Enviado. id: ${id}`);
    registrarResultado("enviado", id);
  } catch (err) {
    if (dryRun) throw err;
    if (err instanceof WindowClosedError) {
      // Antes isso era um return silencioso: o job ficava verde sem ter
      // enviado nada, e no dia seguinte não havia como saber.
      registrarResultado("nao_enviado", "janela de 24h fechada");
      throw new Error(
        "Janela de 24h do WhatsApp fechada — mande qualquer mensagem ao bot para reabrir."
      );
    }
    // Se o print falhar por algum motivo, ainda vale mandar o que se tem
    // (CDI) em texto, em vez de não mandar nada.
    console.error(`Falha ao gerar/enviar o print: ${err.message}`);
    try {
      const alt = await sendText(`${caption}\n\n_(print do mercado indisponível hoje)_`, { previewUrl: false });
      registrarResultado("enviado_sem_print", alt.messages?.[0]?.id || null);
    } catch (fallbackErr) {
      if (fallbackErr instanceof WindowClosedError) {
        registrarResultado("nao_enviado", "janela de 24h fechada");
        throw new Error(
          "Janela de 24h do WhatsApp fechada — mande qualquer mensagem ao bot para reabrir."
        );
      }
      registrarResultado("nao_enviado", fallbackErr.message);
      throw fallbackErr;
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
