const fs = require("fs");
const path = require("path");
const { sendText, requireEnv, WindowClosedError } = require("./whatsapp");

const NEWS_PATH = path.join(__dirname, "..", "news", "news.json");
const CONFIG_PATH = path.join(__dirname, "..", "news-config.json");

function formatMessage({ title, source, link }) {
  return `📰 ${title}\n\nFonte: ${source}\n${link}`;
}

async function main() {
  requireEnv();

  if (!fs.existsSync(NEWS_PATH)) {
    console.log("Nenhum acervo de notícias encontrado, nada a enviar.");
    return;
  }

  const data = JSON.parse(fs.readFileSync(NEWS_PATH, "utf-8"));
  const articles = data.articles || [];

  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) : {};
  const perSend = cfg.quantity && cfg.quantity > 0 ? cfg.quantity : 1;

  // O agendamento do GitHub Actions é fixo e não lê arquivo, então ele roda
  // de hora em hora e o intervalo escolhido na tela é respeitado aqui:
  // se ainda não passou o tempo desde o último envio, este ciclo não envia.
  const horas = cfg.frequency && cfg.frequency > 0 ? Number(cfg.frequency) : 1;
  const ultimoEnvio = articles
    .map((a) => a.sentAt)
    .filter(Boolean)
    .sort()
    .pop();
  if (ultimoEnvio) {
    const decorridas = (Date.now() - new Date(ultimoEnvio).getTime()) / 3600000;
    if (decorridas < horas - 0.1) {
      console.log(
        `Último envio há ${decorridas.toFixed(1)}h; o intervalo configurado é ${horas}h. Nada a enviar.`
      );
      return;
    }
  }

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
