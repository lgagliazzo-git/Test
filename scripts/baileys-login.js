// Script de pareamento único: em vez de QR code (que não dá pra escanear
// de forma confiável a partir do log em ASCII do Actions — a proporção
// dos blocos nunca bate certinho com a fonte do navegador), usa o método
// de CÓDIGO DE PAREAMENTO do WhatsApp: um código de 8 caracteres que você
// digita direto no aparelho, sem precisar de câmera.
//
// Rode isso via o workflow manual "Baileys login" no GitHub Actions,
// informando o número que vai virar o remetente. Acompanhe o log ao vivo
// — o código aparece nele — e digite no WhatsApp desse número em:
// Aparelhos conectados > Conectar um aparelho > Conectar com número de
// telefone.
//
// Use um número separado do seu WhatsApp pessoal: é esse número que fica
// exposto à detecção de automação da Meta, não quem recebe as mensagens.
//
// Depois de conectar, a sessão fica salva em .baileys_auth/ — o passo
// seguinte do workflow empacota essa pasta pra virar o secret
// WHATSAPP_BAILEYS_AUTH.
const path = require("path");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");

const AUTH_DIR = path.join(__dirname, "..", ".baileys_auth");

// Sem isso o job ficaria rodando pra sempre se ninguém confirmar o código.
const TIMEOUT_MS = 4 * 60 * 1000;

const phoneNumber = (process.env.PAIRING_PHONE_NUMBER || "").replace(/\D/g, "");

async function main() {
  if (!phoneNumber) {
    console.error(
      "Faltou informar o número (PAIRING_PHONE_NUMBER) — só dígitos, com código do país, ex: 5511999999999."
    );
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  if (!sock.authState.creds.registered) {
    // Dá um respiro pro socket terminar o handshake inicial antes de pedir
    // o código — pedir cedo demais faz a Meta recusar o pedido.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const code = await sock.requestPairingCode(phoneNumber);
    console.log("\n===================================");
    console.log(`   CÓDIGO DE PAREAMENTO: ${code}`);
    console.log("===================================\n");
    console.log("No WhatsApp do número que vai enviar as notícias:");
    console.log("Aparelhos conectados > Conectar um aparelho > Conectar com número de telefone");
    console.log("Digite esse código lá — ele expira em poucos minutos.\n");
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log("\nCONECTADO! Sessão salva em .baileys_auth/.");
      setTimeout(() => process.exit(0), 3000);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("Sessão deslogada — rode de novo do zero pra gerar um código novo.");
        process.exit(1);
      }
      console.log("Conexão caiu, tentando de novo...");
      main();
    }
  });
}

const killTimer = setTimeout(() => {
  console.log("Ninguém confirmou o código a tempo — encerrando. Rode o workflow de novo quando estiver pronto.");
  process.exit(1);
}, TIMEOUT_MS);
killTimer.unref();

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
