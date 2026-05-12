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
import { primeUiAudio, playUiSound, setUiVolume } from './sounds.js';
import { escapeHtml } from './format.js';
import {
  renderGameScreen, renderInfoModal,
  attachImageInteractivity, equalizeAnswerHeights
} from './views/quiz-view.js';
import {
  renderSettingsView, runTaxonSearch, runPlaceSearch,
  setTaxonQuery, setPlaceQuery, normalizeGroups, toggleCbox,
  setGeoQuickPlaces, detectIconicConflict, renderConfirmModal,
  getSettingsLocal
} from './views/settings-view.js';
import { classifyQuizError } from './error-messages.js';
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
  detachAnswerHeights: null,  // cleanup do equalizador de altura

  // Modal de confirmação para conflitos entre grupos biológicos e o táxon
  // escolhido. Quando setado, vira um overlay no render(). Estrutura:
  //   { kind: 'adding-taxon', taxonId, taxonLabel, taxonSci, taxonIconic, previousGroups }
  //   { kind: 'changing-groups', newGroups, taxonLabel, taxonSci, taxonIconic }
  confirmModal: null
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
      ${state.confirmModal ? renderConfirmModal(state.confirmModal) : ''}
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
//
// Antes de chamar `renderShell()` (que substitui todo o #root.innerHTML e,
// portanto, recria os elementos com scrollTop=0 e perde o foco), capturamos:
//   • scrollTop do contêiner rolável visível (`.config-screen` / `.data-screen`)
//   • elemento focado (input de busca) + posição do caret
// Depois do render, restauramos. Isso impede a "tela pular pra cima" ao
// pesquisar um filtro de táxon/local na tela de Configurações.
function preservedScrollState() {
  const screen = root.querySelector('.config-screen, .data-screen');
  const active = document.activeElement;
  const activeInput = active && active.tagName === 'INPUT' && root.contains(active) ? active : null;
  return {
    scrollTop: screen ? screen.scrollTop : 0,
    inputSelector: activeInput?.dataset?.input ? `[data-input="${activeInput.dataset.input}"]` : null,
    selectionStart: activeInput && typeof activeInput.selectionStart === 'number' ? activeInput.selectionStart : null,
    selectionEnd: activeInput && typeof activeInput.selectionEnd === 'number' ? activeInput.selectionEnd : null
  };
}
function restoreScrollState(saved) {
  const screen = root.querySelector('.config-screen, .data-screen');
  if (screen && saved.scrollTop > 0) screen.scrollTop = saved.scrollTop;
  if (saved.inputSelector) {
    const input = root.querySelector(saved.inputSelector);
    if (input && input instanceof HTMLInputElement) {
      // `preventScroll: true` evita que o foco arraste o contêiner rolável para
      // posicionar o input — é justamente o "page up" que a gente quer evitar.
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
      if (saved.selectionStart !== null && saved.selectionEnd !== null) {
        try { input.setSelectionRange(saved.selectionStart, saved.selectionEnd); } catch { /* ignore */ }
      }
    }
  }
}
function render() {
  const saved = preservedScrollState();
  renderShell();
  restoreScrollState(saved);
}

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
  // Sem grupos e sem táxon → quiz bloqueado, nem chega a buscar.
  const activeGroups = (state.settings.iconicTaxa || []).filter((v) => v && v !== 'all');
  const taxaCount = Array.isArray(state.settings.taxa) ? state.settings.taxa.length : 0;
  if (activeGroups.length === 0 && taxaCount === 0) return;
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

  // Bloqueio: sem grupos E sem táxon, não há nada para perguntar. Lança
  // sentinela "no-filters-selected" — classifyQuizError mapeia para uma
  // mensagem específica orientando a marcar pelo menos um grupo.
  const activeGroups = (state.settings.iconicTaxa || []).filter((v) => v && v !== 'all');
  const taxaCount = Array.isArray(state.settings.taxa) ? state.settings.taxa.length : 0;
  if (activeGroups.length === 0 && taxaCount === 0) {
    state.question = null;
    state.loading = false;
    state.error = 'no-filters-selected';
    render();
    return;
  }

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
  // O modo de exibição agora deriva da dificuldade — Especialista esconde o
  // nome popular. Mantemos `scientificOnly` em sincronia para que o resto do
  // código (quiz-view.js, history) continue lendo o mesmo campo.
  next.scientificOnly = next.difficulty === 'expert';
  state.settings = next;
  saveSettings(next);
  applySettingsTheme();
  // settings mudaram: invalida prefetches em voo, restaura cache para nova chave.
  state.generation += 1;
  state.prefetchInProgress = false;
  state.prefetchQueue = loadQuestionCache(settingsKey());
  syncPrefetchPersist();

  // Se a pergunta na tela não bate mais com os novos filtros, pula
  // instantaneamente — usuário não fica olhando para uma Ave depois de
  // mudar para Aracnídeos. Limpa o question antes do render para a tela
  // mostrar loading enquanto a próxima carrega.
  if (state.question && !isQuestionCompatible(state.question, state.settings)) {
    state.question = null;
    render();
    void nextQuestion();
    return;
  }

  render();
  void fillPrefetchQueue();
}

/**
 * Verifica se uma pergunta já carregada ainda bate com os filtros atuais.
 *  • Se há grupos selecionados: o `iconicTaxonName` da resposta correta
 *    precisa estar nessa lista.
 *  • Conservador: se faltar dado para decidir, assume compatível.
 */
function isQuestionCompatible(question, settings) {
  const answerIconic = question?.answer?.iconicTaxonName ?? null;
  const activeGroups = (settings.iconicTaxa || []).filter((v) => v && v !== 'all');
  if (activeGroups.length > 0 && activeGroups.length < ALL_GROUP_VALUES.length && answerIconic) {
    if (!activeGroups.includes(answerIconic)) return false;
  }
  return true;
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

/**
 * Liga/desliga um grupo. Comportamento do "all":
 *  - Se NÃO está com todos → marca todos.
 *  - Se está com todos E há táxon ativo → mantém só o iconic necessário
 *    para sustentar o táxon (ex.: Salticidae → só Aracnídeos sobra).
 *  - Se está com todos E não há táxon → desmarca tudo (estado vazio).
 *    A próxima tentativa de jogar mostra mensagem explicativa.
 *
 *  Para grupos individuais, alterna normalmente. Vazio é estado válido.
 *  Se a mudança orfanar o táxon (ex.: remover Insecta com Formicidae
 *  selecionado), abre o modal de confirmação.
 */
function toggleGroup(groupValue) {
  const selectedGroups = normalizeGroups(state.settings.iconicTaxa);
  const taxa = Array.isArray(state.settings.taxa) ? state.settings.taxa : [];
  // Iconics necessários para sustentar TODOS os táxons ativos. Dedup via Set.
  const requiredIconics = Array.from(new Set(
    taxa
      .map((t) => t.iconicTaxonName ?? null)
      .filter((v) => typeof v === 'string' && ALL_GROUP_VALUES.includes(v))
  ));

  let next;
  if (groupValue === 'all') {
    const currentlyAll = selectedGroups.includes('all');
    if (!currentlyAll) {
      next = [...ALL_GROUP_VALUES];
    } else if (requiredIconics.length > 0) {
      // Mantém só os iconics necessários para os táxons ativos.
      next = requiredIconics;
    } else {
      next = []; // vazio intencional — bloqueia o quiz com mensagem.
    }
  } else {
    const working = selectedGroups.filter((v) => v !== 'all');
    next = working.includes(groupValue)
      ? working.filter((v) => v !== groupValue)
      : [...working, groupValue];
  }

  // Conflito: a NOVA lista deixa algum táxon órfão. Se sim, abre modal para
  // o primeiro táxon órfão encontrado — usuário cancela ou remove esse só.
  if (next.length > 0 && taxa.length > 0) {
    const candidate = normalizeGroups(next);
    const orphan = taxa.find((t) => detectIconicConflict(t.iconicTaxonName ?? null, candidate) !== null);
    if (orphan) {
      state.confirmModal = {
        kind: 'changing-groups',
        newGroups: next,
        taxonId: orphan.id,
        taxonLabel: orphan.label,
        taxonSci: orphan.label,
        taxonIconic: orphan.iconicTaxonName
      };
      render();
      return;
    }
  }

  updateSettings({ iconicTaxa: normalizeGroups(next) });
}

/** Aplica um táxon selecionado, ADICIONANDO ao array `taxa[]` (multi-select).
 *  Se houver conflito com os grupos biológicos ativos, abre o modal de
 *  confirmação e deixa o usuário decidir. */
function tryApplyTaxon({ id, label, sci, iconic }) {
  const taxa = Array.isArray(state.settings.taxa) ? state.settings.taxa : [];
  if (taxa.some((t) => t.id === id)) return; // já está no filtro
  const selectedGroups = normalizeGroups(state.settings.iconicTaxa);
  const conflict = detectIconicConflict(iconic, selectedGroups);
  if (conflict) {
    state.confirmModal = {
      kind: 'adding-taxon',
      taxonId: id,
      taxonLabel: label,
      taxonSci: sci,
      taxonIconic: iconic,
      previousGroups: [...selectedGroups]
    };
    render();
    return;
  }
  commitAddTaxon({ id, label, rank: '', iconicTaxonName: iconic });
}

/** Adiciona um táxon ao array `taxa[]` (sem checagem) e sincroniza os
 *  espelhos legados (taxonId/Label/IconicName). */
function commitAddTaxon(picked) {
  const taxa = Array.isArray(state.settings.taxa) ? state.settings.taxa : [];
  if (taxa.some((t) => t.id === picked.id)) return;
  const next = [...taxa, picked];
  const head = next[0];
  updateSettings({
    taxa: next,
    taxonId: head.id,
    taxonLabel: head.label,
    taxonIconicName: head.iconicTaxonName ?? null
  });
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

// Global TAP em qualquer <button> ou [role="button"] do app. Excluímos
// .choice (toca correct/wrong) e .fb-primary (toca advance) — esses já
// têm sons próprios. Capture-phase para tocar antes do handler bubble
// do click, dando feedback imediato.
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest('button, [role="button"]');
  if (!btn) return;
  if (btn.classList.contains('choice')) return;
  if (btn.classList.contains('fb-primary')) return;
  primeUiAudio();
  playUiSound('tap');
}, { capture: true });

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

    // Multi-select de filtros (Locais / Táxons) — adiciona ao array.
    case 'pick-taxon': {
      const id = Number(target.dataset.id);
      const label = target.dataset.label;
      const iconic = target.dataset.iconic || null;
      tryApplyTaxon({ id, label, sci: target.dataset.extra ?? label, iconic });
      return;
    }
    case 'pick-place': {
      const id = Number(target.dataset.id);
      const label = target.dataset.label;
      const places = Array.isArray(state.settings.places) ? state.settings.places : [];
      if (places.some((p) => p.id === id)) return; // já adicionado
      const next = [...places, { id, label, rank: '' }];
      updateSettings({
        places: next,
        placeId: next[0].id,
        placeLabel: next[0].label
      });
      return;
    }

    // Modal de conflito — confirmar/cancelar
    case 'confirm-close':
      // Só fecha se o clique foi no backdrop ou no botão Cancelar/Fechar
      // (evita fechar ao clicar dentro do <section.modal>).
      if (event.target.closest('.modal-backdrop') &&
          (event.target.classList.contains('modal-backdrop') ||
           event.target.closest('[data-action="confirm-close"]'))) {
        state.confirmModal = null;
        render();
      }
      return;
    case 'confirm-apply-taxon': {
      // Usuário escolheu: aplicar o táxon e trocar grupos para Todos.
      // Adiciona o táxon ao array existente (multi-select).
      const m = state.confirmModal;
      if (!m) return;
      state.confirmModal = null;
      const existingTaxa = Array.isArray(state.settings.taxa) ? state.settings.taxa : [];
      const newTaxa = existingTaxa.some((t) => t.id === m.taxonId)
        ? existingTaxa
        : [...existingTaxa, { id: m.taxonId, label: m.taxonLabel, rank: '', iconicTaxonName: m.taxonIconic }];
      const head = newTaxa[0];
      updateSettings({
        iconicTaxa: ['all', ...ALL_GROUP_VALUES],
        taxa: newTaxa,
        taxonId: head.id,
        taxonLabel: head.label,
        taxonIconicName: head.iconicTaxonName ?? null
      });
      return;
    }
    case 'confirm-apply-groups': {
      // Usuário escolheu: aplicar mudança de grupos e remover o táxon
      // CONFLITANTE (mantém os outros). m.taxonId identifica o que sai.
      const m = state.confirmModal;
      if (!m) return;
      state.confirmModal = null;
      const normalized = m.newGroups.length === 0 ? [] : normalizeGroups(m.newGroups);
      const existingTaxa = Array.isArray(state.settings.taxa) ? state.settings.taxa : [];
      const remainingTaxa = existingTaxa.filter((t) => t.id !== m.taxonId);
      const head = remainingTaxa[0];
      updateSettings({
        iconicTaxa: normalized,
        taxa: remainingTaxa,
        taxonId: head ? head.id : null,
        taxonLabel: head ? head.label : null,
        taxonIconicName: head?.iconicTaxonName ?? null
      });
      return;
    }
    case 'remove-taxon': {
      const id = Number(target.dataset.id);
      const taxa = Array.isArray(state.settings.taxa) ? state.settings.taxa : [];
      const next = taxa.filter((t) => t.id !== id);
      const head = next[0];
      updateSettings({
        taxa: next,
        taxonId: head ? head.id : null,
        taxonLabel: head ? head.label : null,
        taxonIconicName: head?.iconicTaxonName ?? null
      });
      return;
    }
    case 'remove-place': {
      const id = Number(target.dataset.id);
      const places = Array.isArray(state.settings.places) ? state.settings.places : [];
      const next = places.filter((p) => p.id !== id);
      const head = next[0];
      updateSettings({
        places: next,
        placeId: head ? head.id : null,
        placeLabel: head ? head.label : null
      });
      return;
    }
    // Aliases legados — algumas instalações ainda podem disparar essas ações
    // se houver HTML cacheado. Comportamento: limpa TODA a lista (como o
    // botão antigo de single-select fazia).
    case 'clear-taxon':
      if (!event.target.closest('button')) return;
      updateSettings({ taxa: [], taxonId: null, taxonLabel: null, taxonIconicName: null });
      return;
    case 'clear-place':
      if (!event.target.closest('button')) return;
      updateSettings({ places: [], placeId: null, placeLabel: null });
      return;
    case 'quick-place': {
      const q = target.dataset.quick;
      const places = Array.isArray(state.settings.places) ? state.settings.places : [];
      // Se já está na lista, REMOVE (toggle). Senão, busca + adiciona.
      const existing = places.find((p) => p.label.toLowerCase().includes(q.toLowerCase()));
      if (existing) {
        const next = places.filter((p) => p.id !== existing.id);
        const head = next[0];
        updateSettings({
          places: next,
          placeId: head ? head.id : null,
          placeLabel: head ? head.label : null
        });
      } else {
        setPlaceQuery(q);
        await runPlaceSearch(q);
        const first = getSettingsLocal().placeResults[0];
        if (first) {
          const next = [...places, { id: first.id, label: first.display_name || first.name, rank: '' }];
          updateSettings({
            places: next,
            placeId: next[0].id,
            placeLabel: next[0].label
          });
        } else {
          render();
        }
      }
      return;
    }
    case 'quick-taxon': {
      const q = target.dataset.quick;
      const taxa = Array.isArray(state.settings.taxa) ? state.settings.taxa : [];
      // Se já está na lista, REMOVE (toggle). Senão, busca + adiciona (com
      // checagem de conflito).
      const existing = taxa.find((t) => t.label.toLowerCase() === q.toLowerCase() || (typeof t.label === 'string' && t.label.toLowerCase().includes(q.toLowerCase())));
      if (existing) {
        const next = taxa.filter((t) => t.id !== existing.id);
        const head = next[0];
        updateSettings({
          taxa: next,
          taxonId: head ? head.id : null,
          taxonLabel: head ? head.label : null,
          taxonIconicName: head?.iconicTaxonName ?? null
        });
      } else {
        setTaxonQuery(q);
        await runTaxonSearch();
        const first = getSettingsLocal().taxaResults[0];
        if (first) {
          tryApplyTaxon({
            id: first.id,
            label: first.preferred_common_name ?? first.name,
            sci: first.name,
            iconic: first.iconic_taxon_name ?? null
          });
        } else {
          render();
        }
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

    // (toggles popular / scientific-only removidos — agora derivam da dificuldade)

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

// Amostra de volume — toca quando o usuário solta o slider (`change`) ou
// clica na bolinha sem arrastar (`pointerup`). Os dois eventos são
// idempotentes para volume porque setUiVolume é redundante (já foi setado
// pelo `input`); só playUiSound importa aqui.
function playVolumeSampleFromEvent(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.classList.contains('volume-slider')) return;
  const v = Number(target.value);
  primeUiAudio();
  setUiVolume(v);
  playUiSound('volumeSample');
}
document.addEventListener('change', playVolumeSampleFromEvent);
document.addEventListener('pointerup', playVolumeSampleFromEvent);

// Input listeners (campos de busca e slider de volume)
document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  // Slider de volume — sincroniza pintura + valor exibido em tempo real,
  // sem re-render (para não interromper o drag). A amostra sonora de
  // referência (`volumeSample`) é tocada no pointerup/change, abaixo.
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
    // Aplica volume em tempo real (master gain do AudioContext) para que
    // a próxima amostra reflita o valor atual.
    setUiVolume(v);
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

// Sincroniza `scientificOnly` com a dificuldade na inicialização. Cobre o caso
// de quem tinha o toggle desligado/ligado salvo de uma versão anterior.
{
  const expected = state.settings.difficulty === 'expert';
  if (state.settings.scientificOnly !== expected) {
    state.settings = { ...state.settings, scientificOnly: expected };
    saveSettings(state.settings);
  }
}

// Aplica o volume salvo ao masterGain do AudioContext já no boot — assim o
// primeiro `playUiSound` respeita o nível que o usuário deixou setado.
setUiVolume(typeof state.settings.soundVolume === 'number' ? state.settings.soundVolume : 60);

render();
void fillPrefetchQueue();

// Geolocalização por IP — atualiza os atalhos de Locais quando o provedor
// resolver a cidade/UF. Falha silenciosa: o usuário continua vendo a lista
// padrão (Brasil, Pantanal, Amazônia, Cerrado, Mata Atlântica).
const IP_GEO_KEY = 'inatQuiz.ipGeo.v1';
async function bootstrapIpGeo() {
  let geo = null;
  try {
    const cached = sessionStorage.getItem(IP_GEO_KEY);
    if (cached) geo = JSON.parse(cached);
  } catch { /* ignore */ }

  if (!geo) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const resp = await fetch('https://ipapi.co/json/', { signal: controller.signal });
      if (resp.ok) {
        const data = await resp.json();
        geo = {
          city: typeof data.city === 'string' && data.city.length > 0 ? data.city : null,
          region: typeof data.region === 'string' && data.region.length > 0 ? data.region : null
        };
        try { sessionStorage.setItem(IP_GEO_KEY, JSON.stringify(geo)); } catch { /* ignore */ }
      }
    } catch { /* fallback */ } finally {
      clearTimeout(timer);
    }
  }

  if (!geo) return;
  const local = [];
  if (geo.city) local.push(geo.city);
  if (geo.region && geo.region !== geo.city) local.push(geo.region);
  if (local.length === 0) return;
  // Mistura: cidade/UF primeiro, depois os atalhos pré-definidos.
  setGeoQuickPlaces([...local, 'Brasil', 'Pantanal', 'Amazônia', 'Cerrado', 'Mata Atlântica']);
  // Só rerenderiza se o usuário já estiver na tela de configurações — em outras
  // telas, basta atualizar quando ele entrar (a próxima `render()` pega).
  if (state.mode === 'config') render();
}
void bootstrapIpGeo();
