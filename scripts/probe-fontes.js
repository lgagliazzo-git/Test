// Temporário. A API que o Tesouro Direto usava para publicar preço e taxa
// dos títulos saiu do ar (HTTP 410), e daqui de dentro não dá para testar
// candidata nenhuma: a rede do sandbox não alcança nem a do Banco Central,
// que a gente sabe que funciona no Actions. Então este script pergunta de
// lá: bate em cada fonte candidata e imprime o que voltou. Uma execução
// responde quais servem, do mesmo jeito que o probe de símbolos do widget.
const TIMEOUT_MS = 20000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ANBIMA publica o mercado secundário de títulos públicos em um arquivo
// diário de texto, nomeado pela data (ddmmaa). É a fonte oficial da taxa
// indicativa da NTN-C. O arquivo do dia só sai depois do fechamento, então
// olha alguns dias para trás até achar um que exista.
function datasAnbima(quantos) {
  const urls = [];
  for (let i = 0; i < quantos; i += 1) {
    const d = new Date(Date.now() - i * 86400000);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const aa = String(d.getUTCFullYear()).slice(2);
    urls.push(`https://www.anbima.com.br/informacoes/merc-sec/arqs/ms${dd}${mm}${aa}.txt`);
  }
  return urls;
}

const CANDIDATAS = [
  ...datasAnbima(5),
  // Tesouro Transparente (CKAN) — mesmo dado do Tesouro Direto, publicado
  // como dataset. Vale ver se o datastore responde consulta filtrada, que
  // evitaria baixar o CSV inteiro (histórico desde 2002).
  "https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show?id=taxas-dos-titulos-ofertados-pelo-tesouro-direto",
  // Sucessoras plausíveis da API que morreu.
  "https://www.tesourodireto.com.br/api/treasury/bonds",
  "https://api.tesourodireto.com.br/api/treasury/bonds",
];

async function probe(url) {
  const controle = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: controle });
    const corpo = await res.text();
    const amostra = corpo.slice(0, 400).replace(/\s+/g, " ");
    console.log(`\n=== ${url}\nHTTP ${res.status} — ${corpo.length} bytes\n${amostra}`);
    // Se for o arquivo da ANBIMA, mostra as linhas de NTN-C: é o que
    // interessa saber, e é o que decide o formato do parser.
    if (res.ok && corpo.includes("NTN-C")) {
      const linhas = corpo.split("\n").filter((l) => l.startsWith("NTN-C"));
      console.log(`NTN-C encontradas (${linhas.length}):\n${linhas.join("\n")}`);
    }
    if (res.ok && corpo.includes("LTN")) {
      const linhas = corpo.split("\n").filter((l) => l.startsWith("LTN"));
      console.log(`LTN encontradas (${linhas.length}):\n${linhas.join("\n")}`);
    }
  } catch (err) {
    console.log(`\n=== ${url}\nFALHOU: ${err.message}`);
  }
}

(async () => {
  for (const url of CANDIDATAS) await probe(url);
})();
