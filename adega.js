const STORAGE_KEY = "gaglidom_adega_wines";
const VIEW_KEY = "gaglidom_adega_view";

// Abaixo disso a tabela de 9 colunas não cabe, então lista é o padrão —
// mas a escolha do usuário, se houver, sempre vence.
const TABLE_MIN_WIDTH = 1200;

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
  foto: "photo",
};

const NUMERIC_FIELDS = new Set(["quantity", "priceBR", "pricePaid", "priceUSD", "rating"]);
// Campos digitáveis direto na linha.
const EDITABLE_FIELDS = { quantity: "Qtd", pricePaid: "Preço pago" };

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
  const step = field === "quantity" ? "1" : "0.01";
  return `<input type="number" class="adega-cell-input" inputmode="decimal" min="0" step="${step}"
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
  return [wine.name, wine.country, wine.vintage, wine.grape, wine.origin]
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
         <td colspan="6" class="adega-foot-label">Totais (× quantidade)</td>
         <td class="adega-td-num">${bottles}</td>
         <td class="adega-td-num">${fmtMoney(total, "BRL")}</td>
         <td class="adega-td-num">${fmtMoney(totalPaid, "BRL")}</td>
         <td class="adega-td-num">—</td>
         <td class="adega-td-num">${avgRating || "—"}</td>
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
          <td data-label="Data de fabricação">${escapeHtml(w.vintage) || "—"}</td>
          <td class="adega-td-grape" data-label="Tipo de uva">${escapeHtml(w.grape) || "—"}</td>
          <td class="adega-td-origin" data-label="Origem">${escapeHtml(w.origin) || "—"}</td>
          <td class="adega-td-num" data-label="Qtd">${editableCell(w, "quantity")}</td>
          <td class="adega-td-num" data-label="Preço BR">${cellValue(w, "priceBR")}</td>
          <td class="adega-td-num" data-label="Preço pago">${editableCell(w, "pricePaid")}</td>
          <td class="adega-td-num" data-label="Preço origem">${cellValue(w, "priceUSD")}</td>
          <td class="adega-td-num" data-label="Nota">${cellValue(w, "rating")}</td>
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
  // As fotos são recriadas a cada render, então o clique é escutado no
// corpo da tabela em vez de em cada botão.
document.getElementById("adega-body").addEventListener("click", (e) => {
  const btn = e.target.closest(".adega-photo-btn");
  if (btn) openZoom(btn.dataset.zoom, btn.dataset.name);
});

// Só o resumo é recalculado enquanto digita — um render completo
// recriaria o input e o cursor sairia do campo.
document.getElementById("adega-body").addEventListener("input", (e) => {
  const input = e.target.closest(".adega-cell-input");
  if (!input) return;
  const wine = wines.find((w) => w.name === input.dataset.name);
  if (!wine) return;
  wine[input.dataset.field] = parseNumber(input.value);
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

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ updatedAt: new Date().toISOString(), wines }));
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
    wines = (data.wines || []).map((w) => ({
      // priceBR substituiu o campo antigo "price"; mantido para não perder
      // dado de arquivos gerados antes da mudança.
      quantity: w.quantity ?? 1,
      pricePaid: w.pricePaid ?? null,
      priceBR: w.priceBR ?? w.price ?? null,
      priceUSD: w.priceUSD ?? null,
      rating: w.rating ?? null,
      ...w,
    }));
  } catch (err) {
    document.getElementById("adega-empty").textContent = `Não foi possível carregar a adega (${err.message}).`;
  }

  // Edições locais têm prioridade sobre o arquivo publicado.
  try {
    const local = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (local?.wines?.length) wines = local.wines;
  } catch {
    /* localStorage corrompido: segue com o arquivo publicado */
  }

  fillFilterOptions();
  render();
}

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
});

// Só o resumo é recalculado enquanto digita — um render completo
// recriaria o input e o cursor sairia do campo.
document.getElementById("adega-body").addEventListener("input", (e) => {
  const input = e.target.closest(".adega-cell-input");
  if (!input) return;
  const wine = wines.find((w) => w.name === input.dataset.name);
  if (!wine) return;
  wine[input.dataset.field] = parseNumber(input.value);
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
  const blob = new Blob([JSON.stringify({ updatedAt: new Date().toISOString(), wines }, null, 2)], {
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
