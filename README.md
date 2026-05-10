# iNat Species Quiz — versão estática

Versão **100% cliente** do quiz: apenas HTML + CSS + JavaScript (módulos ES nativos), sem build, sem servidor próprio, sem dependências de runtime. Roda direto no navegador chamando a API pública do iNaturalist.

## Como funciona

A pasta inteira é o site. Estrutura:

```
static/
├── index.html             # ponto de entrada
├── styles.css             # estilos (≈6.000 linhas, mobile-first)
├── js/
│   ├── main.js            # bootstrap, navegação, event delegation
│   ├── state.js           # localStorage (settings, stats, history, cache)
│   ├── inat-api.js        # cliente HTTP do iNaturalist (CORS, rate limit, retry)
│   ├── quiz-engine.js     # geração de pergunta, distratores, display de táxon
│   ├── format.js          # helpers de texto (escape HTML, datas, %)
│   ├── sounds.js          # efeitos sonoros sintetizados via Web Audio API
│   └── views/
│       ├── quiz-view.js     # foto + 4 alternativas + feedback panel
│       ├── settings-view.js # configurações (filtros + busca de táxon/local)
│       └── data-view.js     # estatísticas + histórico paginado
```

Toda a lógica que antes ficava no servidor Express foi portada para o navegador:
geração de perguntas, escolha de distratores por dificuldade, resolução de
nomes populares (incluindo o scrape de HTML como último recurso), cache,
rate limit (mínimo de 350 ms entre requests à API), retry com backoff,
fallback v2 → v1.

Estatísticas, histórico, settings e a fila de perguntas pré-carregadas vivem
em `localStorage`. As respostas JSON do iNat ficam em `sessionStorage`
(memória primeiro, espelho no storage para sobreviver a reload).

## Rodando localmente

Como usa módulos ES nativos, **precisa ser servido por HTTP** (não funciona
abrindo o `index.html` direto pelo `file://`). Qualquer servidor estático serve:

```bash
# Python (vem instalado em macOS, Linux e Windows com Python)
cd static
python -m http.server 8080

# Node (npx, sem instalar nada permanente)
cd static
npx http-server -p 8080

# PHP
cd static
php -S localhost:8080
```

Depois abre `http://localhost:8080` no navegador.

## Publicando no GitHub

1. Cria um repositório novo no GitHub (público se quer usar GitHub Pages grátis).
2. Sobe **só esta pasta** como raiz do repositório, ou sobe o projeto inteiro
   e configura o GitHub Pages para servir a partir dela.
3. Ativa GitHub Pages: **Settings → Pages → Deploy from branch → `main` → `/static`** (ou `/`, dependendo de como subiu).
4. O site fica disponível em `https://<seu-usuario>.github.io/<nome-do-repo>/`.

Como tudo é estático, também funciona sem mudanças em **Netlify**, **Vercel**,
**Cloudflare Pages**, **Surge**, ou qualquer hospedagem de arquivos estáticos.

## Compatibilidade

- **Browsers modernos** (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+).
  Usa Web Audio API, ES Modules, `crypto.randomUUID`, `Intl.DateTimeFormat`.
- **Mobile**: layout mobile-first, gestos de pinch e drag para zoom da foto.
- **Offline parcial**: depois que algumas perguntas pré-carregaram, dá para
  jogar sem rede até o cache esvaziar.

## Diferenças vs. a versão Express + React

- Sem backend → não dá para limitar uso ou anonimizar IP do cliente do iNat.
  Cada visitante chama a API direto. O rate limit no cliente (350 ms) ajuda
  a respeitar o iNat, mas é apenas educacional.
- Sem build/bundling → cada arquivo JS é carregado individualmente. Para um
  app deste tamanho não faz diferença prática (HTTP/2 multiplexa).
- Sem React/Vite → render é via `innerHTML` em template literals, com
  delegação de eventos por `data-action`. Mais código manual, zero deps.
- Mesmas funcionalidades: HUD com pontuação, timer regressivo, dificuldade,
  filtros por grupo/local/táxon, histórico, insights, modal de info da
  observação, sons, vibração tátil, dois temas (escuro/claro).

## Licença

Mesma do projeto principal — ver `../LICENSE`.
