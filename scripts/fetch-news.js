const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");

const FETCH_TIMEOUT_MS = 15000;
const parser = new Parser({ timeout: FETCH_TIMEOUT_MS });

// O timeout embutido do rss-parser nem sempre é respeitado (depende da lib
// HTTP por baixo), o que já travou uma execução real. Isso força a
// desistência no prazo mesmo que a requisição continue pendurada.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout após ${ms}ms (${label})`)), ms)),
  ]);
}

const CONFIG_PATH = path.join(__dirname, "..", "news-config.json");
const OUTPUT_DIR = path.join(__dirname, "..", "news");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "news.json");
const WINDOW_HOURS = 96;

// Fontes com feed RSS mapeado. Só as listadas aqui são buscadas de fato —
// outras fontes escolhidas na tela de configuração são ignoradas até
// termos um feed confiável para elas.
const FEEDS = {
  "InfoMoney": "https://www.infomoney.com.br/feed/",
  "G1": "https://g1.globo.com/rss/g1/economia/",
  "CNN Brasil": "https://www.cnnbrasil.com.br/feed/",
  "Poder360": "https://www.poder360.com.br/feed/",
  "Tecmundo": "https://www.tecmundo.com.br/feed",
  "Canaltech": "https://canaltech.com.br/rss/",
  "Exame": "https://exame.com/feed/",
  "Estadão": "https://www.estadao.com.br/arc/outboundfeeds/rss/category/economia/?outputType=xml",
  "UOL": "https://economia.uol.com.br/rss.xml",
  "Valor Econômico": "https://valor.globo.com/rss/valor/economia/",
};

// Quais fontes atendem cada categoria (usado só se o usuário filtrar por categoria).
const CATEGORY_SOURCES = {
  "Economia": ["InfoMoney", "G1", "Estadão", "UOL", "Valor Econômico", "Exame"],
  "Finanças": ["InfoMoney", "Valor Econômico", "Exame"],
  "Empresas": ["InfoMoney", "Exame", "Valor Econômico"],
  "Política": ["Poder360", "CNN Brasil", "Estadão"],
  "Tecnologia": ["Tecmundo", "Canaltech"],
  "Internacional": ["CNN Brasil"],
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { sources: Object.keys(FEEDS), categories: [], keywords: [], quantity: 10, frequency: 2 };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function loadExisting() {
  if (!fs.existsSync(OUTPUT_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8")).articles || [];
  } catch {
    return [];
  }
}

function scoreArticle(item, keywords) {
  if (!keywords || keywords.length === 0) return 1;
  const text = `${item.title || ""} ${item.contentSnippet || ""}`.toLowerCase();
  return keywords.reduce((score, kw) => score + (text.includes(kw.toLowerCase()) ? 1 : 0), 0);
}

function applyCategoryFilter(sources, categories) {
  if (!categories || categories.length === 0) return sources;
  const allowed = new Set(categories.flatMap((c) => CATEGORY_SOURCES[c] || []));
  return sources.filter((s) => allowed.has(s));
}

async function main() {
  const config = loadConfig();
  const quantity = config.quantity && config.quantity > 0 ? config.quantity : 10;
  let enabledSources = config.sources && config.sources.length ? config.sources : Object.keys(FEEDS);
  enabledSources = applyCategoryFilter(enabledSources, config.categories);
  const now = Date.now();
  const windowStart = now - WINDOW_HOURS * 60 * 60 * 1000;

  const existing = loadExisting();
  const existingLinks = new Set(existing.map((a) => a.link));
  const collected = [...existing];
  const runLog = [];

  for (const sourceName of enabledSources) {
    const feedUrl = FEEDS[sourceName];
    if (!feedUrl) {
      runLog.push({ source: sourceName, status: "sem feed RSS mapeado, ignorado" });
      continue;
    }
    try {
      const feed = await withTimeout(parser.parseURL(feedUrl), FETCH_TIMEOUT_MS, sourceName);
      let added = 0;
      for (const item of feed.items) {
        if (!item.link || existingLinks.has(item.link)) continue;
        const publishedAt = item.isoDate || item.pubDate;
        const publishedTime = publishedAt ? new Date(publishedAt).getTime() : now;
        if (Number.isNaN(publishedTime) || publishedTime < windowStart) continue;

        const score = scoreArticle(item, config.keywords);
        if (config.keywords && config.keywords.length > 0 && score === 0) continue;

        collected.push({
          source: sourceName,
          title: item.title,
          link: item.link,
          publishedAt: new Date(publishedTime).toISOString(),
          score,
        });
        existingLinks.add(item.link);
        added += 1;
      }
      runLog.push({ source: sourceName, status: `ok, ${added} nova(s)` });
    } catch (err) {
      runLog.push({ source: sourceName, status: `falhou: ${err.message}` });
    }
  }

  const fresh = collected.filter((a) => new Date(a.publishedAt).getTime() >= windowStart);
  fresh.sort((a, b) => b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt));

  // Mesma lista que será usada pro envio no WhatsApp — arquivo e envio
  // sempre alinhados na mesma quantidade, fontes, categorias e palavras-chave.
  const top = fresh.slice(0, quantity);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        windowHours: WINDOW_HOURS,
        quantity,
        count: top.length,
        articles: top,
      },
      null,
      2
    )
  );

  console.log(`Salvo ${top.length} notícia(s) (de ${fresh.length} candidatas) em ${OUTPUT_PATH}`);
  console.table(runLog);
}

main()
  .then(() => process.exit(0)) // encerra à força caso alguma requisição "abandonada" pelo timeout ainda mantenha o processo vivo
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
