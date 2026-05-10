// =============================================================================
// SETTINGS VIEW — tela de Configurações (filtros + dificuldade + busca)
// =============================================================================
// Espelha SettingsPanel.tsx. UI controlada via re-render — cada interação
// chama `update(partial)` e o pai redesenha.
// =============================================================================

import { escapeHtml } from '../format.js';
import { ALL_GROUP_VALUES } from '../state.js';
import { searchTaxa, searchPlaces } from '../inat-api.js';

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
  easy: {
    title: 'Fácil',
    bullets: [
      'Base de 60 pts + bônus regressivo por até 20 s.',
      'O bônus começa em 60 pts e cai com o tempo.',
      'Se o tempo acabar, você ainda pode responder, só sem bônus.',
      'Alternativas podem ser de ordens diferentes. Erro: -20 pts.'
    ]
  },
  normal: {
    title: 'Normal',
    bullets: [
      'Base de 100 pts + bônus regressivo por até 15 s.',
      'O bônus começa em 75 pts e diminui a cada segundo.',
      'Depois disso, ainda dá para responder sem bônus.',
      'Alternativas ficam na mesma ordem taxonômica da resposta correta. Erro: -45 pts.'
    ]
  },
  hard: {
    title: 'Difícil',
    bullets: [
      'Base de 140 pts + bônus regressivo por até 12 s.',
      'Alternativas da mesma ordem taxonômica da resposta correta.',
      'Quando o contador zera, a tentativa é perdida automaticamente.',
      'Erro ou tempo esgotado: -65 pts.'
    ]
  },
  expert: {
    title: 'Especialista',
    bullets: [
      'Base de 180 pts + bônus regressivo por até 10 s.',
      'Distratores muito parecidos, todos da mesma ordem, e dica mínima.',
      'Quando o contador zera, a tentativa é perdida automaticamente.',
      'Erro ou tempo esgotado: -90 pts.'
    ]
  }
};

function normalizeGroups(values) {
  const onlyActual = ALL_GROUP_VALUES.filter((v) => values.includes(v));
  if (onlyActual.length === ALL_GROUP_VALUES.length) return ['all', ...ALL_GROUP_VALUES];
  return onlyActual;
}

// Estado local (resultado da busca, queries) — escopo do módulo, não persistido.
const local = {
  taxonQuery: '',
  placeQuery: '',
  taxaResults: [],
  placeResults: [],
  searchError: null
};

export function getSettingsLocal() { return local; }

export function renderSettingsView(settings, loading) {
  const selectedGroups = normalizeGroups(settings.iconicTaxa.length > 0 ? settings.iconicTaxa : ['all', ...ALL_GROUP_VALUES]);
  const currentDifficulty = difficultyInfo[settings.difficulty];

  const chipsHtml = groupItems.map((g) => {
    const isActive = g.value === 'all' ? selectedGroups.includes('all') : selectedGroups.includes(g.value);
    return `
      <button type="button" class="group-chip ${isActive ? 'active' : ''}" data-action="toggle-group" data-group="${g.value}">
        <span class="group-icon" aria-hidden="true">${g.icon}</span>
        <span>${escapeHtml(g.label)}</span>
      </button>
    `;
  }).join('');

  const taxaResultsHtml = local.taxaResults.length > 0 ? `
    <div class="result-list">
      ${local.taxaResults.map((t) => `
        <button type="button" data-action="pick-taxon" data-taxon-id="${t.id}" data-taxon-label="${escapeHtml(t.preferred_common_name ?? t.name)}">
          <strong>${escapeHtml(t.preferred_common_name ?? t.name)}</strong>
          <span>${escapeHtml(t.name)} · ${escapeHtml(t.rank ?? 'rank n/d')}</span>
        </button>
      `).join('')}
    </div>
  ` : '';

  const placeResultsHtml = local.placeResults.length > 0 ? `
    <div class="result-list">
      ${local.placeResults.map((p) => `
        <button type="button" data-action="pick-place" data-place-id="${p.id}" data-place-label="${escapeHtml(p.display_name)}">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.display_name)}</span>
        </button>
      `).join('')}
    </div>
  ` : '';

  return `
    <section class="screen-scroll config-screen drag-scroll-surface" aria-label="Configurações do quiz" data-scroll>
      <div class="simple-page-head">
        <div>
          <p class="eyebrow">Quiz iNaturalist</p>
          <h1>Configurações</h1>
        </div>
      </div>

      <aside class="settings-panel compact-settings">
        <div class="settings-title stacked-title">
          <div>
            <p class="eyebrow">Configuração do quiz</p>
            <h2>Filtro e dificuldade</h2>
          </div>
          <span>${escapeHtml(settings.placeLabel ?? settings.taxonLabel ?? 'global')}</span>
        </div>

        <section class="group-picker" aria-label="Grupos">
          <h3>Grupos</h3>
          <div class="group-chip-grid">${chipsHtml}</div>
        </section>

        <label>
          Dificuldade
          <select data-action="set-difficulty">
            <option value="easy" ${settings.difficulty === 'easy' ? 'selected' : ''}>Fácil</option>
            <option value="normal" ${settings.difficulty === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="hard" ${settings.difficulty === 'hard' ? 'selected' : ''}>Difícil</option>
            <option value="expert" ${settings.difficulty === 'expert' ? 'selected' : ''}>Especialista</option>
          </select>
        </label>

        <div class="difficulty-card">
          <strong>${escapeHtml(currentDifficulty.title)}</strong>
          <ul>
            ${currentDifficulty.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}
          </ul>
        </div>

        <details class="advanced-options">
          <summary>Filtros avançados</summary>

          <div class="search-box">
            <label for="taxon-search">Táxon</label>
            <div class="inline-field">
              <input id="taxon-search" data-input="taxon" placeholder="Felidae, Orchidaceae" value="${escapeHtml(local.taxonQuery)}" />
              <button type="button" class="secondary" data-action="search-taxon">Buscar</button>
            </div>
            ${settings.taxonLabel ? `<button type="button" class="chip" data-action="clear-taxon">Táxon: ${escapeHtml(settings.taxonLabel)} ×</button>` : ''}
            ${taxaResultsHtml}
          </div>

          <div class="search-box">
            <label for="place-search">Local</label>
            <div class="inline-field">
              <input id="place-search" data-input="place" placeholder="Brazil, Pantanal" value="${escapeHtml(local.placeQuery)}" />
              <button type="button" class="secondary" data-action="search-place">Buscar</button>
            </div>
            <button type="button" class="secondary full" data-action="search-place-brazil">Brasil</button>
            ${settings.placeLabel ? `<button type="button" class="chip" data-action="clear-place">Lugar: ${escapeHtml(settings.placeLabel)} ×</button>` : ''}
            ${placeResultsHtml}
          </div>

          <label class="toggle">
            <input type="checkbox" data-action="toggle-scientific-only" ${settings.scientificOnly ? 'checked' : ''} />
            Só nomes científicos
          </label>

          <label>
            Tema
            <select data-action="set-theme">
              <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Escuro</option>
              <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Claro</option>
            </select>
          </label>
        </details>

        ${local.searchError ? `<p class="warning">${escapeHtml(local.searchError)}</p>` : ''}

        <div class="config-actions">
          <button type="button" class="ghost" data-action="reset-stats">Resetar pontuação</button>
          <button type="button" class="primary" data-action="new-question" ${loading ? 'disabled' : ''}>${loading ? 'Buscando...' : 'Nova pergunta'}</button>
        </div>
      </aside>
    </section>
  `;
}

/** Helpers das buscas, expostos para o main.js. */
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
