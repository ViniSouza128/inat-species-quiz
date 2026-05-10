// =============================================================================
// STATE — persistência em localStorage e cache de API
// =============================================================================
// Este módulo expõe getters/setters tipados para tudo que persiste:
//   • settings              — filtros + tema do quiz.
//   • stats                 — pontuação, streak, precisão.
//   • history               — registros das perguntas respondidas.
//   • question prefetch cache — fila pré-carregada para abertura rápida.
//   • API cache             — JSON de respostas do iNat (memória + sessionStorage).
//
// Versionamento: cada chave tem `.v1`. Mudanças incompatíveis bumpam o sufixo.
// =============================================================================

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'inatSpeciesQuiz.settings';
const STATS_KEY = 'inatSpeciesQuiz.localStats.v1';
const HISTORY_KEY = 'inatSpeciesQuiz.localHistory.v1';
const QUESTION_CACHE_KEY = 'inatSpeciesQuiz.questionCache.v1';
const API_CACHE_KEY = 'inatSpeciesQuiz.apiCache.v1';

const QUESTION_CACHE_MAX = 8;
const QUESTION_CACHE_TTL_MS = 14 * 60 * 60 * 1000;
const HISTORY_MAX = 500;

export const ALL_GROUP_VALUES = ['Aves', 'Mammalia', 'Reptilia', 'Amphibia', 'Actinopterygii', 'Insecta', 'Arachnida', 'Plantae', 'Fungi'];

export const DEFAULT_SETTINGS = {
  iconicTaxa: ['Aves'],
  taxonId: null,
  taxonLabel: null,
  placeId: null,
  placeLabel: null,
  difficulty: 'normal',
  choices: 4,
  scientificOnly: false,
  theme: 'dark'
};

export const DEFAULT_STATS = {
  totalQuestions: 0,
  correct: 0,
  incorrect: 0,
  accuracy: 0,
  bestStreak: 0,
  currentStreak: 0,
  score: 0,
  lastPlayed: null
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function safeWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------

function normalizeStoredGroups(value) {
  if (Array.isArray(value)) {
    const onlyActual = ALL_GROUP_VALUES.filter((item) => value.includes(item));
    if (onlyActual.length === ALL_GROUP_VALUES.length) return ['all', ...ALL_GROUP_VALUES];
    return onlyActual.length > 0 ? onlyActual : DEFAULT_SETTINGS.iconicTaxa;
  }
  if (typeof value === 'string') {
    if (value === 'all') return ['all', ...ALL_GROUP_VALUES];
    if (ALL_GROUP_VALUES.includes(value)) return [value];
  }
  return DEFAULT_SETTINGS.iconicTaxa;
}

export function loadSettings() {
  const parsed = safeJsonParse(localStorage.getItem(SETTINGS_KEY), {});
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    iconicTaxa: normalizeStoredGroups(parsed.iconicTaxa),
    choices: 4
  };
}

export function saveSettings(settings) {
  safeWrite(SETTINGS_KEY, { ...settings, choices: 4 });
}

// ---------------------------------------------------------------------------
// STATS
// ---------------------------------------------------------------------------

export function loadStats() {
  return { ...DEFAULT_STATS, ...safeJsonParse(localStorage.getItem(STATS_KEY), {}) };
}

export function saveStats(stats) {
  safeWrite(STATS_KEY, stats);
}

// ---------------------------------------------------------------------------
// HISTORY
// ---------------------------------------------------------------------------

export function loadHistory() {
  const arr = safeJsonParse(localStorage.getItem(HISTORY_KEY), []);
  return Array.isArray(arr) ? arr : [];
}

export function saveHistory(history) {
  safeWrite(HISTORY_KEY, history.slice(0, HISTORY_MAX));
}

// ---------------------------------------------------------------------------
// QUESTION CACHE — fila de perguntas pré-carregadas
// ---------------------------------------------------------------------------

export function loadQuestionCache(settingsKey) {
  try {
    const raw = localStorage.getItem(QUESTION_CACHE_KEY);
    if (!raw) return [];
    const entry = JSON.parse(raw);
    if (entry.settingsKey !== settingsKey) return [];
    if (Date.now() - entry.savedAt > QUESTION_CACHE_TTL_MS) return [];
    return Array.isArray(entry.questions) ? entry.questions.slice(0, QUESTION_CACHE_MAX) : [];
  } catch { return []; }
}

export function saveQuestionCache(questions, settingsKey) {
  try {
    const entry = {
      questions: questions.slice(0, QUESTION_CACHE_MAX),
      settingsKey,
      savedAt: Date.now()
    };
    localStorage.setItem(QUESTION_CACHE_KEY, JSON.stringify(entry));
  } catch { /* quota */ }
}

// ---------------------------------------------------------------------------
// API CACHE — memória primeiro, sessionStorage como espelho
// ---------------------------------------------------------------------------
// Estrutura: { [url]: { data, expiresAt } }
// O sessionStorage permite atravessar reloads (mas não fechamento do tab).

const apiMemCache = new Map();

function loadApiCacheToMemory() {
  try {
    const raw = sessionStorage.getItem(API_CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    const now = Date.now();
    for (const [url, entry] of Object.entries(obj)) {
      if (entry?.expiresAt && entry.expiresAt > now) {
        apiMemCache.set(url, entry);
      }
    }
  } catch { /* ignore */ }
}
loadApiCacheToMemory();

let writeTimer = null;
function scheduleApiCacheFlush() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      const obj = {};
      const now = Date.now();
      for (const [url, entry] of apiMemCache.entries()) {
        if (entry.expiresAt > now) obj[url] = entry;
      }
      sessionStorage.setItem(API_CACHE_KEY, JSON.stringify(obj));
    } catch {
      // sessionStorage cheio: limpa as entradas mais antigas
      try {
        const entries = [...apiMemCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
        for (let i = 0; i < Math.floor(entries.length / 2); i += 1) {
          apiMemCache.delete(entries[i][0]);
        }
      } catch { /* ignore */ }
    }
  }, 250);
}

export function getApiCache(url) {
  const entry = apiMemCache.get(url);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    apiMemCache.delete(url);
    return null;
  }
  return entry.data;
}

export function setApiCache(url, data, ttlHours) {
  const expiresAt = Date.now() + ttlHours * 60 * 60 * 1000;
  apiMemCache.set(url, { data, expiresAt });
  scheduleApiCacheFlush();
}

// ---------------------------------------------------------------------------
// FULL RESET — limpa tudo (usado pelo botão "Apagar")
// ---------------------------------------------------------------------------

export function clearAllUserData() {
  try {
    localStorage.removeItem(STATS_KEY);
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(QUESTION_CACHE_KEY);
  } catch { /* ignore */ }
}
