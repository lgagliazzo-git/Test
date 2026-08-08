const fs = require("fs");
const path = require("path");

const NEWS_PATH = path.join(__dirname, "..", "news", "news.json");
const CONFIG_PATH = path.join(__dirname, "..", "news-config.json");

const TEMPLATE_NAME = "noticia_gaglidom";
const TEMPLATE_LANG = "pt_BR";
const GRAPH_VERSION = "v25.0";

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TO = process.env.WHATSAPP_TO;

function requireEnv() {
  const missing = [];
  if (!TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!PHONE_NUMBER_ID) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!TO) missing.push("WHATSAPP_TO");
  if (missing.length) {
    console.error(`Faltando variável(is) de ambiente: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// Parâmetros de template não aceitam quebra de linha, tabulação, nem mais de
// 4 espaços seguidos — a API rejeita a mensagem inteira se isso passar.
function sanitize(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function sendTemplate({ title, source, link }) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: TO,
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANG },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: sanitize(title) },
              { type: "text", text: sanitize(source) },
              { type: "text", text: sanitize(link) },
            ],
          },
        ],
      },
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  requireEnv();

  if (!fs.existsSync(NEWS_PATH)) {
    console.log("Nenhum acervo de notícias encontrado, nada a enviar.");
    return;
  }

  const data = JSON.parse(fs.readFileSync(NEWS_PATH, "utf-8"));
  const articles = data.articles || [];

  const perSend = (() => {
    if (!fs.existsSync(CONFIG_PATH)) return 1;
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    return cfg.quantity && cfg.quantity > 0 ? cfg.quantity : 1;
  })();

  // O acervo já vem ordenado por relevância (score) e depois por data.
  const pending = articles.filter((a) => !a.sentAt).slice(0, perSend);

  if (pending.length === 0) {
    console.log("Nenhuma notícia nova para enviar neste ciclo.");
    return;
  }

  for (const article of pending) {
    const result = await sendTemplate(article);
    article.sentAt = new Date().toISOString();
    console.log(`Enviado: [${article.source}] ${article.title}`);
    console.log(`  id: ${result.messages?.[0]?.id || "(sem id)"}`);
  }

  fs.writeFileSync(NEWS_PATH, JSON.stringify(data, null, 2));
  console.log(`${pending.length} notícia(s) enviada(s) e marcada(s) no acervo.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
