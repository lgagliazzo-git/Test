// Temporário. A API que o Tesouro Direto usava saiu do ar (HTTP 410), o
// arquivo diário da ANBIMA mudou de lugar (404) e tesourodireto.com.br está
// atrás de Cloudflare (403). O que respondeu foi o CKAN do Tesouro
// Transparente. Este passo lista o que ele oferece: quais recursos existem,
// se dá para consultar filtrado (datastore) em vez de baixar o CSV inteiro,
// e se algum dataset cobre NTN-C. Roda de dentro do Actions porque a rede
// daqui não alcança nenhuma dessas fontes.
const TIMEOUT_MS = 25000;
const CKAN = "https://www.tesourotransparente.gov.br/ckan/api/3/action";
const PACOTE_TD = "df56aa42-484a-4a59-8184-7676580c81e3";

async function pegar(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const corpo = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${corpo.slice(0, 200)}`);
  return JSON.parse(corpo);
}

async function listarRecursos() {
  const json = await pegar(`${CKAN}/package_show?id=${PACOTE_TD}`);
  const recursos = json.result?.resources || [];
  console.log(`\n=== Recursos de "${json.result?.title}" (${recursos.length})`);
  for (const r of recursos) {
    console.log(`- ${r.name} [${r.format}] datastore=${r.datastore_active} id=${r.id}\n  ${r.url}`);
  }
  return recursos;
}

// Se o datastore estiver ativo, dá para pedir só as linhas do papel que
// interessa — resposta de alguns KB em vez do CSV com todo o histórico.
async function testarDatastore(recursos) {
  for (const r of recursos) {
    const url = `${CKAN}/datastore_search?resource_id=${r.id}&limit=2`;
    try {
      const json = await pegar(url);
      const campos = (json.result?.fields || []).map((f) => f.id).join(", ");
      console.log(`\n=== datastore OK em ${r.name}\ncampos: ${campos}`);
      console.log(`amostra: ${JSON.stringify(json.result?.records?.[0])}`);
    } catch (err) {
      console.log(`\n=== datastore indisponível em ${r.name}: ${err.message.slice(0, 120)}`);
    }
  }
}

// O dataset do Tesouro Direto cobre só o que é vendido no Tesouro Direto, e
// NTN-C não é oferecida há anos. Procura no portal se existe outro dataset
// que cubra o papel.
async function procurarDatasets() {
  for (const termo of ["NTN-C", "mercado secundario titulos publicos", "IGP-M titulos"]) {
    try {
      const json = await pegar(`${CKAN}/package_search?q=${encodeURIComponent(termo)}&rows=8`);
      const nomes = (json.result?.results || []).map((p) => `${p.title} [${p.name}]`);
      console.log(`\n=== busca "${termo}" (${json.result?.count}):\n${nomes.join("\n")}`);
    } catch (err) {
      console.log(`\n=== busca "${termo}" falhou: ${err.message.slice(0, 120)}`);
    }
  }
}

(async () => {
  const recursos = await listarRecursos();
  await testarDatastore(recursos);
  await procurarDatasets();
})();
