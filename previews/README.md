# `previews/`

Pasta de protótipos visuais — **não faz parte do site em produção**.

Cada subpasta contém arquivos HTML standalone que carregam dados reais
de `data/trips.json` e renderizam variações de UI / identidade visual
para avaliação antes de virar tema oficial.

## Estrutura

| Pasta | Para que serve |
|---|---|
| `identidade/` | Fase 2a — propostas de identidade visual (paleta + tipografia + layout) |

## Como ver

**Online:** após este PR mergear, os previews ficam servidos pelo
GitHub Pages junto com o site principal:

- `https://edurcampos86-jpg.github.io/viagens/previews/identidade/`

**Local:** rodar um servidor estático na raiz do repo (necessário
porque os HTMLs carregam `data/trips.json` via fetch):

```bash
python -m http.server 8000
# abrir http://localhost:8000/previews/identidade/
```

## Convenções

- Imagens vêm de `https://picsum.photos/seed/{trip.id}/...` enquanto
  o `gallery` real (vindo do sync Google Photos) ainda não está
  populado. Quando estiver, basta trocar o `imgFor()` para usar
  `trip.gallery[0]`.
- Cada preview é **independente**: tem CSS + JS inline ou no mesmo
  diretório. Sem dependência cruzada.
- Arquivos aqui podem ser deletados a qualquer momento sem afetar o
  site em produção (`/index.html`).
