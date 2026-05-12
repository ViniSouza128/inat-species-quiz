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
  // Estado dos boxes colapsáveis. Tudo COLAPSADO por default — o usuário
  // expande só o que precisa, em vez de ver um paredão na abertura.
  cbox: { difficulty: false, filters: false, appearance: false, sound: false }
};

export function getSettingsLocal() { return local; }
export function toggleCbox(id) {
  if (id in local.cbox) local.cbox[id] = !local.cbox[id];
}

/** Tradução PT-BR para os grupos iconic — usada nos textos do modal de
 *  conflito quando o táxon escolhido cair fora dos grupos selecionados. */
export const GROUP_LABEL = {
  Aves: 'Aves',
  Mammalia: 'Mamíferos',
  Reptilia: 'Répteis',
  Amphibia: 'Anfíbios',
  Actinopterygii: 'Peixes',
  Insecta: 'Insetos',
  Arachnida: 'Aracnídeos',
  Plantae: 'Plantas',
  Fungi: 'Fungos'
};

/** Detecta conflito entre o iconic_taxon_name de um táxon e os grupos
 *  biológicos selecionados. Retorna null se não houver. */
export function detectIconicConflict(taxonIconic, selectedGroups) {
  if (!taxonIconic) return null;
  if (selectedGroups.includes('all')) return null;
  if (!ALL_GROUP_VALUES.includes(taxonIconic)) return null;
  if (selectedGroups.includes(taxonIconic)) return null;
  return { taxonIconic };
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

export function renderSettingsView(settings, loading) {
  // Vazio é estado válido (bloqueia quiz com mensagem) — não auto-restaura.
  const selectedGroups = normalizeGroups(settings.iconicTaxa);

  return `
    <section class="config-screen" aria-label="Configurações do quiz" data-scroll>
      <header class="page-head">
        <span class="kicker">Quiz · iNaturalist</span>
        <h1>Configuração</h1>
      </header>

      <div class="config-stack">
        ${renderDifficultyBox(settings)}
        ${renderFiltersBox(settings, selectedGroups)}
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

// 1) GRUPOS BIOLÓGICOS — chips renderizados DENTRO do cbox Filtros ---------

function renderGroupChips(selectedGroups) {
  return groupItems.map((g) => {
    const isActive = g.value === 'all' ? selectedGroups.includes('all') : selectedGroups.includes(g.value);
    return `
      <button type="button" class="chip ${isActive ? 'is-active' : ''}" data-action="toggle-group" data-group="${g.value}">
        <span class="glyph">${g.icon}</span>
        <span>${escapeHtml(g.label)}</span>
      </button>
    `;
  }).join('');
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
  const { glyph, title, count, searchPlaceholder, searchInput, searchAction, currentTags, removeAction, quickList, quickAction, results, pickAction } = opts;

  // Multi-select tag-strip: renderiza TODAS as tags selecionadas. Cada
  // botão "✕" leva o `data-id` para o handler conseguir remover só aquela.
  const tagStrip = (currentTags || []).map((tag) => `
    <span class="tag" data-id="${tag.id}">
      <span>${escapeHtml(tag.label)}</span>
      ${tag.meta ? `<span class="meta">${escapeHtml(tag.meta)}</span>` : ''}
      <button type="button" data-action="${removeAction}" data-id="${tag.id}" aria-label="Remover ${escapeHtml(tag.label)}">✕</button>
    </span>
  `).join('');

  const quickAdd = quickList.map((q) => {
    const isActive = (currentTags || []).some((tag) => tag.label.toLowerCase().includes(q.toLowerCase()));
    return `<button type="button" data-added="${isActive}" data-action="${quickAction}" data-quick="${escapeHtml(q)}">${escapeHtml(q)}</button>`;
  }).join('');

  const resultsHtml = results && results.length > 0
    ? `<div class="result-list-inline">
         ${results.map((r) => `
           <button type="button" data-action="${pickAction}" data-id="${r.id}" data-label="${escapeHtml(r.label)}" ${r.extra ? `data-extra="${escapeHtml(r.extra)}"` : ''} ${r.iconic ? `data-iconic="${escapeHtml(r.iconic)}"` : ''}>
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

function renderFiltersBox(settings, selectedGroups) {
  // Multi-select: lê as listas inteiras de settings.taxa[]/places[].
  // Cada tag aparece como pill removível na .tag-strip.
  const placesList = Array.isArray(settings.places) ? settings.places : [];
  const taxaList = Array.isArray(settings.taxa) ? settings.taxa : [];
  const placeTags = placesList.map((p) => ({ id: p.id, label: p.label, meta: 'local' }));
  const taxonTags = taxaList.map((t) => ({ id: t.id, label: t.label, meta: 'táxon' }));
  const filtersCount = placeTags.length + taxonTags.length;
  const activeGroups = selectedGroups.filter((v) => v !== 'all').length;
  const totalGroups = ALL_GROUP_VALUES.length;
  let groupsPart;
  if (activeGroups === 0) groupsPart = 'sem grupos';
  else if (activeGroups === totalGroups) groupsPart = 'todos grupos';
  else groupsPart = `${activeGroups} grupos`;
  const summary = filtersCount === 0 ? groupsPart : `${groupsPart} · ${filtersCount} ${filtersCount === 1 ? 'filtro' : 'filtros'}`;

  const placesResults = local.placeResults.map((p) => ({
    id: p.id, label: p.name || p.display_name, extra: p.display_name && p.display_name !== p.name ? p.display_name : null
  }));
  // O `iconic` é enviado como data-attribute no botão. main.js usa esse valor
  // para detectar conflito com `iconicTaxa` e abrir o modal de confirmação.
  const taxaResults = local.taxaResults.map((t) => ({
    id: t.id,
    label: t.preferred_common_name ?? t.name,
    extra: t.preferred_common_name ? `${t.name} · ${t.rank ?? 'rank n/d'}` : (t.rank ?? null),
    iconic: t.iconic_taxon_name ?? null
  }));

  return `
    <article class="cbox" data-open="${local.cbox.filters}">
      ${cboxHeader('filters', '🔍', 'Filtros', 'Grupos biológicos, locais e táxons que entram no quiz', summary)}
      <div class="cbox-body">
        <div class="filter-group">
          <header class="filter-group-head">
            <span class="glyph" aria-hidden="true">🌿</span>
            <strong>Grupos biológicos</strong>
            <span class="count">${activeGroups === 0 ? 'nenhum' : (activeGroups === totalGroups ? 'todos' : activeGroups)}</span>
          </header>
          <div class="group-chips">${renderGroupChips(selectedGroups)}</div>
        </div>
        ${filterSubGroup({
          glyph: '📍', title: 'Locais', count: placeTags.length,
          searchPlaceholder: 'Buscar local — ex: Brasil, Pantanal',
          searchInput: 'place', searchAction: 'search-place',
          currentTags: placeTags, removeAction: 'remove-place',
          quickList: quickPlaces, quickAction: 'quick-place',
          results: placesResults, pickAction: 'pick-place',
          queryValue: local.placeQuery
        })}
        ${filterSubGroup({
          glyph: '🔬', title: 'Táxons', count: taxonTags.length,
          searchPlaceholder: 'Buscar táxon — ex: Felidae, Orchidaceae',
          searchInput: 'taxon', searchAction: 'search-taxon',
          currentTags: taxonTags, removeAction: 'remove-taxon',
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
// MODAL de CONFIRMAÇÃO — usado para conflitos entre grupos biológicos e
// o táxon escolhido. Renderizado por main.js quando state.confirmModal
// estiver setado. Não auto-corrige nada; deixa o usuário decidir.
// ---------------------------------------------------------------------------

export function renderConfirmModal(modal) {
  if (!modal) return '';
  const groupName = GROUP_LABEL[modal.taxonIconic] ?? modal.taxonIconic ?? '?';

  let body = '';
  let primaryLabel = '';
  let primaryAction = '';
  let hints = '';

  // Mostra o nome científico em parênteses só se for diferente do label.
  const sciPart = (modal.taxonSci && modal.taxonSci !== modal.taxonLabel)
    ? ` (<em>${escapeHtml(modal.taxonSci)}</em>)`
    : '';

  if (modal.kind === 'adding-taxon') {
    const selected = (modal.previousGroups || [])
      .filter((g) => g !== 'all')
      .map((g) => GROUP_LABEL[g] ?? g)
      .join(', ') || 'nenhum';
    body = `<strong>${escapeHtml(modal.taxonLabel)}</strong>${sciPart} é do grupo <em>${escapeHtml(groupName)}</em>, mas você marcou apenas <em>${escapeHtml(selected)}</em> nos grupos biológicos. Sem ajuste, nenhuma observação vai bater.`;
    primaryLabel = `Trocar grupos para Todos e aplicar ${escapeHtml(modal.taxonLabel)}`;
    primaryAction = 'confirm-apply-taxon';
    hints = '<li>Você pode cancelar a adição do táxon, ou trocar os grupos para “Todos” e manter o táxon.</li>';
  } else if (modal.kind === 'changing-groups') {
    body = `Você está removendo o grupo <em>${escapeHtml(groupName)}</em>, mas o táxon <strong>${escapeHtml(modal.taxonLabel)}</strong>${sciPart} que está nos filtros pertence a esse grupo. Sem ele, o táxon não traz resultados.`;
    primaryLabel = `Aplicar mudança e remover ${escapeHtml(modal.taxonLabel)}`;
    primaryAction = 'confirm-apply-groups';
    hints = '<li>Você pode cancelar para manter o grupo, ou aplicar a mudança removendo o táxon.</li>';
  }

  return `
    <div class="modal-backdrop" role="presentation" data-action="confirm-close">
      <section class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header class="modal-head">
          <div class="confirm-head">
            <span class="confirm-disc" aria-hidden="true">⚠</span>
            <h2 id="confirm-title">Conflito entre filtros</h2>
          </div>
          <button type="button" class="btn btn-ghost" data-action="confirm-close" aria-label="Fechar">Fechar ✕</button>
        </header>
        <div class="modal-body confirm-body">
          <p>${body}</p>
          <ul class="confirm-hints">${hints}</ul>
        </div>
        <footer class="modal-foot">
          <button type="button" class="btn btn-primary" data-action="${primaryAction}">${primaryLabel}</button>
          <button type="button" class="btn btn-ghost" data-action="confirm-close">Cancelar</button>
        </footer>
      </section>
    </div>
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
