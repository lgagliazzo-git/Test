const GRAPH_VERSION = "v25.0";

// Código que a API devolve quando a janela de atendimento de 24h está
// fechada (o usuário não mandou mensagem pro bot nas últimas 24h).
const WINDOW_CLOSED_CODE = 131047;

class WindowClosedError extends Error {}

function requireEnv() {
  const missing = [];
  if (!process.env.WHATSAPP_TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!process.env.WHATSAPP_TO) missing.push("WHATSAPP_TO");
  if (missing.length) {
    console.error(`Faltando variável(is) de ambiente: ${missing.join(", ")}`);
    process.exit(1);
  }
}

async function sendText(body, { previewUrl = true } = {}) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: process.env.WHATSAPP_TO,
        type: "text",
        text: { preview_url: previewUrl, body },
      }),
    }
  );

  const payload = await res.json();
  if (!res.ok) {
    if (payload?.error?.code === WINDOW_CLOSED_CODE) {
      throw new WindowClosedError(payload.error.message);
    }
    throw new Error(`HTTP ${res.status} — ${JSON.stringify(payload)}`);
  }
  return payload;
}

module.exports = { sendText, requireEnv, WindowClosedError };
