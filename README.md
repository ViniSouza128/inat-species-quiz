# iNat Species Quiz

Quiz local, em português do Brasil, para adivinhar espécies a partir de fotos de observações públicas do [iNaturalist](https://www.inaturalist.org/).

O jogador vê uma foto real, escolhe entre quatro alternativas e recebe feedback com o nome popular em PT-BR (quando disponível), nome científico, local aproximado, data, autoria, licença da foto e link para a observação original.

🌐 **Jogar online:** <https://vinisouza128.github.io/inat-species-quiz/>

## Como funciona

Projeto **100% cliente**: apenas HTML + CSS + JavaScript (módulos ES nativos), sem build, sem servidor próprio, sem dependências de runtime. Roda direto no navegador chamando a API pública do iNaturalist.

```
inat-species-quiz/
├── index.html             # ponto de entrada
├── styles.css             # estilos (~6.000 linhas, mobile-first)
├── og-image.svg           # miniatura social (Open Graph)
└── js/
    ├── main.js            # bootstrap, navegação, event delegation
    ├── state.js           # localStorage (settings, stats, history, cache)
    ├── inat-api.js        # cliente HTTP do iNaturalist (CORS, rate limit, retry)
    ├── quiz-engine.js     # geração de pergunta, distratores, display de táxon
    ├── format.js          # helpers de texto (escape HTML, datas, %)
    ├── sounds.js          # efeitos sonoros sintetizados via Web Audio API
    └── views/
        ├── quiz-view.js     # foto + 4 alternativas + feedback panel
        ├── settings-view.js # configurações (filtros + busca de táxon/local)
        └── data-view.js     # estatísticas + histórico paginado
```

Estatísticas, histórico, settings e a fila de perguntas pré-carregadas vivem em `localStorage`. As respostas JSON do iNat ficam em `sessionStorage` (memória primeiro, espelho no storage para sobreviver a reload).

## Rodando localmente

Como usa módulos ES nativos, **precisa ser servido por HTTP** (não funciona abrindo o `index.html` direto pelo `file://`). Qualquer servidor estático serve:

```bash
# Python (vem instalado em macOS, Linux e Windows com Python)
python -m http.server 8080

# Node (npx, sem instalar nada permanente)
npx http-server -p 8080

# PHP
php -S localhost:8080
```

Depois abre `http://localhost:8080` no navegador.

## Publicado no GitHub Pages

O site é publicado automaticamente pelo GitHub Pages a partir do branch `main` deste repositório. Qualquer commit que vai pra `main` é re-publicado em ~1 minuto.

Como tudo é estático, também funciona sem mudanças em **Netlify**, **Vercel**, **Cloudflare Pages**, **Surge**, ou qualquer hospedagem de arquivos estáticos.

## Funcionalidades

- 4 níveis de dificuldade (fácil, normal, difícil, expert)
- Filtros por grupo taxonômico (aves, mamíferos, répteis, anfíbios, peixes, insetos, aracnídeos, plantas, fungos)
- Filtros por localidade (busca via iNaturalist)
- Filtros por táxon específico (múltipla seleção)
- Sistema de dicas (2 níveis por pergunta)
- Pontuação com bônus de tempo e de sequência (streak)
- Atalhos de teclado: `1`/`2`/`3`/`4` para responder, `D` para dica, `S`/`Enter` para próxima, `I` para info
- Histórico e estatísticas (acerto, melhor sequência, total de questões)
- Tema escuro/claro
- Layout mobile-first com gestos de pinch e drag para zoom da foto
- Sons sintetizados e vibração tátil opcionais

## Compatibilidade

- **Browsers modernos** (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+). Usa Web Audio API, ES Modules, `crypto.randomUUID`, `Intl.DateTimeFormat`.
- **Mobile**: layout mobile-first, gestos de pinch e drag para zoom da foto.
- **Offline parcial**: depois que algumas perguntas pré-carregaram, dá para jogar sem rede até o cache esvaziar.

## Histórico do projeto

Este repositório teve uma versão anterior baseada em React + Vite no front e Express + SQLite no back. Foi aposentada porque a complexidade extra não trazia funcionalidades novas — o backend só repassava chamadas pro iNaturalist. A versão atual é equivalente em features e bem mais simples de manter.

A versão antiga continua acessível no branch `redesign-v2` para consulta histórica.

## Licença

[MIT](./LICENSE) — código aberto. As fotos do quiz vêm do iNaturalist e mantêm a licença original de cada observador.
