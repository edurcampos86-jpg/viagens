# Prompt para Claude Code — aplicar refresh do Claude Design

Use esse prompt quando você gerar uma nova versão do site no
[Claude Design](https://claude.ai/design/) e quiser aplicar ao repo
sem perder os fixes locais (`patches.css`, `sketchy-extras`,
auto-sync de Gmail/Photos).

Cole o bloco abaixo numa sessão do **Claude Code** rodando dentro da
pasta local do repo `viagens`:

---

```
Quero importar a versão mais recente do site a partir do Claude Design
e deployar via PR + merge em main. Você vai me guiar passo a passo.

CONTEXTO DO REPO (importante — não revertas sem perguntar):

  Arquivos que JÁ ESTÃO CERTOS e devem ser preservados intactos:
    - assets/patches.css           — overrides com !important (PR #8)
    - assets/sketchy-extras.css    — features Fase 2
    - assets/sketchy-extras.js     — features Fase 2 (banner 5 anos,
                                     lightbox, diário, galeria, países
                                     pintados, importador)
    - .github/workflows/sync.yml   — auto-sync Gmail/Photos (PR #9)
    - scripts/*.py                 — toolchain do sync
    - docs/                        — esse próprio guia + SETUP
    - data/sync-state.json         — marker do sync
    - data/trips.json              — dados das minhas viagens
                                     (NÃO sobrescrever sem confirmação
                                     explícita)
    - icons/*                      — assets fixos
    - .gitignore                   — block secrets
    - manifest.webmanifest         — pode atualizar se o Design mudou
                                     metadados

  Arquivos que provavelmente vão ser atualizados pelo Design:
    - index.html
    - assets/styles.css
    - assets/app.js
    - assets/sketchy.css
    - assets/sketchy.js

  Estrutura DO index.html que DEVE ser preservada (Design tende a omitir):

    No <head>, nessa ordem, as 4 stylesheets locais:
      1. <link rel="stylesheet" href="assets/styles.css">
      2. <link rel="stylesheet" href="assets/sketchy.css">
      3. <link rel="stylesheet" href="assets/sketchy-extras.css">  ← Fase 2
      4. <link rel="stylesheet" href="assets/patches.css">         ← durable, por último

    Antes de </body>, nessa ordem, os scripts locais:
      1. <script src="assets/app.js" type="module"></script>
      2. <script src="assets/sketchy.js" defer></script>
      3. <script src="assets/sketchy-extras.js" defer></script>    ← Fase 2

    Se o index.html novo NÃO TEM alguma dessas linhas, ADICIONA antes
    de mergear (mesmo se isso significar editar o que veio do Design).

    A <html> tag deve ter data-theme="sketchy" como padrão.

  Sintomas de regressão silenciosa que você deve detectar:
    - Sem link de patches.css → stats voltam a ter gradient arco-íris,
      linha do tempo dos anos renderiza vertical
    - Sem link de sketchy-extras.css → banner 5 anos + diário + galeria
      perdem o visual
    - Sem script de sketchy-extras.js → banner 5 anos some completamente,
      lightbox não abre, diário não é editável

ROTEIRO QUE QUERO QUE VOCÊ SIGA:

[fase 0] Sanity
  - pwd, git status, git branch --show-current
  - Confirma que estou na raiz do repo viagens, em main, sem mudanças
    locais
  - git pull origin main → sincroniza

[fase 1] Como vamos receber o conteúdo do Design?
  Pergunte:
    (a) "Você baixou um arquivo (.html, .zip)?" → caminho no Mac
    (b) "Copiou o código do botão </> do Claude Design?" → pbpaste
    (c) "Tem outro método (gist, raw URL)?"
  Espera minha resposta.

[fase 2] Captura
  Caso (a): unzip em /tmp/viagens-new/ ou copia o arquivo único.
            Verifica integridade.
  Caso (b): pbpaste > /tmp/viagens-new/index.html. Pergunta se tem
            mais arquivos pra colar (sketchy.css, sketchy.js, etc.)
            — pra cada um, eu copio no browser, te aviso, e você faz
            pbpaste no caminho certo.
  Caso (c): segue o método indicado.
  Resultado: /tmp/viagens-new/ contendo TODOS os arquivos que vieram
  do Design.

[fase 3] Validação dos arquivos novos
  Pra cada arquivo recebido:
    - Verifica que é UTF-8 (file -bi)
    - Se HTML: html.parser do Python pra sintaxe básica
    - Se JSON: node -e "JSON.parse(require('fs').readFileSync('x'))"
    - Se JS: node --check
    - Se CSS: contagem de {} balanceada via python

  Reporta resumo: "Validados N. M com aviso. K com erro."
  Se tiver erro fatal, pare.

[fase 4] Diff vs main
  Pra cada arquivo novo, mostra `diff <atual> <novo> | head -80`.
  Eu olho e confirmo seguir.

  CHECKS OBRIGATÓRIOS no index.html novo (eu mesmo vou pedir pra você
  fazer cada um e me reportar):
    a) Tem <link> de assets/styles.css?
    b) Tem <link> de assets/sketchy.css?
    c) Tem <link> de assets/sketchy-extras.css?   ← OFTEN MISSING
    d) Tem <link> de assets/patches.css?          ← OFTEN MISSING
    e) Tem <script> de assets/app.js?
    f) Tem <script> de assets/sketchy.js?
    g) Tem <script> de assets/sketchy-extras.js?  ← OFTEN MISSING
    h) <html> tag tem data-theme="sketchy"?

  Pra cada um que está faltando, mostra exatamente onde vai inserir
  (antes/depois de qual elemento) e me pede confirmação antes de mexer.

  PARAR E PERGUNTAR se:
    - data/trips.json vier no pacote — substituir pode apagar minhas
      memórias e logística manual (default: manter atual)
    - assets/patches.css vier no pacote — em geral preferimos manter
    - sync.yml, scripts/, docs/ vierem no pacote — Design não deveria
      mexer; suspeitamos

[fase 5] Aplicar
  Cria branch: git checkout -b claude/design-refresh-$(date +%y%m%d-%H%M)
  Copia arquivos de /tmp/viagens-new/ pra repo (preservando estrutura).
  Aplica patches no index.html pra cada link/script faltante (fase 4).
  git add -A; git status pra confirmar o que vai entrar.

[fase 6] Commit + PR
  Mensagem:
    "design: refresh from Claude Design (<timestamp>)
    
    Files updated: <lista>
    Files preserved: <lista dos preservados>
    Re-added: <lista das tags re-inseridas>"

  git push -u origin <branch>
  Com gh CLI: cria PR e pergunta se mergeio (com --squash).
  Sem gh: imprime URL pra abrir manual.

[fase 7] Pós-deploy
  - Espera ~90s
  - curl em raw.githubusercontent.com confirma main atualizada
  - Lembra que Pages publica em ~30-90s adicional
  - Me diz pra abrir https://edurcampos86-jpg.github.io/viagens/ e
    checar visualmente:
      * Banner dos 5 anos visível (entre stats e chips de marco)
      * Stats em Caveat coral (sem arco-íris)
      * Linha do tempo horizontal
      * Tema sketchy ativo por padrão
      * Clicar numa foto abre lightbox
      * Painel "Diário" tem text area editável

REGRAS:
- Nunca apague data/trips.json sem confirmação dupla
- Nunca remova assets/patches.css, sketchy-extras.css ou sketchy-extras.js
- Não rode `git push --force` em nenhum caso
- Se algo der erro inesperado, pare e me mostre — não tente "consertar"
- Para a qualquer momento se eu mandar; te dou novo comando

Comece pela fase 0.
```

---

## Histórico dos PRs que motivaram cada salvaguarda

- **PR #5 / PR #7**: a CSS do tema `sketchy` referenciava classes antigas
  (`.stat-v`, `.yl-item`, `.yl-dot`, `.yl-yr`) que o `app.js` não renderiza
  mais. Resultado: rainbow gradient leaks + linha do tempo vertical.
- **PR #8**: criou `assets/patches.css` como override durável com
  `!important` — sobrevive a substituições do `sketchy.css`.
- **PR #11**: Design refresh omitiu os `<link>` de `sketchy-extras.css` e
  `patches.css` no `index.html`.
- **PR #12**: Design refresh também omitiu o `<script>` de
  `sketchy-extras.js`, derrubando banner 5 anos / lightbox / diário /
  galeria.

A lista de checks na fase 4 reflete essas lições.
