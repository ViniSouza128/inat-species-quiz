// =============================================================================
// MAIN — bootstrap do app, navegação entre abas, event delegation
// =============================================================================
// Este é o arquivo de entrada (importado pelo index.html). Responsabilidades:
//   • Mantém o "estado central" (settings, stats, history, question state).
//   • Renderiza a tela atual a partir desse estado (template literals).
//   • Delega eventos via data-action no documento (sem listeners por botão).
//   • Gerencia prefetch de perguntas e timer do quiz.
//
// Padrão de render: a cada mudança de estado, chama `render()`. As views
// são funções puras que devolvem strings de HTML; o `innerHTML =` faz o
// diff visual. Como o app é pequeno, o custo é desprezível.
// =============================================================================

import {
  loadSettings, saveSettings, loadStats, saveStats, loadHistory, saveHistory,
  loadQuestionCache, saveQuestionCache, clearAllUserData,
  DEFAULT_SETTINGS, DEFAULT_STATS, ALL_GROUP_VALUES
} from './state.js';
import {
  createQuestion, preloadQuestionAssets,
  difficultyRules, currentBonus, remainingSecondsFor, scoreForAnswer,
  penaltyForDifficulty, nextStats, makeHistoryItem
} from './quiz-engine.js';
import { primeUiAudio, playUiSound } from './sounds.js';
import { escapeHtml } from './format.js';
import {
  renderGameScreen, renderInfoModal,
  attachImageInteractivity, equalizeAnswerHeights
} from './views/quiz-view.js';
import {
  renderSettingsView, runTaxonSearch, runPlaceSearch,
  setTaxonQuery, setPlaceQuery, normalizeGroups, toggleCbox
} from './views/settings-view.js';
import { renderDataView, getDataLocal, setDataLocal } from './views/data-view.js';

// ---------------------------------------------------------------------------
// ESTADO CENTRAL — única fonte da verdade
// ---------------------------------------------------------------------------

const state = {
  // settings + stats persistem em localStorage; tudo abaixo é volátil.
  settings: loadSettings(),
  stats: loadStats(),
  history: loadHistory(),

  mode: 'game', // 'game' | 'config' | 'stats'

  // Quiz state
  question: null,
  prefetchQueue: [], // espelho de loadQuestionCache, populado pelo prefetch
  answerResult: null,
  selectedTaxonId: null,
  loading: false,
  answering: false,
  error: null,
  hintLevel: 0,
  elapsedSeconds: 0,
  remainingSeconds: 0,
  currentBonusPoints: 0,
  startedAt: null,            // Date.now() de quando a pergunta apareceu
  infoModalOpen: false,

  // Refs internos
  prefetchInProgress: false,
  generation: 0,              // incrementa a cada mudança de settings — invalida prefetches em vôo
  countdownCueSecond: null,   // último segundo em que o cue sonoro tocou
  detachImage: null,          // cleanup da interatividade de imagem
  detachAnswerHeights: null   // cleanup do equalizador de altura
};

// inicializa a fila de prefetch a partir do cache persistente
state.prefetchQueue = loadQuestionCache(JSON.stringify(state.settings));
state.currentBonusPoints = difficultyRules[state.settings.difficulty].bonusStart;
state.remainingSeconds = difficultyRules[state.settings.difficulty].countdownSeconds;

// Reduzido para 3 para não sobrecarregar o navegador / iNat (cada pergunta
// dispara observations + 4 enrichments + possível scrape HTML).
const PREFETCH_TARGET = 3;

// ---------------------------------------------------------------------------
// RENDER — desenha a tela atual a partir do estado
// ---------------------------------------------------------------------------

const root = document.getElementById('root');

function modeTitle(mode) {
  if (mode === 'config') return 'Configurações';
  if (mode === 'stats') return 'Dados';
  return 'Quiz';
}

function timerStateClass() {
  const isLimited = Boolean(state.question && ['hard', 'expert'].includes(state.question.meta.difficulty));
  if (!isLimited || state.answerResult) return '';
  if (state.remainingSeconds <= 3) return 'timer-critical';
  if (state.remainingSeconds <= 5) return 'timer-caution';
  return '';
}

function shellClasses() {
  // Classes auxiliares no app-shell — usadas pelo CSS para variar estilos
  // por estado (ex.: timer-critical pinta o HUD de vermelho).
  return [
    'app-shell',
    `mode-${state.mode}`,
    state.answerResult ? 'answered-shell' : '',
    state.answering ? 'answering-shell' : '',
    state.loading ? 'loading-shell' : '',
    timerStateClass()
  ].filter(Boolean).join(' ');
}

function renderShell() {
  // Faz cleanup das interatividades anexadas no render anterior.
  if (state.detachImage) { state.detachImage(); state.detachImage = null; }

  let mainContent = '';
  if (state.mode === 'game') {
    mainContent = renderGameScreen({
      ...state,
      answered: Boolean(state.answerResult),
      prefetchedCount: state.prefetchQueue.length
    });
  } else if (state.mode === 'config') {
    mainContent = renderSettingsView(state.settings, state.loading);
  } else if (state.mode === 'stats') {
    mainContent = renderDataView(state.stats, state.history);
  }

  // Estrutura v2 (espelha App.tsx do app React): flex column 100dvh com
  // app-main (1fr) + bottom-nav (auto, flush base).
  root.className = '';
  root.innerHTML = `
    <div class="${shellClasses()}">
      ${mainContent}
      <nav class="bottom-nav" aria-label="Navegação principal">
        <button type="button" class="bottom-nav-item ${state.mode === 'game' ? 'is-active' : ''}" data-action="set-mode" data-mode="game">
          <span class="icon" aria-hidden="true">🌿</span>
          <span>Quiz</span>
        </button>
        <button type="button" class="bottom-nav-item ${state.mode === 'config' ? 'is-active' : ''}" data-action="set-mode" data-mode="config">
          <span class="icon" aria-hidden="true">⚙</span>
          <span>Config</span>
        </button>
        <button type="button" class="bottom-nav-item ${state.mode === 'stats' ? 'is-active' : ''}" data-action="set-mode" data-mode="stats">
          <span class="icon" aria-hidden="true">📊</span>
          <span>Dados</span>
        </button>
      </nav>
      ${state.infoModalOpen && state.question ? renderInfoModal(state.question) : ''}
    </div>
  `;

  // Garante type="button" em todos os botões recém-renderizados.
  root.querySelectorAll('button:not([type])').forEach((b) => { b.type = 'button'; });

  // Anexa interatividade da foto (zoom/pan + carregamento progressivo).
  if (state.mode === 'game' && state.question && !state.loading) {
    const quizScreen = root.querySelector('.quiz-screen');
    if (quizScreen) {
      state.detachImage = attachImageInteractivity(quizScreen, state.question, () => {
        nextQuestion();
      });
    }
  }
}

// Render (com debounce simples para evitar reflow consecutivo). Nem todos
// os caminhos chamam — eventos de timer fazem múltiplos rerenders por seg.
function render() { renderShell(); }

// ---------------------------------------------------------------------------
// PREFETCH QUEUE — preenche a fila em paralelo até PREFETCH_TARGET
// ---------------------------------------------------------------------------

function settingsKey() { return JSON.stringify(state.settings); }

function syncPrefetchPersist() {
  saveQuestionCache(state.prefetchQueue, settingsKey());
}

async function fillPrefetchQueue() {
  if (state.prefetchInProgress) return;
  const generation = state.generation;
  const needed = PREFETCH_TARGET - state.prefetchQueue.length;
  if (needed <= 0) return;
  state.prefetchInProgress = true;

  try {
    // Fetch SEQUENCIAL (uma por vez) para não saturar o navegador. Cada
    // createQuestion já dispara várias requests internas (observations +
    // taxon details + scrape HTML); rodar tudo em paralelo congelava o tab.
    for (let i = 0; i < needed; i += 1) {
      if (generation !== state.generation) return;
      const data = await createQuestion(state.settings).catch(() => null);
      if (!data) continue;
      preloadQuestionAssets(data);
      const exists = state.prefetchQueue.some((q) => q.questionId === data.questionId)
        || state.question?.questionId === data.questionId;
      if (!exists) state.prefetchQueue = [...state.prefetchQueue, data].slice(0, PREFETCH_TARGET);
      syncPrefetchPersist();
    }
  } finally {
    state.prefetchInProgress = false;
  }
}

function takeQueuedQuestion() {
  if (state.prefetchQueue.length === 0) return null;
  const [next, ...rest] = state.prefetchQueue;
  state.prefetchQueue = rest;
  syncPrefetchPersist();
  void fillPrefetchQueue();
  return next;
}

// ---------------------------------------------------------------------------
// TIMER — interval que tick a cada 250ms enquanto há pergunta não respondida
// ---------------------------------------------------------------------------

let timerHandle = null;

/**
 * Atualização cirúrgica do HUD no tick do timer. Toca apenas o:
 *   • Bônus atual no .hud-pill.timer-pill
 *   • Classe de tempo crítico no .app-shell
 * Sem rerender global — preserva zoom/pan da foto e estado dos botões.
 */
function tickHudUpdate() {
  // 1. Bônus
  const bonusSpan = root.querySelector('.hud-pill.timer-pill strong span:last-child');
  if (bonusSpan) bonusSpan.textContent = `+${state.currentBonusPoints}`;
  // 2. Classe do shell (timer-caution / timer-critical)
  const shell = root.querySelector('.app-shell');
  if (shell) shell.className = shellClasses();
}

function startTimer() {
  if (timerHandle) clearInterval(timerHandle);
  if (!state.question || state.answerResult || state.loading) return;
  state.countdownCueSecond = null;

  const rules = difficultyRules[state.question.meta.difficulty];
  timerHandle = setInterval(() => {
    if (!state.startedAt) return;
    const responseTimeMs = Math.max(0, Date.now() - state.startedAt);
    state.elapsedSeconds = Math.floor(responseTimeMs / 1000);
    state.remainingSeconds = remainingSecondsFor(state.question.meta.difficulty, responseTimeMs);
    state.currentBonusPoints = currentBonus(state.question.meta.difficulty, responseTimeMs);

    if (rules.autoFailOnTimeout && state.remainingSeconds > 0 && state.remainingSeconds <= 3 && state.countdownCueSecond !== state.remainingSeconds) {
      state.countdownCueSecond = state.remainingSeconds;
      playUiSound(state.remainingSeconds === 1 ? 'timerFinal' : 'timerWarning');
    }

    if (rules.autoFailOnTimeout && state.remainingSeconds <= 0) {
      clearInterval(timerHandle);
      timerHandle = null;
      void handleTimeout();
      return;
    }

    // Update cirúrgico — não rerenderiza a foto/grid (preserva zoom + carregamento).
    tickHudUpdate();
  }, 250);
}

function stopTimer() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

// ---------------------------------------------------------------------------
// ACTIONS — funções chamadas pelos handlers de evento
// ---------------------------------------------------------------------------

async function handleTimeout() {
  if (!state.question || state.answering || state.answerResult) return;
  state.answering = true;
  try {
    const scoreDelta = -penaltyForDifficulty(state.question.meta.difficulty);
    const fresh = nextStats(state.stats, false, scoreDelta);
    state.answerResult = {
      correct: false,
      correctTaxonId: state.question.answer.taxonId,
      explanation: 'Tempo esgotado.',
      scoreDelta,
      stats: fresh
    };
    state.history = [makeHistoryItem(state.question, null, false, scoreDelta), ...state.history].slice(0, 500);
    state.stats = fresh;
    saveStats(fresh);
    saveHistory(state.history);
    playUiSound('timeout');
    void fillPrefetchQueue();
  } finally {
    state.answering = false;
    stopTimer();
    render();
  }
}

async function nextQuestion() {
  state.startedAt = null;
  state.loading = true;
  state.error = null;
  state.answerResult = null;
  state.selectedTaxonId = null;
  state.hintLevel = 0;
  state.infoModalOpen = false;
  state.countdownCueSecond = null;
  stopTimer();
  render();

  try {
    let next = takeQueuedQuestion();
    if (!next) {
      next = await createQuestion(state.settings);
      preloadQuestionAssets(next);
      void fillPrefetchQueue();
    }
    state.question = next;
    state.startedAt = Date.now();
    state.elapsedSeconds = 0;
    state.remainingSeconds = difficultyRules[state.settings.difficulty].countdownSeconds;
    state.currentBonusPoints = difficultyRules[state.settings.difficulty].bonusStart;
  } catch (err) {
    state.question = null;
    state.startedAt = null;
    state.elapsedSeconds = 0;
    state.remainingSeconds = difficultyRules[state.settings.difficulty].countdownSeconds;
    state.currentBonusPoints = difficultyRules[state.settings.difficulty].bonusStart;
    state.error = err instanceof Error ? err.message : 'Erro ao gerar pergunta.';
  } finally {
    state.loading = false;
    render();
    startTimer();
  }
}

async function answer(taxonId) {
  if (!state.question || state.answering || state.answerResult) return;
  state.answering = true;
  state.selectedTaxonId = taxonId;
  render();
  try {
    const responseTimeMs = state.startedAt ? Math.max(0, Date.now() - state.startedAt) : 0;
    state.elapsedSeconds = Math.floor(responseTimeMs / 1000);
    state.remainingSeconds = remainingSecondsFor(state.question.meta.difficulty, responseTimeMs);
    state.currentBonusPoints = currentBonus(state.question.meta.difficulty, responseTimeMs);

    const wasCorrect = taxonId === state.question.answer.taxonId;
    const nextStreak = wasCorrect ? state.stats.currentStreak + 1 : 0;
    const scoreDelta = wasCorrect
      ? scoreForAnswer(state.question.meta.difficulty, nextStreak, responseTimeMs)
      : -penaltyForDifficulty(state.question.meta.difficulty);
    const fresh = nextStats(state.stats, wasCorrect, scoreDelta);

    state.answerResult = {
      correct: wasCorrect,
      correctTaxonId: state.question.answer.taxonId,
      explanation: wasCorrect ? 'Correto.' : 'Incorreto.',
      scoreDelta,
      stats: fresh
    };
    state.history = [makeHistoryItem(state.question, taxonId, wasCorrect, scoreDelta), ...state.history].slice(0, 500);
    state.stats = fresh;
    saveStats(fresh);
    saveHistory(state.history);
    playUiSound(wasCorrect ? 'correct' : 'wrong');
    void fillPrefetchQueue();
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Erro ao enviar resposta.';
  } finally {
    state.answering = false;
    stopTimer();
    render();
  }
}

function setMode(mode) {
  state.mode = mode;
  render();
}

function applySettingsTheme() {
  // Resolve "auto" para o tema do sistema. O setting persistido continua
  // "auto", mas o atributo data-theme no <html> é sempre dark/light.
  const t = state.settings.theme;
  const resolved = t === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : (t === 'light' ? 'light' : 'dark');
  document.documentElement.dataset.theme = resolved;
}

function updateSettings(partial) {
  const next = { ...state.settings, ...partial, choices: 4 };
  state.settings = next;
  saveSettings(next);
  applySettingsTheme();
  // settings mudaram: invalida prefetches em voo, restaura cache para nova chave.
  state.generation += 1;
  state.prefetchInProgress = false;
  state.prefetchQueue = loadQuestionCache(settingsKey());
  syncPrefetchPersist();
  render();
  void fillPrefetchQueue();
}

function resetStats() {
  state.stats = { ...DEFAULT_STATS };
  state.history = [];
  saveStats(state.stats);
  saveHistory(state.history);
  render();
}

function clearHistory() {
  if (!window.confirm('Apagar histórico, pontuação e estatísticas deste navegador?')) return;
  setDataLocal({ page: 1 });
  resetStats();
  clearAllUserData();
}

function toggleGroup(groupValue) {
  if (groupValue === 'all') {
    updateSettings({ iconicTaxa: ['all', ...ALL_GROUP_VALUES] });
    return;
  }
  const selectedGroups = normalizeGroups(state.settings.iconicTaxa.length > 0 ? state.settings.iconicTaxa : ['all', ...ALL_GROUP_VALUES]);
  const working = selectedGroups.filter((v) => v !== 'all');
  const next = working.includes(groupValue)
    ? working.filter((v) => v !== groupValue)
    : [...working, groupValue];
  if (next.length === 0) {
    updateSettings({ iconicTaxa: ['all', ...ALL_GROUP_VALUES] });
    return;
  }
  const normalized = normalizeGroups(next);
  updateSettings({ iconicTaxa: normalized.length === 0 ? ['all', ...ALL_GROUP_VALUES] : normalized });
}

// ---------------------------------------------------------------------------
// EVENT DELEGATION — um único listener captura tudo via data-action
// ---------------------------------------------------------------------------

// Resolve o tema "auto" para o tema real conforme prefers-color-scheme.
function resolvedTheme(themeSetting) {
  if (themeSetting === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return themeSetting === 'light' ? 'light' : 'dark';
}

document.addEventListener('click', async (event) => {
  // Prevent default em qualquer <button> — botões sem handler não devem
  // disparar scroll-to-top ou outras ações nativas inesperadas.
  const btn = event.target.closest('button');
  if (btn) event.preventDefault();

  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'set-mode':
      setMode(target.dataset.mode);
      return;

    case 'advance':
      primeUiAudio();
      playUiSound('advance');
      void nextQuestion();
      return;

    case 'answer':
      void answer(Number(target.dataset.taxonId));
      return;

    case 'hint':
      if (state.hintLevel >= 2) return;
      primeUiAudio();
      playUiSound('hint');
      state.hintLevel = Math.min(2, state.hintLevel + 1);
      render();
      return;

    case 'info':
      state.infoModalOpen = true;
      render();
      return;

    case 'close-modal': {
      const onBackdrop = event.target.classList.contains('modal-backdrop');
      const onCloseBtn = Boolean(event.target.closest('button[data-action="close-modal"]'));
      if (onBackdrop || onCloseBtn) {
        state.infoModalOpen = false;
        render();
      }
      return;
    }

    case 'toggle-group':
      toggleGroup(target.dataset.group);
      return;

    // Multi-select de filtros (Locais / Táxons)
    case 'pick-taxon':
      updateSettings({
        taxonId: Number(target.dataset.id),
        taxonLabel: target.dataset.label
      });
      return;
    case 'pick-place':
      updateSettings({
        placeId: Number(target.dataset.id),
        placeLabel: target.dataset.label
      });
      return;
    case 'clear-taxon':
      // Só remove se o clique foi no botão ✕ (evita remover ao clicar no chip)
      if (!event.target.closest('button')) return;
      updateSettings({ taxonId: null, taxonLabel: null });
      return;
    case 'clear-place':
      if (!event.target.closest('button')) return;
      updateSettings({ placeId: null, placeLabel: null });
      return;
    case 'quick-place': {
      const q = target.dataset.quick;
      if (state.settings.placeLabel === q) {
        updateSettings({ placeId: null, placeLabel: null });
      } else {
        // Dispara busca + auto-pick do primeiro resultado
        setPlaceQuery(q);
        await runPlaceSearch(q);
        const first = (await import('./views/settings-view.js')).getSettingsLocal().placeResults[0];
        if (first) updateSettings({ placeId: first.id, placeLabel: first.display_name || first.name });
        else render();
      }
      return;
    }
    case 'quick-taxon': {
      const q = target.dataset.quick;
      if (state.settings.taxonLabel === q) {
        updateSettings({ taxonId: null, taxonLabel: null });
      } else {
        setTaxonQuery(q);
        await runTaxonSearch();
        const first = (await import('./views/settings-view.js')).getSettingsLocal().taxaResults[0];
        if (first) updateSettings({ taxonId: first.id, taxonLabel: first.preferred_common_name ?? first.name });
        else render();
      }
      return;
    }

    case 'search-taxon':
      await runTaxonSearch();
      render();
      return;
    case 'search-place':
      await runPlaceSearch();
      render();
      return;

    // Boxes colapsáveis em Config
    case 'toggle-cbox':
      toggleCbox(target.dataset.cbox);
      render();
      return;

    // Segmented buttons (difficulty / theme)
    case 'set-difficulty':
      updateSettings({ difficulty: target.dataset.difficulty });
      return;
    case 'set-theme': {
      const t = target.dataset.theme;
      const resolved = resolvedTheme(t);
      document.documentElement.dataset.theme = resolved;
      updateSettings({ theme: t });
      return;
    }

    // Toggles (popular / scientific-only)
    case 'toggle-popular':
      updateSettings({ showPopularName: !(state.settings.showPopularName !== false) });
      return;
    case 'toggle-scientific-only':
      updateSettings({ scientificOnly: !state.settings.scientificOnly });
      return;

    case 'reset-stats': {
      const ok = window.confirm('Zerar estatísticas e pontuação atuais?');
      if (ok) resetStats();
      return;
    }

    case 'new-question':
      setMode('game');
      void nextQuestion();
      return;

    case 'clear-history':
      clearHistory();
      return;

    case 'set-filter':
      setDataLocal({ filter: target.dataset.filter, page: 1 });
      render();
      return;
    case 'set-page':
      setDataLocal({ page: Number(target.dataset.page) });
      render();
      return;
    case 'prev-page': {
      const dl = getDataLocal();
      setDataLocal({ page: Math.max(1, dl.page - 1) });
      render();
      return;
    }
    case 'next-page': {
      const dl = getDataLocal();
      setDataLocal({ page: dl.page + 1 });
      render();
      return;
    }

    default:
      return;
  }
});

// Input listeners (campos de busca e slider de volume)
document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  // Slider de volume — sincroniza pintura + valor exibido em tempo real
  if (target.classList.contains('volume-slider')) {
    const v = Number(target.value);
    const pct = `${v}%`;
    target.style.setProperty('--vol', pct);
    const parent = target.closest('.volume-control');
    if (parent) {
      parent.style.setProperty('--vol', pct);
      const num = parent.querySelector('.vol-num');
      if (num) num.textContent = pct;
      const icon = parent.querySelector('.vol-icon');
      if (icon) icon.dataset.vol = String(v);
    }
    // Persiste sem re-render para não interromper o drag
    state.settings = { ...state.settings, soundVolume: v, choices: 4 };
    saveSettings(state.settings);
    return;
  }

  // Campos de busca (filtros)
  const actionTarget = target.closest('[data-input]');
  if (!actionTarget) return;
  if (actionTarget.dataset.input === 'taxon') setTaxonQuery(actionTarget.value);
  if (actionTarget.dataset.input === 'place') setPlaceQuery(actionTarget.value);
  if (actionTarget.dataset.input === 'history-search') {
    setDataLocal({ searchQuery: actionTarget.value, page: 1 });
    render();
  }
});

// ---------------------------------------------------------------------------
// KEYBOARD SHORTCUTS — atalhos do quiz
// ---------------------------------------------------------------------------
// 1/2/3/4: responde alternativa por posição
// D:       revela próxima dica
// S:       pula
// Enter/Espaço/→: próxima pergunta (pós-resposta)
// I:       abre modal de detalhes (pós-resposta)
// Esc:     fecha modal aberto
// Ignora quando foco está em input/textarea/contenteditable.

document.addEventListener('keydown', (event) => {
  const tgt = event.target;
  const isField = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);

  if (event.key === 'Escape' && state.infoModalOpen) {
    state.infoModalOpen = false;
    render();
    return;
  }
  if (isField) return;

  if (state.mode !== 'game' || !state.question) return;

  const pending = !state.answerResult && !state.answering;
  const answered = Boolean(state.answerResult);

  if (pending) {
    if (['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      const i = Number(event.key) - 1;
      const c = state.question.choices[i];
      if (c) void answer(c.taxonId);
      return;
    }
    if (event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      if (state.hintLevel < 2) {
        primeUiAudio(); playUiSound('hint');
        state.hintLevel = Math.min(2, state.hintLevel + 1);
        render();
      }
      return;
    }
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      primeUiAudio(); playUiSound('advance');
      void nextQuestion();
      return;
    }
  }

  if (answered) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
      event.preventDefault();
      primeUiAudio(); playUiSound('advance');
      void nextQuestion();
      return;
    }
    if (event.key === 'i' || event.key === 'I') {
      event.preventDefault();
      state.infoModalOpen = true;
      render();
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// BOOTSTRAP — aplica tema, normaliza buttons sem type e dispara prefetch
// ---------------------------------------------------------------------------

// renderShell já normaliza buttons sem type após cada innerHTML.
applySettingsTheme();
render();
void fillPrefetchQueue();
