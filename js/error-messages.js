// =============================================================================
// error-messages — classifica erros e devolve textos amigáveis para a UI
// =============================================================================
// Espelha client/src/utils/errorMessages.ts. A geração de pergunta pode
// falhar por motivos bem diferentes: filtros vazios, iNaturalist fora do ar,
// rate-limit, sem internet, etc. Cada um merece um título + corpo +
// sugestões específicos.
//
// Uso: `classifyQuizError(error, settings)` devolve `{ icon, title, body,
// hints }` pronto para o cartão de erro.
// =============================================================================

const ALL_GROUPS_COUNT = 9;

function isNetwork(message) {
  return /failed to fetch|networkerror|sem internet|offline|err_internet/i.test(message);
}
function isRateLimit(message) {
  return /429|rate limit|too many requests|aguarde|sobrecarregad/i.test(message);
}
function isInatDown(message) {
  return /http 5\d\d|fora do ar|indisponível|502|503|504|inaturalist retornou/i.test(message);
}
function isNoResults(message) {
  return /não encontrei|sem espécies|filtros muito restritivos|alternativas suficientes|espécies suficientes/i.test(message);
}
function isExpired(message) {
  return /pergunta expirada|expirou|não encontrada/i.test(message);
}

function describeFilters(settings) {
  const parts = [];
  if (settings.taxonLabel) parts.push(`o táxon ${settings.taxonLabel}`);
  if (settings.placeLabel) parts.push(`o local ${settings.placeLabel}`);
  const groups = (settings.iconicTaxa || []).filter((value) => value && value !== 'all');
  if (groups.length > 0 && groups.length < ALL_GROUPS_COUNT) {
    const list = groups.length === 1 ? `o grupo ${groups[0]}` : `os grupos ${groups.join(', ')}`;
    parts.push(list);
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return ` para ${parts[0]}`;
  if (parts.length === 2) return ` para ${parts[0]} e ${parts[1]}`;
  return ` para ${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

function noResultsHints(settings) {
  const hints = [];
  if (settings.taxonLabel && settings.placeLabel) {
    hints.push('Remova o local — provavelmente não há registros desse táxon nesse lugar.');
  } else if (settings.placeLabel) {
    hints.push('Remova ou troque o local.');
  }
  if (settings.taxonLabel) {
    hints.push('Troque o táxon por um mais amplo (família ou ordem).');
  }
  const groups = (settings.iconicTaxa || []).filter((value) => value && value !== 'all');
  if (!settings.taxonLabel && groups.length > 0 && groups.length < ALL_GROUPS_COUNT) {
    hints.push('Adicione mais grupos biológicos.');
  }
  if (hints.length === 0) {
    hints.push('Tente outra dificuldade — pode haver mais variedade.');
  }
  return hints;
}

export function classifyQuizError(error, settings) {
  const raw = error instanceof Error ? error.message : (typeof error === 'string' ? error : '');

  if (isNetwork(raw)) {
    return {
      icon: '📡',
      title: 'Sem conexão',
      body: 'Não consegui falar com o iNaturalist. O navegador pode estar offline ou alguma extensão bloqueando a chamada.',
      hints: ['Verifique a internet.', 'Tente recarregar a página em alguns segundos.']
    };
  }
  if (isRateLimit(raw)) {
    return {
      icon: '⏱',
      title: 'Pediram pra gente esperar',
      body: 'O iNaturalist limitou nossas requisições por instante. É temporário.',
      hints: ['Aguarde 10–20 segundos e tente de novo.']
    };
  }
  if (isInatDown(raw)) {
    return {
      icon: '🛠',
      title: 'iNaturalist instável',
      body: 'A API pública do iNaturalist respondeu com erro. Pode ser manutenção ou pico de uso.',
      hints: ['Tente novamente em alguns minutos.', 'Confirme em inaturalist.org se o serviço está no ar.']
    };
  }
  if (isNoResults(raw)) {
    const filtersText = describeFilters(settings);
    return {
      icon: '🔍',
      title: 'Sem espécies para essa combinação',
      body: filtersText
        ? `Não encontrei observações públicas${filtersText} hoje.`
        : 'Não encontrei observações públicas com esses filtros hoje.',
      hints: noResultsHints(settings)
    };
  }
  if (isExpired(raw)) {
    return {
      icon: '⏳',
      title: 'Pergunta expirou',
      body: 'A pergunta anterior ficou velha demais. Vou gerar uma nova.',
      hints: ['Aperte "Tentar novamente" para continuar.']
    };
  }
  return {
    icon: '⚠',
    title: 'Algo deu errado',
    body: raw || 'Erro inesperado ao gerar a pergunta.',
    hints: ['Recarregue a página.', 'Se persistir, troque os filtros e tente de novo.']
  };
}
