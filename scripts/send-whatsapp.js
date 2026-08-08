const fs = require("fs");
const path = require("path");

const NEWS_PATH = path.join(__dirname, "..", "news", "news.json");
const CONFIG_PATH = path.join(__dirname, "..", "news-config.json");

const GRAPH_VERSION = "v25.0";

// Código que a API devolve quando a janela de atendimento de 24h está
// fechada (o usuário não mandou mensagem pro bot nas últimas 24h).
const WINDOW_CLOSED_CODE = 131047;

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

function formatMessage({ title, source, link }) {
  return `📰 ${title}\n\nFonte: ${source}\n${link}`;
}

class WindowClosedError extends Error {}

async function sendText(body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: TO,
      type: "text",
      text: { preview_url: true, body },
    }),
  });

  const payload = await res.json();
  if (!res.ok) {
    if (payload?.error?.code === WINDOW_CLOSED_CODE) {
      throw new WindowClosedError(payload.error.message);
    }
    throw new Error(`HTTP ${res.status} — ${JSON.stringify(payload)}`);
  }
  return payload;
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

  let sent = 0;
  try {
    for (const article of pending) {
      const result = await sendText(formatMessage(article));
      article.sentAt = new Date().toISOString();
      sent += 1;
      console.log(`Enviado: [${article.source}] ${article.title}`);
      console.log(`  id: ${result.messages?.[0]?.id || "(sem id)"}`);
    }
  } catch (err) {
    if (err instanceof WindowClosedError) {
      // Não é falha do robô: a janela de 24h fechou porque o usuário não
      // mandou mensagem pro bot. A notícia fica pendente e sai no próximo
      // ciclo depois que ele reabrir a janela — por isso não marcamos
      // sentAt nem derrubamos a execução com erro.
      console.log("Janela de 24h fechada — mande qualquer mensagem ao bot para reabrir.");
      console.log("As notícias pendentes serão enviadas no próximo ciclo.");
    } else {
      throw err;
    }
  }

  if (sent > 0) {
    fs.writeFileSync(NEWS_PATH, JSON.stringify(data, null, 2));
    console.log(`${sent} notícia(s) enviada(s) e marcada(s) no acervo.`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
