// =============================================================================
// SERVICE WORKER — habilita PWA (offline + cache) para o iNat Species Quiz
// =============================================================================
// O que ele faz, em ordem de prioridade:
//   1. No primeiro acesso, baixa e guarda o "app shell" (HTML/CSS/JS/icones).
//   2. Em acessos seguintes, serve os arquivos do cache (abre instantaneamente,
//      funciona sem internet).
//   3. Quando o usuario abrir uma pergunta nova, as fotos do iNat sao guardadas
//      em um cache separado para que perguntas ja vistas funcionem offline.
//   4. Requests para a API do iNaturalist sao SEMPRE buscados na rede primeiro
//      (sem cache), com fallback opcional ao cache se a rede falhar.
//
// Para forcar atualizacao apos editar arquivos do site: incremente CACHE_VERSION.
// O SW antigo sera substituido na proxima visita (e os caches antigos apagados).
// =============================================================================

const CACHE_VERSION = "v1";
const SHELL_CACHE  = `inat-quiz-shell-${CACHE_VERSION}`;
const PHOTOS_CACHE = `inat-quiz-photos-${CACHE_VERSION}`;
const FONTS_CACHE  = `inat-quiz-fonts-${CACHE_VERSION}`;

// Arquivos essenciais do app — pre-cacheados na instalacao do SW.
// Paths relativos ao escopo (funciona em / e em /inat-species-quiz/).
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./js/main.js",
  "./js/pwa.js",
  "./js/state.js",
  "./js/quiz-engine.js",
  "./js/inat-api.js",
  "./js/sounds.js",
  "./js/format.js",
  "./js/error-messages.js",
  "./js/views/quiz-view.js",
  "./js/views/settings-view.js",
  "./js/views/data-view.js",
];

// --------------------------------------------------------------------------
// INSTALL — baixa o app shell e ja deixa pronto.
// --------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// --------------------------------------------------------------------------
// ACTIVATE — limpa caches antigos (de versoes anteriores).
// --------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => ![SHELL_CACHE, PHOTOS_CACHE, FONTS_CACHE].includes(n))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// --------------------------------------------------------------------------
// FETCH — roteia cada request para a estrategia certa.
// --------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // SO interceptar GET — POST/PUT/DELETE passam direto.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1) API do iNaturalist: sempre rede, sem cache (dados podem mudar).
  if (url.hostname === "api.inaturalist.org") {
    return; // deixa o browser cuidar
  }

  // 2) Fotos do iNaturalist (estaticas, CDN). Cache-first depois de baixar.
  const isInatPhoto =
    url.hostname === "inaturalist-open-data.s3.amazonaws.com" ||
    url.hostname === "static.inaturalist.org" ||
    url.hostname.endsWith(".inaturalist.org");
  if (isInatPhoto) {
    event.respondWith(cacheFirst(req, PHOTOS_CACHE, { maxEntries: 200 }));
    return;
  }

  // 3) Google Fonts (CSS e .woff2): stale-while-revalidate.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(req, FONTS_CACHE));
    return;
  }

  // 4) Mesma origem (arquivos do site): cache-first com revalidacao.
  if (url.origin === self.location.origin) {
    // Para navegacao (acesso a uma URL HTML), sempre devolve o index.html
    // — o app e single-page e o JS cuida do resto.
    if (req.mode === "navigate") {
      event.respondWith(
        caches.match("./index.html", { cacheName: SHELL_CACHE })
          .then((cached) => cached || fetch(req))
      );
      return;
    }
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // Resto: deixa o browser cuidar.
});

// --------------------------------------------------------------------------
// ESTRATEGIAS DE CACHE
// --------------------------------------------------------------------------

// Cache-first: se ja temos guardado, devolve; senao busca, guarda, devolve.
async function cacheFirst(request, cacheName, opts = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok || res.type === "opaque") {
      cache.put(request, res.clone());
      if (opts.maxEntries) trimCache(cacheName, opts.maxEntries);
    }
    return res;
  } catch (err) {
    return cached || Response.error();
  }
}

// Stale-while-revalidate: devolve o cache imediatamente E atualiza em background.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque")) {
        cache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

// Limpa cache antigo quando passa do limite (LRU simples).
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // Remove os mais antigos (Cache API mantem ordem de insercao).
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

// --------------------------------------------------------------------------
// MENSAGENS — permite que a pagina force skipWaiting depois de um update.
// --------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
