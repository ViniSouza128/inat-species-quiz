// =============================================================================
// QUIZ ENGINE — geração de pergunta, distratores, nomes para exibição
// =============================================================================
// Porte fiel da lógica server/src/services/quizService.ts +
// distractorService.ts + taxonDisplayService.ts + attributionService.ts +
// utils/safeImageUrl.ts. Aqui tudo roda no browser.
// =============================================================================

import {
  getObservations,
  getTaxonDetails,
  getTaxonPageNearestCommonAncestor
} from './inat-api.js';

// ---------------------------------------------------------------------------
// IMAGE URL HELPERS (safeImageUrl.ts)
// ---------------------------------------------------------------------------

/**
 * Reescreve a URL de foto do iNat para um tamanho específico (square/small/
 * medium/large). Retorna '' para URLs inválidas/perigosas.
 */
export function normalizePhotoUrl(url, preferredSize = 'medium') {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith('http')) return '';
    parsed.pathname = parsed.pathname
      .replace(/\/(square|small|medium|large|original)\./, `/${preferredSize}.`);
    return parsed.toString();
  } catch {
    return '';
  }
}

/** Pacote responsivo: 4 versões (thumb/small/medium/large). */
export function makeResponsiveImageUrls(url) {
  return {
    thumbUrl: normalizePhotoUrl(url, 'square'),
    smallUrl: normalizePhotoUrl(url, 'small'),
    mediumUrl: normalizePhotoUrl(url, 'medium'),
    largeUrl: normalizePhotoUrl(url, 'large')
  };
}

// ---------------------------------------------------------------------------
// ATTRIBUTION (attributionService.ts)
// ---------------------------------------------------------------------------

export function photoAttribution(photo, observation) {
  if (photo?.attribution) return photo.attribution;
  const userName = observation?.user?.name || observation?.user?.login;
  if (userName) return `Foto por ${userName}, via iNaturalist`;
  return 'Foto via iNaturalist';
}

export function licenseLabel(code) {
  if (!code) return null;
  const map = {
    cc0: 'CC0',
    'cc-by': 'CC BY',
    'cc-by-nc': 'CC BY-NC',
    'cc-by-sa': 'CC BY-SA',
    'cc-by-nd': 'CC BY-ND',
    'cc-by-nc-sa': 'CC BY-NC-SA',
    'cc-by-nc-nd': 'CC BY-NC-ND'
  };
  return map[code.toLowerCase()] ?? code.toUpperCase();
}

// ---------------------------------------------------------------------------
// TAXON DISPLAY (taxonDisplayService.ts)
// ---------------------------------------------------------------------------

const RANK_PRIORITY = ['species', 'subspecies', 'variety', 'genus', 'family', 'order', 'class', 'phylum', 'kingdom'];

const POPULAR_NAME_OVERRIDES = {
  48139: 'Papa-Moscas',
  47118: 'Aranhas',
  120474: 'Aranhas Verdadeiras',
  47119: 'Aracnídeos',
  47120: 'Artrópodes',
  245097: 'Artrópodes Com Quelíceras',
  1: 'Animais, Metazoários'
};

export const POPULAR_NAME_BY_SCIENTIFIC = {
  Salticidae: 'Papa-Moscas',
  Araneae: 'Aranhas',
  Araneomorphae: 'Aranhas Verdadeiras',
  Arachnida: 'Aracnídeos',
  Arthropoda: 'Artrópodes',
  Chelicerata: 'Artrópodes Com Quelíceras',
  Animalia: 'Animais, Metazoários'
};

function rankScore(rank) {
  if (!rank) return 999;
  const index = RANK_PRIORITY.indexOf(rank);
  return index === -1 ? 500 : index;
}

function ancestorScientificName(taxon, rank) {
  if (!taxon) return null;
  if (taxon.rank === rank && taxon.name) return taxon.name;
  const ancestor = (taxon.ancestors ?? []).find((item) => item.rank === rank && item.name);
  return ancestor?.name ?? null;
}

function localCommonName(taxon) {
  const override = taxon?.id ? POPULAR_NAME_OVERRIDES[taxon.id] : null;
  const scientificOverride = taxon?.name ? POPULAR_NAME_BY_SCIENTIFIC[taxon.name] : null;
  const raw = override ?? scientificOverride ?? taxon?.preferred_common_name ?? taxon?.common_name ?? null;
  if (!raw) return null;
  const cleaned = String(raw).trim();
  if (cleaned.length === 0) return null;
  if (taxon?.name && cleaned.localeCompare(taxon.name, 'pt-BR', { sensitivity: 'base' }) === 0) return null;
  return cleaned;
}

function mappedPopularNameFromKnownScientific(rawSci) {
  if (!rawSci) return null;
  return POPULAR_NAME_BY_SCIENTIFIC[String(rawSci).trim()] ?? null;
}

function nearestMappedPopularAncestor(taxon) {
  if (!taxon) return { name: null, rank: null, taxonId: null };
  const candidate = [...(taxon.ancestors ?? [])]
    .filter((a) => mappedPopularNameFromKnownScientific(a?.name))
    .sort((a, b) => rankScore(a.rank) - rankScore(b.rank))[0];
  const mapped = mappedPopularNameFromKnownScientific(candidate?.name);
  return mapped
    ? { name: mapped, rank: candidate?.rank ?? null, taxonId: candidate?.id ?? null }
    : { name: null, rank: null, taxonId: null };
}

function nearestAncestorScientific(taxon) {
  if (!taxon) return { name: null, rank: null, taxonId: null };
  const ancestor = [...(taxon.ancestors ?? [])]
    .filter((item) => item?.name)
    .sort((a, b) => rankScore(a.rank) - rankScore(b.rank))[0];
  return ancestor?.name
    ? { name: ancestor.name, rank: ancestor.rank ?? null, taxonId: ancestor.id ?? null }
    : { name: null, rank: null, taxonId: null };
}

export function resolvePopularName(taxon) {
  if (!taxon) return { name: null, rank: null, taxonId: null };
  const ownName = localCommonName(taxon);
  if (ownName) {
    return { name: ownName, rank: taxon.rank ?? null, taxonId: taxon.id ?? null };
  }
  const ancestors = [...(taxon.ancestors ?? [])]
    .filter((a) => localCommonName(a))
    .sort((a, b) => rankScore(a.rank) - rankScore(b.rank));
  const fallback = ancestors[0];
  const fallbackName = localCommonName(fallback);
  if (fallbackName) {
    return { name: fallbackName, rank: fallback?.rank ?? null, taxonId: fallback?.id ?? null };
  }
  const mappedFallback = nearestMappedPopularAncestor(taxon);
  return mappedFallback.name ? mappedFallback : { name: null, rank: null, taxonId: null };
}

function choiceImageFromObservation(observation) {
  const referencePhoto = observation.taxon?.default_photo ?? observation.photos?.[0];
  if (!referencePhoto?.url) return null;
  const urls = makeResponsiveImageUrls(referencePhoto.url);
  if (!urls.smallUrl && !urls.mediumUrl && !urls.largeUrl) return null;
  return {
    thumbUrl: urls.thumbUrl,
    smallUrl: urls.smallUrl,
    mediumUrl: urls.mediumUrl,
    largeUrl: urls.largeUrl,
    licenseCode: licenseLabel(referencePhoto.license_code),
    attribution: photoAttribution(referencePhoto, observation)
  };
}

export function toQuizChoice(observation, includeImage = true) {
  const taxon = observation.taxon;
  if (!taxon?.id || !taxon.name) return null;
  const popular = resolvePopularName(taxon);
  const ancestorScientific = nearestAncestorScientific(taxon);
  return {
    taxonId: taxon.id,
    scientificName: taxon.name,
    commonName: popular.name,
    commonNameRank: popular.rank,
    commonNameTaxonId: popular.taxonId,
    fallbackAncestorScientificName: ancestorScientific.name,
    fallbackAncestorRank: ancestorScientific.rank,
    fallbackAncestorTaxonId: ancestorScientific.taxonId,
    rank: taxon.rank ?? null,
    iconicTaxonName: taxon.iconic_taxon_name ?? null,
    familyScientificName: ancestorScientificName(taxon, 'family'),
    orderScientificName: ancestorScientificName(taxon, 'order'),
    image: includeImage ? choiceImageFromObservation(observation) : null
  };
}

export function displayChoiceLabel(choice) {
  if (choice.commonName) return `${choice.commonName} (${choice.scientificName})`;
  if (choice.fallbackAncestorScientificName) return `${choice.fallbackAncestorScientificName} (${choice.scientificName})`;
  return choice.scientificName;
}

function mergeTaxonForDisplay(base, taxon) {
  if (!taxon) return base;
  const popular = resolvePopularName(taxon);
  const ancestorScientific = nearestAncestorScientific(taxon);
  return {
    ...base,
    commonName: base.commonName ?? popular.name,
    commonNameRank: base.commonNameRank ?? popular.rank,
    commonNameTaxonId: base.commonNameTaxonId ?? popular.taxonId,
    fallbackAncestorScientificName: base.fallbackAncestorScientificName ?? ancestorScientific.name,
    fallbackAncestorRank: base.fallbackAncestorRank ?? ancestorScientific.rank,
    fallbackAncestorTaxonId: base.fallbackAncestorTaxonId ?? ancestorScientific.taxonId,
    familyScientificName: base.familyScientificName ?? ancestorScientificName(taxon, 'family'),
    orderScientificName: base.orderScientificName ?? ancestorScientificName(taxon, 'order')
  };
}

function mergePageCommonAncestor(base, page) {
  if (!page?.name) return base;
  const pageIsCloser = page.rank && (!base.commonNameRank || rankScore(page.rank) < rankScore(base.commonNameRank));
  const shouldUsePageName = !base.commonName || Boolean(pageIsCloser);
  return {
    ...base,
    commonName: shouldUsePageName ? page.name : base.commonName,
    commonNameRank: shouldUsePageName ? page.rank : base.commonNameRank,
    commonNameTaxonId: shouldUsePageName ? page.taxonId : base.commonNameTaxonId,
    fallbackAncestorScientificName: base.fallbackAncestorScientificName ?? page.scientificName,
    fallbackAncestorRank: base.fallbackAncestorRank ?? page.rank,
    fallbackAncestorTaxonId: base.fallbackAncestorTaxonId ?? page.taxonId
  };
}

async function enrichChoiceTaxonDisplay(choice) {
  const alreadyComplete = choice.commonName && choice.familyScientificName && choice.orderScientificName;
  if (alreadyComplete) return choice;
  let merged = choice;
  if (!choice.commonName || !choice.familyScientificName || !choice.orderScientificName) {
    try {
      const detail = await getTaxonDetails(choice.taxonId);
      merged = mergeTaxonForDisplay(merged, detail);
    } catch { /* continua */ }
  }
  if (!merged.commonName) {
    try {
      const pageFallback = await getTaxonPageNearestCommonAncestor(choice.taxonId);
      return mergePageCommonAncestor(merged, pageFallback);
    } catch { return merged; }
  }
  return merged;
}

async function enrichChoicesTaxonDisplay(choices) {
  return Promise.all(choices.map((c) => enrichChoiceTaxonDisplay(c)));
}

// ---------------------------------------------------------------------------
// RANDOM HELPERS (utils/random.ts)
// ---------------------------------------------------------------------------

function shuffle(input) {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sample(input) {
  if (input.length === 0) return undefined;
  return input[Math.floor(Math.random() * input.length)];
}

function uniqueBy(input, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function randomPage(maxPage) {
  return Math.max(1, Math.floor(Math.random() * maxPage) + 1);
}

// ---------------------------------------------------------------------------
// DISTRATORES (distractorService.ts)
// ---------------------------------------------------------------------------

function genus(name) {
  const first = name.trim().split(/\s+/)[0];
  return first && /^[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÄËÏÖÜ]/.test(first) ? first : null;
}

function scoreCandidate(correct, candidate, difficulty) {
  const sameIconic = correct.iconicTaxonName && candidate.iconicTaxonName === correct.iconicTaxonName;
  const sameGenus = genus(correct.scientificName) && genus(correct.scientificName) === genus(candidate.scientificName);
  const sameOrder = Boolean(correct.orderScientificName && candidate.orderScientificName && correct.orderScientificName === candidate.orderScientificName);

  if (difficulty === 'easy') return (sameOrder ? 0 : 8) + (sameIconic ? 1 : 4);
  if (difficulty === 'normal') return (sameOrder ? 12 : -20) + (sameIconic ? 4 : 0);
  if (difficulty === 'hard') return (sameOrder ? 16 : -30) + (sameGenus ? 10 : 0) + (sameIconic ? 4 : 0);
  return (sameOrder ? 20 : -40) + (sameGenus ? 20 : 0) + (sameIconic ? 4 : 0);
}

function buildDistractors(correct, observations, difficulty, count) {
  const baseChoices = observations
    .map((obs) => toQuizChoice(obs, true))
    .filter((c) => Boolean(c))
    .filter((c) => c.taxonId !== correct.taxonId)
    .filter((c) => c.rank === correct.rank || !correct.rank || c.rank === 'species');

  const sameOrderRequired = difficulty !== 'easy' && Boolean(correct.orderScientificName);
  const choices = sameOrderRequired
    ? baseChoices.filter((c) => c.orderScientificName && c.orderScientificName === correct.orderScientificName)
    : baseChoices;

  const unique = uniqueBy(choices, (c) => c.taxonId);
  const scored = unique
    .map((choice) => ({ choice, score: scoreCandidate(correct, choice, difficulty), tie: Math.random() }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .map((item) => item.choice);

  return shuffle(scored).slice(0, count);
}

// ---------------------------------------------------------------------------
// QUESTION GENERATION (quizService.ts)
// ---------------------------------------------------------------------------

function isValidObservation(observation, rank) {
  if (!observation.id) return false;
  if (!observation.taxon?.id || !observation.taxon.name) return false;
  if (rank && observation.taxon.rank !== rank) return false;
  const firstPhoto = observation.photos?.[0];
  return Boolean(firstPhoto?.url && normalizePhotoUrl(firstPhoto.url));
}

function observationUri(observation) {
  return observation.uri || `https://www.inaturalist.org/observations/${observation.id}`;
}

function makeHint(answer, difficulty) {
  if (difficulty === 'expert') {
    const g = answer.scientificName.split(/\s+/)[0];
    return g ? `Dica: o gênero começa com “${g[0]}”.` : null;
  }
  if (difficulty === 'hard') {
    return answer.iconicTaxonName ? `Dica: pertence ao grupo ${answer.iconicTaxonName}.` : null;
  }
  if (answer.commonName && answer.commonNameRank && answer.commonNameRank !== answer.rank) {
    return 'Dica: quando a espécie não tem nome popular, usamos o nome comum do táxon superior mais próximo.';
  }
  if (answer.iconicTaxonName) return `Dica: é do grupo ${answer.iconicTaxonName}.`;
  return null;
}

function buildObservationParams(input, relaxed = false) {
  const params = {
    per_page: relaxed ? 80 : 50,
    page: randomPage(relaxed ? 3 : 8),
    locale: 'pt-BR'
  };
  const selectedGroups = (input.iconicTaxa ?? []).filter((v) => v && v !== 'all');

  // Filtros TAXONÔMICOS — preservados em qualquer modo. Multi-select:
  // taxonIds[] vira `taxon_id=1&taxon_id=2` (OR lógico no iNat). Permite
  // misturar Formicidae + Salticidae em uma só rodada.
  if (selectedGroups.length > 0) params.iconic_taxa = selectedGroups;
  if (Array.isArray(input.taxonIds) && input.taxonIds.length > 0) {
    params.taxon_id = input.taxonIds;
  }

  // Filtros GEOGRÁFICOS — só na primeira tentativa. No relaxed expandimos
  // para o mundo todo (mantendo táxon/grupo). Multi-select: placeIds[] vira
  // `place_id=1&place_id=2` — permite p.ex. 3 estados do Centro-Oeste.
  if (!relaxed) {
    if (Array.isArray(input.placeIds) && input.placeIds.length > 0) {
      params.place_id = input.placeIds;
    }
    if (input.lat !== undefined && input.lng !== undefined) {
      params.lat = input.lat;
      params.lng = input.lng;
      params.radius = input.radius ?? 50;
    }
  }
  return params;
}

async function fetchCandidateObservations(input) {
  const primary = await getObservations(buildObservationParams(input, false));
  let observations = primary.results ?? [];
  if (observations.filter((obs) => isValidObservation(obs, input.rank)).length < input.choices) {
    const relaxed = await getObservations(buildObservationParams(input, true));
    observations = [...observations, ...(relaxed.results ?? [])];
  }
  return uniqueBy(observations, (obs) => obs.id);
}

/**
 * UUID v4 (criptograficamente fraco — usa Math.random — mas único o suficiente
 * para identificar perguntas no histórico local).
 */
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try { return crypto.randomUUID(); } catch { /* continua */ }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Gera UMA pergunta. Recebe `settings` (filtros + dificuldade do app),
 * normaliza para o input do iNat, e devolve um QuizQuestion completo.
 */
export async function createQuestion(settings) {
  // Multi-select: prioriza taxa[]/places[]. Fallback para taxonId/placeId
  // single (instalações antigas que ainda não migraram), só pra não quebrar
  // o jogo no primeiro carregamento depois do update.
  const taxonIds = Array.isArray(settings.taxa) && settings.taxa.length > 0
    ? settings.taxa.map((t) => t.id).filter((n) => Number.isFinite(n))
    : (settings.taxonId ? [settings.taxonId] : []);
  const placeIds = Array.isArray(settings.places) && settings.places.length > 0
    ? settings.places.map((p) => p.id).filter((n) => Number.isFinite(n))
    : (settings.placeId ? [settings.placeId] : []);

  const input = {
    iconicTaxa: settings.iconicTaxa.filter((v) => v !== 'all'),
    taxonIds,
    placeIds,
    difficulty: settings.difficulty,
    choices: 4,
    rank: 'species'
  };
  // Se TODOS os 9 grupos estão selecionados, melhor não enviar filtro.
  if (input.iconicTaxa.length >= 9) input.iconicTaxa = [];

  const observations = await fetchCandidateObservations(input);
  const valid = observations.filter((obs) => isValidObservation(obs, input.rank));

  if (valid.length < 2) {
    throw new Error('Não encontrei espécies suficientes com esses filtros. Tente remover o local ou escolher um grupo mais amplo.');
  }
  const selected = sample(valid);
  if (!selected) throw new Error('Não foi possível selecionar uma observação válida.');

  const answer = toQuizChoice(selected, true);
  if (!answer) throw new Error('A observação sorteada não tem táxon válido.');

  const firstPhoto = selected.photos?.[0];
  const urls = makeResponsiveImageUrls(firstPhoto?.url);
  const photoUrl = urls.mediumUrl || urls.largeUrl || urls.smallUrl;

  const distractors = buildDistractors(answer, valid, input.difficulty, 3);
  if (distractors.length === 0) {
    throw new Error('Não encontrei alternativas suficientes com esses filtros. Tente uma dificuldade menor ou filtros mais amplos.');
  }

  const choices = await enrichChoicesTaxonDisplay(shuffle([answer, ...distractors]).slice(0, 4));
  const enrichedAnswer = choices.find((c) => c.taxonId === answer.taxonId) ?? answer;

  const warning = choices.length < 4
    ? 'Menos alternativas foram exibidas porque não havia espécies suficientes com esses filtros.'
    : undefined;

  const question = {
    questionId: uuidv4(),
    image: {
      url: photoUrl,
      thumbUrl: urls.thumbUrl,
      smallUrl: urls.smallUrl || photoUrl,
      mediumUrl: urls.mediumUrl || photoUrl,
      largeUrl: urls.largeUrl || photoUrl,
      licenseCode: licenseLabel(firstPhoto?.license_code),
      attribution: photoAttribution(firstPhoto, selected),
      source: 'iNaturalist'
    },
    observation: {
      id: selected.id,
      uri: observationUri(selected),
      observedOn: selected.observed_on ?? selected.observed_on_details?.date ?? null,
      placeGuess: selected.place_guess ?? null,
      observerLogin: selected.user?.login ?? null,
      observerName: selected.user?.name ?? null
    },
    answer: enrichedAnswer,
    choices,
    hint: makeHint(answer, input.difficulty),
    meta: {
      difficulty: input.difficulty,
      generatedAt: new Date().toISOString(),
      choicesRequested: 4,
      choicesReturned: choices.length,
      filters: { ...input },
      ...(warning ? { warning } : {})
    }
  };

  return question;
}

// ---------------------------------------------------------------------------
// REGRAS DE PONTUAÇÃO (mesmas do useQuiz.ts no client React)
// ---------------------------------------------------------------------------

export const difficultyRules = {
  easy:    { base: 60,  bonusStart: 60,  countdownSeconds: 20, penalty: 20, autoFailOnTimeout: false },
  normal:  { base: 100, bonusStart: 75,  countdownSeconds: 15, penalty: 45, autoFailOnTimeout: false },
  hard:    { base: 140, bonusStart: 90,  countdownSeconds: 12, penalty: 65, autoFailOnTimeout: true },
  expert:  { base: 180, bonusStart: 120, countdownSeconds: 10, penalty: 90, autoFailOnTimeout: true }
};

export function streakBonus(nextStreak) {
  if (nextStreak >= 10) return 60;
  if (nextStreak >= 7) return 40;
  if (nextStreak >= 5) return 25;
  if (nextStreak >= 3) return 12;
  return 0;
}

export function penaltyForDifficulty(difficulty) {
  return difficultyRules[difficulty].penalty;
}

export function currentBonus(difficulty, responseTimeMs) {
  const rules = difficultyRules[difficulty];
  const elapsedSeconds = Math.floor(Math.max(0, responseTimeMs) / 1000);
  const bonusPerSecond = rules.bonusStart / rules.countdownSeconds;
  return Math.max(0, Math.round(rules.bonusStart - (elapsedSeconds * bonusPerSecond)));
}

export function remainingSecondsFor(difficulty, responseTimeMs) {
  const total = difficultyRules[difficulty].countdownSeconds;
  const elapsedSeconds = Math.floor(Math.max(0, responseTimeMs) / 1000);
  return Math.max(0, total - elapsedSeconds);
}

export function scoreForAnswer(difficulty, nextStreak, responseTimeMs) {
  const rules = difficultyRules[difficulty];
  return rules.base + currentBonus(difficulty, responseTimeMs) + streakBonus(nextStreak);
}

export function nextStats(old, correct, scoreDelta) {
  const totalQuestions = old.totalQuestions + 1;
  const correctCount = old.correct + (correct ? 1 : 0);
  const incorrect = old.incorrect + (correct ? 0 : 1);
  const currentStreak = correct ? old.currentStreak + 1 : 0;
  const bestStreak = Math.max(old.bestStreak, currentStreak);
  const score = Math.max(0, old.score + scoreDelta);
  const accuracy = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 1000) / 10 : 0;
  return { totalQuestions, correct: correctCount, incorrect, accuracy, bestStreak, currentStreak, score, lastPlayed: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// LABEL para histórico (espelho do useQuiz.ts)
// ---------------------------------------------------------------------------

export function displayLabel(choice) {
  const directCommon = choice.commonName?.trim();
  const mappedCommon = (choice.familyScientificName && POPULAR_NAME_BY_SCIENTIFIC[choice.familyScientificName])
    || (choice.orderScientificName && POPULAR_NAME_BY_SCIENTIFIC[choice.orderScientificName])
    || (choice.fallbackAncestorScientificName && POPULAR_NAME_BY_SCIENTIFIC[choice.fallbackAncestorScientificName])
    || null;
  const visibleCommon = directCommon && directCommon.localeCompare(choice.scientificName, 'pt-BR', { sensitivity: 'base' }) !== 0
    ? directCommon
    : mappedCommon;
  return visibleCommon ? `${visibleCommon} (${choice.scientificName})` : choice.scientificName;
}

export function makeHistoryItem(question, selectedTaxonId, wasCorrect, scoreDelta) {
  const selected = typeof selectedTaxonId === 'number' ? question.choices.find((c) => c.taxonId === selectedTaxonId) : null;
  return {
    id: Date.now(),
    questionId: question.questionId,
    selectedTaxonId,
    correctTaxonId: question.answer.taxonId,
    wasCorrect,
    scoreDelta,
    difficulty: question.meta.difficulty,
    selectedLabel: selected ? displayLabel(selected) : null,
    correctLabel: displayLabel(question.answer),
    imageUrl: question.image.mediumUrl || question.image.url,
    thumbUrl: question.image.thumbUrl || question.image.smallUrl,
    observationUri: question.observation.uri,
    answerIconicTaxonName: question.answer.iconicTaxonName,
    answeredAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// IMAGE PRELOADING — pré-carrega TUDO de uma pergunta para troca instantânea
// ---------------------------------------------------------------------------

function preloadImage(url) {
  if (!url) return;
  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  image.src = url;
}

export function preloadQuestionAssets(question) {
  preloadImage(question.image.smallUrl || question.image.url);
  preloadImage(question.image.mediumUrl);
  preloadImage(question.image.largeUrl);
  for (const choice of question.choices) {
    preloadImage(choice.image?.smallUrl || choice.image?.mediumUrl || choice.image?.largeUrl || choice.image?.thumbUrl);
  }
}
