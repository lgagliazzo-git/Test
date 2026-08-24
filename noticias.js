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

// Config que está publicada e valendo no robô, para comparar com a escolha
// salva na tela e avisar quando as duas estiverem diferentes.
let publishedConfig = null;

function currentConfig() {
  return {
    sources: Array.from(document.querySelectorAll('input[name="source"]:checked')).map((el) => el.value),
    categories: Array.from(document.querySelectorAll('input[name="category"]:checked')).map((el) => el.value),
    keywords: keywords.slice(),
    quantity: Number(document.getElementById("quantity").value),
    frequency: Number(document.getElementById("frequency").value),
  };
}

function sameConfig(a, b) {
  if (!a || !b) return false;
  const norm = (c) => ({
    sources: (c.sources || []).slice().sort(),
    categories: (c.categories || []).slice().sort(),
    keywords: (c.keywords || []).slice().sort(),
    quantity: Number(c.quantity),
    frequency: Number(c.frequency),
  });
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

function updateSyncMsg() {
  const el = document.getElementById("news-sync-msg");
  if (!publishedConfig) {
    el.textContent = "";
    return;
  }
  if (sameConfig(currentConfig(), publishedConfig)) {
    el.textContent = "✓ É esta configuração que está valendo no envio automático.";
    el.classList.remove("is-pendente");
  } else {
    el.textContent = "⚠ Salvo neste navegador, mas ainda não publicado. Clique em salvar para publicar.";
    el.classList.add("is-pendente");
  }
}

// A escolha salva na tela (localStorage) é o que o usuário vê, porque foi a
// última coisa que ele decidiu. O arquivo publicado entra quando ainda não há
// escolha salva, e serve de comparação para o aviso de pendência.
async function loadConfig() {
  try {
    const res = await fetch(`news-config.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) publishedConfig = await res.json();
  } catch (e) {
    /* segue sem comparação */
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  let saved = null;
  if (raw) {
    try {
      saved = JSON.parse(raw);
    } catch (e) {
      /* ignore corrupted config */
    }
  }

  applyConfig(saved || publishedConfig || {});
  updateSyncMsg();
}

async function saveConfig(e) {
  e.preventDefault();
  const config = currentConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));

  const msg = document.getElementById("news-saved-msg");
  msg.style.display = "block";
  setTimeout(() => (msg.style.display = "none"), 3000);

  // Guardar no navegador não muda nada para o robô: quem ele lê é o
  // news-config.json do repositório. Publicar é o que faz a escolha valer.
  await publicarConfig(config);
  updateSyncMsg();
}

async function publicarConfig(config) {
  const aviso = document.getElementById("news-sync-msg");
  let token = ghToken();
  if (!token) {
    token = ghPedirToken("Para a escolha valer no envio automático, ela precisa ser publicada.");
    if (!token) return;
  }

  aviso.textContent = "Publicando...";
  aviso.classList.remove("is-pendente");
  try {
    await ghGravarArquivo(
      "news-config.json",
      JSON.stringify(config, null, 2) + "\n",
      "Atualiza a configuração de notícias pela tela",
      token
    );
    publishedConfig = config;
    aviso.textContent = "Publicado. Vale a partir da próxima busca.";
  } catch (err) {
    aviso.textContent = `Não consegui publicar: ${err.message}`;
    aviso.classList.add("is-pendente");
  }
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
