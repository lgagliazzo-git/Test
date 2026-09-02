// Envio pelo WhatsApp via WhatsApp Web (biblioteca Baileys), não pela
// Cloud API oficial da Meta — decisão consciente pra não depender mais de
// token/app do Meta for Developers, que travou. Isso "loga" como um
// aparelho conectado num número de WhatsApp de verdade (o mesmo mecanismo
// do WhatsApp Web no navegador), então não existe mais o conceito de
// "janela de 24h" da Cloud API: dá pra mandar mensagem a qualquer hora,
// pra qualquer número que exista no WhatsApp. WindowClosedError continua
// exportada só pra não quebrar quem importa, mas nunca é lançada.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const pino = require("pino");

class WindowClosedError extends Error {}

function requireEnv() {
  const missing = [];
  if (!process.env.WHATSAPP_BAILEYS_AUTH) missing.push("WHATSAPP_BAILEYS_AUTH");
  if (!process.env.WHATSAPP_TO) missing.push("WHATSAPP_TO");
  if (missing.length) {
    console.error(`Faltando variável(is) de ambiente: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function toJid(number) {
  const digits = String(number).replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

// A sessão (WHATSAPP_BAILEYS_AUTH) é o .baileys_auth/ gerado pelo
// scripts/baileys-login.js, compactado em tar.gz e codificado em base64
// pra caber num secret do GitHub. Extraímos pra uma pasta temporária a
// cada execução — não escrevemos de volta no secret, então chaves que a
// própria sessão rotaciona nas conversas não ficam persistidas: se a
// sessão eventualmente dessincronizar, o jeito é rodar o pareamento de
// novo e atualizar o secret.
function extractAuthDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baileys-auth-"));
  const tarPath = path.join(dir, "auth.tar.gz");
  fs.writeFileSync(tarPath, Buffer.from(process.env.WHATSAPP_BAILEYS_AUTH, "base64"));
  execSync(`tar xzf "${tarPath}" -C "${dir}"`);
  return path.join(dir, ".baileys_auth");
}

let socketPromise = null;

function connect() {
  if (socketPromise) return socketPromise;

  socketPromise = (async () => {
    const authDir = extractAuthDir();
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }) });
    sock.ev.on("creds.update", saveCreds);

    await new Promise((resolve, reject) => {
      sock.ev.on("connection.update", (update) => {
        if (update.connection === "open") resolve();
        if (update.connection === "close") {
          reject(new Error(`Conexão com o WhatsApp fechou antes de abrir: ${update.lastDisconnect?.error?.message || "motivo desconhecido"}`));
        }
      });
    });

    return sock;
  })();

  return socketPromise;
}

async function disconnect() {
  if (!socketPromise) return;
  const sock = await socketPromise;
  sock.end(undefined);
}

async function sendText(body) {
  const sock = await connect();
  const result = await sock.sendMessage(toJid(process.env.WHATSAPP_TO), { text: body });
  return { messages: [{ id: result.key.id }] };
}

async function sendImage(filePath, caption) {
  const sock = await connect();
  const result = await sock.sendMessage(toJid(process.env.WHATSAPP_TO), {
    image: fs.readFileSync(filePath),
    caption,
  });
  return { messages: [{ id: result.key.id }] };
}

module.exports = { sendText, sendImage, requireEnv, disconnect, WindowClosedError };
