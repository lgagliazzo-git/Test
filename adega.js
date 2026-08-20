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
let sortKey = "name";
let sortAsc = true;

const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

// Cabeçalhos aceitos na importação -> campo interno. Sem acento e em
// minúsculas, porque planilha vem escrita de tudo quanto é jeito.
const COLUMN_ALIASES = {
  nome: "name",
  vinho: "name",
  pais: "country",
  data: "vintage",
  safra: "vintage",
  ano: "vintage",
  uva: "grape",
  origem: "origin",
  qtd: "quantity",
  quantidade: "quantity",
  garrafas: "quantity",
  preco_pago: "pricePaid",
  precopago: "pricePaid",
  pago: "pricePaid",
  preco_br: "priceBR",
  precobr: "priceBR",
  preco: "priceBR",
  preco_usd: "priceUSD",
  precousd: "priceUSD",
  nota: "rating",
  alcool: "abv",
  teor: "abv",
  abv: "abv",
  harmoniza: "pairing",
  harmonizacao: "pairing",
  pratos: "pairing",
  foto: "photo",
};

const NUMERIC_FIELDS = new Set(["quantity", "priceBR", "pricePaid", "priceUSD", "rating", "abv"]);
// Campos digitáveis direto na linha.
const EDITABLE_FIELDS = { quantity: "Qtd", priceBR: "Preço BR", pricePaid: "Preço pago", abv: "Teor alcoólico" };

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
  const step = field === "quantity" ? "1" : field === "abv" ? "0.1" : "0.01";
  // Vermelho = valor que eu estimei, não li de rótulo nem achei em loja:
  // preço convertido do dólar, ou teor alcoólico típico do estilo.
  // Some assim que o valor é digitado por cima (ver o handler de input).
  const estimado =
    (field === "priceBR" && wine.priceBREstimado) || (field === "abv" && wine.abvEstimado)
      ? " is-estimado"
      : "";
  return `<input type="number" class="adega-cell-input${estimado}" inputmode="decimal" min="0" step="${step}"
            value="${escapeHtml(raw)}" data-field="${field}" data-name="${escapeHtml(wine.name)}"
            aria-label="${EDITABLE_FIELDS[field]} de ${escapeHtml(wine.name)}" />`;
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
  return [wine.name, wine.country, wine.vintage, wine.grape, wine.origin, wine.pairing]
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
    country: document.getElementById("filter-country").value,
    grape: document.getElementById("filter-grape").value,
    min: parseNumber(document.getElementById("filter-price-min").value),
    max: parseNumber(document.getElementById("filter-price-max").value),
  };
}

function passesFilters(wine, f) {
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
  const missing = visible.length - withPrice.length;

  const withPaid = visible.filter((w) => !isBlank(w.pricePaid));
  const totalPaid = withPaid.reduce((sum, w) => sum + Number(w.pricePaid) * qtyOf(w), 0);

  const rated = visible.filter((w) => !isBlank(w.rating));
  const avgRating = rated.length
    ? (rated.reduce((s, w) => s + Number(w.rating), 0) / rated.length).toLocaleString("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    : null;

  const parts = [
    `<strong>Pago ${fmtMoney(totalPaid, "BRL") || "R$ 0,00"}</strong>`,
    `mercado ${fmtMoney(total, "BRL") || "R$ 0,00"}`,
    `${bottles} garrafa${bottles === 1 ? "" : "s"} em ${visible.length} rótulo${visible.length === 1 ? "" : "s"}`,
  ];
  // Sem esses avisos os totais parecem cobrir a adega inteira quando não cobrem.
  if (withPaid.length < visible.length) {
    parts.push(`${visible.length - withPaid.length} sem preço pago`);
  }
  if (missing > 0) parts.push(`${missing} sem preço de mercado`);
  if (avgRating) parts.push(`nota média ${avgRating}`);

  document.getElementById("adega-summary").innerHTML = parts.join(" · ");

  const foot = document.getElementById("adega-foot");
  foot.innerHTML = visible.length
    ? `<tr>
         <td colspan="3" class="adega-foot-label">Totais (× quantidade)</td>
         <td class="adega-td-num">${bottles}</td>
         <td class="adega-td-num">${fmtMoney(total, "BRL")}</td>
         <td class="adega-td-num">${fmtMoney(totalPaid, "BRL")}</td>
         <td class="adega-td-num">—</td>
         <td class="adega-td-num">${avgRating || "—"}</td>
         <td colspan="6">—</td>
       </tr>`
    : "";
}

function photoCell(wine) {
  if (!wine.photo) return `<span class="adega-nophoto">—</span>`;
  const alt = escapeHtml(wine.name || "vinho");
  return `<button type="button" class="adega-photo-btn" data-zoom="${escapeHtml(wine.photo)}"
            data-name="${alt}" aria-label="Ampliar foto de ${alt}">
            <img class="adega-photo" src="${escapeHtml(wine.photo)}" alt="${alt}" loading="lazy" />
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
          <td data-label="País">${escapeHtml(w.country) || "—"}</td>
          <td class="adega-td-num" data-label="Qtd">${editableCell(w, "quantity")}</td>
          <td class="adega-td-num" data-label="Preço BR">${editableCell(w, "priceBR")}</td>
          <td class="adega-td-num" data-label="Preço pago">${editableCell(w, "pricePaid")}</td>
          <td class="adega-td-num" data-label="Preço origem">${cellValue(w, "priceUSD")}</td>
          <td class="adega-td-num" data-label="Nota">${cellValue(w, "rating")}</td>
          <td data-label="Data de fabricação">${escapeHtml(w.vintage) || "—"}</td>
          <td class="adega-td-grape" data-label="Tipo de uva">${escapeHtml(w.grape) || "—"}</td>
          <td class="adega-td-origin" data-label="Origem">${escapeHtml(w.origin) || "—"}</td>
          <td class="adega-td-pairing" data-label="Harmoniza com">${escapeHtml(w.pairing) || "—"}</td>
          <td class="adega-td-abv" data-label="Álcool">${editableCell(w, "abv")}<span class="adega-abv-sufixo">%</span></td>
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

// ---------- Importar / exportar em massa ----------

const EXPORT_COLUMNS = [
  ["nome", "name"],
  ["pais", "country"],
  ["data", "vintage"],
  ["uva", "grape"],
  ["origem", "origin"],
  ["qtd", "quantity"],
  ["preco_br", "priceBR"],
  ["preco_pago", "pricePaid"],
  ["preco_usd", "priceUSD"],
  ["nota", "rating"],
  ["alcool", "abv"],
  ["harmoniza", "pairing"],
  ["foto", "photo"],
];

function toTsv() {
  const header = EXPORT_COLUMNS.map(([label]) => label).join("\t");
  const rows = wines.map((w) => EXPORT_COLUMNS.map(([, field]) => (isBlank(w[field]) ? "" : w[field])).join("\t"));
  return [header, ...rows].join("\n");
}

function importTsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("cole o cabeçalho e pelo menos uma linha de vinho");

  // Tabulação é o separador do Excel/Sheets; ponto e vírgula cobre CSV
  // exportado em pt-BR. Vírgula não serve: os nomes dos vinhos têm vírgula.
  const sep = lines[0].includes("\t") ? "\t" : ";";
  const headers = lines[0].split(sep).map((h) => COLUMN_ALIASES[normalizeHeader(h)] || null);
  if (!headers.includes("name")) throw new Error('falta a coluna "nome"');

  let added = 0;
  let updated = 0;

  for (const line of lines.slice(1)) {
    const cells = line.split(sep);
    const incoming = {};
    headers.forEach((field, i) => {
      if (!field) return;
      const raw = (cells[i] ?? "").trim();
      incoming[field] = NUMERIC_FIELDS.has(field) ? parseNumber(raw) : raw;
    });
    if (!incoming.name) continue;

    const existing = wines.find((w) => w.name.toLowerCase() === incoming.name.toLowerCase());
    if (existing) {
      // Célula em branco na planilha não apaga o que já está catalogado.
      for (const [field, val] of Object.entries(incoming)) {
        if (!isBlank(val)) existing[field] = val;
      }
      updated += 1;
    } else {
      wines.push({ quantity: 1, priceBR: null, pricePaid: null, priceUSD: null, rating: null, photo: null, ...incoming });
      added += 1;
    }
  }

  return { added, updated };
}

// Guardar a lista inteira no navegador fazia o arquivo publicado ser
// ignorado por completo: quem tinha edições locais nunca via foto ou nota
// nova, e quem limpava os dados do navegador perdia as edições. Agora só as
// alterações são guardadas, e elas são reaplicadas sobre o arquivo publicado.
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
  if (temAlteracoes()) {
    botao.disabled = false;
    estadoSalvar("Há alterações salvas só neste aparelho. Clique para publicar no site.", "pendente");
  } else {
    botao.disabled = true;
    estadoSalvar("Nada para salvar — o que está na tela já é o que está publicado.");
  }
}

async function salvarNoSite() {
  const botao = document.getElementById("adega-save");
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = pedirToken("Para salvar no site é preciso um token do GitHub com permissão de escrita neste repositório.");
    if (!token) return;
  }

  botao.disabled = true;
  estadoSalvar("Salvando...");

  const conteudo = JSON.stringify(
    { updatedAt: new Date().toISOString(), wines: wines.map(({ _chave, ...w }) => w) },
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
    if (!atual.ok) throw new Error(`não consegui ler o arquivo publicado (HTTP ${atual.status})`);
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
    if (gravou.status === 403) throw new Error("o token não tem permissão de escrita neste repositório");
    if (!gravou.ok) throw new Error(`HTTP ${gravou.status}`);

    // Publicado: o que era alteração local agora é o próprio arquivo.
    publicados = wines.map((w) => ({ ...w }));
    localStorage.removeItem(EDITS_KEY);
    localStorage.removeItem(STORAGE_KEY);
    estadoSalvar("Salvo. Em cerca de um minuto aparece em qualquer aparelho.", "ok");
  } catch (err) {
    estadoSalvar(`Não consegui salvar: ${err.message}`, "erro");
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

document.getElementById("adega-save").addEventListener("click", salvarNoSite);

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

["filter-country", "filter-grape", "filter-price-min", "filter-price-max"].forEach((id) => {
  document.getElementById(id).addEventListener("input", render);
});

document.getElementById("filter-clear").addEventListener("click", () => {
  ["filter-country", "filter-grape", "filter-price-min", "filter-price-max"].forEach((id) => {
    document.getElementById(id).value = "";
  });
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

document.getElementById("adega-toggle-bulk").addEventListener("click", () => {
  const panel = document.getElementById("adega-bulk");
  panel.hidden = !panel.hidden;
});

document.getElementById("adega-import").addEventListener("click", () => {
  const input = document.getElementById("adega-bulk-input");
  try {
    const { added, updated } = importTsv(input.value);
    persist();
    fillFilterOptions();
    render();
    input.value = "";
    flash(`${added} adicionado(s), ${updated} atualizado(s).`);
  } catch (err) {
    flash(err.message, true);
  }
});

document.getElementById("adega-export-tsv").addEventListener("click", async () => {
  const tsv = toTsv();
  try {
    await navigator.clipboard.writeText(tsv);
    flash("Tabela copiada — cole no Excel.");
  } catch {
    // clipboard exige HTTPS/permissão; sem ele, mostra o texto para copiar à mão
    document.getElementById("adega-bulk-input").value = tsv;
    flash("Copie o texto da caixa acima.");
  }
});

document.getElementById("adega-export-json").addEventListener("click", () => {
  // _chave é controle interno da tela, não entra no arquivo publicado.
  const limpos = wines.map(({ _chave, ...w }) => w);
  const blob = new Blob([JSON.stringify({ updatedAt: new Date().toISOString(), wines: limpos }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wines.json";
  a.click();
  URL.revokeObjectURL(a.href);
  flash("wines.json baixado.");
});

applyView(currentView());
load();
