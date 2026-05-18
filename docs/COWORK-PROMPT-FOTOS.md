# Prompt para Claude Cowork — finalizar setup de fotos

> Copie tudo abaixo da linha `---` e cole numa sessão do Claude Cowork rodando
> com acesso à sua máquina e ao GitHub do repo `edurcampos86-jpg/viagens`.

---

# Contexto

Numa sessão anterior (branch `claude/fix-portfolio-photos-c5u20`, já no remoto),
foram implementados dois fluxos de fotos pro portfólio de viagens:

1. **Manual** — `npm run upload -- <slug>` lê `photos-to-upload/<slug>/` e sobe
   pro Cloudinary, populando `data/trips.json`.
2. **Automatizado** — GH Action `sync-photos` lista álbuns do Google Photos,
   casa título com slug de viagem (`prefix-match` estrito), sobe pro Cloudinary
   e abre PR.

Tudo está implementado e com testes unitários passando, mas **não foi testado
end-to-end** porque a sessão anterior não tinha credenciais. Sua missão é
fazer o teste real, validar e mergear pra `main`.

# O que preciso que você faça, na ordem

## 1. Conferir o estado da branch

```bash
git fetch origin
git checkout claude/fix-portfolio-photos-c5u20
git log --oneline -5
```

Deve aparecer os commits `feat(fotos): infra de upload de fotos via Cloudinary`
e `feat(fotos): automação Google Photos → Cloudinary via GitHub Action`.

## 2. Obter credenciais Cloudinary

1. Acesse https://cloudinary.com e crie uma conta gratuita.
2. No dashboard (https://cloudinary.com/console), na seção
   **Product Environment Credentials**, copie:
   - `Cloud name`
   - `API Key`
   - `API Secret`

## 3. Configurar `.env` local

```bash
cp .env.example .env
# edite o .env e cole os 3 valores acima
```

Confirme que `.env` está ignorado pelo git:

```bash
git check-ignore .env  # deve ecoar ".env"
```

## 4. Instalar deps e rodar um teste manual end-to-end

Escolha uma viagem com fotos no seu computador. Eu sugiro `iguacu-2021`
(a primeira do JSON, fotos antigas, baixo risco).

```bash
npm install
mkdir -p photos-to-upload/iguacu-2021
# copie 2-3 fotos pra essa pasta — qualquer formato, qualquer tamanho
# renomeie pra controlar a ordem (01.jpg, 02.jpg, 03.jpg)
npm run upload -- iguacu-2021
```

**Verifique:**
- Output mostra `✓ <filename> (enviada, X MB)` pra cada foto
- Resumo final mostra `Sucesso: N · Falhas: 0`
- `data/trips.json` agora tem `gallery`, `fotos` e `photo` populados pra
  `iguacu-2021`. Rode: `python3 -c "import json; t=[t for t in json.load(open('data/trips.json'))['trips'] if t['id']=='iguacu-2021'][0]; print(json.dumps({'photo': t.get('photo'), 'gallery_count': len(t.get('gallery',[])), 'fotos_count': len(t.get('fotos',[]))}, indent=2))"`

## 5. Rodar a auditoria

```bash
npm run audit
```

Deve listar `iguacu-2021` com `✓ todas N ok` e as outras viagens como `— (sem fotos)`.

## 6. Testar idempotência

Rode `npm run upload -- iguacu-2021` **de novo**. Deve mostrar todas as fotos
como `(reutilizada, …)` em vez de `(enviada, …)`. Se duplicar, é bug — reporte.

## 7. Conferir o site

Abra `index.html` no navegador (ou rode um servidor estático). Vá pra
Foz do Iguaçu:
- Hero deve ter a foto de fundo (em vez de gradiente)
- Aba **📸 Galeria** deve mostrar as fotos
- Card "memórias" no dashboard deve usar a primeira foto

## 8. Adicionar secrets do Cloudinary no GitHub

```bash
gh secret set CLOUDINARY_CLOUD_NAME --body "<cloud_name>"
gh secret set CLOUDINARY_API_KEY --body "<api_key>"
gh secret set CLOUDINARY_API_SECRET --body "<api_secret>"
```

Confirme que os secrets `GOOGLE_*` já existem (do `sync.yml` antigo):

```bash
gh secret list
```

Esperado: ver `CLOUDINARY_*` (novos) e `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN` (já existentes). Se os Google estiverem faltando, rode
`python scripts/auth.py path/to/client_secret.json` localmente e adicione os
3 outputs como secrets.

## 9. Testar a GH Action em dry-run

No Google Photos, **renomeie um álbum existente** pra começar com um slug
real de viagem. Sugestão: pegue um álbum de fotos do Iguaçu (ou crie um
álbum vazio só pra teste) e renomeie pra:

```
iguacu-2021 - Foz do Iguaçu
```

Depois dispare a Action em dry-run:

```bash
gh workflow run sync-photos.yml -f dry_run=true
gh run watch
```

**Verifique o log:** deve listar o álbum encontrado, mapear pra `iguacu-2021`,
e parar sem upload. Se mostrar 0 álbuns mapeados, confira o título do álbum.

## 10. Disparar a Action pra valer (uma viagem só)

```bash
gh workflow run sync-photos.yml -f slug=iguacu-2021
gh run watch
```

Deve abrir um PR `chore/auto-sync-photos`. Confira o diff: as URLs em
`gallery`/`fotos`/`photo` da Iguaçu devem ter mudado de uma transformação
pra outra (ou ficar iguais se as fotos do Google Photos forem as mesmas
que você já subiu manualmente).

Mergeie esse PR.

## 11. Abrir PR da branch principal pra main

```bash
gh pr create --base main \
  --title "feat(fotos): infra Cloudinary + automação Google Photos" \
  --body "Adiciona fluxo manual (npm run upload) e fluxo automatizado
(GH Action sync-photos) para gestão de fotos do portfólio. Detalhes no
commit message e no README atualizado.

Testado end-to-end com Cloudinary real e com a viagem 'iguacu-2021'."
```

Mergeie quando os checks passarem.

## 12. Reportar de volta pra mim

No fim, me mande:
- Quantas fotos foram subidas (manual + via Action)
- Quanto consumiu da quota Cloudinary
- Se algum passo deu problema
- Link do PR final na main

# Se algo der errado

- **`npm install` falha** — confira `node --version` (precisa ≥18).
- **"Credenciais ausentes"** — `.env` na raiz, três `CLOUDINARY_*` preenchidas.
- **GH Action falha em "Run sync_photos"** — abra o log da run. Se a OAuth
  do Google falhar (`invalid_grant`), o refresh token expirou. Rode
  `python scripts/auth.py` localmente de novo e atualize o secret.
- **Action lista 0 álbuns** — pode ser API restriction do Google
  pós-mar/2025. Workaround: usar o fluxo manual.
- **Foto vira `.jpg` no Cloudinary mas vc subiu HEIC** — esperado, `f_auto`
  serve o melhor formato pro navegador. URL é estável.

# Não fazer
- Não commitar `.env` (já está no `.gitignore`).
- Não commitar `photos-to-upload/` (já está no `.gitignore`).
- Não rodar `gh workflow run sync-photos.yml` sem `dry_run=true` na primeira
  vez. A primeira execução real pode subir centenas de MB se você tiver
  vários álbuns matched.
