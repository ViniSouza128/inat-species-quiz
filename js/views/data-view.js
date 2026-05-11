// =============================================================================
// DATA VIEW — tela "Dados" v2 (Field Notebook)
// =============================================================================
// Espelha UserPage.tsx + ScreenData() do mockup:
//   Layout:
//     Mobile  → 1 coluna empilhada
//     Desktop → grid 2 colunas (esquerda: stats + charts | direita: histórico + zona de risco)
//
//   Componentes:
//     • Visão geral: 4 stat-tiles (Pontos, Precisão, Melhor sequência, Jogadas)
//     • Atividade recente: calendário 7 dias com intensidade
//     • Por dificuldade: bar charts
//     • Por grupo biológico: bar charts
//     • Histórico: filter pills SEMPRE visíveis (Todos/Acertos/Erros) +
//       busca + lista paginada 8/página + history-row com border-left
//     • Zona de risco: 2 botões (Resetar pontuação + Apagar histórico)
// =============================================================================

import { escapeHtml, formatDate } from '../format.js';

const PAGE_SIZE = 8;

const groupMeta = {
  Aves: { label: 'Aves', icon: '🐦' },
  Mammalia: { label: 'Mamíferos', icon: '🐾' },
  Reptilia: { label: 'Répteis', icon: '🦎' },
  Amphibia: { label: 'Anfíbios', icon: '🐸' },
  Actinopterygii: { label: 'Peixes', icon: '🐟' },
  Insecta: { label: 'Insetos', icon: '🐞' },
  Arachnida: { label: 'Aracnídeos', icon: '🕷️' },
  Plantae: { label: 'Plantas', icon: '🌿' },
  Fungi: { label: 'Fungos', icon: '🍄' },
  unknown: { label: 'Sem grupo', icon: '◌' }
};

function scoreLabel(value) { return value > 0 ? `+${value}` : String(value); }
function accuracy(correct, total) { return total > 0 ? Math.round((correct / total) * 1000) / 10 : 0; }
function normalizedGroup(item) { return item.answerIconicTaxonName || 'unknown'; }
function groupLabel(value) { return groupMeta[value]?.label ?? value; }
function groupIcon(value) { return groupMeta[value]?.icon ?? '◌'; }

function pageNumbers(current, total) {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1].filter((v) => v >= 1 && v <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  for (const v of sorted) {
    const prev = result[result.length - 1];
    if (typeof prev === 'number' && v - prev > 1) result.push('gap');
    result.push(v);
  }
  return result;
}

function computeInsights(history) {
  const byDifficulty = new Map();
  const byGroup = new Map();
  const lastDays = new Map();
  for (const item of history) {
    const difficulty = item.difficulty ?? 'normal';
    const diffBucket = byDifficulty.get(difficulty) ?? { total: 0, correct: 0 };
    diffBucket.total += 1;
    diffBucket.correct += item.wasCorrect ? 1 : 0;
    byDifficulty.set(difficulty, diffBucket);

    const group = normalizedGroup(item);
    const groupBucket = byGroup.get(group) ?? { total: 0, correct: 0 };
    groupBucket.total += 1;
    groupBucket.correct += item.wasCorrect ? 1 : 0;
    byGroup.set(group, groupBucket);

    const day = (item.answeredAt ?? '').slice(0, 10);
    if (day) {
      lastDays.set(day, (lastDays.get(day) ?? 0) + 1);
    }
  }
  return {
    byDifficulty: [...byDifficulty.entries()].map(([label, value]) => ({
      label, total: value.total, correct: value.correct, accuracy: accuracy(value.correct, value.total)
    })).sort((a, b) => b.total - a.total),
    byGroup: [...byGroup.entries()].map(([label, value]) => ({
      label, total: value.total, correct: value.correct, accuracy: accuracy(value.correct, value.total)
    })).sort((a, b) => b.total - a.total || b.accuracy - a.accuracy),
    lastDays
  };
}

/**
 * Constrói os 7 dias mais recentes (de hoje pra trás). Cada dia recebe
 * uma "intensidade" (0..4) baseada na contagem de respostas.
 */
function recentDaysStrip(lastDays) {
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const count = lastDays.get(iso) ?? 0;
    let intensity = 0;
    if (count > 0) intensity = 1;
    if (count >= 3) intensity = 2;
    if (count >= 6) intensity = 3;
    if (count >= 10) intensity = 4;
    const letter = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()];
    days.push({ label: letter, intensity, count });
  }
  return days;
}

// ---------------------------------------------------------------------------
// PARTIALS
// ---------------------------------------------------------------------------

function statsTile(label, value, glyph = '') {
  return `
    <div class="stat-tile">
      ${glyph ? `<span class="glyph" aria-hidden="true">${glyph}</span>` : ''}
      <small>${escapeHtml(label)}</small>
      <strong class="tnum">${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function barRow(label, percent, detail, icon) {
  const width = Math.max(percent > 0 ? 4 : 0, Math.round(percent));
  return `
    <div class="bar-row">
      <div class="bar-row-head">
        <span>${icon ? `<span aria-hidden="true">${icon}</span> ` : ''}${escapeHtml(label)}</span>
        <strong class="tnum">${escapeHtml(detail ?? `${percent}%`)}</strong>
      </div>
      <div class="bar-track"><span style="width: ${width}%;"></span></div>
    </div>
  `;
}

function dayCell(day) {
  return `<div class="day" data-int="${day.intensity}" title="${day.count} respostas">${escapeHtml(day.label)}</div>`;
}

function historyRow(item) {
  const ok = item.wasCorrect;
  return `
    <div class="history-row" data-correct="${ok}">
      ${item.thumbUrl
        ? `<div class="thumb"><img src="${escapeHtml(item.thumbUrl)}" alt="" loading="lazy" /></div>`
        : '<div class="thumb"></div>'}
      <div class="meta">
        <strong>
          ${ok ? 'Acerto' : 'Erro'}
          <span class="tag">${escapeHtml(item.difficulty ?? 'normal')}</span>
        </strong>
        <span>${escapeHtml(item.correctLabel ?? 'Resposta não informada')}</span>
        <small>${escapeHtml(formatDate(item.answeredAt))}</small>
      </div>
      <div class="delta tnum">${escapeHtml(scoreLabel(item.scoreDelta))}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// LOCAL UI STATE
// ---------------------------------------------------------------------------

const local = { page: 1, filter: 'all', searchQuery: '' };

export function getDataLocal() { return local; }
export function setDataLocal(partial) { Object.assign(local, partial); }

// ---------------------------------------------------------------------------
// MAIN RENDER
// ---------------------------------------------------------------------------

export function renderDataView(stats, history) {
  const insights = computeInsights(history);
  const days = recentDaysStrip(insights.lastDays);

  // Filtro por status (Todos/Acertos/Erros)
  let filtered = local.filter === 'correct' ? history.filter((h) => h.wasCorrect)
    : local.filter === 'miss' ? history.filter((h) => !h.wasCorrect)
    : history.slice();
  // Filtro por busca (nome científico ou popular)
  if (local.searchQuery.trim()) {
    const q = local.searchQuery.trim().toLowerCase();
    filtered = filtered.filter((h) =>
      (h.correctLabel ?? '').toLowerCase().includes(q) ||
      (h.selectedLabel ?? '').toLowerCase().includes(q)
    );
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(local.page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  const paginationButtons = pageNumbers(safePage, totalPages).map((item) => item === 'gap'
    ? '<button class="page-num dots" disabled>…</button>'
    : `<button type="button" class="page-num ${item === safePage ? 'is-active' : ''}" data-action="set-page" data-page="${item}">${item}</button>`
  ).join('');

  const summaryCard = `
    <article class="card">
      <header class="card-head">
        <div>
          <span class="kicker">Resumo local</span>
          <h2>Visão geral</h2>
        </div>
        <span class="badge">${stats.totalQuestions} jogadas</span>
      </header>
      <div class="stats-grid">
        ${statsTile('Pontos', stats.score, '★')}
        ${statsTile('Precisão', `${Math.round(stats.accuracy)}%`, '🎯')}
        ${statsTile('Melhor sequência', stats.bestStreak, '🔥')}
        ${statsTile('Jogadas', stats.totalQuestions, '▦')}
      </div>
    </article>
  `;

  const calendarCard = `
    <article class="card">
      <header class="card-head">
        <div><span class="kicker">Calendário</span><h2>Atividade recente</h2></div>
        <span class="badge">7 dias</span>
      </header>
      <div class="day-strip">${days.map(dayCell).join('')}</div>
    </article>
  `;

  const difficultyCard = `
    <article class="card">
      <header class="card-head">
        <div><span class="kicker">Análise</span><h2>Por dificuldade</h2></div>
        <span class="badge">${insights.byDifficulty.length}</span>
      </header>
      ${insights.byDifficulty.length === 0
        ? '<p style="font-size: 13px; color: var(--text-faint); margin: 0;">Sem dados suficientes ainda.</p>'
        : `<div>${insights.byDifficulty.map((i) =>
            barRow(`${i.label} · ${i.correct}/${i.total}`, i.accuracy, `${i.accuracy}%`)
          ).join('')}</div>`}
    </article>
  `;

  const groupCard = `
    <article class="card">
      <header class="card-head">
        <div><span class="kicker">Análise</span><h2>Por grupo biológico</h2></div>
        <span class="badge">${insights.byGroup.length}</span>
      </header>
      ${insights.byGroup.length === 0
        ? '<p style="font-size: 13px; color: var(--text-faint); margin: 0;">Os grupos aparecerão conforme você responder.</p>'
        : `<div>${insights.byGroup.map((i) =>
            barRow(groupLabel(i.label), i.accuracy, `${i.accuracy}%`, groupIcon(i.label))
          ).join('')}</div>`}
    </article>
  `;

  const historyCard = `
    <article class="card">
      <header class="card-head">
        <div><span class="kicker">Registro</span><h2>Histórico</h2></div>
        <span class="badge">${filtered.length} entradas</span>
      </header>
      <div class="history-toolbar">
        <div class="filter-pills">
          <button type="button" class="filter-pill ${local.filter === 'all' ? 'is-active' : ''}" data-action="set-filter" data-filter="all">Todos</button>
          <button type="button" class="filter-pill ${local.filter === 'correct' ? 'is-active' : ''}" data-action="set-filter" data-filter="correct">Acertos</button>
          <button type="button" class="filter-pill ${local.filter === 'miss' ? 'is-active' : ''}" data-action="set-filter" data-filter="miss">Erros</button>
        </div>
        <input class="input" placeholder="Buscar nome científico…" data-input="history-search" value="${escapeHtml(local.searchQuery)}" />
      </div>
      <div class="history-list">
        ${visible.length === 0
          ? '<p style="font-size: 13px; color: var(--text-faint); padding: 16px;">Nenhuma partida registrada para este filtro.</p>'
          : visible.map(historyRow).join('')}
      </div>
      ${totalPages > 1 ? `
        <div class="pagination">
          <button type="button" class="page-num" aria-label="Anterior" ${safePage <= 1 ? 'disabled' : ''} data-action="prev-page">‹</button>
          ${paginationButtons}
          <button type="button" class="page-num" aria-label="Próxima" ${safePage >= totalPages ? 'disabled' : ''} data-action="next-page">›</button>
        </div>
      ` : ''}
    </article>
  `;

  const dangerCard = `
    <article class="card danger-zone">
      <header class="card-head">
        <div>
          <span class="kicker" style="color: var(--err);">Zona de risco</span>
          <h2>Apagar dados locais</h2>
        </div>
      </header>
      <p class="danger-desc">
        Remove <strong>todo o histórico</strong> e <strong>zera as estatísticas</strong> deste navegador.
        A ação é irreversível — peço confirmação dupla antes de executar.
      </p>
      <div class="danger-actions">
        <button type="button" class="btn btn-ghost btn-block-mobile" data-action="reset-stats">↺ Resetar pontuação</button>
        <button type="button" class="btn btn-danger btn-block-mobile" data-action="clear-history">⚠ Apagar histórico</button>
      </div>
    </article>
  `;

  return `
    <section class="data-screen" aria-label="Estatísticas e histórico" data-scroll>
      <header class="page-head">
        <span class="kicker">Quiz · iNaturalist</span>
        <h1>Dados</h1>
      </header>

      <div class="config-grid">
        <div style="display: grid; gap: var(--sp-4); align-content: start;">
          ${summaryCard}
          ${calendarCard}
          ${difficultyCard}
          ${groupCard}
        </div>
        <div style="display: grid; gap: var(--sp-4); align-content: start;">
          ${historyCard}
          ${dangerCard}
        </div>
      </div>
    </section>
  `;
}
