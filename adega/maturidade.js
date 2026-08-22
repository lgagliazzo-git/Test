// Cruzamento entre a adega e o Wine Enthusiast 2023 Vintage Chart.
// Usado tanto pelo script que preenche o wines.json quanto pela tela, para
// que um vinho novo receba a mesma classificação sem depender de mim.

// Cada regra casa um vinho com uma faixa da tabela. A ordem importa: a
// primeira que casar vence, então o específico vem antes do genérico.
const REGRAS_MATURIDADE = [
  // --- Itália ---
  { faixa: "IT-Brunello", pais: "Itália", origem: /montalcino/i, nome: /brunello/i },
  { faixa: "IT-ChiantiClassico", pais: "Itália", origem: /chianti/i },
  { faixa: "IT-Barolo", pais: "Itália", nome: /barolo|barbaresco/i },
  { faixa: "IT-Amarone", pais: "Itália", origem: /vêneto|veneto|valpolicella|veronese/i },
  { faixa: "IT-Puglia", pais: "Itália", origem: /puglia|manduria|salento/i },
  { faixa: "IT-Sicilia", pais: "Itália", origem: /sicília|sicilia|etna/i },
  { faixa: "IT-Campania", pais: "Itália", origem: /campânia|campania|irpinia|taurasi/i },
  { faixa: "IT-Sardenha", pais: "Itália", origem: /sardenha|sulcis/i },
  { faixa: "IT-Bolgheri", pais: "Itália", origem: /bolgheri/i },
  { faixa: "IT-ChiantiClassico", pais: "Itália", origem: /toscana/i },

  // --- Espanha ---
  { faixa: "ES-Rioja", pais: "Espanha", origem: /rioja|haro|sonsierra/i },

  // --- França ---
  { faixa: "FR-PomerolStEmilion", pais: "França", origem: /saint-émilion|st-émilion|pomerol/i },
  { faixa: "FR-GravesTinto", pais: "França", origem: /pessac|graves/i },
  { faixa: "FR-Chablis", pais: "França", origem: /chablis/i },

  // --- Portugal ---
  { faixa: "PT-BrancoMesa", pais: "Portugal", tipo: "Branco" },
  { faixa: "PT-TintoMesa", pais: "Portugal" },

  // --- Estados Unidos ---
  { faixa: "US-NapaCabernet", pais: "EUA", origem: /napa/i },
  { faixa: "US-RRVPinotNoir", pais: "EUA", origem: /russian river/i },
  { faixa: "US-ColumbiaCabMer", pais: "EUA", origem: /columbia/i },
  { faixa: "US-WillamettePinot", pais: "EUA", origem: /oregon|willamette/i },

  // --- Argentina e Chile ---
  { faixa: "AR-Mendoza", pais: "Argentina" },
  { faixa: "CL-Colchagua", pais: "Chile", origem: /colchagua|cachapoal|curicó|sagrada familia/i },
  { faixa: "CL-Maipo", pais: "Chile", origem: /maipo|puente alto/i },
];

function faixaDoVinho(w) {
  const origem = `${w.origin || ""} ${w.name || ""}`;
  for (const r of REGRAS_MATURIDADE) {
    if (r.pais && w.country !== r.pais) continue;
    if (r.tipo && w.type !== r.tipo) continue;
    if (r.nome && !r.nome.test(w.name || "")) continue;
    if (r.origem && !r.origem.test(origem)) continue;
    return r.faixa;
  }
  return null;
}

// Devolve a letra da tabela, ou null quando não há cruzamento: país fora da
// tabela (Brasil), safra fora do período coberto, ou vinho sem safra.
function maturidadeDe(w, chart) {
  if (!w.vintage) return null;
  const ano = Number(String(w.vintage).slice(0, 4));
  if (!Number.isFinite(ano)) return null;
  const i = chart.primeiroAno - ano;
  if (i < 0 || i >= 26) return null;
  const faixa = faixaDoVinho(w);
  if (!faixa || !chart.faixas[faixa]) return null;
  const letra = chart.faixas[faixa][i];
  return letra && letra !== " " ? letra : null;
}

if (typeof module !== "undefined") module.exports = { faixaDoVinho, maturidadeDe };
