const fs = require("fs");

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

// Envio de imagem exige dois passos na Cloud API: subir o binário pro
// endpoint /media (que devolve um media id) e só depois referenciar esse
// id numa mensagem — não dá pra mandar o arquivo direto em /messages.
async function uploadMedia(filePath) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image/png");
  form.append("file", new Blob([fs.readFileSync(filePath)], { type: "image/png" }), "snapshot.png");

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      body: form,
    }
  );
  const payload = await res.json();
  if (!res.ok || !payload.id) throw new Error(`upload de mídia falhou: HTTP ${res.status} — ${JSON.stringify(payload)}`);
  return payload.id;
}

async function sendImage(filePath, caption) {
  const mediaId = await uploadMedia(filePath);

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
        type: "image",
        image: { id: mediaId, caption },
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

module.exports = { sendText, sendImage, requireEnv, WindowClosedError };
