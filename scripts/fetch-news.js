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
const WINDOW_HOURS = 48;

const GOOGLE_TRENDS_URL = "https://trends.google.com/trends/api/dailytrends?hl=pt-BR&tz=180&geo=BR&ns=15";
const TREND_SIMILARITY_THRESHOLD = 0.5;
const TREND_MATCH_CAP = 2;

const STOPWORDS_PT = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "um", "uma", "uns", "umas",
  "para", "com", "por", "que", "e", "no", "na", "nos", "nas", "ao", "aos", "a", "as", "e",
  "sao", "foi", "como", "mais", "menos", "sobre", "entre", "sem", "apos", "antes", "depois",
  "ja", "nao", "sim", "seu", "sua", "seus", "suas", "isso", "essa", "esse", "este", "esta",
  "pelo", "pela", "pelos", "pelas", "ou", "se", "ele", "ela",
]);

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
  "Valor Econômico": "https://valor.globo.com/rss/valor/economia/",
  "Tecmundo": "https://rss.tecmundo.com.br/feed",
  "UOL": "http://www3.uol.com.br/xml/midiaindoor/economia.xml",
  "Brazil Journal": "https://braziljournal.com/feed/",
  "Neofeed": "https://neofeed.com.br/feed/",
  "Suno Notícias": "https://www.suno.com.br/noticias/feed/",
  "Folha de S.Paulo": "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
  "Quem (Globo)": "https://revistaquem.globo.com/rss/quem/",
  "Contigo": "https://contigo.com.br/feed",
  "LeoDias": "https://portalleodias.com/feed/",
  "GE Globo Esporte": "https://ge.globo.com/rss/ge/futebol/",
  // Sem feed RSS público disponível:
  // - Estadão, Money Times, Seu Dinheiro, Bloomberg Línea Brasil, Purepeople
  // Ficam na config apenas para referência
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

function normalizeText(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function significantWords(title) {
  return normalizeText(title)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS_PT.has(w));
}

// Duas manchetes tratam do mesmo assunto se boa parte das palavras
// relevantes de uma aparecer na outra. Overlap sobre a menor (não Jaccard),
// porque manchetes de fontes diferentes têm tamanhos bem diferentes.
function titleOverlap(a, b) {
  const wa = new Set(significantWords(a));
  const wb = new Set(significantWords(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

// Quantas fontes distintas estão cobrindo o mesmo assunto agora = proxy de
// "está bombando" sem depender de nenhuma API externa. Normalizado entre 0
// (só uma fonte cobre) e 1 (todas as fontes habilitadas cobrem).
function crossSourceScores(articles) {
  const totalSources = new Set(articles.map((a) => a.source)).size;
  return articles.map((article) => {
    const covering = new Set([article.source]);
    for (const other of articles) {
      if (other.source !== article.source && titleOverlap(article.title, other.title) >= TREND_SIMILARITY_THRESHOLD) {
        covering.add(other.source);
      }
    }
    const norm = totalSources > 1 ? (covering.size - 1) / (totalSources - 1) : 0;
    return { ...article, crossSourceNorm: norm };
  });
}

// Termos em alta no Google Trends Brasil hoje. É uma API não documentada do
// Google (sem chave) — se ela mudar de formato ou bloquear a requisição,
// degradamos em silêncio para "sem sinal de tendência" em vez de derrubar a
// coleta inteira.
async function fetchTrendingTermsBR() {
  try {
    const res = await withTimeout(
      fetch(GOOGLE_TRENDS_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; gaglidom-news-bot/1.0; +https://gaglidom.cloud)" },
      }),
      FETCH_TIMEOUT_MS,
      "google-trends"
    );
    const raw = await res.text();
    const data = JSON.parse(raw.replace(/^\)\]\}'/, ""));
    const days = data?.default?.trendingSearchesDays || [];
    const terms = new Set();
    for (const day of days) {
      for (const t of day.trendingSearches || []) {
        if (t.title?.query) terms.add(normalizeText(t.title.query));
        for (const rq of t.relatedQueries || []) {
          if (rq.query) terms.add(normalizeText(rq.query));
        }
      }
    }
    return terms;
  } catch (err) {
    console.log(`Não consegui buscar o Google Trends BR: ${err.message}`);
    return new Set();
  }
}

function trendMatchScore(title, trendingTerms) {
  if (!trendingTerms || trendingTerms.size === 0) return 0;
  const normalizedTitle = normalizeText(title);
  let matches = 0;
  for (const term of trendingTerms) {
    if (term.length >= 4 && normalizedTitle.includes(term)) matches += 1;
  }
  return Math.min(1, matches / TREND_MATCH_CAP);
}

async function main() {
  const config = loadConfig();
  const quantity = config.quantity && config.quantity > 0 ? config.quantity : 10;
  let enabledSources = config.sources && config.sources.length ? config.sources : Object.keys(FEEDS);
  enabledSources = applyCategoryFilter(enabledSources, config.categories);
  const now = Date.now();
  const windowStart = now - WINDOW_HOURS * 60 * 60 * 1000;
  const trendingTerms = await fetchTrendingTermsBR();

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

        // Não descarta mais quem não bate com keyword: o acervo precisa ter
        // as duas coisas disponíveis, porque a publicação mistura notícias
        // relacionadas à keyword com notícias só por trend (ver send-whatsapp.js).
        const keywordScore = scoreArticle(item, config.keywords);

        collected.push({
          source: sourceName,
          title: item.title,
          link: item.link,
          publishedAt: new Date(publishedTime).toISOString(),
          keywordScore,
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

  // Pontuação final = keywords do usuário + "está bombando" (metade
  // cobertura cruzada entre fontes, metade presença nos termos em alta do
  // Google Trends BR — cada uma normalizada entre 0 e 1).
  const scored = crossSourceScores(fresh).map((a) => {
    const keywordScore = a.keywordScore !== undefined ? a.keywordScore : a.score !== undefined ? a.score : 1;
    const trendsNorm = trendMatchScore(a.title, trendingTerms);
    const trendScore = Number((0.5 * a.crossSourceNorm + 0.5 * trendsNorm).toFixed(3));
    const { crossSourceNorm, score, ...rest } = a;
    return { ...rest, keywordScore, trendScore, score: Number((keywordScore + trendScore).toFixed(3)) };
  });
  scored.sort((a, b) => b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        windowHours: WINDOW_HOURS,
        perSend: quantity,
        count: scored.length,
        articles: scored,
      },
      null,
      2
    )
  );

  console.log(`Acervo com ${scored.length} notícia(s) das últimas ${WINDOW_HOURS}h em ${OUTPUT_PATH}`);
  console.table(runLog);
}

main()
  .then(() => process.exit(0)) // encerra à força caso alguma requisição "abandonada" pelo timeout ainda mantenha o processo vivo
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
