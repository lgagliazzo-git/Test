document.getElementById("year").textContent = new Date().getFullYear();

// O GitHub Pages serve o HTML com cache de 10 minutos e não dá para mudar
// esse cabeçalho. O ?v= dos assets não resolve: quem manda no ?v= é o próprio
// HTML, então uma página velha carrega o JS velho junto e a tela fica presa
// numa versão antiga sem aviso nenhum. Carimbar a versão no rodapé ao menos
// deixa isso visível: se o número não for o mais recente, é página em cache.
(function carimbarVersao() {
  const script = document.querySelector('script[src*="script.js?v="]');
  const versao = script && new URL(script.src, location.href).searchParams.get("v");
  if (!versao) return;
  const rodape = document.querySelector(".hub-footer");
  if (rodape) rodape.insertAdjacentHTML("beforeend", ` · <span class="hub-versao">v${versao}</span>`);
})();

// O GitHub Pages guarda o HTML por 10 minutos e não há como mudar esse
// cabeçalho: o navegador serve uma página antiga sem avisar, e como é o HTML
// que aponta o ?v= dos assets, o JS antigo vem junto. Aqui a página consulta
// qual é a versão publicada e, se for outra, oferece recarregar por uma URL
// diferente — que o cache não cobre.
(async function avisarVersaoNova() {
  const atual = document.querySelector('script[src*="script.js?v="]');
  const carregada = atual && new URL(atual.src, location.href).searchParams.get("v");
  if (!carregada) return;

  let publicada;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    publicada = (await res.json()).v;
  } catch {
    return; // sem rede ou sem o arquivo: não atrapalha o uso da página
  }
  if (!publicada || publicada === carregada) return;

  const url = new URL(location.href);
  url.searchParams.set("v", publicada);
  const aviso = document.createElement("div");
  aviso.className = "aviso-versao";
  aviso.innerHTML = `Há uma versão mais nova desta página. <a href="${url}">Recarregar</a>`;
  document.body.appendChild(aviso);
})();
