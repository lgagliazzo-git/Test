// Gravação de arquivos do site no repositório, pela API do GitHub.
// O site é estático: sem isso, o que se escolhe na tela fica só no navegador
// e o robô, que lê os arquivos do repositório, nunca fica sabendo.

const GH_REPO = {
  owner: "lgagliazzo-git",
  repo: "Test",
  branch: "claude/landing-page-domain-esf6bn",
};
const GH_TOKEN_KEY = "gaglidom_github_token"; // o mesmo da adega

function ghToken() {
  return localStorage.getItem(GH_TOKEN_KEY);
}

function ghPedirToken(motivo) {
  const token = prompt(
    `${motivo}\n\nToken do GitHub (fine-grained) com acesso a ${GH_REPO.owner}/${GH_REPO.repo} ` +
      "e permissão Contents: Read and write.\nFica guardado só neste aparelho:",
    ghToken() || ""
  );
  if (token === null) return null;
  const limpo = token.trim();
  if (!limpo) return null;
  localStorage.setItem(GH_TOKEN_KEY, limpo);
  return limpo;
}

function ghEsquecerToken() {
  localStorage.removeItem(GH_TOKEN_KEY);
}

function ghParaBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

async function ghChamar(caminho, opcoes, token) {
  return fetch(`https://api.github.com/repos/${GH_REPO.owner}/${GH_REPO.repo}${caminho}`, {
    ...opcoes,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      ...(opcoes.headers || {}),
    },
  });
}

async function ghMotivo(resposta) {
  try {
    const corpo = await resposta.json();
    if (corpo && corpo.message) return `${corpo.message} (HTTP ${resposta.status})`;
  } catch {
    /* resposta sem JSON */
  }
  return `HTTP ${resposta.status}`;
}

// Grava o arquivo e devolve nada; joga erro com mensagem em português.
// O sha da versão atual é obrigatório e é o que impede sobrescrever uma
// alteração feita em outro aparelho sem perceber.
async function ghGravarArquivo(caminho, conteudo, mensagem, token) {
  const atual = await ghChamar(`/contents/${caminho}?ref=${GH_REPO.branch}`, {}, token);
  if (atual.status === 401) {
    ghEsquecerToken();
    throw new Error("token inválido ou expirado; informe outro");
  }
  if (atual.status === 404 || atual.status === 403) {
    throw new Error(`o token não dá acesso a ${GH_REPO.owner}/${GH_REPO.repo} — ${await ghMotivo(atual)}`);
  }
  if (!atual.ok) throw new Error(await ghMotivo(atual));
  const { sha } = await atual.json();

  const gravou = await ghChamar(
    `/contents/${caminho}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: mensagem,
        content: ghParaBase64(conteudo),
        sha,
        branch: GH_REPO.branch,
      }),
    },
    token
  );
  if (gravou.status === 409) throw new Error("o arquivo mudou em outro aparelho; recarregue e tente de novo");
  if (!gravou.ok) throw new Error(await ghMotivo(gravou));
}
