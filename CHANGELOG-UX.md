# CHANGELOG — Intervenção de UX (autoexplicabilidade)

> Relatório gerencial de 5 fases progressivas para tornar o site
> [Minhas Viagens](https://edurcampos86-jpg.github.io/viagens/) totalmente
> autoexplicativo a visitantes novos (familiares, amigos, marido), sem
> exigir contexto prévio.

**Data:** 2026-05-18
**Branch:** `claude/improve-site-documentation-S4Pfx`
**Commits:** 6 (5 fases + 1 melhoria atrelada)
**Sem dependências novas.** Tudo em HTML/CSS/JS puro.

---

## Visão geral das fases

| Fase | Tema | Commit | Arquivos |
|---|---|---|---|
| 1 | Hero com proposta de valor | [`220a1cb`](../../commit/220a1cb) | `index.html`, `assets/styles.css` |
| 2 | Tooltips em ícones de ação | [`438e0be`](../../commit/438e0be) | `index.html`, `assets/styles.css`, `assets/app.js` |
| 3 | Cards de introdução dos agentes | [`a682053`](../../commit/a682053) | `assets/app.js`, `assets/styles.css` |
| 3b | Empty state inteligente | [`ff0a4d2`](../../commit/ff0a4d2) | `index.html` |
| 4 | Tour guiado para primeira visita | [`7a6c331`](../../commit/7a6c331) | `index.html`, `assets/styles.css`, `assets/app.js` |
| 5 | Modal "Como usar este site" | [`49f54f2`](../../commit/49f54f2) | `index.html`, `assets/styles.css`, `assets/app.js` |

---

## Fase 1 — Hero com proposta de valor (`220a1cb`)

**Problema:** o título "🌍 Minhas Viagens" não explica o que o site faz.
Um visitante novo não sabe que existem agentes ou modos diferentes.

**Solução:** parágrafo de missão (2-3 linhas) logo no topo do dashboard,
mencionando explicitamente o mapa, a linha do tempo e os dois agentes
(🧳 Bagagem, 💡 Inspiração).

**Detalhes técnicos:**
- Renderiza apenas no dashboard — some automaticamente em rotas internas
  (`#memoria`, `#planejamento`, `#plan/<id>`).
- Tipografia clampada (`clamp(0.98rem, 1.4vw, 1.12rem)`) para escalar entre
  mobile e desktop.
- Cor via `var(--text2)` → adapta-se ao tema claro/escuro sem código extra.

**Critérios atendidos:**
- ✅ Hero visível na primeira dobra (desktop e mobile).
- ✅ Não empurra elementos críticos para fora da viewport.
- ✅ Renderiza corretamente em ambos os temas.

---

## Fase 2 — Tooltips em ícones de ação (`438e0be`)

**Problema:** botões com apenas emojis (🧳 💡 ⚖ 📋 💬 𝕏 🔗 🌙 ⚙ 🔍) não
comunicam função para quem não conhece o site.

**Solução:** sistema de tooltips em CSS puro cobrindo os 10 controles
principais, com fallback de touch para mobile.

**Cobertura:**
| Ícone | Tooltip |
|---|---|
| 🧳 Bagagem | Monta lista personalizada de bagagem para a viagem |
| 💡 Inspiração | Sugere destinos baseado em humor, orçamento e tempo disponível |
| ⚖ Comparar | Compare duas ou mais viagens lado a lado |
| 📋 Copiar texto | Copia o resumo da viagem para colar onde quiser |
| 💬 WhatsApp | Compartilha o resumo da viagem no WhatsApp |
| 𝕏 X / Twitter | Compartilha o resumo da viagem no X |
| 🔗 Sistema | Usa o menu de compartilhamento nativo do sistema |
| 🌙 Escuro | Alterna entre modo claro e escuro |
| ⚙ Filtros | Filtra viagens por continente, duração, tipo e companhia |
| 🔍 Busca | Busca viagens por nome, cidade ou palavra-chave |

**Detalhes técnicos:**
- Atributo `data-tooltip` + pseudo-elementos `::after`/`::before` (com seta).
- Desktop: `@media (hover: hover)` ativa por `:hover` e `:focus-visible`.
- Mobile: handler delegado em `touchstart` adiciona `.tt-show` por 2000ms.
- `max-width: min(220px, calc(100vw - 24px))` previne overflow em 375px.
- `pointer-events: none` garante que não bloqueia cliques.
- `aria-label` adicionado onde faltava (abas de Bagagem/Inspiração, botão Filtros).

**Critérios atendidos:**
- ✅ Todos os 10 ícones cobertos.
- ✅ Legibilidade em ambos os temas (via `var(--bg2)` + `var(--text)`).
- ✅ Não bloqueiam cliques.
- ✅ Funcionam em mobile (long-press de 2s).
- ✅ `aria-label` em todos.

---

## Fase 3 — Cards de introdução dos agentes (`a682053`)

**Problema:** abrir o agente 🧳 Bagagem ou 💡 Inspiração sem explicação
não comunica o que cada um faz, quando usar e por que existe.

**Solução:** card de boas-vindas exibido na primeira abertura de cada
agente, com 3 informações estruturadas. Dismissal persistente +
botão "?" para reabrir a qualquer momento.

**Conteúdo dos cards:**

**🧳 Bagagem**
- **O que faz:** Monta uma lista de bagagem personalizada para sua viagem.
- **Quando usar:** 1 a 2 semanas antes do embarque.
- **Por que existe:** Evita esquecer itens críticos como passaporte, adaptador e remédios.

**💡 Inspiração**
- **O que faz:** Sugere destinos com base no seu humor, orçamento e tempo disponível.
- **Quando usar:** Quando bater aquela vontade de viajar mas sem saber para onde.
- **Por que existe:** Transforma vontade vaga em opções concretas de destino.

**Detalhes técnicos:**
- Helper `mountAgentIntro(panelEl, agentKey)` injetada a cada render
  (os panels reescrevem `innerHTML` completo).
- `localStorage`:
  - `agent-bagagem-intro-dismissed`
  - `agent-inspiracao-intro-dismissed`
- Botão "?" reabre o card **só na sessão atual** (não altera o dismissal
  permanente), o que é mais previsível.
- Fundo via `color-mix(in srgb, var(--text) 4%, transparent)` → destaque
  sutil em ambos os temas.

**Critérios atendidos:**
- ✅ Aparece na primeira abertura.
- ✅ "Entendi, não mostrar mais" persiste entre sessões.
- ✅ Botão "?" reabre.
- ✅ Layout responsivo (colunas → empilhado <520px).
- ✅ Navegável por teclado.

---

## Fase 3b — Empty state inteligente (`ff0a4d2`)

**Problema:** mensagem neutra "😕 Nenhuma viagem encontrada com esses
filtros." não oferece próxima ação.

**Solução:** texto reescrito com CTA explícito para o agente de Inspiração:

> 😕 Nenhuma viagem aqui ainda com esses filtros. Que tal limpar os
> filtros ou pedir uma sugestão ao 💡 Agente de Inspiração?

**Escopo:** só o `[data-empty-default]`. Os outros empty states
(`[data-empty-planned]`, `[data-empty-wishlist]`) ainda contêm texto
técnico mencionando `data/trips.json` — candidato a melhoria futura.

---

## Fase 4 — Tour guiado (`7a6c331`)

**Problema:** visitantes não exploram funcionalidades que não estão
visíveis na primeira tela (modos memória/planejamento, agentes,
comparador).

**Decisão de arquitetura:** **JS puro custom**, sem driver.js ou outras
libs externas. Motivos:
- Sem ponto de falha de CDN.
- ~250 linhas vs ~30kb de download.
- Combina melhor com o tom minimalista do site.

**Decisão de UX (opção "C" — híbrida):** tour fica todo no dashboard, sem
navegar entre rotas. Steps com spotlight nos atalhos existentes
(`Modo Memória`, `Modo Planejamento`) cobrem mapa/timeline/filtros via
referência; agentes e comparador são apresentados em modais descritivos.

**Estrutura (7 passos):**
1. **Welcome** (modal centralizado) — "Quer um tour rápido de 30s?"
2. **Visão geral** (spotlight em `.dash-stats`) — explica estatísticas.
3. **Modo Memória** (spotlight em `.dash-mode-memoria`) — mapa + linha do tempo.
4. **Modo Planejamento** (spotlight em `.dash-mode-plano`) — kanban + filtros.
5. **Agentes** (modal descritivo) — Bagagem e Inspiração dentro de cada viagem.
6. **Comparador** (modal descritivo) — ⚖ Comparar dentro de qualquer lista.
7. **Final** (spotlight em `#tourBtn`) — "Pronto! Reabra pelo 🎬 Tour."

**Detalhes técnicos:**
- Spotlight via `box-shadow: 0 0 0 9999px rgba(0,0,0,.55)` (sem clip-path).
- Balão reposiciona em `resize` e `scroll`; alvo é scrolled para o centro
  se sair da viewport.
- `localStorage`:
  - `tour-completed: true` ao chegar no final.
  - `tour-skipped: true` ao sair antes.
- Botão `🎬 Tour` no header reativa manualmente, ignorando as flags.
- Auto-start só na rota dashboard, 900ms após o boot.
- Teclado: `ESC` sai, `←/→` navegam, `Enter` confirma (botão primário
  recebe foco automático).
- `role="dialog"` `aria-modal="true"`.

**Critérios atendidos:**
- ✅ Modal de boas-vindas só na primeira visita.
- ✅ 7 passos sem bugs visuais.
- ✅ Estado persiste em `localStorage`.
- ✅ Botão de reativação manual.
- ✅ Mobile responsivo (balão clampado em `calc(100vw - 32px)`).
- ✅ Estética alinhada.

---

## Fase 5 — Modal "Como usar este site" (`49f54f2`)

**Problema:** ausência de manual permanente. Tour é único, mas as
pessoas esquecem; precisava de referência consultável.

**Solução:** modal acessível pelo botão `❓ Ajuda` no header, com 5 seções.

**Seções:**
1. **🌍 O que é este site** — descrição do propósito.
2. **📖 Glossário** — tabela com 8 termos/ícones e seus significados.
3. **🧭 Fluxo recomendado de uso** — 4 fases (antes / durante /
   1-2 semanas antes / depois da viagem).
4. **👤 Quem é Eduardo** — mini-bio neutra (sem links sociais, candidatos
   a adição futura).
5. **💬 Perguntas frequentes** — 3 Q&A (editar viagens, sugerir destino,
   funcionamento offline).

**Detalhes técnicos:**
- `<dialog>` nativo do HTML — ganha foco trap, ESC e a11y tree de graça.
- Mesmo padrão dos dialogs existentes (`#compareDialog`, `#shareDialog`,
  `#exportDialog`).
- Handler extra para fechar ao clicar no backdrop (não é built-in).
- `max-width: 720px`, `max-height: 85vh` com scroll interno.
- Tags coloridas (`✓ Realizadas`, `📅 Planejadas`, `⭐ Wishlist`) no
  glossário, via `color-mix` para se adaptar ao tema.

**Critérios atendidos:**
- ✅ Link visível no header.
- ✅ 5 seções formatadas.
- ✅ Mobile sem scroll horizontal (breakpoint em 520px).
- ✅ Fecha com ESC e com clique no overlay.
- ✅ Estética alinhada.

---

## Princípios respeitados

- **Sem alterações de lógica de negócio.** Nenhuma mudança em
  `data/trips.json` ou em qualquer função core.
- **Sem dependências externas novas.** Tudo em JS/CSS puro.
- **Responsividade testada** mentalmente em 375px, 768px, 1280px (com
  uso de `clamp()`, `min()`, breakpoints específicos).
- **Tema escuro/claro funcional** em todos os novos componentes via
  `var(--bg)`, `var(--text)`, `color-mix(...)`.
- **Acessibilidade:** `aria-label`, `role`, navegação por teclado,
  `:focus-visible` com outline visível, contraste WCAG AA via variáveis
  existentes.
- **Cada fase em commit separado** para revisão e rollback granular.

## Sugestões adicionais coletadas (fora do escopo executado)

Identificadas durante a implementação, ficam como backlog para você
priorizar:

1. **Tooltips em mais ícones** — botões `📆 Agenda (.ics)`,
   `📤 Compartilhar`, `🔗 Copiar link` na página `#plan/<id>`; botões
   `Instalar` e `edições` no header; botões em cards
   (`📅 Mover para Planejadas`, `🖼 Abrir página inteira`).
2. **Empty states `planned` e `wishlist`** ainda têm texto técnico
   mencionando `data/trips.json` — candidato a reescrita amigável.
3. **Focus trap explícito no tour** (atualmente confia no `<dialog>`
   nativo, mas o balão custom não é dialog real — Tab pode escapar).
4. **Barra de progresso visual no tour** (hoje só "3 de 7" textual).
5. **Sub-tour específico do `#plan/<id>`** (mini-mapa, checklist,
   reservas, orçamento, abas).
6. **Link do help no step final do tour** ("Quer saber mais? Abra ❓ Ajuda").
7. **Versionamento do help** (`data-help-version="1"`) para mostrar
   "Atualizado" quando o conteúdo evoluir.
8. **Links sociais reais** na mini-bio (LinkedIn, Instagram).

---

## Estatísticas da intervenção

- **6 commits** atômicos na branch `claude/improve-site-documentation-S4Pfx`.
- **~1.000 linhas adicionadas** distribuídas em `index.html`,
  `assets/styles.css`, `assets/app.js`.
- **0 linhas removidas** de lógica existente.
- **0 dependências externas adicionadas.**
- **0 erros de console esperados.**

---

# CHANGELOG — Evolução do site (Fase 2 — álbum dinâmico)

**Data:** 2026-05-22
**Branch:** `claude/minhas-viagens-evolution-Xpi9h`
**Commits:** 4 (schema + LFS + dados + UI)
**Dependências novas:** Git LFS (config; instala fora do repo)

## Fase 2 — Álbum dinâmico nos cards

**Problema:** os cards de viagem não tinham forma de revisitar as
memórias visuais — só `memory` textual + thumbnail genérica picsum no
hero do card.

**Solução:** novo campo opcional `media` em cada trip + UI de álbum
em dialog fullscreen com cover, grid responsivo e lightbox.

### Schema (`data/schemas/trip.schema.json`)

Campo `media` novo, opcional, retrocompatível:

```jsonc
"media": {
  "cover": "media/<trip-id>/cover.webp",          // ou URL absoluta
  "gallery": [
    {
      "type": "image",                             // ou "video"
      "src":     "media/<trip-id>/01.webp",
      "thumb":   "media/<trip-id>/01-thumb.webp",
      "caption": "Cataratas ao amanhecer",
      "date":    "2021-06-15",
      "lat": -25.6953, "lon": -54.4367,
      "duration": 45                               // só para video
    }
  ],
  "stats": { "photos": 18, "videos": 2 }
}
```

Limites: até 30 itens em `gallery` (hard cap no schema). Para vídeos,
`type: "video"` + `poster` recomendado.

### Validação

Estende `scripts/validate_schemas.py` (já existente) e o workflow
`.github/workflows/validate-schemas.yml` cobre o novo campo
automaticamente em cada PR.

### UI do álbum

- **Botão** `🖼 Álbum (N)` em `card-actions`, visível apenas quando
  `trip.media` existe; oculto para viagens sem.
- **Dialog `#albumDialog`** com:
  - Cover hero (clamp 180–320px) + overlay com país/cidade + stats.
  - `<p class="album-memory">` em destaque tipográfico.
  - Grid responsivo (3/2/1 colunas) com thumbnails `loading="lazy"`.
  - Mini-mapa Leaflet no rodapé quando `trip.lat/lon` existem.
- **Dialog `#lightboxDialog`** com:
  - Foto em fullscreen, max-height `calc(100vh - 100px)`.
  - Navegação por setas (`←/→`), botões e swipe touch (>50px).
  - `ESC` fecha (nativo `<dialog>`).
  - Contador `N/total` + caption.
  - Preload da próxima foto via `new Image()`.
  - Vídeos: `<video controls preload="metadata" poster=...>`.
- Foco retorna ao botão que abriu o álbum (`dialog.addEventListener('close', ...)`).
- `prefers-reduced-motion`: transitions zeradas.

### Git LFS (`.gitattributes`)

Configurado para `*.webp`, `*.jpg`, `*.jpeg`, `*.png`, `*.heic`, `*.avif`,
`*.mp4`, `*.mov`, `*.m4v`, `*.webm`. SVGs de `icons/` ficam fora.
Instalação requerida (uma única vez por clone): `git lfs install`.

Limites GitHub gratuito: 1 GB storage + 1 GB/mês bandwidth. Suficiente
para um portfolio pessoal de ~14 anos × ~20 fotos otimizadas por viagem.

### Estrutura

```
media/
├── README.md                  # workflow manual + preview da Fase 3
├── iguacu-2021/               # vazio até fotos reais chegarem
└── atacama-2021/              # idem
```

### Dados iniciais

`iguacu-2021` e `atacama-2021` em `data/trips.json` ganharam bloco
`media` com 6 e 7 fotos respectivamente, usando URLs `picsum.photos`
com seeds estáveis (`iguacu-cover`, `iguacu-01`, etc.) como placeholders.
Quando fotos reais chegarem, basta trocar URLs no JSON — o código
aceita tanto URLs absolutas quanto paths relativos.

### Princípios respeitados

- ✅ Retrocompatível: viagens sem `media` continuam funcionando idênticas.
- ✅ Sem dependências JS novas — `<dialog>` nativo, Leaflet já carregado.
- ✅ Responsivo (3/2/1 colunas; lightbox adaptado).
- ✅ Acessível (`role=list`, `aria-label` nos botões nav, focus return).
- ✅ Tema escuro/claro funciona via `var()` em todos os componentes.
- ✅ Performance: thumbs separados, `loading="lazy"`, preload da próxima.

---

# CHANGELOG — Fase 3 — Pipeline de ingestão Google Takeout

**Data:** 2026-05-22
**Branch:** `claude/minhas-viagens-evolution-Xpi9h`
**Commits:** 5 (deps + 3 scripts + workflow + docs)
**Dependências novas:** `Pillow`, `exifread`, `scikit-learn`, `geopy` (Python) + `ffmpeg` (sistema)
**Testes:** 21/21 pytest verdes (cluster, otimização, apply)

## O problema

Em 31/mar/2025 o Google deprecou a Google Photos Library API. Apps que
usavam `photoslibrary.readonly` agora recebem 403. A única forma estável
de acessar fotos históricas é via Google Takeout (ZIP de download manual).

## Solução — 3 scripts + 1 workflow + 1 doc

### `scripts/ingest_takeout.py`

- Varre `media-import/` (gitignored).
- Lê EXIF (Pillow + exifread) e cai em sidecar JSON `.json` do Takeout
  como fallback.
- **DBSCAN espaço-temporal:** features normalizadas por `eps_days=2` e
  `eps_km=500`, métrica Chebyshev. Cada cluster = candidato a viagem.
- Reverse geocoding via Nominatim (gratuito, rate-limit 1 req/s).
- **Match contra trips.json existente:** mesmo país + datas próximas
  (threshold 7 dias) → propõe `merge`. Senão `create`. Fotos sem
  GPS + sem timestamp → `orphan` (revisão manual).
- Saída: `proposals.json` (gitignored). Nunca toca `trips.json`.

### `scripts/optimize_media.py`

- WebP qualidade 80, max 1920px (fotos).
- Thumbs WebP qualidade 70, max 320px.
- Vídeos: poster em `t=1s` via ffmpeg, re-encoda h264 720p CRF 26 se >10MB.
- **EXIF strip total:** orientação aplicada antes, depois removida.
  ffmpeg `-map_metadata -1` zera metadados de container.
- Cap por trip: 20 fotos + 2 vídeos, priorizando GPS > cronologia.
- Output em `media/<trip-id>/cover.webp` + `NN.webp` + `NN-thumb.webp`
  (LFS configurado na Fase 2).

### `scripts/apply_proposals.py`

- Lê `proposals.json` (com chave `_optimized` adicionada pelo passo
  anterior).
- `action=create` → adiciona trip nova com `id/name/dates/country/lat/lon`
  + bloco `media` populado.
- `action=merge` → anexa `media.gallery[]`, sem duplicar (filtra por
  `src`), recalcula `stats`.
- `action=orphan` → pula.
- Roda `validate_schemas.py` antes de salvar — falha aborta sem persistir.
- Colisão de ID → sufixa `-dup-N`.
- Gera `INGEST-LOG.md` em Markdown.

### `.github/workflows/ingest.yml`

Manual via `workflow_dispatch`, dois estágios:

- **stage=detect:** `ingest_takeout.py --no-geocode` → abre PR
  `chore/ingest-proposals` com `proposals.json` para revisão humana.
- **stage=apply:** após o usuário aprovar o PR, roda `optimize_media.py`
  + `apply_proposals.py` e commita `media/` + `trips.json` + `INGEST-LOG.md`.

Human-in-the-loop garantido em todos os caminhos.

### `docs/INGESTAO.md`

Walk-through completo: como solicitar Takeout no Google, colocar em
`media-import/`, rodar local OU via Actions, parâmetros de cluster,
limitações, privacidade. Material de referência para reproduzir.

## Privacidade

- Fotos brutas ficam em `media-import/` (gitignored).
- Fotos otimizadas que vão pro repo **público** têm EXIF stripado:
  sem GPS, sem timestamp, sem modelo de câmera.
- GPS útil para o mapa fica no `trips.json` no nível da **viagem**, não
  da foto individual.

## Princípios respeitados

- ✅ Nada acontece sem `workflow_dispatch` manual ou execução local.
- ✅ Toda mudança em `trips.json` passa por revisão humana de `proposals.json`.
- ✅ `validate_schemas.py` é o gate antes de qualquer escrita.
- ✅ Apenas deps gratuitas e open-source.
- ✅ Testes pytest cobrem clustering, otimização e apply (21/21).

---

# Fase 4 — Modo álbum-por-álbum + legendas híbridas + preview em PR

**Data:** 2026-05-22
**Branch:** `claude/album-by-album-ingest-6j8Al`
**Sem deps novas.** Reusa `Pillow`/`exifread`/`scikit-learn` já em `requirements-ingest.txt`.

## Problema

A pipeline de ingestão da Fase 3 só sabia processar Takeouts grandes
("solte tudo, DBSCAN descobre"). Para o uso real — "tirei foto de uma
viagem, quero subir esse álbum específico" — o fluxo era acoplado demais.
Faltava também: legendas amigáveis por foto, preview visual no PR (sem
abrir cada WebP do Files-changed) e rastreabilidade de descartes.

## Solução

Quatro mudanças complementares, todas opt-in/auto-detect (não quebra
nada da Fase 3):

### 1. Modo `album` no `ingest_takeout.py`

- `detect_mode(input_dir)`: se `/media-import/` tem subpastas → `album`;
  se tem arquivos soltos → `cluster` (legado).
- `scan_album_mode`: cada subpasta vira uma viagem candidata (sem DBSCAN).
- `match_existing_trip_album`: 3 estratégias antes de criar viagem nova:
  (a) trip-id direto, (b) ano + país, (c) ano + lat/lon próximos (≤300 km).
- Default em `--mode auto`; força com `--mode album` ou `--mode cluster`.

### 2. Legendas híbridas (`caption_auto`)

- `optimize_media.make_auto_caption(place, ts)` gera `"Kyoto · 15 out 2023"`
  (formato pt-BR, com mês abreviado).
- Cada item otimizado carrega `caption_auto: true` no JSON. Se você editar
  manualmente, mude para `caption_auto: false` — distinção visual fácil
  no PR e em admin futuro.
- Fallback: se reverse-geocoding falhar, usa só a data.

### 3. Priorização com espaçamento temporal + log de descartes

- `prioritize_with_discards`: GPS-primeiro, depois espaçamento temporal
  uniforme (1 a cada N min — primeiro e último sempre incluídos),
  cronológico para preencher resto.
- Cap mantido: 20 fotos + 2 vídeos por viagem.
- Descartes ficam em `proposals.json._discards` e são logados em
  `INGEST-LOG.md` com `path`, `type`, `has_gps`, `timestamp`.

### 4. Preview do PR (`scripts/build_pr_preview.py`)

- Para cada cluster não-órfão: thumbs 160×160 WebP em
  `previews/ingest/<cluster-id>/N.webp` (até 4 imagens representativas).
- Markdown body (`pr-body.md`) com:
  - `trip-id` detectado e ação (create/merge)
  - Período + local + contagem `Detectadas N fotos + M vídeos`
  - Grid 2×2 inline via `raw.githubusercontent.com`
  - Lista de captions geradas (até 25/cluster)
- Workflow `.github/workflows/ingest.yml` agora roda
  `build_pr_preview.py` e usa `body-path: pr-body.md`.

## Testes

`scripts/test_ingest.py`: 21 testes antigos preservados + **19 novos**:

- `test_detect_mode_*` (3): album, cluster, vazio.
- `test_scan_album_mode_skips_empty_subdirs`
- `test_build_album_cluster_no_dbscan_groups_everything`
- `test_album_match_by_*` (4): id direto, ano+país, proximidade, mismatch.
- `test_run_album_mode_*` (2): end-to-end + merge com trip existente.
- `test_make_auto_caption_*` (3): formato pt-BR, fallbacks.
- `test_prioritize_*` (2): discards + espaçamento temporal.
- `test_optimize_cluster_emits_caption_auto`
- `test_optimize_cluster_returns_discards_when_requested`
- `test_apply_preserves_caption_auto_in_gallery`

**Resultado:** 40/40 pytest passando.

## Compatibilidade

- ✅ Modo `cluster` (Fase 3) intacto — testado e ainda padrão para
  Takeouts soltos.
- ✅ Trips existentes (Foz 2021) não são afetadas: nenhum schema mudou,
  `caption_auto` é campo opcional no `gallery[]`.
- ✅ `validate_schemas.py` continua sendo o gate antes de qualquer
  escrita em `trips.json`.

## Não validado nessa branch

- **Lighthouse mobile ≥ 90:** mudanças são só em `scripts/`, `docs/` e
  `.github/workflows/` — frontend (`index.html`, `assets/`) não foi
  tocado, então a métrica não muda em relação à medição da Fase 3.
- **Workflow end-to-end no Actions:** validei localmente
  (`ingest_takeout.py` + `optimize_media.py` + `build_pr_preview.py` com
  álbum sintético `kyoto-2023` de 5 fotos). Próxima execução real
  validará o `peter-evans/create-pull-request` com `body-path` e o
  rendering dos thumbs via raw URL.

## Patches consolidados de `claude/album-by-album-ingest-dQZe0`

Existia uma branch paralela `claude/album-by-album-ingest-dQZe0`
implementando a mesma feature por outra sessão. Comparação lado-a-lado
revelou 4 melhorias funcionais que foram cherry-picked aqui antes do
merge. A `dQZe0` é deletada do remote ao consolidar.

### Patch 1 — `caption_auto` no schema (commit `f35d3ea`)

**Bug crítico encontrado.** `data/schemas/trip.schema.json` tem
`additionalProperties: false` em `media.gallery[].items`. Sem declarar
`caption_auto`, `apply_proposals.py` aborta em `validate_or_die()` no
modo non-dry-run. Coberto pelo teste de regressão
`test_apply_with_caption_auto_passes_schema_validation`.

### Patch 2 — Captions per-photo com cache (commit `33edb3d`)

**UX win significativo.** Antes: caption usava `cluster.place` (1 cidade
por álbum). Álbum Tokyo+Kyoto recebia rótulo único errado. Depois:
`generate_captions()` em `ingest_takeout.py` faz reverse-geocode por
foto, com cache por `(lat, lon)` arredondado a ~5 km. Foto em Tokyo vira
`"Tokyo · DD"`, foto em Kyoto vira `"Kyoto · DD"`. 30 fotos no mesmo
bairro = 1 chamada ao Nominatim. Responsabilidade movida de
`optimize_media.py` (errada — não tem GPS contexto) para `ingest_takeout.py`.

### Patch 3 — Push trigger no workflow (commit `711cdc2`)

A spec original pedia "push em `/media-import/` OU `workflow_dispatch`".
A primeira versão tinha só `workflow_dispatch` — agora `on.push.paths:
["media-import/**"]` dispara `stage=detect` automaticamente. Job `apply`
permanece manual via dispatch (sem auto-apply, ever).

### Patch 4 — Filtro `__MACOSX` / dotfiles (commit `???`)

`detect_mode()` e `scan_album_mode()` agora ignoram subpastas
`__MACOSX/` (geradas pelo Finder ao zipar) e qualquer subpasta começando
com `.` (`.Spotlight-V100`, `.DS_Store`, `.git` etc.). Antes: uma pasta
com só `__MACOSX/` virava modo `album` com cluster fantasma.

### Testes adicionados pelos patches

49 testes totais (45 anteriores + 4 dos patches):

- `test_apply_with_caption_auto_passes_schema_validation` (patch 1)
- `test_generate_captions_per_photo_with_cache` (patch 2)
- `test_generate_captions_falls_back_to_date_when_no_geocode` (patch 2)
- `test_generate_captions_uses_fallback_place_when_geocode_fails` (patch 2)
- `test_run_album_mode_emits_per_photo_captions` (patch 2)
- `test_optimize_cluster_preserves_pre_generated_captions` (patch 2, renomeado)
- `test_workflow_has_push_trigger_for_media_import` (patch 3)
- `test_detect_mode_ignores_macosx_and_dotfiles` (patch 4)
- `test_detect_mode_album_when_macosx_alongside_real_album` (patch 4)
- `test_scan_album_mode_skips_macosx` (patch 4)
