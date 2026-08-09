const { sendText, requireEnv, WindowClosedError } = require("./whatsapp");

const TIMEOUT_MS = 15000;
const BCB_CDI_SERIES = 4389; // Taxa CDI anualizada, base 252
const VALUE_COLUMN = 23;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout (${label})`)), ms)),
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url) {
  const res = await withTimeout(fetch(url, { headers: { "User-Agent": BROWSER_UA } }), TIMEOUT_MS, url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

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

// ---------- Fontes de cotação ----------

// Stooq: CSV diário sem chave. As duas últimas linhas dão fechamento atual
// e anterior, que é o que precisamos para calcular a variação.
async function fromStooq(symbol) {
  const csv = await getText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`);
  const rows = csv.trim().split("\n").filter(Boolean);
  if (rows.length < 3) {
    // Stooq responde 200 tanto para símbolo inexistente quanto para bloqueio
    // por volume — sem ver o corpo não dá pra saber qual dos dois é.
    throw new Error(`stooq inválido [${csv.slice(0, 60).replace(/\s+/g, " ")}]`);
  }
  const closeOf = (row) => Number(row.split(",")[4]);
  const price = closeOf(rows[rows.length - 1]);
  const previous = closeOf(rows[rows.length - 2]);
  if (!Number.isFinite(price) || !Number.isFinite(previous) || previous === 0) {
    throw new Error(`stooq sem preço [${rows[rows.length - 1].slice(0, 50)}]`);
  }
  return { price, previous };
}

// FRED (Federal Reserve de St. Louis): CSV público, sem chave. É fonte
// oficial e não bloqueia IP de datacenter, diferente de Yahoo/Stooq.
async function fromFred(seriesId) {
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const csv = await getText(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${start}`
  );
  // O FRED marca dia sem cotação (feriado) com "." — precisa descartar,
  // senão a variação sai contra um valor inexistente.
  const values = csv
    .trim()
    .split("\n")
    .slice(1)
    .map((row) => Number(row.split(",")[1]))
    .filter((n) => Number.isFinite(n));

  if (values.length < 2) throw new Error(`fred sem série [${csv.slice(0, 50).replace(/\s+/g, " ")}]`);
  const price = values[values.length - 1];
  const previous = values[values.length - 2];
  if (previous === 0) throw new Error("fred sem base de comparação");
  return { price, previous };
}

async function fromYahoo(symbol) {
  const json = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
  );
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const previous = meta?.chartPreviousClose ?? meta?.previousClose;
  if (typeof price !== "number" || typeof previous !== "number" || previous === 0) {
    throw new Error("yahoo sem preço válido");
  }
  return { price, previous };
}

// AwesomeAPI: brasileira, sem chave, já devolve a variação percentual pronta.
async function fromAwesome(pair) {
  const json = await getJson(`https://economia.awesomeapi.com.br/json/last/${pair}`);
  const entry = json?.[pair.replace("-", "")];
  const price = Number(entry?.bid);
  const pct = Number(entry?.pctChange);
  if (!Number.isFinite(price)) throw new Error("awesomeapi sem preço");
  return { price, changePct: Number.isFinite(pct) ? pct : null };
}

// BCB é a única fonte que respondeu de dentro do GitHub Actions até agora,
// então vale como âncora para o que ela cobre (câmbio e juros).
async function fromBcbSeries(series) {
  const json = await getJson(
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados/ultimos/2?formato=json`
  );
  if (!Array.isArray(json) || json.length < 2) throw new Error("bcb sem histórico");
  const num = (row) => Number(String(row.valor).replace(",", "."));
  const price = num(json[json.length - 1]);
  const previous = num(json[json.length - 2]);
  if (!Number.isFinite(price) || !Number.isFinite(previous) || previous === 0) {
    throw new Error("bcb sem valor válido");
  }
  return { price, previous };
}

async function fromCoinGecko(id) {
  const json = await getJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`
  );
  const price = json?.[id]?.usd;
  const pct = json?.[id]?.usd_24h_change;
  if (!Number.isFinite(price)) throw new Error("coingecko sem preço");
  return { price, changePct: Number.isFinite(pct) ? pct : null };
}

// A ordem dos provedores é a ordem de tentativa: o primeiro que responder vence.
const QUOTES = [
  {
    group: "Bolsas",
    label: "IBOV",
    providers: [() => fromStooq("^bvp"), () => fromYahoo("^BVSP")],
  },
  {
    group: "Bolsas",
    label: "S&P 500",
    providers: [() => fromFred("SP500"), () => fromStooq("^spx"), () => fromYahoo("^GSPC")],
  },
  {
    group: "Câmbio & Commodities",
    label: "USD/BRL",
    providers: [
      () => fromBcbSeries(1), // PTAX dólar comercial (venda)
      () => fromAwesome("USD-BRL"),
      () => fromStooq("usdbrl"),
      () => fromYahoo("BRL=X"),
    ],
  },
  {
    group: "Câmbio & Commodities",
    label: "WTI",
    providers: [() => fromFred("DCOILWTICO"), () => fromStooq("cl.f"), () => fromYahoo("CL=F")],
  },
  {
    group: "Câmbio & Commodities",
    label: "BITCOIN",
    providers: [
      () => fromCoinGecko("bitcoin"),
      () => fromAwesome("BTC-USD"),
      () => fromStooq("btcusd"),
      () => fromYahoo("BTC-USD"),
    ],
  },
  {
    group: "Câmbio & Commodities",
    label: "T10Y EUA",
    isPercent: true,
    providers: [() => fromFred("DGS10"), () => fromStooq("10usy.b"), () => fromYahoo("^TNX")],
  },
];

async function resolveQuote(quote) {
  const errors = [];
  for (const provider of quote.providers) {
    try {
      const data = await withRetry(provider);
      let price = data.price;
      let changePct = data.changePct;
      if (changePct === undefined || changePct === null) {
        let previous = data.previous;
        // O ^TNX do Yahoo às vezes vem x10 (46,4 em vez de 4,64%).
        if (quote.isPercent && price > 20) {
          price /= 10;
          previous /= 10;
        }
        changePct = ((price - previous) / previous) * 100;
      } else if (quote.isPercent && price > 20) {
        price /= 10;
      }
      return { ...quote, price, changePct };
    } catch (err) {
      errors.push(err.message);
    }
  }
  console.error(`Falha em ${quote.label}: ${errors.join(" | ")}`);
  return { ...quote, failed: true };
}

async function fetchCdi() {
  const json = await withRetry(() =>
    getJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${BCB_CDI_SERIES}/dados/ultimos/1?formato=json`)
  );
  const raw = json?.[0]?.valor;
  if (raw === undefined) throw new Error("série sem valor");
  return Number(String(raw).replace(",", "."));
}

// ---------- Formatação ----------

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

async function buildMessage() {
  // Sequencial de propósito: disparar tudo em paralelo dispara rate limit
  // (foi o que derrubou a primeira versão, com 429 em todos os símbolos).
  const results = [];
  for (const quote of QUOTES) {
    results.push(await resolveQuote(quote));
  }

  let cdi = null;
  try {
    cdi = await fetchCdi();
  } catch (err) {
    console.error(`Falha no CDI: ${err.message}`);
  }

  const stamp = new Date()
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(":", "h");

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
  lines.push(`_Snapshot ${stamp} BRT · BCB + FRED + CoinGecko_`);
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
