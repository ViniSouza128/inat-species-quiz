// =============================================================================
// SETTINGS VIEW — tela de Configurações (5 collapsible boxes)
// =============================================================================
// Espelha o ScreenConfig() do mockup e o SettingsPanel.tsx do app React:
//   • Grupos biológicos (chips toggleáveis)
//   • Dificuldade (segmented + descrição + 2 toggles)
//   • Filtros (Locais + Táxons em sub-grupos, busca + tag selecionada)
//   • Aparência (segmented Escuro/Claro/Auto)
//   • Som (slider de volume com gradient sincronizado)
// =============================================================================

import { escapeHtml } from '../format.js';
import { ALL_GROUP_VALUES } from '../state.js';
import { searchTaxa, searchPlaces } from '../inat-api.js';

// ---------------------------------------------------------------------------
// CATÁLOGOS LOCAIS
// ---------------------------------------------------------------------------

const groupItems = [
  { value: 'all', label: 'Todos', icon: '🌐' },
  { value: 'Aves', label: 'Aves', icon: '🐦' },
  { value: 'Mammalia', label: 'Mamíferos', icon: '🐾' },
  { value: 'Reptilia', label: 'Répteis', icon: '🦎' },
  { value: 'Amphibia', label: 'Anfíbios', icon: '🐸' },
  { value: 'Actinopterygii', label: 'Peixes', icon: '🐟' },
  { value: 'Insecta', label: 'Insetos', icon: '🐞' },
  { value: 'Arachnida', label: 'Aracnídeos', icon: '🕷️' },
  { value: 'Plantae', label: 'Plantas', icon: '🌿' },
  { value: 'Fungi', label: 'Fungos', icon: '🍄' }
];

const difficultyInfo = {
  easy:   { title: 'Fácil',        summary: 'Fácil · 20s',  bullets: [
    'Base de <em>60 pts</em> + bônus regressivo por até <em>20 s</em>.',
    'Alternativas podem ser de ordens diferentes.',
    'Erro: <em>−20 pts</em>. Score nunca fica negativo.'
  ]},
  normal: { title: 'Normal',       summary: 'Normal · 15s', bullets: [
    'Base de <em>100 pts</em> com bônus regressivo até <em>15 s</em>.',
    'Distratores priorizam mesma <em>ordem taxonômica</em>.',
    'Erro: <em>−45 pts</em>. Score nunca fica negativo.'
  ]},
  hard:   { title: 'Difícil',      summary: 'Difícil · 12s', bullets: [
    'Base de <em>140 pts</em> + bônus até <em>12 s</em>.',
    'Alternativas da mesma ordem taxonômica.',
    'Timer zerado = resposta errada automática. Erro: <em>−65 pts</em>.'
  ]},
  expert: { title: 'Especialista', summary: 'Especialista · 10s', bullets: [
    'Base de <em>180 pts</em> + bônus até <em>10 s</em>.',
    'Distratores muito parecidos; dica mínima.',
    'Timer zerado = resposta errada automática. Erro: <em>−90 pts</em>.'
  ]}
};

// Fallback usado quando a geolocalização por IP não retornar nada.
const FALLBACK_QUICK_PLACES = ['Brasil', 'Pantanal', 'Amazônia', 'Cerrado', 'Mata Atlântica'];
const quickTaxa = ['Salticidae', 'Formicidae', 'Plantae', 'Felidae', 'Orchidaceae', 'Coleoptera', 'Anura'];

// Lista efetiva de atalhos de Locais. O bootstrap em main.js chama
// `setGeoQuickPlaces` quando a busca por IP resolver — aí prefixamos com
// cidade/UF do usuário antes do fallback.
let quickPlaces = [...FALLBACK_QUICK_PLACES];
export function setGeoQuickPlaces(values) {
  const dedup = [];
  for (const v of values) if (v && !dedup.includes(v)) dedup.push(v);
  quickPlaces = dedup.length > 0 ? dedup : [...FALLBACK_QUICK_PLACES];
}

function normalizeGroups(values) {
  const onlyActual = ALL_GROUP_VALUES.filter((v) => values.includes(v));
  if (onlyActual.length === ALL_GROUP_VALUES.length) return ['all', ...ALL_GROUP_VALUES];
  return onlyActual;
}

// ---------------------------------------------------------------------------
// ESTADO LOCAL DA VIEW (módulo, não persistido)
// ---------------------------------------------------------------------------

const local = {
  taxonQuery: '',
  placeQuery: '',
  taxaResults: [],
  placeResults: [],
  searchError: null,
  // Estado dos boxes colapsáveis. Grupos abre por default.
  cbox: { groups: true, difficulty: false, filters: false, appearance: false, sound: false }
};

export function getSettingsLocal() { return local; }
export function toggleCbox(id) {
  if (id in local.cbox) local.cbox[id] = !local.cbox[id];
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

export function renderSettingsView(settings, loading) {
  const selectedGroups = normalizeGroups(settings.iconicTaxa.length > 0 ? settings.iconicTaxa : ['all', ...ALL_GROUP_VALUES]);

  return `
    <section class="config-screen" aria-label="Configurações do quiz" data-scroll>
      <header class="page-head">
        <span class="kicker">Quiz · iNaturalist</span>
        <h1>Configuração</h1>
      </header>

      <div class="config-stack">
        ${renderGroupsBox(selectedGroups)}
        ${renderDifficultyBox(settings)}
        ${renderFiltersBox(settings)}
        ${renderAppearanceBox(settings)}
        ${renderSoundBox(settings)}

        ${local.searchError ? `<p class="warning" style="color: var(--err); font-size: 13px;">${escapeHtml(local.searchError)}</p>` : ''}

        <div style="display: flex; gap: 8px; padding: var(--sp-3) 0 var(--sp-5);">
          <button type="button" class="btn btn-primary" data-action="new-question" ${loading ? 'disabled' : ''} style="flex: 1;">
            ${loading ? 'Buscando…' : 'Nova pergunta →'}
          </button>
        </div>
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// BOX HELPERS
// ---------------------------------------------------------------------------

function cboxHeader(id, glyph, title, desc, summary) {
  return `
    <button type="button" class="cbox-head" data-action="toggle-cbox" data-cbox="${id}">
      <span class="glyph" aria-hidden="true">${glyph}</span>
      <span class="info">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(desc)}</span>
      </span>
      <span class="summary">${escapeHtml(summary)}</span>
      <span class="caret" aria-hidden="true"></span>
    </button>
  `;
}

// 1) GRUPOS BIOLÓGICOS -------------------------------------------------------

function renderGroupsBox(selectedGroups) {
  const chips = groupItems.map((g) => {
    const isActive = g.value === 'all' ? selectedGroups.includes('all') : selectedGroups.includes(g.value);
    return `
      <button type="button" class="chip ${isActive ? 'is-active' : ''}" data-action="toggle-group" data-group="${g.value}">
        <span class="glyph">${g.icon}</span>
        <span>${escapeHtml(g.label)}</span>
      </button>
    `;
  }).join('');

  const activeCount = selectedGroups.filter((v) => v !== 'all').length;
  const summary = `${activeCount} ativos`;

  return `
    <article class="cbox" data-open="${local.cbox.groups}">
      ${cboxHeader('groups', '🌿', 'Grupos biológicos', 'Quais reinos/classes podem aparecer no quiz', summary)}
      <div class="cbox-body">
        <div class="group-chips">${chips}</div>
      </div>
    </article>
  `;
}

// 2) DIFICULDADE -------------------------------------------------------------

function renderDifficultyBox(settings) {
  const current = difficultyInfo[settings.difficulty];
  const segmented = ['easy', 'normal', 'hard', 'expert'].map((d) => {
    const label = difficultyInfo[d].title;
    const active = settings.difficulty === d ? 'is-active' : '';
    return `<button type="button" class="${active}" data-action="set-difficulty" data-difficulty="${d}">${label}</button>`;
  }).join('');

  // O modo de exibição agora é determinado pela dificuldade — Especialista
  // mostra só o nome científico; os demais incluem o nome popular.
  const onlySci = settings.difficulty === 'expert';
  const namingNote = onlySci
    ? 'Modo Especialista: só nomes <em>científicos</em> nas alternativas.'
    : 'Nomes populares exibidos quando disponíveis.';

  return `
    <article class="cbox" data-open="${local.cbox.difficulty}">
      ${cboxHeader('difficulty', '🎯', 'Dificuldade', 'Tempo, pontuação e tipo de distratores', current.summary)}
      <div class="cbox-body">
        <div class="segmented" role="radiogroup">${segmented}</div>
        <div class="difficulty-detail">
          <strong>${escapeHtml(current.title)}</strong>
          <ul>${current.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
          <p class="naming-note">${namingNote}</p>
        </div>
      </div>
    </article>
  `;
}

// 3) FILTROS (Locais + Táxons) -----------------------------------------------

function filterSubGroup(opts) {
  const { glyph, title, count, searchPlaceholder, searchInput, searchAction, currentTag, removeAction, quickList, quickAction, results, pickAction } = opts;

  const tagStrip = currentTag
    ? `<span class="tag" data-action="${removeAction}">
         <span>${escapeHtml(currentTag.label)}</span>
         ${currentTag.meta ? `<span class="meta">${escapeHtml(currentTag.meta)}</span>` : ''}
         <button type="button" aria-label="Remover ${escapeHtml(currentTag.label)}">✕</button>
       </span>`
    : '';

  const quickAdd = quickList.map((q) => {
    const isActive = currentTag && currentTag.label === q;
    return `<button type="button" data-added="${isActive}" data-action="${quickAction}" data-quick="${escapeHtml(q)}">${escapeHtml(q)}</button>`;
  }).join('');

  const resultsHtml = results && results.length > 0
    ? `<div class="result-list-inline">
         ${results.map((r) => `
           <button type="button" data-action="${pickAction}" data-id="${r.id}" data-label="${escapeHtml(r.label)}" ${r.extra ? `data-extra="${escapeHtml(r.extra)}"` : ''}>
             <span class="add-glyph" aria-hidden="true">+</span>
             <strong>${escapeHtml(r.label)}${r.extra ? ` <em style="font-style: normal; color: var(--text-faint); font-weight: 500;">· ${escapeHtml(r.extra)}</em>` : ''}</strong>
           </button>
         `).join('')}
       </div>`
    : '';

  return `
    <div class="filter-group">
      <header class="filter-group-head">
        <span class="glyph" aria-hidden="true">${glyph}</span>
        <strong>${escapeHtml(title)}</strong>
        <span class="count">${count}</span>
      </header>
      <div class="multi-select">
        <div class="search-row">
          <input class="input" data-input="${searchInput}" placeholder="${escapeHtml(searchPlaceholder)}" value="${escapeHtml(opts.queryValue || '')}" />
          <button type="button" class="btn btn-secondary" data-action="${searchAction}">Buscar</button>
        </div>
        <div class="tag-strip" aria-label="${escapeHtml(title)} selecionados">${tagStrip}</div>
        <div class="quick-add" aria-label="Atalhos rápidos">${quickAdd}</div>
        ${resultsHtml}
      </div>
    </div>
  `;
}

function renderFiltersBox(settings) {
  const placeTag = settings.placeId ? { label: settings.placeLabel ?? `Local ${settings.placeId}`, meta: 'local' } : null;
  const taxonTag = settings.taxonId ? { label: settings.taxonLabel ?? `Táxon ${settings.taxonId}`, meta: 'táxon' } : null;
  const count = (placeTag ? 1 : 0) + (taxonTag ? 1 : 0);
  const summary = count === 0 ? 'nenhum' : `${count} ${count === 1 ? 'filtro' : 'filtros'}`;

  const placesResults = local.placeResults.map((p) => ({
    id: p.id, label: p.name || p.display_name, extra: p.display_name && p.display_name !== p.name ? p.display_name : null
  }));
  const taxaResults = local.taxaResults.map((t) => ({
    id: t.id, label: t.preferred_common_name ?? t.name, extra: t.preferred_common_name ? `${t.name} · ${t.rank ?? 'rank n/d'}` : (t.rank ?? null)
  }));

  return `
    <article class="cbox" data-open="${local.cbox.filters}">
      ${cboxHeader('filters', '🔍', 'Filtros', 'Restringir a locais ou táxons específicos', summary)}
      <div class="cbox-body">
        ${filterSubGroup({
          glyph: '📍', title: 'Locais', count: placeTag ? 1 : 0,
          searchPlaceholder: 'Buscar local — ex: Brasil, Pantanal',
          searchInput: 'place', searchAction: 'search-place',
          currentTag: placeTag, removeAction: 'clear-place',
          quickList: quickPlaces, quickAction: 'quick-place',
          results: placesResults, pickAction: 'pick-place',
          queryValue: local.placeQuery
        })}
        ${filterSubGroup({
          glyph: '🔬', title: 'Táxons', count: taxonTag ? 1 : 0,
          searchPlaceholder: 'Buscar táxon — ex: Felidae, Orchidaceae',
          searchInput: 'taxon', searchAction: 'search-taxon',
          currentTag: taxonTag, removeAction: 'clear-taxon',
          quickList: quickTaxa, quickAction: 'quick-taxon',
          results: taxaResults, pickAction: 'pick-taxon',
          queryValue: local.taxonQuery
        })}
      </div>
    </article>
  `;
}

// 4) APARÊNCIA ---------------------------------------------------------------

function renderAppearanceBox(settings) {
  const themeLabel = settings.theme === 'light' ? 'Claro' : settings.theme === 'auto' ? 'Auto' : 'Escuro';
  return `
    <article class="cbox" data-open="${local.cbox.appearance}">
      ${cboxHeader('appearance', '🎨', 'Aparência', 'Tema visual (escuro / claro / auto)', themeLabel)}
      <div class="cbox-body">
        <div class="field">
          <span class="field-label">Tema</span>
          <div class="segmented" role="radiogroup">
            <button type="button" class="${settings.theme === 'dark' ? 'is-active' : ''}" data-action="set-theme" data-theme="dark">🌙 Escuro</button>
            <button type="button" class="${settings.theme === 'light' ? 'is-active' : ''}" data-action="set-theme" data-theme="light">☀ Claro</button>
            <button type="button" class="${settings.theme === 'auto' ? 'is-active' : ''}" data-action="set-theme" data-theme="auto">Auto (sistema)</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

// 5) SOM ---------------------------------------------------------------------

function renderSoundBox(settings) {
  const vol = typeof settings.soundVolume === 'number' ? settings.soundVolume : 60;
  return `
    <article class="cbox" data-open="${local.cbox.sound}">
      ${cboxHeader('sound', '🔊', 'Som', 'Volume dos efeitos sonoros (0 = mudo)', `Volume ${vol}%`)}
      <div class="cbox-body">
        <div class="volume-control" style="--vol: ${vol}%;">
          <span class="vol-icon" aria-hidden="true" data-vol="${vol}">🔊</span>
          <input class="volume-slider" type="range" min="0" max="100" value="${vol}" aria-label="Volume" style="--vol: ${vol}%;" data-action="set-volume" />
          <span class="vol-num tnum">${vol}%</span>
        </div>
      </div>
    </article>
  `;
}

// ---------------------------------------------------------------------------
// API DE BUSCA — chamada pelo main.js
// ---------------------------------------------------------------------------

export async function runTaxonSearch() {
  const q = local.taxonQuery.trim();
  local.searchError = null;
  if (q.length < 2) return;
  try {
    local.taxaResults = await searchTaxa(q);
  } catch (err) {
    local.searchError = err instanceof Error ? err.message : 'Erro na busca de táxons.';
  }
}

export async function runPlaceSearch(forceQuery) {
  const q = (forceQuery ?? local.placeQuery).trim();
  if (forceQuery !== undefined) local.placeQuery = forceQuery;
  local.searchError = null;
  if (q.length < 2) return;
  try {
    local.placeResults = await searchPlaces(q);
  } catch (err) {
    local.searchError = err instanceof Error ? err.message : 'Erro na busca de lugares.';
  }
}

export function setTaxonQuery(value) { local.taxonQuery = value; }
export function setPlaceQuery(value) { local.placeQuery = value; }
export { normalizeGroups };
