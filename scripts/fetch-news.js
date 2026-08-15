const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");

const FETCH_TIMEOUT_MS = 15000;
const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; gaglidom-news-bot/1.0; +https://gaglidom.cloud)",
  },
});

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
  "Canaltech": "https://canaltech.com.br/rss/",
  "Exame": "https://exame.com/feed/",
  "Valor Econômico": "https://www.valor.com.br/feed",
  "Tecmundo": "https://rss.tecmundo.com.br/feed",
  "UOL": "https://feeds.uol.com.br/economia/ultimas-noticias/",
  "Brazil Journal": "https://braziljournal.com/feed/",
  "Neofeed": "https://neofeed.com.br/feed/",
  "Suno Notícias": "https://www.suno.com.br/noticias/feed/",
  "Folha de S.Paulo": "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
  "Quem (Globo)": "https://revistaquem.globo.com/rss/quem/",
  "Contigo": "https://contigo.com.br/feed",
  "LeoDias": "https://portalleodias.com/feed/",
  "GE Globo Esporte": "https://ge.globo.com/rss/ge/futebol/",
  "Estadão": "https://feeds.estadao.com.br/rss/geral",
  "Money Times": "https://feeds.moneytimes.com.br/",
  "Seu Dinheiro": "https://feeds.seudinheiro.com.br/",
  "Bloomberg Línea Brasil": "https://feeds.bloomberglinea.com.br/",
  "Purepeople": "https://feeds.purepeople.com.br/",
};

// Quais fontes atendem cada categoria (usado só se o usuário filtrar por categoria).
const CATEGORY_SOURCES = {
  "Economia": ["InfoMoney", "G1", "Estadão", "UOL", "Valor Econômico", "Exame", "Folha de S.Paulo"],
  "Finanças": ["InfoMoney", "Valor Econômico", "Exame", "Money Times", "Suno Notícias", "Seu Dinheiro", "Bloomberg Línea Brasil"],
  "Empresas": ["InfoMoney", "Exame", "Valor Econômico", "Brazil Journal", "Neofeed", "Bloomberg Línea Brasil"],
  "Política": ["Poder360", "CNN Brasil", "Estadão", "Folha de S.Paulo"],
  "Tecnologia": ["Tecmundo", "Canaltech", "Neofeed"],
  "Esportes": ["GE Globo Esporte"],
  "Internacional": ["CNN Brasil", "Bloomberg Línea Brasil"],
  "Fofoca": ["Quem (Globo)", "Purepeople", "Contigo", "LeoDias"],
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

  // O arquivo guarda TUDO da janela de 96h (é o acervo que o site exibe).
  // Quem escolhe o que vai pro WhatsApp é o send-whatsapp.js, que pega a
  // mais relevante ainda não enviada — por isso o campo sentAt é preservado.
  const fresh = collected.filter((a) => new Date(a.publishedAt).getTime() >= windowStart);
  fresh.sort((a, b) => b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        windowHours: WINDOW_HOURS,
        perSend: quantity,
        count: fresh.length,
        articles: fresh,
      },
      null,
      2
    )
  );

  console.log(`Acervo com ${fresh.length} notícia(s) das últimas ${WINDOW_HOURS}h em ${OUTPUT_PATH}`);
  console.table(runLog);
}

main()
  .then(() => process.exit(0)) // encerra à força caso alguma requisição "abandonada" pelo timeout ainda mantenha o processo vivo
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
