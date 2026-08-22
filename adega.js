const STORAGE_KEY = "gaglidom_adega_wines"; // formato antigo: a lista inteira
const EDITS_KEY = "gaglidom_adega_edicoes"; // formato atual: só as alterações
const VIEW_KEY = "gaglidom_adega_view";

// Lista do adega/wines.json publicado, sem as alterações locais. Serve de
// base para saber o que o usuário mudou de fato.
let publicados = [];

// Abaixo disso as 14 colunas não cabem, então lista é o padrão — mas a
// escolha do usuário, se houver, sempre vence.
const TABLE_MIN_WIDTH = 1330;

let wines = [];
// Tipo escolhido nos botões de filtro; vazio significa todos.
let filtroTipo = "";
let sortKey = "name";
let sortAsc = true;

const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

const NUMERIC_FIELDS = new Set(["quantity", "priceBR", "pricePaid", "priceUSD", "rating", "abv"]);
// Campos digitáveis direto na linha.
const EDITABLE_FIELDS = { quantity: "Qtd", priceBR: "Preço BR", pricePaid: "Preço pago", abv: "Teor alcoólico" };

// Harmonização sugerida para vinho novo, pela uva principal do corte. É a
// mesma referência usada para preencher o catálogo; serve de ponto de
// partida e pode ser corrigida depois.
const PAIRING_POR_UVA = {
  sangiovese: "Massas com molho de tomate, pizza, parmesão",
  "cabernet sauvignon": "Carnes vermelhas grelhadas, cordeiro, queijos curados",
  tempranillo: "Cordeiro assado, presunto cru, paella de carne",
  chardonnay: "Peixes assados, frango cremoso, risoto",
  malbec: "Churrasco, picanha, empanadas",
  primitivo: "Carnes de panela, embutidos, queijos maduros",
  corvina: "Assados de longa cocção, risoto de funghi, queijos duros",
  merlot: "Carnes suaves, aves assadas, massas com molho leve",
  aglianico: "Cordeiro, carnes de caça, queijos picantes",
  "sauvignon blanc": "Frutos do mar, saladas, queijo de cabra",
  "pinot noir": "Salmão, pato, cogumelos",
  syrah: "Carnes defumadas, costela, pimenta-do-reino",
  gamay: "Charcutaria, aves, pratos leves",
  negroamaro: "Carnes assadas, berinjela, queijos de ovelha",
  glera: "Aperitivos, frituras, frutos do mar leves",
  "touriga nacional": "Carnes vermelhas, feijoada, queijos curados",
  grenache: "Cordeiro, cozidos, especiarias",
  garnacha: "Cordeiro, cozidos, especiarias",
  carmenère: "Carnes grelhadas, pimentão, comida apimentada",
  "cabernet franc": "Carnes grelhadas, legumes assados, queijos médios",
  nebbiolo: "Trufas, carnes de caça, risoto de funghi",
  bonarda: "Carnes de panela, empanadas, queijos leves",
};

function harmonizaPorUva(uva) {
  const principal = String(uva || "").split("/")[0].trim().toLowerCase();
  if (!principal) return null;
  if (PAIRING_POR_UVA[principal]) return PAIRING_POR_UVA[principal];
  const parcial = Object.keys(PAIRING_POR_UVA).find((k) => principal.includes(k));
  return parcial ? PAIRING_POR_UVA[parcial] : null;
}

function isBlank(v) {
  return v === null || v === undefined || v === "";
}

function normalizeHeader(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .replace(/\s+/g, "_");
}

// Aceita "1.234,56" (pt-BR), "1,234.56" (en) e "R$ 199".
function parseNumber(raw) {
  if (isBlank(raw)) return null;
  let s = String(raw).replace(/[^\d,.-]/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(value, currency) {
  if (isBlank(value)) return null;
  return Number(value).toLocaleString(currency === "USD" ? "en-US" : "pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  });
}

function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function searchLink(wine, kind) {
  const base = [wine.name, wine.vintage].filter(Boolean).join(" ");
  const urls = {
    priceBR: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(base + " vinho preço")}`,
    priceUSD: `https://www.wine-searcher.com/find/${encodeURIComponent(base)}`,
    rating: `https://www.vivino.com/search/wines?q=${encodeURIComponent(base)}`,
  };
  const labels = { priceBR: "buscar", priceUSD: "buscar", rating: "buscar" };
  return `<a class="adega-price-search" href="${urls[kind]}" target="_blank" rel="noopener">${labels[kind]}</a>`;
}

function editableCell(wine, field) {
  const raw = isBlank(wine[field]) ? "" : wine[field];
  // type="number" recusa vírgula, e em pt-BR é assim que se digita preço.
  // text + inputmode="decimal" aceita os dois separadores e mantém o teclado
  // numérico no celular; parseNumber normaliza na leitura.
  const tipo = field === "quantity" ? 'type="number" step="1"' : 'type="text"';
  // Vermelho = valor que eu estimei, não li de rótulo nem achei em loja:
  // preço convertido do dólar, ou teor alcoólico típico do estilo.
  // Some assim que o valor é digitado por cima (ver o handler de input).
  const estimado =
    (field === "priceBR" && wine.priceBREstimado) || (field === "abv" && wine.abvEstimado)
      ? " is-estimado"
      : "";
  return `<input ${tipo} class="adega-cell-input${estimado}" inputmode="decimal"
            value="${escapeHtml(raw)}" data-field="${field}" data-name="${escapeHtml(wine.name)}"
            aria-label="${EDITABLE_FIELDS[field]} de ${escapeHtml(wine.name)}" />`;
}

// Campo que o usuário não soube preencher ao importar a foto: fica visível
// em vermelho em vez de virar um travessão igual aos demais vazios.
function textoCell(wine, campo) {
  const bruto = wine[campo];
  if (!isBlank(bruto)) return escapeHtml(bruto);
  return (wine.faltando || []).includes(campo)
    ? `<span class="adega-falta">a completar</span>`
    : "—";
}

function cellValue(wine, kind) {
  const raw = wine[kind];
  if (isBlank(raw)) return searchLink(wine, kind);
  if (kind === "priceBR") return fmtMoney(raw, "BRL");
  if (kind === "priceUSD") return fmtMoney(raw, "USD");
  return Number(raw).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function value(wine, key) {
  if (NUMERIC_FIELDS.has(key)) {
    // Number(null) é 0, então o vazio tem de ser barrado antes do Number,
    // senão vinho sem preço ordena como se custasse zero.
    if (isBlank(wine[key])) return null;
    const n = Number(wine[key]);
    return Number.isFinite(n) ? n : null;
  }
  return wine[key] ?? "";
}

function compare(a, b) {
  const va = value(a, sortKey);
  const vb = value(b, sortKey);

  // Campos vazios sempre no fim, independente da direção da ordenação.
  const emptyA = va === "" || va === null;
  const emptyB = vb === "" || vb === null;
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;

  const result = typeof va === "number" && typeof vb === "number" ? va - vb : COLLATOR.compare(va, vb);
  return sortAsc ? result : -result;
}

function matches(wine, term) {
  if (!term) return true;
  return [wine.name, wine.type, wine.country, wine.vintage, wine.grape, wine.origin, wine.pairing]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(term);
}

// "Primitivo / Negroamaro" precisa aparecer ao filtrar por qualquer uma
// das duas, então o campo é quebrado em uvas individuais.
function grapesOf(wine) {
  return String(wine.grape || "")
    .split(/[/,]/)
    .map((g) => g.trim())
    .filter(Boolean);
}

function currentFilters() {
  return {
    type: filtroTipo,
    country: document.getElementById("filter-country").value,
    grape: document.getElementById("filter-grape").value,
    min: parseNumber(document.getElementById("filter-price-min").value),
    max: parseNumber(document.getElementById("filter-price-max").value),
  };
}

function passesFilters(wine, f) {
  if (f.type && wine.type !== f.type) return false;
  if (f.country && wine.country !== f.country) return false;
  if (f.grape && !grapesOf(wine).includes(f.grape)) return false;

  if (f.min !== null || f.max !== null) {
    // Vinho sem preço não entra numa faixa de preço — deixá-lo passar
    // inflaria a contagem e sujaria o total.
    if (isBlank(wine.priceBR)) return false;
    const price = Number(wine.priceBR);
    if (f.min !== null && price < f.min) return false;
    if (f.max !== null && price > f.max) return false;
  }
  return true;
}

function fillFilterOptions() {
  const countries = [...new Set(wines.map((w) => w.country).filter(Boolean))].sort(COLLATOR.compare);
  const grapes = [...new Set(wines.flatMap(grapesOf))].sort(COLLATOR.compare);

  const fill = (id, values, allLabel) => {
    const select = document.getElementById(id);
    const chosen = select.value;
    select.innerHTML =
      `<option value="">${allLabel}</option>` +
      values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    // Mantém a seleção se o valor ainda existir depois de uma importação.
    if (values.includes(chosen)) select.value = chosen;
  };

  fill("filter-country", countries, "Todos");
  fill("filter-grape", grapes, "Todas");
  renderBotoesTipo();
}

// Ordem de adega, não alfabética: tinto primeiro por ser a maioria.
const ORDEM_TIPOS = ["Tinto", "Branco", "Rosé", "Espumante"];

function renderBotoesTipo() {
  const tipos = [...new Set(wines.map((w) => w.type).filter(Boolean))].sort(
    (a, b) => ORDEM_TIPOS.indexOf(a) - ORDEM_TIPOS.indexOf(b)
  );
  // Se o tipo filtrado sumir do catálogo, o filtro fica preso num resultado
  // vazio sem botão para desfazer.
  if (filtroTipo && !tipos.includes(filtroTipo)) filtroTipo = "";

  document.getElementById("filter-type").innerHTML = ["", ...tipos]
    .map(
      (t) =>
        `<button type="button" class="adega-tipo-btn${t === filtroTipo ? " is-ativo" : ""}"
           data-tipo="${escapeHtml(t)}" aria-pressed="${t === filtroTipo}">${t || "Todos"}</button>`
    )
    .join("");
}

function qtyOf(wine) {
  const n = Number(wine.quantity);
  // Um vinho catalogado é ao menos uma garrafa; quantidade em branco não
  // pode zerar o valor dele no total.
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function renderSummary(visible) {
  const bottles = visible.reduce((sum, w) => sum + qtyOf(w), 0);

  const withPrice = visible.filter((w) => !isBlank(w.priceBR));
  const total = withPrice.reduce((sum, w) => sum + Number(w.priceBR) * qtyOf(w), 0);

  const totalPaid = visible.reduce((sum, w) => sum + (isBlank(w.pricePaid) ? 0 : Number(w.pricePaid) * qtyOf(w)), 0);

  const rated = visible.filter((w) => !isBlank(w.rating));
  const avgRating = rated.length
    ? (rated.reduce((s, w) => s + Number(w.rating), 0) / rated.length).toLocaleString("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    : null;

  const foot = document.getElementById("adega-foot");
  foot.innerHTML = visible.length
    ? `<tr>
         <td colspan="3" class="adega-foot-label">Totais (× quantidade)</td>
         <td class="adega-td-num">${bottles}</td>
         <td class="adega-td-num">${fmtMoney(total, "BRL")}</td>
         <td class="adega-td-num">${fmtMoney(totalPaid, "BRL")}</td>
         <td class="adega-td-num">—</td>
         <td class="adega-td-num">${avgRating || "—"}</td>
         <td colspan="7">—</td>
       </tr>`
    : "";
}

function photoCell(wine) {
  // photoNova é a foto escolhida na tela e ainda não gravada no repositório.
  const src = wine.photo || wine.photoNova;
  if (!src) return `<span class="adega-nophoto">—</span>`;
  const alt = escapeHtml(wine.name || "vinho");
  return `<button type="button" class="adega-photo-btn" data-zoom="${escapeHtml(src)}"
            data-name="${alt}" aria-label="Ampliar foto de ${alt}">
            <img class="adega-photo" src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />
          </button>`;
}

// ---------- Zoom da foto ----------

function openZoom(src, name) {
  document.getElementById("adega-zoom-img").src = src;
  document.getElementById("adega-zoom-img").alt = name;
  document.getElementById("adega-zoom-caption").textContent = name;
  document.getElementById("adega-zoom").hidden = false;
  document.body.classList.add("no-scroll");
}

function closeZoom() {
  document.getElementById("adega-zoom").hidden = true;
  // Solta a imagem para não segurar memória com dezenas de fotos abertas.
  document.getElementById("adega-zoom-img").removeAttribute("src");
  document.body.classList.remove("no-scroll");
}

function render() {
  const term = document.getElementById("adega-search").value.trim().toLowerCase();
  const filters = currentFilters();
  const visible = wines.filter((w) => matches(w, term) && passesFilters(w, filters)).sort(compare);

  const body = document.getElementById("adega-body");
  const empty = document.getElementById("adega-empty");

  body.innerHTML = visible
    .map(
      (w) => `
        <tr>
          <td class="adega-td-photo">${photoCell(w)}</td>
          <td class="adega-td-name" data-label="Vinho">${escapeHtml(w.name) || "—"}</td>
          <td data-label="País">${textoCell(w, "country")}</td>
          <td class="adega-td-num" data-label="Qtd">${editableCell(w, "quantity")}</td>
          <td class="adega-td-num" data-label="Preço BR">${editableCell(w, "priceBR")}</td>
          <td class="adega-td-num" data-label="Preço pago">${editableCell(w, "pricePaid")}</td>
          <td class="adega-td-num" data-label="Preço origem">${cellValue(w, "priceUSD")}</td>
          <td class="adega-td-num" data-label="Nota">${cellValue(w, "rating")}</td>
          <td data-label="Data de fabricação">${textoCell(w, "vintage")}</td>
          <td class="adega-td-grape" data-label="Tipo de uva">${textoCell(w, "grape")}</td>
          <td class="adega-td-origin" data-label="Origem">${textoCell(w, "origin")}</td>
          <td class="adega-td-pairing" data-label="Harmoniza com">${textoCell(w, "pairing")}</td>
          <td class="adega-td-abv" data-label="Álcool">${editableCell(w, "abv")}<span class="adega-abv-sufixo">%</span></td>
          <td class="adega-td-tipo" data-label="Tipo">${escapeHtml(w.type) || "—"}</td>
          <td class="adega-td-del">
            <button type="button" class="adega-del-btn" data-del="${escapeHtml(w.name)}"
                    title="Excluir ${escapeHtml(w.name)}" aria-label="Excluir ${escapeHtml(w.name)}">🗑</button>
          </td>
        </tr>`
    )
    .join("");

  empty.hidden = visible.length > 0;
  if (wines.length === 0) {
    empty.textContent = "Nenhum vinho cadastrado ainda. Me mande as fotos que eu preencho a tabela.";
  } else if (visible.length === 0) {
    empty.textContent = "Nenhum vinho encontrado para essa busca.";
  }

  const count = document.getElementById("adega-count");
  count.textContent =
    wines.length === 0
      ? ""
      : visible.length === wines.length
        ? `${wines.length} vinho${wines.length === 1 ? "" : "s"}`
        : `${visible.length} de ${wines.length}`;

  document.querySelectorAll("th[data-sort]").forEach((th) => {
    const active = th.dataset.sort === sortKey;
    th.classList.toggle("adega-sorted", active);
    th.dataset.dir = active ? (sortAsc ? "asc" : "desc") : "";
  });

  document.getElementById("adega-sort").value = sortKey;

  renderSummary(visible);
}

// ---------- Formato de exibição ----------

function applyView(view) {
  document.getElementById("adega-table-wrap").classList.toggle("is-list", view === "list");
  document.querySelectorAll(".adega-view-btn").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.view === view));
  });
}

function setView(view) {
  localStorage.setItem(VIEW_KEY, view);
  applyView(view);
}

function currentView() {
  return localStorage.getItem(VIEW_KEY) || (window.innerWidth > TABLE_MIN_WIDTH ? "table" : "list");
}

// ---------- Exportar como tabela de texto ----------

// Colunas da exportação: largura fixa, porque o alinhamento é o que faz a
// tabela sobreviver ao copiar e colar. Nomes longos são cortados em vez de
// quebrar a linha, senão a grade se desmancha.
const EXPORT_TEXTO = [
  { titulo: "Vinho", largura: 26, valor: (w) => w.name },
  { titulo: "País", largura: 12, valor: (w) => w.country },
  { titulo: "Safra", largura: 5, valor: (w) => w.vintage },
  { titulo: "Uva", largura: 20, valor: (w) => w.grape },
  { titulo: "Origem", largura: 18, valor: (w) => w.origin },
  { titulo: "Qtd", largura: 3, valor: (w) => w.quantity, direita: true },
  { titulo: "R$", largura: 9, valor: (w) => moedaTexto(w.priceBR), direita: true },
  { titulo: "Pago", largura: 9, valor: (w) => moedaTexto(w.pricePaid), direita: true },
  { titulo: "US$", largura: 8, valor: (w) => moedaTexto(w.priceUSD), direita: true },
  { titulo: "Nota", largura: 4, valor: (w) => w.rating, direita: true },
  { titulo: "Álc", largura: 5, valor: (w) => (isBlank(w.abv) ? null : `${String(w.abv).replace(".", ",")}%`), direita: true },
];

// Sem símbolo de moeda: a coluna já diz qual é, e cada caractere conta na
// largura total da linha.
function moedaTexto(valor) {
  if (isBlank(valor)) return null;
  return Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ajusta(texto, largura, direita) {
  let t = isBlank(texto) ? "" : String(texto);
  if (t.length > largura) t = t.slice(0, largura - 1) + "…";
  return direita ? t.padStart(largura) : t.padEnd(largura);
}

function tabelaTexto(lista) {
  const linha = (celulas) => celulas.join(" | ").trimEnd();
  const cabecalho = linha(EXPORT_TEXTO.map((c) => ajusta(c.titulo, c.largura, c.direita)));
  const separador = EXPORT_TEXTO.map((c) => "-".repeat(c.largura)).join("-+-");
  const corpo = lista.map((w) => linha(EXPORT_TEXTO.map((c) => ajusta(c.valor(w), c.largura, c.direita))));

  const garrafas = lista.reduce((soma, w) => soma + qtyOf(w), 0);
  const total = lista.reduce((soma, w) => soma + (isBlank(w.priceBR) ? 0 : Number(w.priceBR) * qtyOf(w)), 0);
  const rodape = `${lista.length} rótulos · ${garrafas} garrafas · ${fmtMoney(total, "BRL")}`;

  // As crases fazem o WhatsApp usar fonte de largura fixa; sem isso as
  // colunas desalinham na hora que a mensagem é enviada.
  return ["```", cabecalho, separador, ...corpo, "```", rodape].join("\n");
}

function visiveis() {
  const termo = document.getElementById("adega-search").value.trim().toLowerCase();
  const filtros = currentFilters();
  return wines.filter((w) => matches(w, termo) && passesFilters(w, filtros)).sort(compare);
}

function persist() {
  gravarEdicoes();
  atualizarEstadoSalvar();
}

function gravarEdicoes() {
  const base = new Map(publicados.map((w) => [w._chave, w]));
  const edicoes = {};
  const novos = [];
  const presentes = new Set();

  for (const w of wines) {
    presentes.add(w._chave);
    const original = base.get(w._chave);
    if (!original) {
      novos.push(w);
      continue;
    }
    const dif = {};
    for (const campo of [...Object.keys(EDITABLE_FIELDS), "priceBREstimado", "abvEstimado"]) {
      if (w[campo] !== original[campo]) dif[campo] = w[campo];
    }
    if (Object.keys(dif).length) edicoes[w._chave] = dif;
  }

  const removidos = publicados.filter((w) => !presentes.has(w._chave)).map((w) => w._chave);

  localStorage.setItem(
    EDITS_KEY,
    JSON.stringify({ updatedAt: new Date().toISOString(), edicoes, novos, removidos })
  );
}

// ---------- Salvar de verdade (grava o wines.json no repositório) ----------

const REPO = {
  owner: "lgagliazzo-git",
  repo: "Test",
  branch: "claude/landing-page-domain-esf6bn",
  path: "adega/wines.json",
};
const TOKEN_KEY = "gaglidom_github_token";

// btoa só aceita bytes; os nomes têm acento, então codifica em UTF-8 antes.
function paraBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function pedirToken(motivo) {
  const atual = localStorage.getItem(TOKEN_KEY) || "";
  const token = prompt(
    `${motivo}\n\nCole aqui o token do GitHub (fica guardado só neste aparelho):`,
    atual
  );
  if (token === null) return null;
  const limpo = token.trim();
  if (!limpo) return null;
  localStorage.setItem(TOKEN_KEY, limpo);
  return limpo;
}

async function chamarGitHub(caminho, opcoes, token) {
  return fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}${caminho}`, {
    ...opcoes,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      ...(opcoes.headers || {}),
    },
  });
}

// O corpo do erro do GitHub costuma dizer exatamente o que está errado
// ("Resource not accessible by personal access token", "Branch not found").
// Sem isso a tela mostrava só o código HTTP, que não ajuda a resolver.
async function motivoDoErro(resposta) {
  try {
    const corpo = await resposta.json();
    if (corpo && corpo.message) return `${corpo.message} (HTTP ${resposta.status})`;
  } catch {
    /* resposta sem JSON */
  }
  return `HTTP ${resposta.status}`;
}

function estadoSalvar(texto, tipo = "") {
  const el = document.getElementById("adega-save-estado");
  el.textContent = texto;
  el.className = `adega-salvar-estado${tipo ? ` is-${tipo}` : ""}`;
}

function temAlteracoes() {
  try {
    const g = JSON.parse(localStorage.getItem(EDITS_KEY) || "null");
    if (!g) return false;
    return Object.keys(g.edicoes || {}).length > 0 || (g.novos || []).length > 0 || (g.removidos || []).length > 0;
  } catch {
    return false;
  }
}

function atualizarEstadoSalvar() {
  const botao = document.getElementById("adega-save");
  // Só faz sentido trocar o que já existe; sem token guardado, quem pede é
  // o próprio botão de salvar.
  document.getElementById("adega-trocar-token").hidden = !localStorage.getItem(TOKEN_KEY);
  if (temAlteracoes()) {
    botao.disabled = false;
    estadoSalvar("Há alterações salvas só neste aparelho. Clique para publicar no site.", "pendente");
  } else {
    botao.disabled = true;
    estadoSalvar("Nada para salvar — o que está na tela já é o que está publicado.");
  }
}

function apelidoArquivo(nome) {
  return (
    String(nome)
      .toLowerCase()
      .normalize("NFD")
      .replace(new RegExp("[\u0300-\u036f]", "g"), "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "vinho"
  );
}

// A foto escolhida na tela vive como data URL. Publicar é gravá-la como
// arquivo em adega/fotos/ e deixar no vinho só o caminho — senão a imagem
// inteira iria parar dentro do wines.json, que engordaria a cada garrafa.
async function publicarFotos(token) {
  const pendentes = wines.filter((w) => w.photoNova);
  for (const w of pendentes) {
    const caminho = `adega/fotos/${apelidoArquivo(w.name)}-${Date.now().toString(36)}.jpg`;
    const base64 = w.photoNova.split(",")[1];
    const res = await chamarGitHub(
      `/contents/${caminho}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: `Adiciona foto de ${w.name}`,
          content: base64,
          branch: REPO.branch,
        }),
      },
      token
    );
    if (!res.ok) throw new Error(`não consegui enviar a foto — ${await motivoDoErro(res)}`);
    w.photo = caminho;
    delete w.photoNova;
  }
  return pendentes.length;
}

async function salvarNoSite() {
  const botao = document.getElementById("adega-save");
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = pedirToken(
      "Para salvar é preciso um token do GitHub (fine-grained) com acesso ao " +
        `repositório ${REPO.owner}/${REPO.repo} e permissão Contents: Read and write.`
    );
    if (!token) return;
  }

  botao.disabled = true;
  estadoSalvar("Salvando...");

  try {
    const enviadas = await publicarFotos(token);
    if (enviadas) estadoSalvar(`${enviadas} foto(s) enviada(s), salvando a tabela...`);
  } catch (err) {
    estadoSalvar(`Não consegui salvar: ${err.message}`, "erro");
    botao.disabled = false;
    return;
  }

  const conteudo = JSON.stringify(
    { updatedAt: new Date().toISOString(), wines: wines.map(({ _chave, photoNova, ...w }) => w) },
    null,
    2
  );

  try {
    // O sha da versão atual é obrigatório para o GitHub aceitar a gravação,
    // e é o que impede sobrescrever uma alteração feita por outro aparelho.
    const atual = await chamarGitHub(`/contents/${REPO.path}?ref=${REPO.branch}`, {}, token);
    if (atual.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      estadoSalvar("Token inválido ou expirado. Clique de novo para informar outro.", "erro");
      botao.disabled = false;
      return;
    }
    if (atual.status === 404) {
      throw new Error(
        `o token não enxerga ${REPO.owner}/${REPO.repo}. Confira se ele foi criado para esse ` +
          "repositório e com a permissão Contents: Read and write"
      );
    }
    if (!atual.ok) throw new Error(`não consegui ler o arquivo publicado — ${await motivoDoErro(atual)}`);
    const { sha } = await atual.json();

    const gravou = await chamarGitHub(
      `/contents/${REPO.path}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: "Atualiza a adega pela tela",
          content: paraBase64(conteudo),
          sha,
          branch: REPO.branch,
        }),
      },
      token
    );

    if (gravou.status === 409) throw new Error("o arquivo mudou enquanto você editava; recarregue a página e tente de novo");
    if (gravou.status === 403 || gravou.status === 404) {
      throw new Error(`o token não tem permissão de escrita aqui — ${await motivoDoErro(gravou)}`);
    }
    if (!gravou.ok) throw new Error(await motivoDoErro(gravou));

    // Publicado: o que era alteração local agora é o próprio arquivo.
    publicados = wines.map((w) => ({ ...w }));
    localStorage.removeItem(EDITS_KEY);
    localStorage.removeItem(STORAGE_KEY);
    estadoSalvar("Salvo. Em cerca de um minuto aparece em qualquer aparelho.", "ok");
  } catch (err) {
    const msg =
      err instanceof TypeError
        ? "não consegui falar com o GitHub (sem internet, ou a conexão foi bloqueada)"
        : err.message;
    estadoSalvar(`Não consegui salvar: ${msg}`, "erro");
    botao.disabled = false;
  }
}

// Nomes se repetem no catálogo (duas Villa Antinori 2022, duas Sessantanni),
// então a chave leva um contador para a edição cair na garrafa certa.
function comChaves(lista) {
  const vistos = new Map();
  return lista.map((w) => {
    const base = `${w.name}|${w.vintage ?? ""}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return { ...w, _chave: `${base}|${n}` };
  });
}

function lerEdicoes() {
  try {
    const novo = JSON.parse(localStorage.getItem(EDITS_KEY) || "null");
    if (novo) return { edicoes: {}, novos: [], removidos: [], ...novo };
  } catch {
    /* segue para o formato antigo */
  }

  // Formato antigo: a lista inteira. Converte para alterações comparando
  // com o arquivo publicado, para ninguém perder o que já tinha editado.
  try {
    const antigo = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!antigo?.wines?.length) return null;
    const base = new Map(publicados.map((w) => [w._chave, w]));
    const edicoes = {};
    const novos = [];
    for (const w of comChaves(antigo.wines)) {
      const original = base.get(w._chave);
      if (!original) {
        novos.push(w);
        continue;
      }
      const dif = {};
      for (const campo of [...Object.keys(EDITABLE_FIELDS), "priceBREstimado", "abvEstimado"]) {
        if (w[campo] !== original[campo]) dif[campo] = w[campo];
      }
      if (Object.keys(dif).length) edicoes[w._chave] = dif;
    }
    return { edicoes, novos, removidos: [] };
  } catch {
    return null;
  }
}

function flash(message, isError = false) {
  const el = document.getElementById("adega-bulk-msg");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("adega-bulk-msg-error", isError);
  setTimeout(() => (el.textContent = ""), 5000);
}

async function load() {
  try {
    const res = await fetch("adega/wines.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    publicados = comChaves(
      (data.wines || []).map((w) => ({
        // priceBR substituiu o campo antigo "price"; mantido para não perder
        // dado de arquivos gerados antes da mudança.
        quantity: w.quantity ?? 1,
        pricePaid: w.pricePaid ?? null,
        priceBR: w.priceBR ?? w.price ?? null,
        priceUSD: w.priceUSD ?? null,
        rating: w.rating ?? null,
        priceBREstimado: w.priceBREstimado ?? false,
        ...w,
      }))
    );
    wines = publicados.map((w) => ({ ...w }));
  } catch (err) {
    document.getElementById("adega-empty").textContent = `Não foi possível carregar a adega (${err.message}).`;
  }

  // O arquivo publicado é a base (fotos, notas, preços pesquisados) e as
  // alterações feitas na tela entram por cima, campo a campo.
  const guardado = lerEdicoes();
  if (guardado) {
    const removidos = new Set(guardado.removidos);
    wines = wines.filter((w) => !removidos.has(w._chave));
    for (const w of wines) Object.assign(w, guardado.edicoes[w._chave] || {});
    wines.push(...comChaves(guardado.novos).map((w) => ({ ...w })));
  }

  fillFilterOptions();
  render();
  atualizarEstadoSalvar();
}

document.getElementById("adega-toggle-export").addEventListener("click", () => {
  const painel = document.getElementById("adega-export");
  painel.hidden = !painel.hidden;
  if (!painel.hidden) {
    document.getElementById("adega-export-texto").value = tabelaTexto(visiveis());
  }
});

document.getElementById("adega-export-copiar").addEventListener("click", async () => {
  const campo = document.getElementById("adega-export-texto");
  try {
    await navigator.clipboard.writeText(campo.value);
    flash("Copiado. É só colar no WhatsApp ou no e-mail.");
  } catch {
    // clipboard exige contexto seguro; sem ele resta selecionar para o usuário
    campo.select();
    flash("Selecionado — use copiar do navegador.");
  }
});

// ---------- Importar foto ----------

// Foto escolhida e ainda não publicada, como data URL. Fica no vinho até o
// "Salvar no site", que aí sim grava o arquivo em adega/fotos/.
let fotoPendente = null;

// A foto do celular tem uns 4000px e 3 MB. Sem reduzir, o localStorage
// estoura já na segunda garrafa e o commit no repositório fica enorme.
function reduzirFoto(arquivo, larguraMax = 520) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("não consegui ler o arquivo"));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("arquivo não é uma imagem"));
      img.onload = () => {
        const escala = Math.min(1, larguraMax / img.width);
        const tela = document.createElement("canvas");
        tela.width = Math.round(img.width * escala);
        tela.height = Math.round(img.height * escala);
        tela.getContext("2d").drawImage(img, 0, 0, tela.width, tela.height);
        resolve(tela.toDataURL("image/jpeg", 0.82));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

document.getElementById("adega-importar-foto").addEventListener("click", () => {
  document.getElementById("adega-arquivo-foto").click();
});

document.getElementById("adega-arquivo-foto").addEventListener("change", async (e) => {
  const arquivo = e.target.files && e.target.files[0];
  e.target.value = ""; // permite escolher a mesma foto de novo
  if (!arquivo) return;
  try {
    fotoPendente = await reduzirFoto(arquivo);
  } catch (err) {
    estadoSalvar(`Não consegui usar essa foto: ${err.message}`, "erro");
    return;
  }
  document.getElementById("adega-novo-previa").src = fotoPendente;
  document.getElementById("adega-novo-foto").hidden = false;
  alternarNovo(true);
});

// ---------- Adicionar vinho ----------

function alternarNovo(mostrar) {
  const form = document.getElementById("adega-novo");
  form.hidden = mostrar === undefined ? !form.hidden : !mostrar;
  if (!form.hidden) document.getElementById("novo-name").focus();
}

document.getElementById("adega-toggle-novo").addEventListener("click", () => alternarNovo());
document.getElementById("adega-novo-cancelar").addEventListener("click", () => {
  document.getElementById("adega-novo").reset();
  fotoPendente = null;
  document.getElementById("adega-novo-foto").hidden = true;
  alternarNovo(false);
});

document.getElementById("adega-novo").addEventListener("submit", (e) => {
  e.preventDefault();
  const campo = (id) => document.getElementById(`novo-${id}`).value.trim();
  const nome = campo("name");
  const msg = document.getElementById("adega-novo-msg");
  if (!nome) return;

  const grape = campo("grape");
  const novo = {
    name: nome,
    country: campo("country") || null,
    vintage: campo("vintage") || null,
    grape: grape || null,
    origin: campo("origin") || null,
    quantity: parseNumber(campo("quantity")) ?? 1,
    priceBR: parseNumber(campo("priceBR")),
    pricePaid: parseNumber(campo("pricePaid")),
    priceUSD: null,
    rating: parseNumber(campo("rating")),
    abv: parseNumber(campo("abv")),
    pairing: harmonizaPorUva(grape),
    photo: null,
    photoNova: fotoPendente,
  };

  // Marca o que não foi informado, para aparecer em vermelho na tabela.
  novo.faltando = ["country", "vintage", "grape", "origin", "priceBR", "rating", "abv", "pairing"].filter((c) =>
    isBlank(novo[c])
  );
  if (!novo.faltando.length) delete novo.faltando;

  // Chave própria: o vinho não existe no arquivo publicado, então entra como
  // adição e não como alteração de uma linha existente.
  novo._chave = `${novo.name}|${novo.vintage ?? ""}|novo-${Date.now()}`;
  wines.push(novo);

  persist();
  fillFilterOptions();
  render();

  document.getElementById("adega-novo").reset();
  fotoPendente = null;
  document.getElementById("adega-novo-foto").hidden = true;
  alternarNovo(false);
  // flash() escreve dentro do bloco de importação, que fica escondido; aqui
  // o aviso vai para a linha do salvar, que está sempre visível.
  msg.textContent = "";
  estadoSalvar(`"${nome}" adicionado. Clique em salvar para publicar no site.`, "pendente");
});

document.getElementById("adega-save").addEventListener("click", salvarNoSite);

document.getElementById("adega-trocar-token").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  const novo = pedirToken(
    "Informe outro token do GitHub (fine-grained) com acesso ao " +
      `repositório ${REPO.owner}/${REPO.repo} e permissão Contents: Read and write.`
  );
  atualizarEstadoSalvar();
  if (novo) estadoSalvar("Token trocado. Clique em salvar para tentar de novo.");
});

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (key === sortKey) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = true;
    }
    render();
  });
});

document.getElementById("adega-sort").addEventListener("change", (e) => {
  sortKey = e.target.value;
  sortAsc = true;
  render();
});

document.getElementById("filter-type").addEventListener("click", (e) => {
  const btn = e.target.closest(".adega-tipo-btn");
  if (!btn) return;
  filtroTipo = btn.dataset.tipo;
  renderBotoesTipo();
  render();
});

["filter-country", "filter-grape", "filter-price-min", "filter-price-max"].forEach((id) => {
  document.getElementById(id).addEventListener("input", render);
});

document.getElementById("filter-clear").addEventListener("click", () => {
  ["filter-country", "filter-grape", "filter-price-min", "filter-price-max"].forEach((id) => {
    document.getElementById(id).value = "";
  });
  filtroTipo = "";
  renderBotoesTipo();
  document.getElementById("adega-search").value = "";
  render();
});

document.getElementById("adega-search").addEventListener("input", render);

// As fotos são recriadas a cada render, então o clique é escutado no
// corpo da tabela em vez de em cada botão.
document.getElementById("adega-body").addEventListener("click", (e) => {
  const btn = e.target.closest(".adega-photo-btn");
  if (btn) openZoom(btn.dataset.zoom, btn.dataset.name);

  // Excluir é irreversível pelo site (o wines.json publicado não muda),
  // então confirma antes de tirar a garrafa da lista.
  const del = e.target.closest(".adega-del-btn");
  if (del) {
    const nome = del.dataset.del;
    if (!confirm(`Excluir "${nome}" da adega?`)) return;
    const i = wines.findIndex((w) => w.name === nome);
    if (i === -1) return;
    wines.splice(i, 1);
    persist();
    render();
    flash(`"${nome}" excluído.`);
  }
});

// Só o resumo é recalculado enquanto digita — um render completo
// recriaria o input e o cursor sairia do campo.
document.getElementById("adega-body").addEventListener("input", (e) => {
  const input = e.target.closest(".adega-cell-input");
  if (!input) return;
  const wine = wines.find((w) => w.name === input.dataset.name);
  if (!wine) return;
  const campo = input.dataset.field;
  wine[campo] = parseNumber(input.value);
  // Valor digitado deixa de ser estimativa: tira o vermelho na hora, sem
  // re-renderizar a linha (isso apagaria o cursor no meio da digitação).
  if (campo === "priceBR" && wine.priceBREstimado) {
    delete wine.priceBREstimado;
    input.classList.remove("is-estimado");
  }
  if (campo === "abv" && wine.abvEstimado) {
    delete wine.abvEstimado;
    input.classList.remove("is-estimado");
  }
  if (wine.faltando && wine.faltando.includes(campo) && !isBlank(input.value)) {
    wine.faltando = wine.faltando.filter((c) => c !== campo);
    if (!wine.faltando.length) delete wine.faltando;
  }
  renderSummary(wines.filter((w) => matches(w, document.getElementById("adega-search").value.trim().toLowerCase()) && passesFilters(w, currentFilters())));
});

document.getElementById("adega-body").addEventListener("change", (e) => {
  if (e.target.closest(".adega-cell-input")) persist();
});

document.getElementById("adega-zoom-close").addEventListener("click", closeZoom);

document.getElementById("adega-zoom").addEventListener("click", (e) => {
  // Clicar fora da imagem fecha; clicar nela, não.
  if (e.target.id === "adega-zoom") closeZoom();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("adega-zoom").hidden) closeZoom();
});

document.querySelectorAll(".adega-view-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});


applyView(currentView());
load();
