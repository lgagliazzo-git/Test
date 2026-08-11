const path = require("path");
const os = require("os");
const { chromium } = require("playwright");
const { sendText, sendImage, requireEnv, WindowClosedError } = require("./whatsapp");

const TIMEOUT_MS = 15000;
const BCB_CDI_SERIES = 4389; // Taxa CDI anualizada, base 252
const WIDGET_PATH = path.join(__dirname, "market-widget.html");

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
// (HTTP 429) ou travando (timeout) de dentro do GitHub Actions. O widget é
// feito pra ser embutido em página de terceiro, então não bloqueia
// navegador automatizado do jeito que os endpoints de dados bloqueiam.
async function captureSnapshot(stampText) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(`file://${WIDGET_PATH}`);
    await page.evaluate((text) => {
      document.getElementById("stamp").textContent = `Snapshot ${text} BRT`;
    }, stampText);
    await page.waitForSelector(".tradingview-widget-container iframe", { timeout: 20000 });
    // O iframe carrega os preços via websocket depois de montado; não tem
    // evento de "dados prontos" exposto, então dá um tempo fixo pra
    // renderizar antes do print.
    await page.waitForTimeout(6000);
    const outputPath = path.join(os.tmpdir(), "gaglidom-market-snapshot.png");
    await page.locator("#card").screenshot({ path: outputPath });
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

  try {
    const screenshotPath = await captureSnapshot(stampText);
    console.log(`Print gerado em ${screenshotPath}`);
    const result = await sendImage(screenshotPath, caption);
    console.log(`Enviado. id: ${result.messages?.[0]?.id || "(sem id)"}`);
  } catch (err) {
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
