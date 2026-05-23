# Bug: Modo Memória/Planejamento não renderiza + stats zerados

**Branch:** `claude/fix-modo-memoria-render`
**Data do diagnóstico:** 2026-05-23
**Estado:** **Todos os 4 bugs resolvidos** no commit dessa branch. Diagnóstico abaixo preservado por motivos de auditoria.

---

## 1. Sintomas confirmados (Chrome MCP em http://localhost:8000/)

Reproduzido em `localhost` com `python -m http.server 8000` numa aba limpa do Chrome do "casa". Estado da página após boot:

| Verificação | Esperado | Observado |
|---|---|---|
| `#dashStatTrips` (texto) | `41` | `—` |
| `#dashStatCountries` | `21` | `—` |
| `#dashStatContinents` | `5` | `—` |
| `#dashStatKm` | `262` | `—` |
| `#grid > .card` (filtro `all`) | 52 cards | **9 cards** (só `planned`/`wishlist`) |
| `#dashKanban` | populado | vazio |
| `#secCount` | "52 viagens" | string vazia |
| `#ytl` ano "undefined" | não deveria existir | aparece como aba |
| `#yearSlider[max]` | `2028` | **`NaN`** (slider cai para `value=50`) |
| Clique em `<a href="#memoria">` | Modo Memória renderizado | view troca, mas **`#memTimeline` fica vazio** |

Console na carga inicial: **1 warning** (`SecurityError` de Service Worker — escopo errado em `src/main.js:80`, ruído pré-existente) e **zero erros** de JS — o erro real está sendo engolido (ver §3 abaixo).

Console após clicar em Modo Memória: **1 exception** (capturada):

```
TypeError: Cannot read properties of undefined (reading 'map')
    at renderMemTimeline (assets/app.js:2274:30)
    at renderMemoria      (assets/app.js:2228)
    at applyHash          (assets/app.js:2568)
```

Screenshot do estado pós-boot inicial (modal de tour por cima — ver §3): 4 stats em traço, kanban vazio, cards "Modo Memória"/"Modo Planejamento" visíveis.

---

## 2. Causa raiz — **dois bugs distintos**, encadeados

### Bug A (primário, silencioso) — `hydrateCard → populateDiary` quebra no 1º trip `done`

**Local:** [assets/app.js:1191-1195](assets/app.js#L1191) (`populateDiary`).

```js
function populateDiary(node, trip) {
  const hl = node.querySelector('[data-highlights]');     // ← retorna null
  hl.innerHTML = (trip.highlights || []).map(...);        // ← TypeError aqui
  node.querySelector('[data-memory]').textContent = trip.memory || '';
}
```

**Por quê quebra:** o template `#tpl-trip-card` ([index.html:443-504](index.html#L443)) NÃO tem mais nenhum dos atributos `data-highlights`, `data-memory`, `data-log-hotels`, `data-log-restaurants`, `data-log-tips`, `data-cost-total`, `data-cost-bars`, `data-cost-curr`, `data-cost-day`, `data-gallery`, `data-gallery-empty`. O template só tem `data-tabs` e `data-panels` vazios, e `hydrateCard` ([assets/app.js:947-955](assets/app.js#L947)) gera apenas divs vazios `<div data-panel="diary">` etc.

`populatePlanning`/`Checklist`/`Reservations`/`Budget`/`Packing`/`Inspiration`/`Context`/`Route` *scaffoldam* o conteúdo do panel via `panel.innerHTML = ...` antes de mexer. **`populateDiary`/`Logistics`/`Cost`/`Gallery` esquecem desse passo** e assumem placeholders que não existem mais.

**Verificação independente, no console da aba:**
```js
const cloned = document.getElementById('tpl-trip-card').content.firstElementChild.cloneNode(true);
cloned.querySelector('[data-highlights]')   // → null
cloned.querySelector('[data-cost-total]')   // → null
cloned.querySelector('[data-gallery]')      // → null
```

E reproduzindo o passo exato de `populateDiary` num clone do template: `"Cannot set properties of null (setting 'innerHTML')"`.

**Quando esse bug entrou:** o último commit a tocar `data-highlights` no `index.html` foi `d1a91c3 feat(planejadas): reformulação completa da aba de viagens planejadas` — aparentemente removeu os placeholders estáticos do template ao migrar para tabs dinâmicas, mas só atualizou os `populate*` do lado planning, deixando os do lado `done` desatualizados.

**Por que ninguém viu antes:** o erro é **silenciosamente engolido** pelo `.catch()` no fim de `assets/app.js`:

```js
// assets/app.js:3627
boot().then(() => maybeStartTourFirstVisit()).catch(() => maybeStartTourFirstVisit());
```

Como o handler do `.catch` não recebe o erro e nem re-lança, qualquer exceção dentro de `boot()` desaparece. O DevTools não mostra nada. E `maybeStartTourFirstVisit()` chama mesmo no caminho de erro — por isso o tour pop-up aparece "como se" tudo tivesse dado certo (ver screenshot).

**Cadeia de efeitos colaterais (todos derivados desse bug único):**

1. `render()` ([linha 555](assets/app.js#L555)) chama `renderCards(visible)` antes de `renderMapMarkers(visible)`. Como `renderCards` quebra no 10º trip da ordenação (1º com `status:'done'`, que com a sort instável por `NaN` é o `africa-2026`), o resto de `render()` não roda:
   - `renderMapMarkers` não roda → mapa sem pins
   - `el.secCount.textContent = ...` não roda → contador vazio
2. `boot()` interrompe na linha 242, então as linhas 243-244 não rodam:
   - `refreshEditsIndicator()` pulada
   - **`initRouting()` pulada** → `applyHash()` nunca é chamada na carga inicial → `renderDashboard()` nunca roda → 4 stats permanecem como "—" no HTML.

A "intermitência" do mapa que o Eduardo notou bate com isso: o `Array.prototype.sort` recebe comparador que retorna `NaN` para trips sem `year` → ordem **não-determinística entre execuções**. Às vezes a fila de trips ordenados pode ter algum done logo no início e o crash acontece antes de algum future trip ser appendado; outras vezes a sequência de 9 future-trips entra primeiro. Quando o mapa apareceu "com pins corretamente", **provavelmente foi o `memMap` dentro do Modo Memória** (criado por `initMemMap` em [assets/app.js:2231](assets/app.js#L2231)), que roda **antes** do `renderMemTimeline` crashar — então o mapa do modo memória pinta os pins e logo em seguida a timeline-abaixo fica vazia.

### Bug B (secundário, dispara no clique em #memoria) — `renderMemTimeline` quebra com `porAno[NaN]`

**Local:** [assets/app.js:2267-2305](assets/app.js#L2267) (`renderMemTimeline`).

```js
const porAno = {};
for (const t of done) (porAno[t.year] ||= []).push(t);             // ← cria chave "undefined"
const anos = Object.keys(porAno).map(Number).sort((a, b) => b - a); // ← anos contém NaN

container.innerHTML = anos.map(ano => {
  const ents = porAno[ano];                                         // porAno[NaN] === undefined
  const entriesHtml = ents.map(t => { ... });                       // ← TypeError
  ...
}).join('');
```

**Por quê:** as **8 trips agregadoras** adicionadas no PR #38 (`natal-micareta`, `canoa-quebrada-reveillon-cardume`, `florianopolis-micareta`, `mucuge-aniversario`, `brasilia-recorrente`, `nordeste-litoral-recorrente`, `aracaju-familia`, `campos-jordao-recorrente`) têm `status:"done"` mas **não têm `year`**. A linha `(porAno[t.year] ||= [])` cria a chave string `"undefined"`. Depois `Object.keys(porAno).map(Number)` transforma `"undefined"` em `NaN`. No loop seguinte `porAno[NaN]` é `porAno["NaN"]` (não a chave `"undefined"` que foi criada), então retorna `undefined` e `.map(...)` lança.

Esse erro **não** é engolido (não está dentro do `.catch()` de `boot`) — aparece como exception normal no console, como confirmado.

Mas como `showView('memoria')` ([linha 2567](assets/app.js#L2567)) já rodou **antes** do `renderMemoria → renderMemTimeline` quebrar, o `memoriaView.hidden = false` ficou aplicado e o `dashboardView.hidden = true` também. Por isso o sintoma percebido pelo Eduardo é "URL mudou para #memoria mas conteúdo é dashboard" — na verdade a tela já é a do Modo Memória, mas **vazia** (timeline em branco + map pode ou não ter pintado dependendo de qual erro disparou primeiro), o que confunde com "nada aconteceu".

### Bug "C" (cosmético, do mesmo PR #38) — `initYearSlider` quebra com `Math.max(...years)`

**Local:** [assets/app.js:478-484](assets/app.js#L478).

```js
const years = state.trips.map(t => t.year);   // contém vários undefined
const max = Math.max(...years);                // → NaN
el.yearSlider.max = max;                       // → "NaN"
state.filters.maxYear = max;                   // → NaN
```

Não quebra fluxo (NaN é falsy → filtro ignorado em `applyFilters`), mas:
- O `<input type=range>` recebe `max="NaN"`, o browser cai pro default e o `value` foi para **50**.
- `renderYearTimeline` cria uma aba `<button data-year="undefined">undefined</button>` no `#ytl` (vê `ytlYears` no relatório).

Bug B desaparece quando as 8 trips ganharem `year`/`month`. Bug C também. Mas a correção robusta deve **tolerar** trips sem `year` no front-end, dado que o `_schema:2` já entrou e o JSON aceita essas agregadoras sem data por design (são placeholders enquanto o pipeline de EXIF não roda).

---

## 3. Plano de correção (a aprovar antes de aplicar)

Disciplina: **NÃO modificar `data/trips.json`** (combinado no brief). Toda mudança é no front-end (`assets/app.js`) e idealmente no template (`index.html`).

### Fix #1 (Bug A — primário, ~20-30 linhas)
**Em `assets/app.js`:** alterar `populateDiary`, `populateLogistics`, `populateCost`, `populateGallery` para *scaffold* o painel antes de popular — mesmo padrão que `populateRoute`/`populatePlanning` já usam. Exemplo:

```js
function populateDiary(node, trip) {
  const panel = node.querySelector('[data-panel="diary"]');
  if (!panel) return;
  panel.innerHTML = `
    <div class="hlights" data-highlights></div>
    <p class="memory" data-memory></p>
  `;
  panel.querySelector('[data-highlights]').innerHTML =
    (trip.highlights || []).map(h => `<span class="hl">${escapeHtml(h)}</span>`).join('');
  panel.querySelector('[data-memory]').textContent = trip.memory || '';
}
```

Mesmo padrão para `Logistics`, `Cost`, `Gallery`. Total: ~4 funções, ~30 linhas afetadas, **só em `assets/app.js`** (zero mudanças no template).

### Fix #2 (Bug B — memoria, ~5 linhas)
**Em `assets/app.js`** (`renderMemTimeline`, linha 2263): tratar trips sem `year` agrupando-as em um bucket `"sem ano"` (ou descartando, dependendo do que o Eduardo preferir — minha sugestão é **bucket próprio** para não esconder as agregadoras):

```js
const porAno = {};
for (const t of done) {
  const k = (typeof t.year === 'number' && !Number.isNaN(t.year)) ? t.year : '__noyear';
  (porAno[k] ||= []).push(t);
}
const anos = Object.keys(porAno)
  .sort((a, b) => {
    if (a === '__noyear') return 1;                  // ano-desconhecido por último
    if (b === '__noyear') return -1;
    return Number(b) - Number(a);
  });
// no map: usar `ano === '__noyear' ? 'Sem data' : ano` no header da seção
```

### Fix #4 — `invalidateSize` do `#map` principal (Leaflet markercluster em limbo)

**Local:** `showView` em [assets/app.js:2577-2604](assets/app.js#L2577).

**Causa técnica.** Quando `boot()` roda pela primeira vez, a sequência é:

1. `initMap()` cria o `map = L.map('map', …)`. Mas `#map` vive dentro de `#timelineView`, que nasce `hidden=true` no HTML (a view default é o dashboard). Leaflet faz uma medida do container nesse momento — **encontra 0×0** e guarda esse tamanho no estado interno.
2. `render()` roda na sequência. Chama `renderMapMarkers(visible)`, que faz `markerCluster.addLayer(marker)` 52 vezes. Os markers entram na estrutura interna do `markerClusterGroup`, **mas o cluster não os materializa no DOM** porque o map "acredita" que tem 0×0 — não há viewport para projetar lat/lng.
3. Boot termina. Usuário fica no dashboard.
4. Usuário navega para `#linha-do-tempo` → `showView('timeline')` torna `#timelineView` visível, `render()` é chamado de novo no contexto da timeline. Mas: a) `applyHash` roda síncrono, o reflow do `hidden=false` só aplica depois do task atual; b) `markerCluster.clearLayers()` + re-add não dispara recálculo automático de tamanho do map.

Resultado observado: `L.marker` invocado 52 vezes (instrumentei e contei), `markerCluster` aceita os 52 markers, mas `#map .leaflet-marker-pane` fica com **0 filhos no DOM**. Mapa visível só com tiles, sem pins nem clusters.

A "intermitência" que o Eduardo notou antes (mapa apareceu com pins uma vez, depois quebrou) era **outra confusão**: o `memMap` do Modo Memória chama `invalidateSize` explicitamente em `initMemMap` ([assets/app.js:2290](assets/app.js#L2290)), por isso ele sempre funciona quando o usuário entra em `#memoria`. O Eduardo viu o `memMap` populado e atribuiu ao `#map` principal.

**Fix aplicado.** Dentro de `showView`, quando `name === 'timeline'` e `map` já foi inicializado:

```js
if (name === 'timeline' && map) {
  requestAnimationFrame(() => {
    try {
      map.invalidateSize();
      render();
    } catch (e) {
      console.error('[showView] invalidateSize/render falhou:', e);
    }
  });
}
```

Duas escolhas importantes:

- **`requestAnimationFrame` em vez de `setTimeout(0)` ou `setTimeout(100)`** — o RAF dispara antes do próximo paint, depois do reflow do `hidden=false` ter aplicado. É a janela mais cedo possível em que `map._container.offsetWidth/Height` retorna o tamanho real. `setTimeout(100)` (padrão do `initMemMap`) também funcionaria mas adiciona latência visível; `setTimeout(0)` pode disparar antes do reflow.
- **`render()` depois do `invalidateSize`** — só chamar `invalidateSize` não basta. Quando ele dispara, o map percebe que cresceu, mas os markers já foram adicionados ao cluster no tamanho 0×0 e o cluster não recomputa as células. Re-chamar `render()` faz `renderMapMarkers` rodar de novo (`markerCluster.clearLayers()` + addLayer 52×) **agora com o map no tamanho correto**. Verificado: produz 5 pins individuais + 12 clusters no `#map` (= 17 elementos no marker pane, expandindo para 52 totais ao dar zoom).

Cobertura: `showView('timeline')` é chamado a partir dos branches `trip/<id>`, `linha-do-tempo`/`timeline`, e `planned`/`wishlist`/`done` do `applyHash`. Todos passam a ter o map populado. O dashboard, `#memoria` e `#planejamento` não tocam o `#map` (têm map próprio ou nenhum), então não há regressão.

**Verificação após o fix:**

```js
document.querySelectorAll('#map .pin-wrap').length        // → 5
document.querySelectorAll('#map .cluster-wrap').length    // → 12
document.querySelector('#map .leaflet-marker-pane').children.length  // → 17
```

### Fix #3 (Bug C + paliativos defensivos)
- `initYearSlider`: filtrar `years.filter(y => Number.isFinite(y))` antes de `Math.min`/`Math.max`.
- `renderYearTimeline`: mesmo filtro antes de criar abas, ou agrupar `undefined` num bullet "Sem data".
- **Remover o `.catch(() => maybeStartTourFirstVisit())` silencioso em `assets/app.js:3627`** — substituir por:
  ```js
  boot()
    .catch(e => console.error('[boot] falhou:', e))
    .finally(() => maybeStartTourFirstVisit());
  ```
  Isso é o que mais economizaria tempo do Eduardo no futuro. Bugs em `boot()` voltariam a aparecer no DevTools normalmente, e o tour continua disparando.

### Estimativa de tamanho (real, pós-aplicação)
- Fix #1: 4 funções reescritas com scaffold (`populateDiary`/`Logistics`/`Cost`/`Gallery`) — ~50 linhas líquidas adicionadas
- Fix #2: bucket sentinel `__noyear` no `renderMemTimeline` — ~12 linhas
- Fix #3: 3 mudanças pontuais (`initYearSlider`/`renderYearTimeline`/`boot` catch) — ~10 linhas
- Fix #4: bloco de `invalidateSize + render` dentro de `showView` — ~15 linhas (com comentários explicativos)
- **Total: ~87 linhas (+95/−25 no diff final), todas em `assets/app.js`** — 1 arquivo, 1 commit, abaixo do limiar de "complexo".

### Validação executada (todos verdes)
1. `python -m http.server 8000 --directory C:\Users\edurc\Dev\viagens` ✓
2. Abrir `http://localhost:8000/` ✓ (título "🌍 Minhas Viagens")
3. 4 stats: **`41 / 21 / 5 / 262`** ✓
4. `#grid > .card` = **52 cards** ✓
5. **`#map` principal: 5 pins + 12 clusters = 17 elementos no marker pane** ✓ (Fix #4 funcionando); `#memMap` do Modo Memória: 41 markers ✓
6. Modo Memória: 7 year-blocks (`2026, 2025, 2024, 2023, 2022, 2021, "Sem data"`), 41 entries, 8 entries no bucket "Sem data" ✓
7. Modo Planejamento: 3 colunas (3 próximas + 3 confirmadas + 4 wishlist = 10 cards) ✓
8. Voltar dashboard: stats permanecem `41 / 21 / 5 / 262` ✓
9. Console: 0 exceptions; apenas warning pré-existente do SW Workbox em `src/main.js:80` (escopo de registro errado — tangente) ✓

Bônus além dos 9:
- Slider de ano: `max="2028"`, `value="2028"` (antes: `max="NaN"`, `value=50`) ✓
- `#ytl` sem aba "undefined" (antes tinha) ✓

---

## 4. O que NÃO é o bug

- **Não é o `status:"draft"` do `rio-multiplo`:** trips com status fora de `all/done/planned/wishlist` são simplesmente filtradas em `applyFilters` (`if (f.status !== 'all' && t.status !== f.status) return false`). Sem crash.
- **Não é o `_audit_notes`:** o front-end ignora campos extras do JSON. Nenhum `populate*` lê `_audit_notes`.
- **Não é o `_schema:2`:** idem — não há código que valide schema em runtime.
- **Não é o trips.json em si:** o JSON é válido (`Invoke-WebRequest` retorna 200 + 74733 bytes; `JSON.parse` sucede; 52 trips íntegras).
- **Não é o Service Worker:** o warning do SW Workbox em `src/main.js:80` é pré-existente e isolado — não afeta `assets/app.js`.

---

## 5. Status final

**Todos os 4 bugs resolvidos** no commit dessa branch:

| Bug | Sintoma original | Status |
|---|---|---|
| A | Stats em "—", grid com 9 cards (só future), kanban vazio, dashboard meio-renderizado, exception engolida pelo `.catch` | 🟢 Fix #1 (scaffold dos panels) + Fix #3 (`.catch` agora loga) |
| B | Clique em `#memoria` → view trocava mas timeline em branco (`TypeError: porAno[NaN].map`) | 🟢 Fix #2 (bucket `__noyear` + header "Sem data") |
| C | Slider de ano com `max="NaN"`, aba `<button data-year="undefined">` em `#ytl` | 🟢 Fix #3 (`Number.isFinite(y)`) |
| D | `#map` principal sem pins mesmo após `renderMapMarkers` rodar (markercluster em limbo) | 🟢 Fix #4 (`invalidateSize` + re-`render()` via RAF em `showView`) |

Pendência pré-existente NÃO endereçada aqui: `scripts/test_ingest.py::test_optimize_cluster_end_to_end_with_synthetic_photos` falha no Windows por usar `\` em vez de `/` nos paths retornados. Não toca em `assets/app.js`, é um issue de teste no Windows native. Vale follow-up separado.
