let wines = [];
let sortKey = "name";
let sortAsc = true;

const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function fmtPrice(wine) {
  if (wine.price === null || wine.price === undefined || wine.price === "") return "—";
  const currency = wine.currency || "BRL";
  try {
    return Number(wine.price).toLocaleString("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${wine.price}`;
  }
}

function value(wine, key) {
  if (key === "price") {
    // Cuidado: Number(null) é 0, então o vazio precisa ser barrado antes,
    // senão vinho sem preço ordena como se custasse zero.
    if (wine.price === null || wine.price === undefined || wine.price === "") return null;
    const n = Number(wine.price);
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
  const haystack = [wine.name, wine.country, wine.vintage, wine.grape, wine.origin]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
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
          <td class="adega-td-name">${escapeHtml(w.name) || "—"}</td>
          <td>${escapeHtml(w.country) || "—"}</td>
          <td>${escapeHtml(w.vintage) || "—"}</td>
          <td>${escapeHtml(w.grape) || "—"}</td>
          <td>${escapeHtml(w.origin) || "—"}</td>
          <td class="adega-td-num">${fmtPrice(w)}</td>
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
}

async function load() {
  try {
    const res = await fetch("adega/wines.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    wines = data.wines || [];
  } catch (err) {
    document.getElementById("adega-empty").textContent = `Não foi possível carregar a adega (${err.message}).`;
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

document.getElementById("adega-search").addEventListener("input", render);

load();
