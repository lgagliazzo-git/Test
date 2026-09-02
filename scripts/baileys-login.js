// Script de pareamento único: gera o QR code (em ASCII, direto no log)
// pra linkar um número de WhatsApp como "dispositivo conectado" — o
// mesmo mecanismo do WhatsApp Web. Rode isso via o workflow manual
// "Baileys login" no GitHub Actions e escaneie o QR ao vivo na tela de
// log da execução (o log atualiza em tempo real enquanto o job roda).
//
// Use um número separado do seu WhatsApp pessoal: é esse número que fica
// exposto à detecção de automação da Meta, não quem recebe as mensagens.
//
// Depois de conectar, a sessão fica salva em .baileys_auth/ — o passo
// seguinte do workflow empacota essa pasta pra virar o secret
// WHATSAPP_BAILEYS_AUTH.
const path = require("path");
const qrcodeTerminal = require("qrcode-terminal");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");

const AUTH_DIR = path.join(__dirname, "..", ".baileys_auth");

// Sem isso o job ficaria rodando pra sempre se ninguém escanear.
const TIMEOUT_MS = 4 * 60 * 1000;

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n=== Escaneie este QR no WhatsApp do número que vai enviar as notícias ===");
      console.log("(WhatsApp > Aparelhos conectados > Conectar um aparelho)\n");
      qrcodeTerminal.generate(qr, { small: true });
      console.log("\nEsse código expira em segundos — se sumir antes de conseguir escanear, espera o próximo aparecer.\n");
    }

    if (connection === "open") {
      console.log("\nCONECTADO! Sessão salva em .baileys_auth/.");
      setTimeout(() => process.exit(0), 3000);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("Sessão deslogada — rode de novo do zero pra gerar um QR novo.");
        process.exit(1);
      }
      console.log("Conexão caiu, tentando de novo...");
      main();
    }
  });
}

const killTimer = setTimeout(() => {
  console.log("Ninguém escaneou a tempo — encerrando. Rode o workflow de novo quando estiver pronto.");
  process.exit(1);
}, TIMEOUT_MS);
killTimer.unref();

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
