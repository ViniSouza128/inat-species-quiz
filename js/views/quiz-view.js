// =============================================================================
// QUIZ VIEW — tela principal com foto + 4 alternativas + feedback dock
// =============================================================================
// Construído com innerHTML (templates simples) + delegation. Sem framework.
// Espelha o design system v2 (mockup/index-v2.html) + componentes React em
// client/src/components/{QuizCard,HudBar,AnswerGrid,FeedbackPanel,InfoModal}.
//
// Estrutura:
//   <section.app-main>
//     <div.hud> ............................ HUD pill (pts/streak/precisão/bônus)
//     <div.quiz-screen>
//       <section.hero> ..................... foto (com zoom gestual)
//       <div.play>
//         <div.choices[data-mode]> ......... 4 alternativas (ancoradas embaixo)
//         <div.feedback> ................... dock fixo no rodapé do .play
// =============================================================================

import { escapeHtml, formatDate } from '../format.js';
import { POPULAR_NAME_BY_SCIENTIFIC } from '../quiz-engine.js';
import { classifyQuizError } from '../error-messages.js';

// ---------------------------------------------------------------------------
// HELPERS DE DISPLAY
// ---------------------------------------------------------------------------

function bestChoiceImage(choice) {
  return choice.image?.mediumUrl || choice.image?.smallUrl || choice.image?.largeUrl || choice.image?.thumbUrl || null;
}

function mappedPopularFromAncestor(choice) {
  const familyMatch = choice.familyScientificName ? POPULAR_NAME_BY_SCIENTIFIC[choice.familyScientificName] : null;
  if (familyMatch) return familyMatch;
  const orderMatch = choice.orderScientificName ? POPULAR_NAME_BY_SCIENTIFIC[choice.orderScientificName] : null;
  if (orderMatch) return orderMatch;
  const raw = choice.fallbackAncestorScientificName?.trim();
  if (!raw) return null;
  return POPULAR_NAME_BY_SCIENTIFIC[raw] ?? null;
}

function normalizedCommonName(choice) {
  const raw = choice.commonName?.trim();
  if (!raw) return null;
  if (raw.localeCompare(choice.scientificName, 'pt-BR', { sensitivity: 'base' }) === 0) return null;
  return raw;
}

function normalizedAncestorScientific(choice) {
  const raw = choice.fallbackAncestorScientificName?.trim();
  if (!raw) return null;
  if (raw.localeCompare(choice.scientificName, 'pt-BR', { sensitivity: 'base' }) === 0) return null;
  return raw;
}

/** Resolve título (nome popular) + subtítulo (nome científico). */
function labelForChoice(choice, scientificOnly) {
  if (scientificOnly) return { title: choice.scientificName, subtitle: null };
  const direct = normalizedCommonName(choice);
  const mapped = mappedPopularFromAncestor(choice);
  const ancestor = normalizedAncestorScientific(choice);
  const title = direct ?? mapped ?? ancestor ?? choice.scientificName;
  const subtitle = title.localeCompare(choice.scientificName, 'pt-BR', { sensitivity: 'base' }) === 0
    ? null : choice.scientificName;
  return { title, subtitle };
}

function cleanAttribution(raw) {
  if (!raw) return 'usuário iNaturalist';
  return raw
    .replace(/^\(c\)\s*/i, '')
    .replace(/,?\s*some rights reserved.*$/i, '')
    .replace(/,?\s*all rights reserved.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || 'usuário iNaturalist';
}

function visibleAuthor(question) {
  return question.observation.observerName
    || question.observation.observerLogin
    || cleanAttribution(question.image.attribution);
}

function displayName(question) {
  if (question.answer.commonName && question.answer.commonName !== question.answer.scientificName) {
    return question.answer.commonName;
  }
  if (question.answer.fallbackAncestorScientificName && question.answer.fallbackAncestorScientificName !== question.answer.scientificName) {
    return question.answer.fallbackAncestorScientificName;
  }
  return question.answer.scientificName;
}

function rankLabel(rank) {
  const map = { species: 'espécie', genus: 'gênero', family: 'família', order: 'ordem', class: 'classe', phylum: 'filo', kingdom: 'reino' };
  return rank ? map[rank] ?? rank : 'táxon';
}

// ---------------------------------------------------------------------------
// HUD (pontos / streak / precisão / bônus regressivo)
// ---------------------------------------------------------------------------

function renderHud(state) {
  const { stats, currentBonusPoints } = state;
  const bonusStart = 75; // referência para a largura da barra (varia por difficulty no real)
  const bonusPct = Math.max(0, Math.min(100, Math.round((currentBonusPoints / bonusStart) * 100)));
  return `
    <div class="hud" role="status">
      <div class="hud-stats">
        <span class="hud-stat score"><span class="num tnum">${stats.score}</span><span class="lbl">pts</span></span>
        <span class="hud-stat streak"><span class="num tnum">${stats.currentStreak}</span><span class="lbl">streak</span></span>
        <span class="hud-stat acc"><span class="num tnum">${stats.accuracy}%</span><span class="lbl">precisão</span></span>
      </div>
      <div class="hud-bonus" aria-label="Bônus de tempo">
        <span class="lbl">Bônus</span>
        <div class="bar" aria-hidden="true"><span style="--bonus:${bonusPct}%"></span></div>
        <span class="val tnum">+${currentBonusPoints}</span>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// CENTER CARDS (start / loading / error)
// ---------------------------------------------------------------------------

function startCard() {
  return `
    <div class="center-card">
      <div class="icon-disc" aria-hidden="true">🌿</div>
      <h1>Adivinhe a espécie</h1>
      <p>Veja uma foto real de observação pública do iNaturalist e escolha entre 4 alternativas. O bônus começa alto e cai a cada segundo.</p>
      <button type="button" class="btn btn-primary" data-action="advance">Começar partida →</button>
    </div>
  `;
}

function loadingCard(hasPrefetch) {
  const msg = hasPrefetch ? 'Abrindo a próxima rodada…' : 'Buscando uma espécie compatível com seus filtros…';
  return `
    <div class="center-card">
      <div class="loader-spinner" aria-hidden="true"></div>
      <h1 style="font-size: 22px; margin-top: 8px;">Carregando observação</h1>
      <p>${escapeHtml(msg)}</p>
    </div>
  `;
}

function errorCard(friendly) {
  // `friendly` é o objeto devolvido por classifyQuizError({title, body,
  // hints, icon}). Renderiza um cartão rico com sugestões acionáveis e dois
  // botões (Ajustar filtros / Tentar novamente).
  const isNoResults = (friendly.title || '').toLowerCase().includes('sem espécies');
  const gradient = isNoResults
    ? 'linear-gradient(135deg, var(--amber), #f59e0b)'
    : 'linear-gradient(135deg, var(--err), #ef4444)';
  const hints = (friendly.hints || []).map((h) => `<li>${escapeHtml(h)}</li>`).join('');
  return `
    <div class="center-card error-card">
      <div class="icon-disc" aria-hidden="true" style="background: ${gradient};">${escapeHtml(friendly.icon || '⚠')}</div>
      <h1>${escapeHtml(friendly.title || 'Não deu certo')}</h1>
      <p>${escapeHtml(friendly.body || '')}</p>
      ${hints ? `<ul class="error-hints" aria-label="Sugestões">${hints}</ul>` : ''}
      <div class="error-actions">
        <button type="button" class="btn btn-secondary" data-action="set-mode" data-mode="config">Ajustar filtros</button>
        <button type="button" class="btn btn-primary" data-action="advance">Tentar novamente</button>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// HERO (foto + créditos)
// ---------------------------------------------------------------------------

function renderHero(question, answered) {
  const photoSrc = question.image.smallUrl || question.image.url;
  const author = visibleAuthor(question);
  const alt = answered
    ? `Foto de ${question.answer.commonName ?? question.answer.scientificName}`
    : 'Foto de uma espécie para adivinhar';
  const stateAttr = answered ? 'answered' : 'idle';
  return `
    <section class="hero" data-state="${stateAttr}" data-zoomed="false" data-image-frame>
      <img class="hero-img blur" data-image-backdrop src="${escapeHtml(photoSrc)}" alt="" aria-hidden="true" draggable="false" />
      <img class="hero-img zoomable" data-zoomable src="${escapeHtml(photoSrc)}" alt="${escapeHtml(alt)}" draggable="false" />
      <div class="hero-credit" title="${escapeHtml(question.image.attribution ?? author)}">
        <div class="author">
          <small>Foto por</small>
          <strong>${escapeHtml(author)}</strong>
        </div>
        <span class="lic">${escapeHtml(question.image.licenseCode ?? 'licença n/d')}</span>
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// CHOICES (4 alternativas com subgrid alignment)
// ---------------------------------------------------------------------------

function renderChoices(state) {
  const { question, settings, answered, answering, selectedTaxonId, answerResult, hintLevel } = state;
  const mode = answered ? 'answered' : hintLevel >= 2 ? 'hint2' : hintLevel >= 1 ? 'hint1' : 'plain';

  const choicesHtml = question.choices.slice(0, 4).map((choice, index) => {
    const isSelected = selectedTaxonId === choice.taxonId;
    const isCorrect = answered && choice.taxonId === answerResult?.correctTaxonId;
    const isWrong = answered && isSelected && !isCorrect;
    const isNeutral = answered && !isCorrect && !isWrong;
    const cls = ['choice'];
    if (isCorrect) cls.push('is-correct');
    else if (isWrong) cls.push('is-wrong');
    else if (isNeutral) cls.push('is-neutral');

    const label = labelForChoice(choice, settings.scientificOnly);
    const thumbUrl = bestChoiceImage(choice);
    const showHints = !answered && hintLevel > 0;

    const thumb = (answered && thumbUrl)
      ? `<span class="thumb"><img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" /></span>` : '';

    const hintLabels = showHints ? `
      <span class="hint-labels" aria-hidden="true">
        <span class="hint-tag">FAMÍLIA</span>
        ${hintLevel >= 2 ? '<span class="hint-tag">ORDEM</span>' : ''}
      </span>` : '';
    const hintValues = showHints ? `
      <span class="hint-values">
        <span class="hint-val">${escapeHtml(choice.familyScientificName ?? '—')}</span>
        ${hintLevel >= 2 ? `<span class="hint-val">${escapeHtml(choice.orderScientificName ?? '—')}</span>` : ''}
      </span>` : '';

    // Badge "1"/"2"/"3"/"4" — visível só em desktop (CSS .kbd-hint tem
    // display: none em mobile). Some quando o usuário já respondeu.
    const kbdHint = answered
      ? ''
      : `<span class="kbd-hint kbd-num" aria-hidden="true">${index + 1}</span>`;

    let status = '';
    if (isCorrect) status = '<span class="status status-ok" aria-label="Resposta correta">✓</span>';
    else if (isWrong) status = '<span class="status status-err" aria-label="Sua escolha (errada)">✕</span>';

    return `
      <button type="button" class="${cls.join(' ')}" data-action="answer" data-taxon-id="${choice.taxonId}" ${answered || answering ? 'disabled' : ''} aria-pressed="${isSelected}">
        ${thumb}
        <span class="names">
          <span class="name">${escapeHtml(label.title)}</span>
          ${label.subtitle ? `<span class="sci">${escapeHtml(label.subtitle)}</span>` : ''}
        </span>
        ${hintLabels}
        ${hintValues}
        ${kbdHint}
        ${status}
      </button>
    `;
  }).join('');

  return `
    <div class="choices" data-mode="${mode}" data-hint="${hintLevel}" data-answered="${answered}" role="listbox" aria-label="Alternativas">
      ${choicesHtml}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// FEEDBACK DOCK (pending / ok / err)
// ---------------------------------------------------------------------------

function renderFeedback(state) {
  const { answered, answerResult, hintLevel, currentBonusPoints, stats, question } = state;

  if (!answered) {
    const hintLabel = hintLevel === 0 ? '💡 Dica (família)'
      : hintLevel === 1 ? '💡 Mais dica (ordem)'
      : '— Sem mais dicas';
    const sub = hintLevel === 0
      ? `Bônus atual <strong class="tnum">+${currentBonusPoints} pts</strong> · tecla <kbd>1-4</kbd>`
      : `<span class="hint-used">${hintLevel} dica${hintLevel === 1 ? '' : 's'} usada${hintLevel === 1 ? '' : 's'}</span> · bônus <strong class="tnum">+${currentBonusPoints}</strong>`;
    return `
      <div class="feedback is-pending" data-kind="pending" role="status">
        <span class="fb-disc" aria-hidden="true">?</span>
        <div class="fb-text">
          <strong class="fb-title"><span class="fb-label">Selecione uma alternativa</span></strong>
          <span class="fb-sub">${sub}</span>
        </div>
        <button type="button" class="btn btn-secondary fb-secondary" data-action="hint" ${hintLevel >= 2 ? 'disabled' : ''}>
          <span class="kbd-hint" aria-hidden="true">D</span>
          <span>${escapeHtml(hintLabel)}</span>
        </button>
        <button type="button" class="btn btn-ghost fb-primary" data-action="advance">
          <span>Pular</span>
          <span class="kbd-hint" aria-hidden="true">S</span>
        </button>
      </div>
    `;
  }

  const ok = answerResult.correct;
  const delta = answerResult.scoreDelta;
  const sub = ok
    ? `Streak <strong class="tnum">${stats.currentStreak}</strong> · acertou em sequência`
    : `A correta era <em>${escapeHtml(displayName(question))}</em>`;
  const deltaText = `${delta > 0 ? '+' : ''}${delta} pts`;
  return `
    <div class="feedback ${ok ? 'is-ok' : 'is-err'}" data-kind="${ok ? 'ok' : 'err'}" role="status" aria-live="polite">
      <span class="fb-disc" aria-hidden="true">${ok ? '✓' : '✕'}</span>
      <div class="fb-text">
        <strong class="fb-title">
          <span class="fb-label">${ok ? 'Correto' : 'Incorreto'}</span>
          <span class="fb-delta tnum">${escapeHtml(deltaText)}</span>
        </strong>
        <span class="fb-sub">${sub}</span>
      </div>
      <button type="button" class="btn btn-secondary fb-secondary" data-action="info">
        <span class="kbd-hint" aria-hidden="true">I</span>
        <span>Detalhes</span>
      </button>
      <button type="button" class="btn btn-primary fb-primary" data-action="advance">
        <span>Próxima</span>
        <span class="kbd-hint" aria-hidden="true">↵</span>
      </button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// QUIZ STAGE — pergunta completa (hero + play)
// ---------------------------------------------------------------------------

function renderQuizStage(state) {
  return `
    <div class="quiz-screen" data-question-id="${escapeHtml(state.question.questionId)}">
      ${renderHero(state.question, state.answered)}
      <div class="play">
        ${renderChoices(state)}
        ${renderFeedback(state)}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// GAME SCREEN — wrapper completo (HUD + content)
// ---------------------------------------------------------------------------

export function renderGameScreen(state) {
  const { question, loading, error, prefetchedCount } = state;

  let content = '';
  if (loading) content = loadingCard(prefetchedCount > 0);
  else if (error) {
    // Classifica o erro usando os settings atuais (taxonLabel, placeLabel...)
    // para enriquecer a mensagem com o contexto real dos filtros.
    const friendly = classifyQuizError(new Error(error), state.settings || {});
    content = errorCard(friendly);
  }
  else if (!question) content = startCard();
  else content = renderQuizStage(state);

  // Hero/play só aparecem em quiz-pending/hint/answered. Nos demais, HUD
  // ainda fica visível, mas com tudo zerado se for start.
  const showHud = Boolean(question);

  return `
    <section class="app-main" aria-label="Quiz">
      ${showHud ? renderHud(state) : ''}
      ${content}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// INFO MODAL — detalhes da observação (pós-resposta)
// ---------------------------------------------------------------------------

export function renderInfoModal(question) {
  const fallbackNote = question.answer.commonName && question.answer.commonNameRank !== question.answer.rank
    ? `Nome popular exibido a partir da ${rankLabel(question.answer.commonNameRank)}.`
    : null;

  const observer = question.observation.observerName
    || question.observation.observerLogin
    || cleanAttribution(question.image.attribution);
  const photoSrc = question.image.mediumUrl || question.image.largeUrl || question.image.smallUrl || question.image.url;

  return `
    <div class="modal-backdrop" role="presentation" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="info-title" data-stop>
        <div class="modal-thumb">
          <img src="${escapeHtml(photoSrc)}" alt="Foto de ${escapeHtml(displayName(question))}" />
          <div class="modal-thumb-credit">
            <span>${escapeHtml(observer)}</span>
            <span class="lic">${escapeHtml(question.image.licenseCode ?? 'licença n/d')}</span>
          </div>
        </div>
        <header class="modal-head">
          <div>
            <h2 id="info-title">${escapeHtml(displayName(question))}<em>${escapeHtml(question.answer.scientificName)}</em></h2>
          </div>
          <button type="button" class="btn btn-ghost" data-action="close-modal">Fechar ✕</button>
        </header>
        <div class="modal-body">
          <dl>
            <div><dt>Família</dt><dd><em>${escapeHtml(question.answer.familyScientificName ?? 'n/d')}</em></dd></div>
            <div><dt>Ordem</dt><dd><em>${escapeHtml(question.answer.orderScientificName ?? 'n/d')}</em></dd></div>
            <div><dt>Local</dt><dd>${escapeHtml(question.observation.placeGuess ?? 'n/d')}</dd></div>
            <div><dt>Data</dt><dd>${escapeHtml(question.observation.observedOn ? formatDate(question.observation.observedOn) : 'n/d')}</dd></div>
            <div><dt>Foto por</dt><dd>${escapeHtml(observer)}</dd></div>
            <div><dt>Licença</dt><dd>${escapeHtml(question.image.licenseCode ?? 'n/d')}</dd></div>
            <div><dt>Grupo</dt><dd>${escapeHtml(question.answer.iconicTaxonName ?? 'n/d')}</dd></div>
          </dl>
          ${fallbackNote ? `<p style="font-size: 12px; color: var(--text-faint); margin-top: 12px;">${escapeHtml(fallbackNote)}</p>` : ''}
        </div>
        <footer class="modal-foot">
          ${question.observation.uri ? `<a class="btn btn-secondary" href="${escapeHtml(question.observation.uri)}" target="_blank" rel="noreferrer">Abrir no iNaturalist ↗</a>` : ''}
          <button type="button" class="btn btn-primary" data-action="close-modal">OK</button>
        </footer>
      </section>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// IMAGE INTERACTIVITY — pipeline progressivo + zoom/pan/pinch
// ---------------------------------------------------------------------------
// Espelha hooks/useImageZoom.ts do app React. Wheel 14% por tick (1x..4x),
// pinch+pan simultâneo, drag ±240px, dblclick reset, snap-back ≤1.01.

export function attachImageInteractivity(stageRoot, question, onImageError) {
  const hero = stageRoot.querySelector('[data-image-frame]');
  const img = stageRoot.querySelector('[data-zoomable]');
  const backdrop = stageRoot.querySelector('[data-image-backdrop]');
  if (!hero || !img) return () => undefined;

  let zoom = 1;
  let pan = { x: 0, y: 0 };
  const pointers = new Map();
  let lastDragPoint = null;
  let pinchStart = null;
  let cancelled = false;

  function applyTransform() {
    img.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    hero.dataset.zoomed = zoom > 1.02 ? 'true' : 'false';
  }
  function resetView() {
    zoom = 1;
    pan = { x: 0, y: 0 };
    pointers.clear();
    lastDragPoint = null;
    pinchStart = null;
    applyTransform();
  }

  // Carregamento progressivo small → medium → large
  const pipeline = [question.image.smallUrl, question.image.mediumUrl, question.image.largeUrl]
    .filter((url, i, arr) => Boolean(url) && arr.indexOf(url) === i);
  function loadNext(index) {
    const url = pipeline[index];
    if (!url || cancelled) return;
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => {
      if (cancelled) return;
      img.src = url;
      if (backdrop) backdrop.src = url;
      loadNext(index + 1);
    };
    probe.onerror = () => loadNext(index + 1);
    probe.src = url;
  }
  loadNext(1);

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function onWheel(event) {
    event.preventDefault();
    const dir = event.deltaY > 0 ? -0.14 : 0.14;
    zoom = clamp(zoom + dir, 1, 4);
    if (zoom === 1) pan = { x: 0, y: 0 };
    applyTransform();
  }
  function onDoubleClick() { resetView(); }
  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    hero.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) lastDragPoint = point;
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStart = {
        distance: distance(pts[0], pts[1]),
        zoom,
        midpoint: midpoint(pts[0], pts[1]),
        panX: pan.x,
        panY: pan.y
      };
    }
  }
  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);
    if (pointers.size === 2 && pinchStart) {
      const pts = [...pointers.values()];
      const newDist = distance(pts[0], pts[1]);
      const newMid = midpoint(pts[0], pts[1]);
      const ratio = newDist / Math.max(1, pinchStart.distance);
      zoom = clamp(pinchStart.zoom * ratio, 1, 4);
      const dx = newMid.x - pinchStart.midpoint.x;
      const dy = newMid.y - pinchStart.midpoint.y;
      pan.x = clamp(pinchStart.panX + dx, -240, 240);
      pan.y = clamp(pinchStart.panY + dy, -240, 240);
      applyTransform();
      return;
    }
    if (pointers.size === 1 && zoom > 1 && lastDragPoint) {
      const dx = next.x - lastDragPoint.x;
      const dy = next.y - lastDragPoint.y;
      lastDragPoint = next;
      pan.x = clamp(pan.x + dx, -240, 240);
      pan.y = clamp(pan.y + dy, -240, 240);
      applyTransform();
    }
  }
  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    pinchStart = null;
    lastDragPoint = pointers.size === 1 ? [...pointers.values()][0] : null;
    if (zoom <= 1.01) resetView();
  }
  function onError() {
    if (typeof onImageError === 'function') onImageError();
  }

  hero.addEventListener('wheel', onWheel, { passive: false });
  hero.addEventListener('dblclick', onDoubleClick);
  hero.addEventListener('pointerdown', onPointerDown);
  hero.addEventListener('pointermove', onPointerMove);
  hero.addEventListener('pointerup', onPointerUp);
  hero.addEventListener('pointercancel', onPointerUp);
  img.addEventListener('error', onError);

  return () => {
    cancelled = true;
    hero.removeEventListener('wheel', onWheel);
    hero.removeEventListener('dblclick', onDoubleClick);
    hero.removeEventListener('pointerdown', onPointerDown);
    hero.removeEventListener('pointermove', onPointerMove);
    hero.removeEventListener('pointerup', onPointerUp);
    hero.removeEventListener('pointercancel', onPointerUp);
    img.removeEventListener('error', onError);
  };
}

// equalizeAnswerHeights ficou obsoleto — o grid v2 usa
// grid-template-rows: repeat(4, minmax(0, 1fr)) que iguala altura
// nativamente. Mantemos a função como no-op para não quebrar
// chamadas existentes no main.js.
export function equalizeAnswerHeights() {
  return () => undefined;
}
