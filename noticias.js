const SOURCES = [
  "InfoMoney",
  "Valor Econômico",
  "Exame",
  "Money Times",
  "Brazil Journal",
  "Neofeed",
  "Suno Notícias",
  "Seu Dinheiro",
  "Bloomberg Línea Brasil",
  "G1",
  "UOL",
  "Folha de S.Paulo",
  "Estadão",
  "CNN Brasil",
  "Poder360",
  "Quem (Globo)",
  "Purepeople",
  "Contigo",
  "LeoDias",
  "Tecmundo",
  "Canaltech",
  "GE Globo Esporte",
];

const CATEGORIES = [
  "Economia",
  "Finanças",
  "Empresas",
  "Política",
  "Tecnologia",
  "Esportes",
  "Internacional",
  "Fofoca",
];

const STORAGE_KEY = "gaglidom_news_config";
const MAX_KEYWORDS = 10;
let keywords = [];

function slug(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-");
}

function renderCheckboxGrid(containerId, items, namePrefix) {
  const container = document.getElementById(containerId);
  container.innerHTML = items
    .map((item) => {
      const id = `${namePrefix}-${slug(item)}`;
      return `
        <label class="news-checkbox" for="${id}">
          <input type="checkbox" id="${id}" name="${namePrefix}" value="${item}" />
          <span>${item}</span>
        </label>
      `;
    })
    .join("");
}

function renderKeywordTags() {
  const container = document.getElementById("keyword-tags");
  const count = document.getElementById("keyword-count");
  container.innerHTML = keywords
    .map(
      (kw, i) => `
        <span class="keyword-tag">
          ${kw}
          <button type="button" class="keyword-remove" data-index="${i}" aria-label="Remover">&times;</button>
        </span>
      `
    )
    .join("");
  count.textContent = `${keywords.length}/${MAX_KEYWORDS} palavras-chave`;

  container.querySelectorAll(".keyword-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      keywords.splice(Number(btn.dataset.index), 1);
      renderKeywordTags();
    });
  });
}

function addKeyword() {
  const input = document.getElementById("keyword-input");
  const value = input.value.trim();
  if (!value || keywords.length >= MAX_KEYWORDS || keywords.includes(value)) {
    input.value = "";
    return;
  }
  keywords.push(value);
  input.value = "";
  renderKeywordTags();
}

function applyConfig(config) {
  (config.sources || []).forEach((s) => {
    const el = document.getElementById(`source-${slug(s)}`);
    if (el) el.checked = true;
  });
  (config.categories || []).forEach((c) => {
    const el = document.getElementById(`category-${slug(c)}`);
    if (el) el.checked = true;
  });
  if (config.frequency) document.getElementById("frequency").value = config.frequency;
  if (config.quantity) document.getElementById("quantity").value = config.quantity;
  keywords = config.keywords || [];
  renderKeywordTags();
}

// O news-config.json publicado é a verdade: é ele que o robô lê para buscar
// e enviar. O localStorage só entra como reserva quando o arquivo não carrega
// (offline, por exemplo) — senão a tela mostraria um rascunho local que não
// corresponde ao que está no ar, que foi exatamente o que confundiu antes.
async function loadConfig() {
  try {
    const res = await fetch(`news-config.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyConfig(await res.json());
    return;
  } catch (e) {
    /* cai para o rascunho local */
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    applyConfig(JSON.parse(raw));
  } catch (e) {
    /* ignore corrupted config */
  }
}

function saveConfig(e) {
  e.preventDefault();
  const sources = Array.from(document.querySelectorAll('input[name="source"]:checked')).map((el) => el.value);
  const categories = Array.from(document.querySelectorAll('input[name="category"]:checked')).map((el) => el.value);
  const frequency = document.getElementById("frequency").value;
  const quantity = document.getElementById("quantity").value;

  const config = {
    sources,
    categories,
    keywords,
    quantity: Number(quantity),
    frequency: Number(frequency),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));

  const msg = document.getElementById("news-saved-msg");
  msg.style.display = "block";
  setTimeout(() => (msg.style.display = "none"), 3000);

  showExport(config);
}

function showExport(config) {
  const box = document.getElementById("news-export");
  const field = document.getElementById("news-export-json");
  field.value = JSON.stringify(config, null, 2);
  box.hidden = false;
  copyExport();
}

function copyExport() {
  const field = document.getElementById("news-export-json");
  if (navigator.clipboard) {
    navigator.clipboard.writeText(field.value).catch(() => {});
  }
  field.select();
}

renderCheckboxGrid("sources-grid", SOURCES, "source");
renderCheckboxGrid("categories-grid", CATEGORIES, "category");
loadConfig();

document.getElementById("keyword-add").addEventListener("click", addKeyword);
document.getElementById("keyword-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addKeyword();
  }
});
document.getElementById("news-form").addEventListener("submit", saveConfig);
document.getElementById("news-export-copy").addEventListener("click", copyExport);
