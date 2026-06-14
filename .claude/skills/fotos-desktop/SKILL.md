---
name: fotos-desktop
description: >-
  Ingestão desktop das fotos do iPhone que o picker (PR #95) subiu ao Cloudinary.
  Use SEMPRE que o Eduardo colar o bloco JSON exportado pelo picker do celular —
  o que começa com {"tripId": ..., "tripName": ..., "items": [...]} e vem com o
  aviso "cole para o Claude no desktop" — pedindo para gravar/commitar as fotos.
  Também use quando ele disser "ingerir as fotos", "subir o álbum da viagem X",
  "commitar essas fotos do picker" ou variações. A skill baixa os posters,
  funde no trips.json e commita posters + metadado JUNTOS, num PR, sem merge.
---

# Ingestão desktop das fotos do picker (Cloudinary → trips.json)

O picker do celular (PR #95) sobe a mídia ao Cloudinary e exporta um JSON. Esta
skill faz a segunda metade no desktop: baixa o poster `.webp` de cada item,
funde na `media.gallery` da viagem e grava o metadado — **as duas coisas no
mesmo commit** (all-or-nothing). Reproduz a garantia "sem órfão" que antes
vivia no celular.

## Invariantes (não negociáveis)
- **All-or-nothing:** posters e `trips.json` entram no MESMO commit. Se a
  validação falhar, descarta tudo (`git restore`) e NÃO commita nada.
- **Nunca cria viagem:** se o `tripId` do JSON não existe em `trips.json`, o
  script aborta. Não invente viagem.
- **Idempotente:** reexecutar o mesmo JSON cai todo em "dupes" (dedup por
  `source_id`). Re-colar é seguro.
- **Sem bump de service worker:** `data/trips.json` é NetworkFirst e `media/` é
  cache de runtime — nenhum arquivo precacheado muda. NÃO toque em `sw-workbox.js`.
  Se o diff incluir qualquer precacheado (`src/*`, `assets/*`, `index.html`,
  `sw-workbox.js`), PARE: algo está errado.
- **`git add` escopado:** só `data/trips.json` e os posters `media/<trip>/`.
  Nunca `git add -A` (evita o phantom do webp e ruído de ambiente).

## Procedimento

> **Interpretador Python:** use o Python 3 desta máquina. No macOS é `python3`;
> no Windows o `python3` costuma ser um stub da Microsoft Store (sai com erro) —
> use `py -3` (ou `python`). Onde os passos abaixo escreverem `python3`, troque
> pelo que funciona aqui. O mesmo vale para o `venv` do passo 6 (`py -3 -m venv`).

1. **Salve o JSON** colado em um arquivo temporário, ex.: `/tmp/picker.json`.
2. **Recon + branch:** working tree limpo, `git checkout main && git pull --ff-only`.
   Crie a branch: `git checkout -b feat/fotos-<tripId>-<YYYYMMDD>`.
3. **Rode o script** (stdlib pura, sem venv):
   `python3 scripts/ingest_picker_json.py /tmp/picker.json`
   Ele baixa TODOS os posters antes de escrever nada; se um download falhar,
   aborta sem tocar em arquivo. Leia a saída: viagem, quantos entraram, paths.
   - Se imprimir "Nada novo" (tudo dupe), encerre: não há o que commitar.
4. **Guard read-only:** `git status --porcelain`. As mudanças devem ser SÓ
   `data/trips.json` + posters novos em `media/<tripId>/`. Qualquer outro
   arquivo (sobretudo um precacheado) → PARE e reporte.
5. **All-or-nothing no disco:** para cada item novo, confirme que o arquivo de
   poster existe. Faltou algum → `git restore` tudo e PARE.
6. **Valide o schema** no venv (PEP 668 bloqueia o pip do sistema no macOS):
   `python3 -m venv .venv 2>/dev/null; . .venv/bin/activate;`
   `pip install -q jsonschema referencing; python3 scripts/validate_schemas.py`
   Falhou → `git restore data/trips.json` + remova os posters novos + PARE.
7. **Commit junto (a parte que importa):**
   `git add data/trips.json media/<tripId>/`
   `git diff --cached --stat`  (confirme: só esses arquivos)
   `git commit -m "feat(fotos): +N em <tripId> via picker Cloudinary"`
8. **Push + PR, sem merge:** `git push -u origin <branch>` então
   `gh pr create --fill`. PARE no merge. Devolva ao Eduardo o número do PR e o
   resumo (viagem, N fotos/vídeos, cover).
9. Ele revisa o preview (as fotos aparecem na viagem) e mergeia quando aprovar:
   `gh pr merge <N> --squash --delete-branch`.

## Se algo divergir
Pare e reporte. Nunca force, nunca improvise um caminho alternativo. Em dúvida,
o caminho conservador é `git restore` + branch intacta + avisar o Eduardo.
