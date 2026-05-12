// =============================================================================
// PWA — registra o service worker (carregado pelo index.html).
// =============================================================================
// Roda silenciosamente. Se o navegador nao suporta SW (ex.: Safari muito antigo,
// modo privado em Firefox), simplesmente nao faz nada — o app continua funcionando
// normalmente como pagina web comum.
//
// Caminho relativo "./service-worker.js" funciona tanto em
// https://vinisouza128.github.io/inat-species-quiz/ quanto em localhost:8080/.
// =============================================================================

if ("serviceWorker" in navigator) {
  // Aguarda a pagina terminar de carregar para nao competir por banda na 1a visita.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js", { scope: "./" })
      .then((reg) => {
        // Se houver atualizacao do SW disponivel, aplicar imediatamente.
        // Isso permite que mudancas no site cheguem ao usuario na proxima visita,
        // sem precisar recarregar a pagina varias vezes.
        if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              sw.postMessage("SKIP_WAITING");
            }
          });
        });
      })
      .catch((err) => {
        // Falha silenciosa — registrar SW e melhoria progressiva, nao bloqueante.
        console.warn("[pwa] service worker nao pode ser registrado:", err);
      });
  });

  // Quando o SW novo assume, recarregar uma vez para usar a versao mais recente.
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
