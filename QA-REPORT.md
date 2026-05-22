# QA-REPORT — Auditoria do Site Público

> Auditoria estática do código (`index.html`, `assets/app.js`, `assets/styles.css`,
> `sw.js`, `src/pwa/sw-workbox.js`, `manifest.webmanifest`, `data/trips.json`).
> Fase 1 do projeto _Evolução do site Minhas Viagens_.
>
> **Data:** 2026-05-22
> **Branch:** `claude/minhas-viagens-evolution-Xpi9h`
> **Escopo:** funcionalidades do site público (não inclui editor inline v2,
> agentes Claude/Supabase, nem backend — esses ficam em `src/components/`,
> `src/agents/`, `backend/`).

## Como esta auditoria foi feita

A maioria dos achados é resultado de **análise estática de código**: ler o
fonte, traçar fluxo, verificar handlers e estado em `localStorage`. Itens
que exigiam validação visual/interativa (Lighthouse, contraste,
touch real, navegação por teclado em browser) estão marcados como
`[carece de teste em browser]` e devem ser confirmados em uma segunda
passada com o site rodando.

## Sumário executivo

| Severidade | Quantidade | IDs |
|---|---|---|
| Crítico | 2 | B1, B2 |
| Alto | 6 | B3, B4, B5, B6, B7, B8 |
| Médio | 8 | B9–B16 |
| Baixo | 5 | B17–B21 |

**Total: 21 achados** distribuídos em 11 das 15 áreas auditadas.

### Resumo das correções aplicadas nesta fase

Status inicial: nada corrigido. Atualize a checklist conforme cada commit `fix(qa): …` for criado.

- [ ] B1 — Empty states do timeline mencionam `data/trips.json` (jargão)
- [ ] B2 — Tour não tem focus trap (Tab escapa do balão)
- [ ] B3 — Dead code de status `em_planejamento` (não existe em trips.json)
- [ ] B4 — `tour-balloon` ignora `prefers-reduced-motion` no `scrollIntoView`
- [ ] B5 — Alerta do dashboard cita `documentos.json` (jargão técnico)
- [ ] B6 — `meta[name=theme-color]` não acompanha toggle manual de tema
- [ ] B7 — Tour não tem barra de progresso visual (só textual)
- [ ] B8 — Sem `<link rel="preload">` em `data/trips.json` (FCP cai)
- [ ] B9 — `renderStats` usa `t.name` em vez de `t.country` p/ contar "Destinos"
- [ ] B10 — Hero background carrega imagem 1800x1000 em mobile sem responsive
- [ ] B11 — Tour não confirma com Enter explicitamente (depende do `focus()`)
- [ ] B12 — `tourReposition` pode entrar em loop se elemento sai da viewport
- [ ] B13 — `<noscript>` mostra texto técnico mencionando `data/trips.json`
- [ ] B14 — Inspiração permite URLs externas sem validar (XSS leve em `src`)
- [ ] B15 — `share-toast` usa `_t` em variável local `toast` indefinida (bug latente)
- [ ] B16 — `sw.js` stub não trata erro se `unregister()` falhar
- [ ] B17 — `manifest.theme_color` (#0369a1) destoa do header coral/sun
- [ ] B18 — Falta `cache-busting` em `assets/app.js` e `assets/styles.css`
- [ ] B19 — `loading="lazy"` ausente nas imagens dos cards hero do dashboard
- [ ] B20 — Tour balloon não tem `aria-labelledby` apontando para `<h4>`
- [ ] B21 — `404.html` não tem link de voltar para o site

---

## 1. Dashboard

### B1 — Empty states do timeline expõem jargão técnico
- **Severidade:** Crítico
- **File:** `index.html:418–429`
- **Problema:** Os blocos `[data-empty-planned]` e `[data-empty-wishlist]` ainda contêm:
  > "Adicione a primeira em `data/trips.json` com `"status": "planned"`."
- **Esperado:** Texto orientado ao visitante final, sem mencionar arquivo
  interno do repo. O `[data-empty-default]` já foi reescrito (Fase 3b
  do CHANGELOG-UX); estes dois ficaram pendentes.
- **Notas:** CHANGELOG-UX.md, linhas 137–143, listou isso como
  "candidato a melhoria futura". Hora de fazer.

### B5 — Alerta do dashboard menciona `documentos.json`
- **Severidade:** Alto
- **File:** `assets/app.js:2092`
- **Problema:** O alerta de passaporte exibe ao usuário:
  > "Validade do passaporte ainda não cadastrada em **documentos.json** — necessária para o Auditor."
- **Esperado:** "Cadastre a validade do passaporte para destrancar o
  Auditor" ou remover (o site público não expõe `documentos.json`).
- **Notas:** Outro vazamento de nome de arquivo no UI público.

### B9 — `renderStats` conta `t.name` em vez de `t.country`
- **Severidade:** Médio
- **File:** `assets/app.js:586`
- **Problema:**
  ```js
  const countries = new Set(visible.map(t => t.name)).size;
  ```
  O label é "Destinos", mas o cálculo soma viagens únicas pelo
  `name`, não por país. Se houver 2 viagens chamadas "Tokyo 2024" e
  "Tokyo 2025", contam como 2 destinos diferentes.
- **Esperado:** Se label é "Destinos" → trocar para "Lugares" e usar
  algo como `t.country || t.sub`. Ou — preferível — manter "Países"
  e usar `t.country`.
- **Notas:** O dashboard top (`renderDashboard`) faz certo (`t.country`,
  linha 2019). Discrepância entre as duas stats bars.

### B10 — Hero background usa imagem 1800x1000 sem responsive
- **Severidade:** Médio
- **File:** `assets/app.js:2001, 2038`
- **Problema:**
  ```js
  const imgUrl = (t.gallery && t.gallery[0]) || `https://picsum.photos/seed/.../1800/1000`;
  $('#dashHeroBg').style.backgroundImage = `url(${imgUrl})`;
  ```
  Em mobile 375px serve uma imagem 1800x1000 (≈300-500KB) só para
  preencher 100vw x 280px. Picsum também não respeita Save-Data.
- **Esperado:** Servir 800x450 em mobile via media query CSS
  (`@media (max-width: 720px) { background-image: ... 800x450 }`)
  ou usar `srcset` em `<img>` real.
- **Notas:** `background-image` em `style` inline impede `loading="lazy"`.

### B19 — `loading="lazy"` ausente em hero do dashboard
- **Severidade:** Baixo
- **File:** `assets/app.js:2001, 2038`
- **Problema:** Mesma raiz que B10 — `background-image` inline não
  pode ser lazy. Cards do timeline já têm `<img loading="lazy">` (linha 1212),
  mas o dashboard hero é decorativo via CSS.
- **Esperado:** Converter para `<img>` semântico com `loading="lazy"`
  ou usar IntersectionObserver para diferir.

## 2. Modo Memória

(Sem achados além de B1.)

## 3. Modo Planejamento

### B3 — Status `em_planejamento` é referenciado mas não existe no dataset
- **Severidade:** Alto
- **Files:**
  - `assets/app.js:1052` (label "Em planejamento")
  - `assets/app.js:1992` (filtro `['planned', 'em_planejamento']`)
  - `assets/app.js:2077` (alerta "sem hospedagem")
  - `assets/app.js:2125, 2289, 2290, 2356, 2369` (kanban)
- **Problema:** `grep "status" data/trips.json` retorna apenas
  `done | planned | wishlist`. Nenhum trip tem `em_planejamento`,
  mas o código trata como se existisse. Resultado: a coluna "Em
  planejamento" do kanban dashboard sempre fica vazia; o alerta "sem
  hospedagem" nunca dispara.
- **Esperado:** Remover `em_planejamento` do código (ou unificar com
  `planned`). Decidir uma estratégia para o sub-status (e.g.,
  `dates.confirmed === false`) e refletir nas duas pontas.
- **Notas:** Provavelmente legado do schema v2 não-completado. Dead
  code visível pelo usuário (coluna vazia confunde).

## 4. Página `#plan/<id>`

(Sem achados específicos confirmados nesta passada estática.
`[carece de teste em browser]` para checklist persistence.)

## 5. Agentes 🧳 Bagagem / 💡 Inspiração

(Lógica de intro cards e localStorage parece correta em `assets/app.js:2872–2930`.
`mountAgentIntro()` reinjeta a cada render — esperado, pois `innerHTML` é
recompletado. Botão `?` reabre só na sessão. `[carece de teste em browser]`
para confirmar.)

### B14 — Inspiração aceita URLs sem validar protocolo
- **Severidade:** Médio
- **File:** `assets/app.js:1532, 1559–1565`
- **Problema:** Em `populateInspiration` o input é `type="url"` (HTML
  valida), mas no submit não há sanitização de protocolo (`javascript:`
  passa pelo `type="url"` em alguns browsers antigos) nem normalização.
  A imagem é renderizada com `<img src="${escapeHtml(src)}">` —
  `escapeHtml` previne XSS no atributo mas não impede
  `src="javascript:alert(1)"` em img (não executa em browser moderno,
  mas é prática frágil).
- **Esperado:** Reforçar com `new URL(value).protocol === 'https:'`
  ou `'http:'` antes de salvar.
- **Notas:** Risco baixo (autor único, dados locais). Mantido por
  higiene.

## 6. Comparador ⚖

(Sem achados confirmados na leitura.)

## 7. Tour guiado

### B2 — Tour não implementa focus trap (Tab escapa)
- **Severidade:** Crítico
- **File:** `assets/app.js:3267–3271`
- **Problema:**
  ```js
  function tourOnKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); tourEnd(...); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tourNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); tourPrev(); }
  }
  ```
  Não há handler para `Tab`. O balão é `role="dialog" aria-modal="true"`
  mas é um `<div>` posicionado fora de `<dialog>`. O usuário tabula
  para fora — o "tour" fica ativo enquanto o foco vai para o botão
  `🎬 Tour` no header (que reativa o tour, causando comportamento
  estranho).
- **Esperado:** Capturar `Tab` no `tourOnKey`, identificar elementos
  focáveis dentro do balão (`.tour-btn`, `.tour-skip`), e ciclar entre
  eles. Devolver foco para `lastFocused` quando o tour fecha.
- **Notas:** CHANGELOG-UX.md, linha 257: já documentado como bug
  conhecido pela equipe.

### B4 — Tour `scrollIntoView` ignora `prefers-reduced-motion`
- **Severidade:** Alto
- **File:** `assets/app.js:3204`
- **Problema:** `target.scrollIntoView({ block: 'center', behavior: 'smooth' })`
  usa `smooth` independentemente da preferência do usuário. O CSS
  trata reduced-motion em outros lugares (linhas 1044 e 3003 de
  `styles.css`), mas o JS não.
- **Esperado:**
  ```js
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block:'center', behavior: reduce ? 'auto' : 'smooth' });
  ```
- **Notas:** WCAG 2.3.3 (Animation from Interactions).

### B7 — Tour sem barra de progresso visual
- **Severidade:** Alto
- **File:** `assets/app.js:3226–3227` (template do balão)
- **Problema:** Mostra "3 de 7" textual. Para 7 passos é OK, mas o
  CHANGELOG-UX.md (linha 259) já apontou que uma barra visual ajuda
  na percepção de progresso.
- **Esperado:** Adicionar `<div class="tour-progress"><div style="width:${pct}%"></div></div>`
  com largura proporcional ao passo atual.

### B11 — Tour não confirma com Enter de forma explícita
- **Severidade:** Médio
- **File:** `assets/app.js:3267–3271`
- **Problema:** O CHANGELOG-UX (linha 178) prometeu "Enter confirma
  (botão primário recebe foco automático)". Funciona por acidente
  (botão primário tem `focus()` em 3248 e Enter ativa botão focado),
  mas se o usuário tabular para `Anterior`, Enter aciona "Anterior",
  não "Próximo". Quebra a expectativa do CHANGELOG.
- **Esperado:** No `tourOnKey`, capturar Enter quando NÃO houver
  botão focado (e.g., após resize) e disparar primário.

### B12 — `tourReposition` pode entrar em loop
- **Severidade:** Médio
- **File:** `assets/app.js:3185–3211`
- **Problema:** Quando `target.scrollIntoView()` é chamado (linha 3204),
  ele dispara o event listener `scroll` que reroda `tourReposition`.
  Se durante o smooth scroll o `rect` ainda está fora da viewport,
  chama de novo. Em condições normais o `requestAnimationFrame` quebra
  o ciclo, mas em mobile com layout shift há risco de loop.
- **Esperado:** Debounce ou flag `isScrolling`.

### B20 — Tour balloon falta `aria-labelledby`
- **Severidade:** Baixo
- **File:** `assets/app.js:3117–3123`
- **Problema:** `aria-live="polite"` está OK, mas `role="dialog"` quer
  `aria-label` ou `aria-labelledby`. O `<h4>` do balão tem o título,
  basta dar `id="tour-title"` e apontar.

## 8. Modal "Como usar"

(`<dialog>` nativo trata ESC. Backdrop click trata. Sem achados.)

## 9. Compartilhamento

### B15 — `setTimeout` salvo na variável errada
- **Severidade:** Médio
- **File:** `assets/app.js:1974–1975`
- **Problema:**
  ```js
  if (toast._t) clearTimeout(toast._t);
  toast._t = setTimeout(() => el.shareToast.classList.remove('show'), 2200);
  ```
  `toast` é o **parâmetro da função** (string da mensagem), não o
  elemento. `toast._t` cria propriedade num primitivo (silenciosamente
  ignorado em strict). Resultado: dois toasts em sequência podem
  sobrepor; o segundo `clearTimeout(undefined)` é noop, mas o timer
  do primeiro continua e pode esconder o segundo antes do tempo.
- **Esperado:**
  ```js
  if (el.shareToast._t) clearTimeout(el.shareToast._t);
  el.shareToast._t = setTimeout(...);
  ```

## 10. Exportar edições

(Sem achados confirmados.)

## 11. PWA & Service Worker

### B6 — `meta[name=theme-color]` não acompanha toggle manual
- **Severidade:** Alto
- **File:** `index.html:6–7`, `assets/app.js` (em `initTheme`/`toggleDark`)
- **Problema:** As duas meta tags usam `media="(prefers-color-scheme: …)"`,
  ou seja, refletem a **preferência do sistema**, não o estado do toggle.
  Quando o usuário troca o tema no botão 🌙/☀, a barra de status do
  mobile não muda.
- **Esperado:** Após `toggleDark`, atualizar dinamicamente:
  ```js
  document.querySelector('meta[name="theme-color"]:not([media])')
    || criar dinâmico, e setar `content` p/ `#fff8ee` ou `#0e1a26`.
  ```

### B16 — `sw.js` stub não trata erro no `unregister()`
- **Severidade:** Médio
- **File:** `sw.js:8–20`
- **Problema:** A IIFE assíncrona em `activate` faz
  `await self.registration.unregister(); …; for (const c of clients) c.navigate(c.url);`
  Se `unregister()` rejeitar (improvável mas possível em iOS antigo),
  o `for` ainda navega — comportamento inconsistente. Não é grave
  mas é uma armadilha de manutenção.
- **Esperado:** `try/catch` ao redor do bloco; se falhar, deixa o SW
  velho ativo até a próxima tentativa.

### B18 — Sem cache-busting em `assets/app.js` e `assets/styles.css`
- **Severidade:** Médio
- **File:** `index.html:31, 656`, `src/pwa/sw-workbox.js:35–43`
- **Problema:** Os arquivos são servidos sem query string de versão.
  O SW Workbox usa `StaleWhileRevalidate` (linhas 36–43 do
  `sw-workbox.js`), que serve a versão antiga e atualiza em segundo
  plano. Resultado: após um deploy, o primeiro load mostra versão
  antiga; o segundo, a nova.
- **Esperado:** No build (ou no commit), gerar
  `assets/app.js?v=<hash>` (manual ou via `vite build`). Alternativa:
  trocar estratégia para `NetworkFirst` com timeout curto (~2s) só
  em deploy days.

### B17 — `manifest.theme_color` destoa da identidade visual
- **Severidade:** Baixo
- **File:** `manifest.webmanifest:10`
- **Problema:** `"theme_color": "#0369a1"` (azul). O resto do site usa
  paleta coral/cream (`#ff5c3d`, `#fff8ee`).
- **Esperado:** Alinhar com `#fff8ee` (light) ou `#ff5c3d` (primary).

## 12. Responsividade

`[carece de teste em browser]` — viewport real é necessário para
validar 375px, 768px, 1280px, 1920px e tooltips long-press 2s.

## 13. Acessibilidade

Achados verificados:
- ✅ `skip-link` presente (`index.html:35`).
- ✅ `aria-label` em todos os `.icon-btn` (linhas 44–60).
- ✅ `aria-pressed` no botão de tema.
- ✅ `role="tablist"` + `aria-selected` em filtros e abas.
- ✅ `:focus-visible` parece coberto no CSS.
- ⚠ B2 e B20 (tour) acima.
- `[carece de teste]` contraste WCAG AA real, screen reader,
  navegação por teclado.

## 14. Tema claro/escuro

Achados:
- ✅ `data-theme` é a fonte da verdade.
- ⚠ B6 acima (meta theme-color não acompanha).
- `[carece de teste]` validação visual em todos os componentes
  novos (`tour-balloon` tem ramo `[data-theme="dark"]` em
  `styles.css:3127` — bom sinal).

## 15. Performance

### B8 — Falta `<link rel="preload">` para `data/trips.json`
- **Severidade:** Alto
- **File:** `index.html:18–31`
- **Problema:** O `trips.json` (~62KB) é o dado crítico para a primeira
  pintura útil do dashboard. Mas é carregado por `fetch` dentro de
  `boot()` em `assets/app.js`, **depois** do parsing do JS. Isso
  significa que o navegador só descobre a necessidade do JSON tarde,
  bloqueando o FCP.
- **Esperado:**
  ```html
  <link rel="preload" href="data/trips.json" as="fetch" crossorigin="anonymous">
  ```
  Junto com o `preconnect` ao `unpkg.com`.

### Outros (já cobertos por outros bugs)
- B10/B19 — imagens responsivas e lazy do dashboard hero.
- B18 — cache-busting.

## Outros achados pontuais

### B13 — `<noscript>` mostra texto técnico
- **Severidade:** Baixo
- **File:** `index.html:647–652`
- **Problema:** Quando JS está desabilitado, exibe:
  > "As viagens estão armazenadas em `data/trips.json`."
  É a única mensagem que o visitante recebe e cita arquivo interno.
- **Esperado:** "Para a melhor experiência, habilite JavaScript. Você
  pode também navegar pelo perfil em [link]."

### B21 — `404.html` é minimalista demais
- **Severidade:** Baixo
- **File:** `404.html`
- **Problema:** Página de erro sem link para a home; usuário precisa
  editar URL manualmente.
- **Esperado:** Adicionar `<a href="/">Voltar ao início</a>`.

---

## Itens NÃO auditados nesta passada

Estes pontos do checklist exigem ambiente de browser real e ficam para
a etapa de validação manual:

1. **Lighthouse mobile** — sem ambiente para rodar.
2. **Contraste WCAG AA** — exige analisador visual.
3. **Tooltips long-press 2s em touch real** — código está presente
   (`app.js:3334–3344`), mas só teste em device confirma.
4. **Mapa navegável em mobile** — Leaflet em pinch/zoom de iOS/Android.
5. **`navigator.share` (Web Share API)** — só funciona em HTTPS
   com Safari iOS / Chrome Android.
6. **Checklist persistence em `#plan/<id>`** — `loadTripState` /
   `saveTripState` aparentam corretos em `app.js:148–162`,
   confirmação no browser.
7. **Service Worker race condition** — sequência `sw.js → unregister →
   src/main.js → register Workbox` parece OK mas precisa DevTools
   Application tab para verificar.

## Próximos passos (Fase 1 — execução)

Plano de correção em commits atômicos:

1. `fix(qa): empty states sem jargao tecnico` (B1, B13)
2. `fix(qa): alerta de passaporte sem jargao` (B5)
3. `fix(qa): focus trap no tour guiado` (B2)
4. `fix(qa): prefers-reduced-motion no tour scrollIntoView` (B4)
5. `fix(qa): barra de progresso no tour` (B7)
6. `fix(qa): Enter ativa proximo no tour mesmo sem foco` (B11)
7. `fix(qa): debounce em tourReposition` (B12)
8. `fix(qa): aria-labelledby no balao do tour` (B20)
9. `fix(qa): meta theme-color acompanha toggle de tema` (B6)
10. `fix(qa): preload de trips.json` (B8)
11. `fix(qa): remover dead code de em_planejamento` (B3)
12. `fix(qa): renderStats conta paises corretamente` (B9)
13. `fix(qa): shareToast usa elemento, nao string` (B15)
14. `fix(qa): manifest theme_color alinhado a identidade` (B17)
15. `fix(qa): sw.js trata erro em unregister` (B16)
16. `fix(qa): 404 com link de retorno` (B21)
17. `fix(qa): validar protocolo em URLs de Inspiracao` (B14)
18. `chore(qa): cache-bust assets via query string` (B18)
19. `perf(qa): imagens responsivas no dashboard hero` (B10, B19)
20. `docs(qa): relatorio final + sumario executivo`

Após cada commit, marcar checkbox no topo deste relatório.
