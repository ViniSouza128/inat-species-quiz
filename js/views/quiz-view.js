// =============================================================================
// QUIZ VIEW — tela principal com foto + 4 alternativas + feedback panel
// =============================================================================
// Construído com innerHTML (templates simples) + delegation. Sem framework.
// Equivalente a App.tsx + QuizCard + AnswerGrid + FeedbackPanel.
// =============================================================================

import { escapeHtml, formatDate, html } from '../format.js';
import { POPULAR_NAME_BY_SCIENTIFIC } from '../quiz-engine.js';

// Helpers de display ----------------------------------------------------------

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

function labelForChoice(choice, scientificOnly, hintLevel, answered) {
  if (scientificOnly) {
    return { title: choice.scientificName, subtitle: null, metaLines: [] };
  }
  const directCommonName = normalizedCommonName(choice);
  const mappedAncestorCommon = mappedPopularFromAncestor(choice);
  const fallbackAncestorScientific = normalizedAncestorScientific(choice);
  const title = directCommonName ?? mappedAncestorCommon ?? fallbackAncestorScientific ?? choice.scientificName;
  const subtitle = title.localeCompare(choice.scientificName, 'pt-BR', { sensitivity: 'base' }) === 0
    ? null : choice.scientificName;
  const metaLines = [];
  if (!answered) {
    if (hintLevel >= 1 && choice.familyScientificName) metaLines.push(`família: ${choice.familyScientificName}`);
    if (hintLevel >= 2 && choice.orderScientificName) metaLines.push(`ordem: ${choice.orderScientificName}`);
  }
  return { title, subtitle, metaLines };
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

function rankLabel(rank) {
  const map = {
    species: 'espécie', genus: 'gênero', family: 'família',
    order: 'ordem', class: 'classe', phylum: 'filo', kingdom: 'reino'
  };
  return rank ? map[rank] ?? rank : 'táxon';
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

// ---------------------------------------------------------------------------
// RENDER STATES
// ---------------------------------------------------------------------------

function startScreen() {
  return `
    <div class="start-screen-card compact-card">
      <p class="intro-icon" aria-hidden="true">🌿</p>
      <h1>iNat Species Quiz</h1>
      <p>Adivinhe a espécie pela foto. O bônus de tempo é regressivo: você começa com um bônus alto e ele cai a cada segundo.</p>
      <button type="button" data-action="advance">Começar</button>
    </div>
  `;
}

function loadingScreen(hasPrefetch) {
  const msg = hasPrefetch ? 'Abrindo a próxima rodada...' : 'Buscando a próxima observação...';
  return `
    <div class="compact-loading-shell compact-card">
      <p class="loading-emoji" aria-hidden="true">🔎</p>
      <h2>Carregando</h2>
      <p>${escapeHtml(msg)}</p>
    </div>
  `;
}

function errorScreen(error) {
  return `
    <div class="compact-loading-shell compact-card">
      <p class="loading-emoji" aria-hidden="true">⚠️</p>
      <h2>Não deu certo</h2>
      <p>${escapeHtml(error)}</p>
      <button type="button" data-action="advance">Tentar novamente</button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// QUIZ STAGE — pergunta + alternativas + feedback
// ---------------------------------------------------------------------------

export function renderQuizStage(state) {
  const { question, settings, answered, answering, selectedTaxonId, answerResult, hintLevel, currentBonusPoints } = state;

  // Imagem inicial: começa em smallUrl, JS depois faz progressão.
  const photoSrc = question.image.smallUrl || question.image.url;
  const author = visibleAuthor(question);

  // Alternativas
  const choicesHtml = question.choices.slice(0, 4).map((choice, index) => {
    const isSelected = selectedTaxonId === choice.taxonId;
    const isCorrect = answerResult?.correctTaxonId === choice.taxonId;
    const statusClass = answered
      ? isCorrect ? 'correct' : isSelected ? 'wrong' : 'neutral'
      : '';
    const label = labelForChoice(choice, settings.scientificOnly, hintLevel, answered);
    const thumbUrl = bestChoiceImage(choice);

    const buttonClass = `answer-button ${statusClass} ${isSelected ? 'selected-choice' : ''} ${answering ? 'is-answering' : ''} ${answered && thumbUrl ? 'revealed-thumb' : ''} hint-level-${hintLevel}`;

    const thumb = (answered && thumbUrl)
      ? `<span class="choice-media"><img class="choice-thumb" src="${escapeHtml(thumbUrl)}" alt="Imagem de referência: ${escapeHtml(label.title)}" loading="eager" decoding="async" /></span>`
      : '';

    const subtitle = label.subtitle ? `<span class="answer-subtitle"><em>${escapeHtml(label.subtitle)}</em></span>` : '';
    const metaLines = label.metaLines.map((line) => `<span class="answer-taxonomy">${escapeHtml(line)}</span>`).join('');

    let status = '';
    if (answered && isCorrect) status = '<span class="answer-status">✓ correta</span>';
    else if (answered && isSelected && !isCorrect) status = '<span class="answer-status">✕ escolhida</span>';
    else if (answered && !isSelected && !isCorrect && answerResult?.correct === false) status = '<span class="answer-status muted-status">alternativa</span>';

    return `
      <button type="button" class="${buttonClass}" data-action="answer" data-taxon-id="${choice.taxonId}" ${answered || answering ? 'disabled' : ''} aria-pressed="${isSelected}" style="--choice-index:${index}">
        ${thumb}
        <span class="answer-text">
          <span class="answer-title">${escapeHtml(label.title)}</span>
          ${subtitle}
          ${metaLines}
          ${status}
        </span>
      </button>
    `;
  }).join('');

  // Feedback panel ----------------------------------------------------------
  const scoreLabel = (delta) => `${delta > 0 ? `+${delta}` : String(delta)} pts`;
  const feedbackHtml = answered
    ? `
      <section class="feedback compact-feedback ${answerResult.correct ? 'positive' : 'negative'}" aria-live="polite">
        <div class="feedback-head compact-feedback-head">
          <h2>${answerResult.correct ? 'Correto' : 'Incorreto'}</h2>
          <strong>${escapeHtml(scoreLabel(answerResult.scoreDelta))}</strong>
        </div>
        <div class="feedback-actions compact-feedback-actions persistent-actions">
          <button type="button" class="secondary small-action" data-action="info">Info</button>
          <button type="button" class="large-action" data-action="advance">Próxima</button>
        </div>
      </section>
    ` : `
      <section class="feedback compact-feedback pending-feedback" aria-live="polite">
        <div class="feedback-head compact-feedback-head pending-feedback-head">
          <h2>Escolha a espécie</h2>
          <strong>+${currentBonusPoints} bônus</strong>
        </div>
        <div class="feedback-actions compact-feedback-actions persistent-actions">
          <button type="button" class="secondary small-action" data-action="hint" ${hintLevel >= 2 ? 'disabled' : ''}>${hintLevel === 0 ? 'Dica' : hintLevel === 1 ? '2ª dica' : 'Dicas completas'}</button>
          <button type="button" class="ghost large-action" data-action="advance">Pular</button>
        </div>
      </section>
    `;

  const warning = question.meta.warning ? `<p class="warning compact-warning">${escapeHtml(question.meta.warning)}</p>` : '';

  return `
    <div class="quiz-stage mobile-stage ${answered ? 'is-answered' : ''}" data-question-id="${escapeHtml(question.questionId)}">
      <div class="media-column">
        <section class="quiz-card compact-quiz-card">
          <div class="image-frame" data-image-frame>
            <div class="image-viewport">
              <img class="image-backdrop" data-image-backdrop src="${escapeHtml(photoSrc)}" alt="" aria-hidden="true" draggable="false" />
              <img class="zoomable-image" data-zoomable src="${escapeHtml(photoSrc)}" alt="${answered ? `Foto de ${escapeHtml(question.answer.commonName ?? question.answer.scientificName)}` : 'Foto de uma espécie para adivinhar'}" draggable="false" />
            </div>
            <div class="image-credit" title="${escapeHtml(question.image.attribution ?? author)}">
              <strong>Autor: ${escapeHtml(author)}</strong>
              <span>${escapeHtml(question.image.licenseCode ?? 'licença n/d')}</span>
            </div>
          </div>
          ${warning}
        </section>
      </div>

      <div class="play-column">
        <div class="answer-grid choices-4 hint-level-${hintLevel} ${answered ? 'answered-grid' : 'pending-grid'}" role="group" aria-label="Alternativas de resposta" data-answer-grid>
          ${choicesHtml}
        </div>
        ${feedbackHtml}
      </div>
    </div>
  `;
}

/**
 * Renderiza a tela inteira do jogo (HUD + content area). Recebe `state`
 * com tudo necessário do hook do quiz (question, stats, etc.).
 */
export function renderGameScreen(state) {
  const { question, loading, error, prefetchedCount, stats } = state;

  let content = '';
  if (!question && !loading && !error) content = startScreen();
  else if (loading) content = loadingScreen(prefetchedCount > 0);
  else if (error && !loading) content = errorScreen(error);
  else if (question && !loading) content = renderQuizStage(state);

  return `
    <section class="game-screen" aria-label="Tela do quiz">
      <header class="game-topbar" aria-label="Resumo do jogo">
        <div class="hud-strip" aria-label="Pontuação da rodada">
          <span class="hud-pill accent"><strong><span class="hud-icon" aria-hidden="true">⭐</span><span>${stats.score}</span></strong><small>Pontos</small></span>
          <span class="hud-pill"><strong><span class="hud-icon" aria-hidden="true">🔥</span><span>${stats.currentStreak}</span></strong><small>Seq.</small></span>
          <span class="hud-pill timer-pill"><strong><span class="hud-icon" aria-hidden="true">💎</span><span>+${state.currentBonusPoints}</span></strong><small>Bônus</small></span>
          <span class="hud-pill"><strong><span class="hud-icon" aria-hidden="true">🎯</span><span>${stats.accuracy}%</span></strong><small>Prec.</small></span>
        </div>
      </header>
      ${content}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// INFO MODAL — exibido quando clica em "Info" após responder
// ---------------------------------------------------------------------------

export function renderInfoModal(question) {
  const fallbackNote = question.answer.commonName && question.answer.commonNameRank !== question.answer.rank
    ? `Nome popular exibido a partir da ${rankLabel(question.answer.commonNameRank)}.`
    : null;

  const observer = question.observation.observerName
    || question.observation.observerLogin
    || question.image.attribution
    || 'não informado';

  return `
    <div class="modal-backdrop" role="presentation" data-action="close-modal">
      <section class="info-modal" role="dialog" aria-modal="true" aria-label="Informações da observação" data-modal>
        <div class="modal-head">
          <h2>Informações</h2>
          <button type="button" class="ghost" data-action="close-modal">Fechar</button>
        </div>
        <dl class="info-list">
          <div><dt>Nome exibido</dt><dd>${escapeHtml(displayName(question))}</dd></div>
          <div><dt>Nome popular</dt><dd>${escapeHtml(question.answer.commonName ?? 'não informado')}</dd></div>
          <div><dt>Nome científico</dt><dd><em>${escapeHtml(question.answer.scientificName)}</em></dd></div>
          <div><dt>Família</dt><dd><em>${escapeHtml(question.answer.familyScientificName ?? 'n/d')}</em></dd></div>
          <div><dt>Ordem</dt><dd><em>${escapeHtml(question.answer.orderScientificName ?? 'n/d')}</em></dd></div>
          <div><dt>Grupo</dt><dd>${escapeHtml(question.answer.iconicTaxonName ?? 'n/d')}</dd></div>
          <div><dt>Autor</dt><dd>${escapeHtml(observer)}</dd></div>
          <div><dt>Licença</dt><dd>${escapeHtml(question.image.licenseCode ?? 'n/d')}</dd></div>
          <div><dt>Data</dt><dd>${escapeHtml(question.observation.observedOn ? formatDate(question.observation.observedOn) : 'n/d')}</dd></div>
          <div><dt>Local</dt><dd>${escapeHtml(question.observation.placeGuess ?? 'n/d')}</dd></div>
        </dl>
        ${fallbackNote ? `<p class="fine-print">${escapeHtml(fallbackNote)}</p>` : ''}
        ${question.observation.uri ? `<a class="link-button" href="${escapeHtml(question.observation.uri)}" target="_blank" rel="noreferrer">Abrir no iNaturalist</a>` : ''}
      </section>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// IMAGE PROGRESSIVE LOAD + ZOOM/PAN — anexa interatividade após render
// ---------------------------------------------------------------------------

/**
 * Aplica:
 *   • Carregamento progressivo (small → medium → large).
 *   • Zoom com wheel.
 *   • Pan com drag (1 ponteiro) e pinch (2 ponteiros).
 *   • Reset com double-click.
 * Devolve uma função de cleanup (chamar no unmount/replace).
 */
export function attachImageInteractivity(stageRoot, question, onImageError) {
  const frame = stageRoot.querySelector('[data-image-frame]');
  const img = stageRoot.querySelector('[data-zoomable]');
  const backdrop = stageRoot.querySelector('[data-image-backdrop]');
  if (!frame || !img) return () => undefined;

  let zoom = 1;
  let pan = { x: 0, y: 0 };
  const pointers = new Map();
  let lastDragPoint = null;
  let pinchStart = null;
  let cancelled = false;

  function applyTransform() {
    img.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    if (zoom > 1) frame.classList.add('is-zoomed');
    else frame.classList.remove('is-zoomed');
  }

  function resetView() {
    zoom = 1;
    pan = { x: 0, y: 0 };
    pointers.clear();
    lastDragPoint = null;
    pinchStart = null;
    applyTransform();
  }

  // Carregamento progressivo (small → medium → large)
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
      backdrop.src = url;
      loadNext(index + 1);
    };
    probe.onerror = () => loadNext(index + 1);
    probe.src = url;
  }
  loadNext(1);

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function onWheel(event) {
    event.preventDefault();
    const dir = event.deltaY > 0 ? -0.14 : 0.14;
    zoom = clamp(zoom + dir, 1, 4);
    if (zoom === 1) pan = { x: 0, y: 0 };
    applyTransform();
  }
  function onDoubleClick() { resetView(); }
  function onPointerDown(event) {
    frame.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) lastDragPoint = point;
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStart = { distance: distance(pts[0], pts[1]), zoom };
    }
  }
  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);
    if (pointers.size === 2 && pinchStart) {
      const pts = [...pointers.values()];
      const ratio = distance(pts[0], pts[1]) / Math.max(1, pinchStart.distance);
      zoom = clamp(pinchStart.zoom * ratio, 1, 4);
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

  frame.addEventListener('wheel', onWheel, { passive: false });
  frame.addEventListener('dblclick', onDoubleClick);
  frame.addEventListener('pointerdown', onPointerDown);
  frame.addEventListener('pointermove', onPointerMove);
  frame.addEventListener('pointerup', onPointerUp);
  frame.addEventListener('pointercancel', onPointerUp);
  img.addEventListener('error', onError);

  return () => {
    cancelled = true;
    frame.removeEventListener('wheel', onWheel);
    frame.removeEventListener('dblclick', onDoubleClick);
    frame.removeEventListener('pointerdown', onPointerDown);
    frame.removeEventListener('pointermove', onPointerMove);
    frame.removeEventListener('pointerup', onPointerUp);
    frame.removeEventListener('pointercancel', onPointerUp);
    img.removeEventListener('error', onError);
  };
}

// ---------------------------------------------------------------------------
// ANSWER GRID HEIGHT EQUALIZER
// ---------------------------------------------------------------------------
// Replica o useLayoutEffect do AnswerGrid.tsx: mede o botão mais alto e
// seta `--answer-btn-h` no grid, fazendo todos terem a mesma altura.

export function equalizeAnswerHeights(stageRoot) {
  const grid = stageRoot.querySelector('[data-answer-grid]');
  if (!grid) return () => undefined;

  function measure() {
    const buttons = Array.from(grid.querySelectorAll('button.answer-button'));
    if (buttons.length === 0) return;
    const previousVar = grid.style.getPropertyValue('--answer-btn-h');
    grid.style.setProperty('--answer-btn-h', 'auto', 'important');
    void buttons[0].offsetHeight; // força reflow
    let max = 0;
    for (const b of buttons) {
      const h = b.getBoundingClientRect().height;
      if (h > max) max = h;
    }
    if (previousVar) grid.style.setProperty('--answer-btn-h', previousVar);
    else grid.style.removeProperty('--answer-btn-h');
    grid.style.setProperty('--answer-btn-h', `${Math.ceil(max)}px`);
  }

  // Mede após o frame atual e depois que as imagens carregaram.
  requestAnimationFrame(measure);
  window.addEventListener('resize', measure);

  return () => window.removeEventListener('resize', measure);
}
