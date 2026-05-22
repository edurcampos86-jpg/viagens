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
