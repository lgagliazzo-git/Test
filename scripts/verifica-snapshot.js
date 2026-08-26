// Confere, todo dia de manhã, se o snapshot da véspera saiu.
// Existe porque "job verde" nunca foi prova de envio: o Actions também
// pula execuções agendadas em dias de fila cheia, e nesse caso não há log
// nenhum para olhar — o silêncio é idêntico ao de um envio bem-sucedido.
const fs = require("fs");
const path = require("path");

const LOG_PATH = path.join(__dirname, "..", "news", "market-log.json");

function diaBRT(deslocamentoDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function main() {
  const ontem = diaBRT(-1);

  if (!fs.existsSync(LOG_PATH)) {
    console.error(`Não existe registro de envios (${LOG_PATH}).`);
    process.exit(1);
  }
  const envios = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8")).envios || [];
  const doDia = envios.filter((e) => e.dia === ontem);

  if (doDia.length === 0) {
    console.error(`Nenhum snapshot registrado em ${ontem}. A execução agendada não rodou ou falhou antes de registrar.`);
    process.exit(1);
  }

  const ok = doDia.find((e) => e.status === "enviado" || e.status === "enviado_sem_print");
  if (!ok) {
    console.error(`Snapshot de ${ontem} não foi enviado: ${doDia.map((e) => e.detalhe).join("; ")}`);
    process.exit(1);
  }

  console.log(`Snapshot de ${ontem} enviado (${ok.status}) às ${ok.quando}.`);
}

main();
