const { sendText, requireEnv, WindowClosedError } = require("./whatsapp");

const YAHOO_TIMEOUT_MS = 15000;
const BCB_CDI_SERIES = 4389; // Taxa CDI anualizada, base 252

// A ordem aqui é a ordem em que as linhas aparecem na mensagem.
const QUOTES = [
  { group: "Bolsas", label: "IBOV", symbol: "^BVSP" },
  { group: "Bolsas", label: "S&P 500", symbol: "^GSPC" },
  { group: "Câmbio & Commodities", label: "USD/BRL", symbol: "BRL=X" },
  { group: "Câmbio & Commodities", label: "WTI", symbol: "CL=F" },
  { group: "Câmbio & Commodities", label: "BITCOIN", symbol: "BTC-USD" },
  { group: "Câmbio & Commodities", label: "T10Y EUA", symbol: "^TNX", isPercent: true },
];

const VALUE_COLUMN = 23;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout (${label})`)), ms)),
  ]);
}

function fmtNumber(value) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPercent(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function line(label, value, changePct) {
  const padded = label + value.padStart(Math.max(1, VALUE_COLUMN - label.length));
  if (changePct === null || changePct === undefined) return padded;
  const arrow = changePct >= 0 ? "▲" : "▼";
  return `${padded}   ${arrow} ${fmtPercent(changePct)}`;
}

async function fetchQuote({ symbol, isPercent }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await withTimeout(
    fetch(url, {
      headers: {
        // Sem um User-Agent de navegador o Yahoo devolve 429/403.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    }),
    YAHOO_TIMEOUT_MS,
    symbol
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("resposta sem meta");

  let price = meta.regularMarketPrice;
  let previous = meta.chartPreviousClose ?? meta.previousClose;
  if (typeof price !== "number" || typeof previous !== "number" || previous === 0) {
    throw new Error("preço indisponível");
  }

  // O ^TNX às vezes vem multiplicado por 10 (46,4 em vez de 4,64%).
  if (isPercent && price > 20) {
    price /= 10;
    previous /= 10;
  }

  return { price, changePct: ((price - previous) / previous) * 100 };
}

async function fetchCdi() {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${BCB_CDI_SERIES}/dados/ultimos/1?formato=json`;
  const res = await withTimeout(fetch(url), YAHOO_TIMEOUT_MS, "BCB CDI");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const raw = json?.[0]?.valor;
  if (raw === undefined) throw new Error("série sem valor");
  return Number(String(raw).replace(",", "."));
}

async function buildMessage() {
  const results = await Promise.all(
    QUOTES.map(async (q) => {
      try {
        return { ...q, ...(await fetchQuote(q)) };
      } catch (err) {
        console.error(`Falha em ${q.label} (${q.symbol}): ${err.message}`);
        return { ...q, failed: true };
      }
    })
  );

  let cdi = null;
  try {
    cdi = await fetchCdi();
  } catch (err) {
    console.error(`Falha no CDI: ${err.message}`);
  }

  const now = new Date();
  const hour = now.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  const stamp = hour.replace(":", "h");

  const lines = [`⚡ *GAGLIDOM CLOSE — ${stamp}*`, ""];

  let currentGroup = null;
  for (const r of results) {
    if (r.group !== currentGroup) {
      lines.push(`*${r.group}*`);
      currentGroup = r.group;
    }
    if (r.failed) {
      lines.push(line(r.label, "—", null));
      continue;
    }
    const value = r.isPercent ? `${fmtNumber(r.price)}%` : fmtNumber(r.price);
    lines.push(line(r.label, value, r.changePct));
  }

  lines.push("*Juros*");
  lines.push(line("CDI", cdi === null ? "—" : `${fmtNumber(cdi)}% a.a.`, null));
  lines.push(`_Snapshot ${stamp} BRT · Yahoo Finance + BCB_`);
  lines.push("");
  lines.push("📰 gaglidom · Market Desk");
  lines.push("");
  lines.push("_Informações educacionais. Não constituem recomendação de investimento._");

  return lines.join("\n");
}

async function main() {
  requireEnv();
  const message = await buildMessage();
  console.log(message);

  try {
    // preview_url off: sem link no corpo, e evita o WhatsApp inventar card.
    const result = await sendText(message, { previewUrl: false });
    console.log(`\nEnviado. id: ${result.messages?.[0]?.id || "(sem id)"}`);
  } catch (err) {
    if (err instanceof WindowClosedError) {
      console.log("\nJanela de 24h fechada — mande qualquer mensagem ao bot para reabrir.");
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
