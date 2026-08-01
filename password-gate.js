// ============================================
// CONFIGURAÇÃO DA SENHA — edite aqui para trocar
// ============================================
const SITE_PASSWORD = "gaglidom@@123";
const RECOVERY_EMAIL = "lgagliazzo@icloud.com";
// ============================================

(function () {
  if (sessionStorage.getItem("gaglidom_unlocked") === "true") return;

  document.documentElement.style.visibility = "hidden";

  window.addEventListener("DOMContentLoaded", () => {
    const overlay = document.createElement("div");
    overlay.id = "password-gate";
    overlay.innerHTML = `
      <div class="password-gate-box">
        <a href="#" class="password-gate-logo">gagli<span>dom</span></a>
        <p class="password-gate-title">Este site é protegido</p>
        <form id="password-gate-form">
          <input type="password" id="password-gate-input" placeholder="Digite a senha" autocomplete="off" />
          <button type="submit" class="btn btn-primary btn-lg">Entrar</button>
        </form>
        <p class="password-gate-error" id="password-gate-error">Senha incorreta, tente de novo.</p>
        <a class="password-gate-forgot" id="password-gate-forgot">Esqueci minha senha</a>
      </div>
    `;
    document.body.appendChild(overlay);
    document.documentElement.style.visibility = "visible";

    const form = document.getElementById("password-gate-form");
    const input = document.getElementById("password-gate-input");
    const error = document.getElementById("password-gate-error");
    const forgot = document.getElementById("password-gate-forgot");

    input.focus();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value === SITE_PASSWORD) {
        sessionStorage.setItem("gaglidom_unlocked", "true");
        overlay.remove();
      } else {
        error.style.display = "block";
        input.value = "";
        input.focus();
      }
    });

    forgot.addEventListener("click", (e) => {
      e.preventDefault();
      const subject = encodeURIComponent("Esqueci minha senha - gaglidom.cloud");
      const body = encodeURIComponent("Olá, esqueci a senha de acesso ao gaglidom.cloud. Pode me lembrar qual é?");
      window.location.href = `mailto:${RECOVERY_EMAIL}?subject=${subject}&body=${body}`;
    });
  });
})();
