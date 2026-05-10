// =============================================================================
// FORMAT — helpers de formatação textual em PT-BR
// =============================================================================
// Espelha client/src/utils/format.ts.
// =============================================================================

/**
 * Texto canônico para o nome de uma espécie. Em modo "scientificOnly" ou
 * quando não há nome popular, mostra só o científico.
 */
export function displaySpecies(commonName, scientificName, scientificOnly) {
  if (scientificOnly || !commonName) return scientificName;
  return `${commonName} — ${scientificName}`;
}

/**
 * Formata uma string de data (ISO 8601) para PT-BR no estilo "9 de mai. de 2026".
 * Defensivo: data inválida → devolve a string crua; sem valor → fallback.
 */
export function formatDate(value) {
  if (!value) return 'Data não informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date);
}

/** Formata um número como "X,Y%". */
export function formatAccuracy(value) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/**
 * Escape HTML em uma string. Necessário porque construímos pedaços de UI
 * com template literals (innerHTML) e não queremos permitir injeção de
 * tags vindas da API ou do localStorage.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cria um nó DOM rapidamente a partir de um HTML string. */
export function html(strings, ...values) {
  // Tagged template helper. Escapa interpolações automaticamente,
  // a menos que sejam um objeto { __raw: '...' }.
  let out = '';
  for (let i = 0; i < strings.length; i += 1) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '__raw')) {
        out += String(v.__raw);
      } else if (Array.isArray(v)) {
        // Array de strings: concatena sem escape (os pedaços já foram
        // construídos com `html` ou `escapeHtml` pelo chamador).
        out += v.join('');
      } else {
        out += escapeHtml(v);
      }
    }
  }
  return out;
}

/** Marca uma string como "raw" — não escapa quando interpolada via `html`. */
export function raw(value) {
  return { __raw: value ?? '' };
}

/**
 * Cria um elemento DOM a partir de uma string HTML. Devolve o primeiro
 * elemento. Útil para construir blocos e anexá-los depois.
 */
export function fromHtml(htmlString) {
  const template = document.createElement('template');
  template.innerHTML = htmlString.trim();
  return template.content.firstElementChild;
}

/** Helper para query dentro de um root + cast pra HTMLElement. */
export function $(selector, root = document) {
  return root.querySelector(selector);
}

/** Helper para todos os elementos. */
export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}
