// =============================================================================
// iNAT API — cliente HTTP do iNaturalist (versão browser, CORS direto)
// =============================================================================
// Toda chamada externa passa por aqui. Recursos:
//   • Construção segura de URLs com query strings.
//   • Cache em memória (Map) com TTL — mesma URL não é refeita por X horas.
//   • Rate limit serial: 1 request por intervalo mínimo (350ms).
//   • Retry com backoff em 429 e timeouts.
//   • Fallback v2 → v1.
//   • Scrape de HTML público para encontrar nome popular do ancestral.
//
// O User-Agent NÃO pode ser sobrescrito pelo browser (header proibido).
// O iNat aceita requests sem UA customizado — só não fica pretty na log
// deles. Funciona normal.
// =============================================================================

import { getApiCache, setApiCache } from './state.js';

const V2_BASE = 'https://api.inaturalist.org/v2';
const V1_BASE = 'https://api.inaturalist.org/v1';

// Intervalo mínimo entre requests à API JSON. 350ms = ~3 req/s, conservador
// e em linha com a recomendação do iNat para uso público.
const MIN_INTERVAL_MS = 350;

// Timeout por request — aborta se não responder em 15s.
const REQUEST_TIMEOUT_MS = 15000;

// TTLs (em horas) para cache.
export const CACHE_TTL_HOURS = 6;
export const AUTOCOMPLETE_TTL_HOURS = 24;

// Pequena utilidade.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// RATE LIMITER — fila serial com intervalo mínimo entre tasks
// ---------------------------------------------------------------------------

let queue = Promise.resolve();
let lastRun = 0;

/**
 * Enfileira uma task (função async). A task só roda quando todas as
 * anteriores terminaram E passou MIN_INTERVAL_MS desde a última execução.
 * Erros não param a fila.
 */
function schedule(task) {
  const run = queue.then(async () => {
    const elapsed = Date.now() - lastRun;
    const wait = Math.max(0, MIN_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      lastRun = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// URL BUILDING
// ---------------------------------------------------------------------------

function appendParams(url, params) {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '');
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function buildUrl(baseUrl, path, params) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`);
  appendParams(url, params);
  return url.toString();
}

// ---------------------------------------------------------------------------
// FETCH JSON com retry e timeout
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await schedule(() => fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      }));

      if (response.status === 429) {
        // Rate limit: aguarda mais entre tentativas.
        const wait = attempt === 0 ? 3000 : 8000;
        await sleep(wait);
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`iNaturalist HTTP ${response.status}. ${text.slice(0, 120)}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(attempt === 0 ? 1000 : 3000);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('Não consegui buscar dados no iNaturalist agora.');
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await schedule(() => fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.3'
        },
        signal: controller.signal
      }));
      if (response.status === 429) {
        const wait = attempt === 0 ? 3000 : 8000;
        await sleep(wait);
        continue;
      }
      if (!response.ok) {
        throw new Error(`iNaturalist HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(attempt === 0 ? 1000 : 3000);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('Não consegui buscar a página do iNaturalist.');
}

// ---------------------------------------------------------------------------
// REQUEST com cache (sessionStorage + memória)
// ---------------------------------------------------------------------------

async function requestJson(baseUrl, path, params, ttlHours) {
  const url = buildUrl(baseUrl, path, params);
  const cached = getApiCache(url);
  if (cached) return cached;
  const data = await fetchJson(url);
  setApiCache(url, data, ttlHours);
  return data;
}

async function requestText(url, ttlHours) {
  const cached = getApiCache(url);
  if (cached) return cached;
  const data = await fetchText(url);
  setApiCache(url, data, ttlHours);
  return data;
}

// ---------------------------------------------------------------------------
// HTML PARSING — nome popular do ancestral mais próximo
// ---------------------------------------------------------------------------

function decodeHtmlEntity(entity) {
  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    const value = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
  }
  if (entity.startsWith('#')) {
    const value = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
  }
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ',
    ccedil: 'ç', Ccedil: 'Ç'
  };
  return named[entity] ?? `&${entity};`;
}

function decodeHtml(raw) {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&([^;]+);/g, (_, entity) => decodeHtmlEntity(entity))
    .replace(/\s+/g, ' ')
    .trim();
}

function rankFromHtml(row) {
  const classMatch = row.match(/class="[^"]*sciname\s+([^\s"]+)/i);
  if (classMatch?.[1]) return classMatch[1].toLowerCase();
  const rankMatch = row.match(/<span class="rank">([^<]+)<\/span>/i);
  return rankMatch?.[1] ? decodeHtml(rankMatch[1]).toLowerCase() : null;
}

function parseTaxonPageNearestCommonAncestor(html) {
  const branchMatch = html.match(/<div class="TaxonomicBranch">([\s\S]*?)(?:<h3>|<section|<div id="Names"|<div class="Names"|$)/i);
  const branch = branchMatch?.[1] ?? html;
  const nameRows = [...branch.matchAll(/<div class="name-row">([\s\S]*?)<\/div>/gi)];
  let nearest = null;

  for (const match of nameRows) {
    const row = match[1] ?? '';
    const commonMatch = row.match(/<a class="comname\s+display-name\s*"[^>]*href="\/taxa\/(\d+)(?:-[^"]*)?"[^>]*>([\s\S]*?)<\/a>/i);
    if (!commonMatch?.[2]) continue;
    const commonName = decodeHtml(commonMatch[2]);
    if (!commonName) continue;

    const sciMatch = row.match(/<a class="sciname\s+([^\s"]+)[^"]*"[^>]*href="\/taxa\/(\d+)(?:-[^"]*)?"[^>]*>([\s\S]*?)<\/a>/i);
    const scientificName = sciMatch?.[3]
      ? decodeHtml(sciMatch[3]).replace(/^(Reino|Filo|Subfilo|Classe|Ordem|Subordem|Infraordem|Superfamília|Família|Subfamília|Tribo|Subtribo|Gênero|Espécie)\s+/i, '')
      : null;

    nearest = {
      name: commonName,
      rank: rankFromHtml(row),
      taxonId: commonMatch?.[1] ? Number(commonMatch[1]) : (sciMatch?.[2] ? Number(sciMatch[2]) : null),
      scientificName
    };
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// CAMPOS PEDIDOS NA API V2
// ---------------------------------------------------------------------------

const observationFields = [
  'id', 'uri', 'observed_on', 'place_guess',
  'taxon.id', 'taxon.name', 'taxon.preferred_common_name', 'taxon.rank', 'taxon.iconic_taxon_name',
  'taxon.default_photo.id', 'taxon.default_photo.url', 'taxon.default_photo.license_code', 'taxon.default_photo.attribution',
  'taxon.ancestors.id', 'taxon.ancestors.name', 'taxon.ancestors.preferred_common_name', 'taxon.ancestors.common_name', 'taxon.ancestors.rank', 'taxon.ancestors.iconic_taxon_name',
  'photos.id', 'photos.url', 'photos.license_code', 'photos.attribution',
  'user.login', 'user.name'
].join(',');

// ---------------------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------------------

/** Lista observações research-grade com filtros. Cai para v1 se v2 falhar. */
export async function getObservations(params) {
  const baseParams = {
    per_page: 50,
    photos: true,
    quality_grade: 'research',
    rank: 'species',
    order_by: 'observed_on',
    order: 'desc',
    fields: observationFields,
    ...params
  };
  try {
    return await requestJson(V2_BASE, '/observations', baseParams, CACHE_TTL_HOURS);
  } catch (error) {
    // Fallback v1 — sem `fields` (que é só v2).
    const { fields: _f, ...v1Params } = baseParams;
    return await requestJson(V1_BASE, '/observations', v1Params, CACHE_TTL_HOURS);
  }
}

/** Detalhe de UM táxon (ancestrais inclusos). */
export async function getTaxonDetails(taxonId) {
  if (!Number.isFinite(taxonId) || taxonId <= 0) return null;
  const data = await requestJson(
    V1_BASE,
    `/taxa/${Math.trunc(taxonId)}`,
    { locale: 'pt-BR', all_names: true },
    CACHE_TTL_HOURS
  );
  return data.results?.[0] ?? null;
}

/** Última cartada: scrape do HTML público. */
export async function getTaxonPageNearestCommonAncestor(taxonId) {
  if (!Number.isFinite(taxonId) || taxonId <= 0) return null;
  const url = `https://www.inaturalist.org/taxa/${Math.trunc(taxonId)}?locale=pt-BR`;
  try {
    const html = await requestText(url, CACHE_TTL_HOURS);
    return parseTaxonPageNearestCommonAncestor(html);
  } catch {
    // Sem comprometer o quiz: HTML pode falhar silenciosamente.
    return null;
  }
}

/** Autocomplete de táxons — para busca em Filtros avançados. */
export async function searchTaxa(q) {
  if (!q || q.trim().length < 2) return [];
  const data = await requestJson(
    V1_BASE,
    '/taxa/autocomplete',
    { q, per_page: 10, locale: 'pt-BR' },
    AUTOCOMPLETE_TTL_HOURS
  );
  return (data.results ?? []).map((taxon) => ({
    id: Number(taxon.id),
    name: String(taxon.name ?? ''),
    preferred_common_name: taxon.preferred_common_name ?? taxon.common_name ?? null,
    rank: taxon.rank ?? null,
    iconic_taxon_name: taxon.iconic_taxon_name ?? null,
    observations_count: typeof taxon.observations_count === 'number' ? taxon.observations_count : null
  })).filter((item) => item.id && item.name);
}

/** Autocomplete de lugares. */
export async function searchPlaces(q) {
  if (!q || q.trim().length < 2) return [];
  const data = await requestJson(
    V1_BASE,
    '/places/autocomplete',
    { q, per_page: 10 },
    AUTOCOMPLETE_TTL_HOURS
  );
  return (data.results ?? []).map((place) => ({
    id: Number(place.id),
    name: String(place.name ?? ''),
    display_name: String(place.display_name ?? place.name ?? ''),
    place_type: place.place_type ?? null
  })).filter((item) => item.id && item.name);
}
