// =============================================================================
// DATA VIEW — tela "Dados" com cartões de resumo, insights e histórico
// =============================================================================
// Espelha UserPage.tsx. Recebe stats + history e renderiza tudo a partir de
// agregações in-memory.
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

function percent(stats) {
  return `${stats.accuracy.toFixed(stats.accuracy % 1 === 0 ? 0 : 1)}%`;
}

function scoreLabel(value) {
  return value > 0 ? `+${value}` : String(value);
}

function accuracy(correct, total) {
  return total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
}

function normalizedGroup(item) {
  return item.answerIconicTaxonName || 'unknown';
}

function groupLabel(value) {
  return groupMeta[value]?.label ?? value;
}

function groupIcon(value) {
  return groupMeta[value]?.icon ?? '◌';
}

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
  const progress = new Map();
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
      const dayBucket = progress.get(day) ?? { total: 0, correct: 0, score: 0 };
      dayBucket.total += 1;
      dayBucket.correct += item.wasCorrect ? 1 : 0;
      dayBucket.score += item.scoreDelta;
      progress.set(day, dayBucket);
    }
  }
  return {
    byDifficulty: [...byDifficulty.entries()].map(([label, value]) => ({
      label, total: value.total, correct: value.correct, accuracy: accuracy(value.correct, value.total)
    })).sort((a, b) => b.total - a.total),
    byGroup: [...byGroup.entries()].map(([label, value]) => ({
      label, total: value.total, correct: value.correct, accuracy: accuracy(value.correct, value.total)
    })).sort((a, b) => b.total - a.total || b.accuracy - a.accuracy),
    progress: [...progress.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-5).map(([label, v]) => ({ label, ...v }))
  };
}

function rateBar(label, value, max = 100, detail, icon) {
  const width = max > 0 ? Math.max(value > 0 ? 5 : 0, Math.round((value / max) * 100)) : 0;
  return `
    <div class="rate-bar-row">
      <div class="rate-bar-head">
        <span>${icon ? `<b aria-hidden="true">${icon}</b>` : ''}${escapeHtml(label)}</span>
        <strong>${escapeHtml(detail ?? `${value}%`)}</strong>
      </div>
      <div class="rate-bar-track"><span style="width: ${width}%"></span></div>
    </div>
  `;
}

function progressCard(item) {
  const rate = accuracy(item.correct, item.total);
  return `
    <article class="recent-progress-card">
      <div class="recent-progress-head">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${item.correct}/${item.total} acertos</span>
        <b class="${item.score >= 0 ? 'positive-score' : 'negative-score'}">${escapeHtml(scoreLabel(item.score))} pts</b>
      </div>
      <div class="rate-bar-track"><span style="width: ${Math.max(5, rate)}%"></span></div>
    </article>
  `;
}

function historyRow(item) {
  return `
    <details class="history-row ${item.wasCorrect ? 'ok' : 'miss'}">
      <summary>
        ${item.thumbUrl ? `<img src="${escapeHtml(item.thumbUrl)}" alt="Miniatura da pergunta respondida" loading="lazy" />` : ''}
        <div>
          <strong>${item.wasCorrect ? 'Acerto' : 'Erro'} · ${escapeHtml(item.difficulty ?? 'normal')} · ${escapeHtml(scoreLabel(item.scoreDelta))}</strong>
          <span>${escapeHtml(item.correctLabel ?? 'Resposta não informada')}</span>
          <small>${escapeHtml(formatDate(item.answeredAt))}</small>
        </div>
      </summary>
      <div class="history-expand">
        ${!item.wasCorrect ? `<p><strong>Você marcou:</strong> ${escapeHtml(item.selectedLabel ?? 'n/d')}</p>` : ''}
        <p><strong>Resposta certa:</strong> ${escapeHtml(item.correctLabel ?? 'n/d')}</p>
        <p><strong>Grupo:</strong> ${escapeHtml(groupLabel(normalizedGroup(item)))}</p>
        ${item.observationUri ? `<a href="${escapeHtml(item.observationUri)}" target="_blank" rel="noreferrer">Abrir observação no iNaturalist</a>` : ''}
      </div>
    </details>
  `;
}

// Estado local de UI para esta view (paginação + filtro).
const local = { page: 1, filter: 'all', filtersOpen: false };

export function getDataLocal() { return local; }
export function setDataLocal(partial) { Object.assign(local, partial); }

export function renderDataView(stats, history) {
  const insights = computeInsights(history);
  const filteredHistory = local.filter === 'correct' ? history.filter((h) => h.wasCorrect)
    : local.filter === 'miss' ? history.filter((h) => !h.wasCorrect)
    : history;

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  const safePage = Math.min(local.page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visibleHistory = filteredHistory.slice(start, start + PAGE_SIZE);

  const maxDifficultyTotal = Math.max(0, ...insights.byDifficulty.map((i) => i.total));

  const paginationButtons = pageNumbers(safePage, totalPages).map((item, idx) => item === 'gap'
    ? `<span>…</span>`
    : `<button type="button" class="${item === safePage ? 'active' : ''}" data-action="set-page" data-page="${item}">${item}</button>`
  ).join('');

  return `
    <section class="screen-scroll user-screen drag-scroll-surface" aria-label="Estatísticas e histórico" data-scroll>
      <div class="simple-page-head">
        <div>
          <p class="eyebrow">Quiz iNaturalist</p>
          <h1>Dados</h1>
        </div>
      </div>

      <section class="user-panel data-panel" aria-label="Dados locais">
        <div class="user-head data-head">
          <div>
            <p class="eyebrow">Resumo local</p>
            <h2>Dados</h2>
          </div>
          <div class="data-head-actions">
            <button type="button" class="ghost icon-button danger-action" data-action="clear-history">Apagar</button>
          </div>
        </div>

        <div class="profile-stats data-summary-grid">
          <div><span>Pontos</span><strong>${stats.score}</strong></div>
          <div><span>Jogadas</span><strong>${stats.totalQuestions}</strong></div>
          <div><span>Precisão</span><strong>${escapeHtml(percent(stats))}</strong></div>
          <div><span>Melhor sequência</span><strong>${stats.bestStreak}</strong></div>
        </div>

        <section class="data-card recent-card" aria-label="Progresso recente">
          <div class="data-card-head"><h3>Progresso recente</h3><span>${insights.progress.length > 0 ? 'últimos dias' : 'sem dados'}</span></div>
          ${insights.progress.length === 0 ? '<p class="fine-print">Responda algumas rodadas para ver tendência diária.</p>' : ''}
          <div class="progress-list compact-progress-list">
            ${insights.progress.map(progressCard).join('')}
          </div>
        </section>

        <section class="data-card" aria-label="Desempenho por dificuldade">
          <div class="data-card-head"><h3>Desempenho por dificuldade</h3><span>${history.length} registros</span></div>
          ${insights.byDifficulty.length === 0 ? '<p class="fine-print">Sem dados suficientes ainda.</p>' : ''}
          <div class="rate-list">
            ${insights.byDifficulty.map((i) => rateBar(`${i.label} · ${i.accuracy}%`, i.total, maxDifficultyTotal, String(i.total))).join('')}
          </div>
        </section>

        <section class="data-card" aria-label="Taxa de acerto por grupos">
          <div class="data-card-head"><h3>Taxa de acerto por grupos</h3><span>${insights.byGroup.length} grupos</span></div>
          ${insights.byGroup.length === 0 ? '<p class="fine-print">Os grupos aparecerão conforme você responder.</p>' : ''}
          <div class="rate-list group-rate-list">
            ${insights.byGroup.map((i) => rateBar(groupLabel(i.label), i.accuracy, 100, `${i.accuracy}%`, groupIcon(i.label))).join('')}
          </div>
        </section>

        <section class="data-card history-card" aria-label="Todos os registros">
          <div class="data-card-head">
            <h3>Todos os registros</h3>
            <span>${filteredHistory.length}/${history.length}</span>
          </div>
          <div class="history-toolbar">
            <button type="button" class="ghost icon-button" data-action="toggle-filters">⌕ Filtros</button>
            ${local.filtersOpen ? `
              <div class="history-filter-row" aria-label="Filtros de histórico">
                <button type="button" class="${local.filter === 'all' ? 'active' : ''}" data-action="set-filter" data-filter="all">Todos</button>
                <button type="button" class="${local.filter === 'correct' ? 'active' : ''}" data-action="set-filter" data-filter="correct">Acertos</button>
                <button type="button" class="${local.filter === 'miss' ? 'active' : ''}" data-action="set-filter" data-filter="miss">Erros</button>
              </div>
            ` : ''}
          </div>
          <div class="history-list">
            ${visibleHistory.length === 0 ? '<p class="fine-print">Nenhuma partida registrada para este filtro.</p>' : ''}
            ${visibleHistory.map(historyRow).join('')}
          </div>
          <div class="pagination-row numbered-pagination">
            <button type="button" class="secondary pager-arrow" aria-label="Página anterior" ${safePage <= 1 ? 'disabled' : ''} data-action="prev-page">‹</button>
            <div class="page-number-list">${paginationButtons}</div>
            <button type="button" class="secondary pager-arrow" aria-label="Próxima página" ${safePage >= totalPages ? 'disabled' : ''} data-action="next-page">›</button>
          </div>
        </section>
      </section>
    </section>
  `;
}
