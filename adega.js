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
  preco_br: "priceBR",
  precobr: "priceBR",
  preco: "priceBR",
  preco_usd: "priceUSD",
  precousd: "priceUSD",
  nota: "rating",
  foto: "photo",
};

const NUMERIC_FIELDS = new Set(["priceBR", "priceUSD", "rating"]);

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

function photoCell(wine) {
  if (!wine.photo) return `<span class="adega-nophoto">—</span>`;
  const alt = escapeHtml(wine.name || "vinho");
  return `<a href="${escapeHtml(wine.photo)}" target="_blank" rel="noopener">
            <img class="adega-photo" src="${escapeHtml(wine.photo)}" alt="${alt}" loading="lazy" />
          </a>`;
}

function render() {
  const term = document.getElementById("adega-search").value.trim().toLowerCase();
  const visible = wines.filter((w) => matches(w, term)).sort(compare);

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
          <td data-label="Tipo de uva">${escapeHtml(w.grape) || "—"}</td>
          <td class="adega-td-origin" data-label="Origem">${escapeHtml(w.origin) || "—"}</td>
          <td class="adega-td-num" data-label="Preço BR">${cellValue(w, "priceBR")}</td>
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
  ["preco_br", "priceBR"],
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
      wines.push({ priceBR: null, priceUSD: null, rating: null, photo: null, ...incoming });
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

document.getElementById("adega-search").addEventListener("input", render);

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
