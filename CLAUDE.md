# Instruções para o Claude Code

> Este arquivo é lido automaticamente em toda sessão nova do Claude Code aberta nesta pasta. Leia inteiro antes de propor qualquer mudança.

## O que este projeto é, hoje

**iNat Species Quiz** — versão **100% estática** (HTML + CSS + JavaScript puro, sem build, sem servidor). Roda direto no navegador, chamando a API pública do iNaturalist. Publicado via **GitHub Pages**.

- Repositório no GitHub: <https://github.com/ViniSouza128/inat-species-quiz>
- Site publicado: <https://vinisouza128.github.io/inat-species-quiz/>
- Branch de produção (= o que está no GitHub Pages): **`main`**
- Stack: HTML + CSS + JavaScript ES Modules. Zero dependências em runtime. Zero build.

## Estrutura da pasta

```
inat-species-quiz/
├── index.html              ← ponto de entrada (a página)
├── styles.css              ← estilos
├── og-image.svg            ← miniatura social (Open Graph)
├── .nojekyll               ← diz ao GitHub Pages para não processar com Jekyll
├── .gitignore
├── LICENSE                 ← MIT
├── README.md               ← documentação principal
├── CLAUDE.md               ← este arquivo
├── js/                     ← módulos JS (quiz-engine, inat-api, views/, etc.)
│
├── _bkp-react-node/        ← BACKUP LOCAL da versão antiga React+Node (gitignored, NÃO está no GitHub)
└── static-screenshots/     ← screenshots do app (gitignored)
```

## Histórico curto (importante saber)

Este projeto teve duas vidas:

1. **Versão 1 (antiga)**: React + TypeScript + Vite no front, Node + Express + SQLite no back. Bem mais complexa.
2. **Versão 2 (atual)**: 100% estática. Tudo o que a versão antiga fazia, esta faz também — sem precisar de servidor.

A versão antiga foi **aposentada** porque era complexa demais para o que o app realmente faz (o backend não guardava nada de útil — só repassava chamadas pro iNaturalist). A versão estática é equivalente em funcionalidade.

**Onde está a versão antiga, caso precise consultar:**
- 📁 Pasta local `_bkp-react-node/` (não vai pro GitHub) — código React+Node completo, navegável.
- 🌿 Branch git `redesign-v2` — backup completo via git, com histórico de commits.

## Regras para o Claude Code

### ✅ FAZER

- Quando o usuário pedir para **"atualizar no GitHub"** / **"subir no GitHub"** / **"publicar"** / similar:
  1. Trabalhar no branch **`main`**.
  2. `git add` os arquivos modificados.
  3. `git commit` com mensagem descritiva em PT-BR.
  4. `git push origin main`.
  5. O GitHub Pages republica automaticamente em ~1 minuto.

- Editar livremente: `index.html`, `styles.css`, `og-image.svg`, qualquer arquivo dentro de `js/`.

- Se precisar consultar como algo funcionava na versão antiga (lógica de quiz, filtros, etc.), abrir `_bkp-react-node/`.

### ❌ NÃO FAZER

- **NÃO reintroduzir build, bundler, ou backend.** Se a tarefa parece exigir isso (ex.: "vamos usar React aqui"), pergunte ao usuário antes — o ponto deste projeto é ficar simples.

- **NÃO commitar a pasta `_bkp-react-node/`.** Ela está no `.gitignore` e deve continuar assim. É só um backup local para o usuário consultar.

- **NÃO mexer no branch `redesign-v2`** sem motivo. Ele é backup permanente da versão antiga.

- **NÃO criar arquivos `.md` de documentação extras** sem o usuário pedir. Este `CLAUDE.md` e o `README.md` bastam.

## Sobre o usuário

O usuário é **leigo em programação** — usa Claude Code para fazer as alterações. Explicar em termos simples, evitar jargão técnico desnecessário, e quando explicar alguma coisa, dar contexto sobre o porquê.

## Comandos úteis (referência)

```bash
# Ver estado do projeto
git status

# Atualizar no GitHub (fluxo padrão)
git add <arquivos>
git commit -m "descrição em PT-BR"
git push origin main

# Rodar localmente (precisa servidor HTTP, não dá pra abrir o index.html direto)
python -m http.server 8080
# ou
npx http-server -p 8080

# Recuperar a versão antiga, caso precise
git checkout redesign-v2     # vai pro branch antigo
git checkout main             # volta pro atual
```
