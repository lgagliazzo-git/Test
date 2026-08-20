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
