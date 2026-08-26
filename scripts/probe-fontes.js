// Temporário. Sobrou uma fonte viva: o CSV de preços e taxas do Tesouro
// Direto no CKAN do Tesouro Transparente. Não tem consulta filtrada — é o
// histórico inteiro desde 2002 em um arquivo só. Este passo mede o custo
// disso e responde a pergunta que importa: quais papéis com vencimento em
// 2032 existem de fato, com que nome exato, e qual a taxa mais recente de
// cada um. NTN-C não aparece em dataset nenhum do portal, então é aqui que
// se confirma se há um equivalente para 2032.
const readline = require("readline");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

const CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv";

function paraData(br) {
  const [d, m, a] = br.split("/");
  return `${a}-${m}-${d}`;
}

(async () => {
  const destino = path.join(os.tmpdir(), "td.csv");
  const t0 = Date.now();
  const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(180000) });
  console.log(`HTTP ${res.status}`);
  if (!res.ok) return;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destino));
  const mb = (fs.statSync(destino).size / 1048576).toFixed(1);
  console.log(`Baixado: ${mb} MB em ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const rl = readline.createInterface({ input: fs.createReadStream(destino, "latin1") });
  let cabecalho = null;
  let linhas = 0;
  const tipos = new Set();
  // Por (tipo, vencimento), guarda só a linha com a data base mais recente.
  const recentes = new Map();

  for await (const linha of rl) {
    if (!cabecalho) {
      cabecalho = linha;
      console.log(`Cabeçalho: ${linha}`);
      continue;
    }
    linhas += 1;
    const col = linha.split(";");
    if (col.length < 5) continue;
    const [tipo, venc, base, taxaCompra, taxaVenda] = col;
    tipos.add(tipo);
    if (!venc.endsWith("2032")) continue;
    const chave = `${tipo}|${venc}`;
    const iso = paraData(base);
    const atual = recentes.get(chave);
    if (!atual || iso > atual.iso) recentes.set(chave, { iso, base, taxaCompra, taxaVenda });
  }

  console.log(`\nLinhas: ${linhas}`);
  console.log(`\nTipos de título no arquivo:\n${[...tipos].sort().join("\n")}`);
  console.log(`\nPapéis com vencimento em 2032:`);
  for (const [chave, v] of [...recentes].sort()) {
    console.log(`- ${chave} — última base ${v.base}: compra ${v.taxaCompra} / venda ${v.taxaVenda}`);
  }
})();
