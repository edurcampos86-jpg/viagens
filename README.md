# Minhas Viagens

Portfólio estático de viagens hospedado em GitHub Pages, com dados em `data/trips.json` e renderização em `index.html` + `assets/app.js`.

## Estrutura do repositório

- `index.html`, `assets/` — site estático (HTML + JS + CSS)
- `data/trips.json` — fonte única das viagens (schema em `data/schemas/`)
- `scripts/` — toolkit Python (sync, curador, auditor) + scripts Node (fotos)
- `photos-to-upload/` — pasta local **ignorada pelo git** com fotos brutas a subir

---

## Gestão de fotos (Cloudinary)

Todas as fotos do portfólio ficam centralizadas no [Cloudinary](https://cloudinary.com) (tier gratuito). O fluxo é totalmente automatizado: você joga uma pasta de fotos local e um script Node faz upload, gera URLs otimizadas, e atualiza `trips.json`.

### Setup inicial (uma vez só)

1. **Criar conta gratuita no Cloudinary:**
   - Acesse https://cloudinary.com e clique em **Sign up for free**.
   - Após login, vá ao dashboard: https://cloudinary.com/console
   - Na seção **Product Environment Credentials** copie:
     - `Cloud name`
     - `API Key`
     - `API Secret`

2. **Configurar credenciais locais:**
   ```bash
   cp .env.example .env
   # edite o .env e cole os três valores acima
   ```
   O `.env` está no `.gitignore` — nunca vai pro repositório.

3. **Instalar dependências Node (precisa Node 18+):**
   ```bash
   npm install
   ```

### Dois fluxos: manual (iCloud + qualquer pasta) e automatizado (Google Photos)

| Fluxo | Quando usar | Script |
| --- | --- | --- |
| **Manual** | Fotos do iPhone/iCloud, câmera, WhatsApp, qualquer pasta no PC | `npm run upload -- <slug>` |
| **Automatizado** | Você organiza por álbum no Google Photos | GitHub Action `sync-photos` |

iCloud não tem API pública estável, então o fluxo manual cobre esse caso (e qualquer outro). Google Photos tem álbuns e API — é o que vale a pena automatizar.

---

### Fluxo manual — `npm run upload`

Suponha que você acabou de voltar de Bruxelas e a viagem tem `id: "brussels-2026"` em `data/trips.json`.

1. **Criar a pasta local com as fotos:**
   ```bash
   mkdir -p photos-to-upload/brussels-2026
   # copie suas fotos pra lá (qualquer nome, qualquer resolução)
   ```
   A ordem das fotos no site será a ordem alfabética dos nomes dos arquivos — renomeie pra controlar (`01-grand-place.jpg`, `02-atomium.jpg`, …).

2. **Subir e atualizar `trips.json`:**
   ```bash
   npm run upload -- brussels-2026
   ```
   O script:
   - Sobe cada foto pra `viagens/brussels-2026/` no Cloudinary
   - Aplica `quality: auto` e `fetch_format: auto` (servido como WebP/AVIF)
   - Gera URL otimizada de até 1600px de largura preservando aspect ratio
   - Sobe em paralelo (5 simultâneas) com tratamento de erro por arquivo
   - É **idempotente**: rodar de novo não duplica fotos já subidas
   - Atualiza `data/trips.json` populando `gallery`, `fotos` e `photo` da viagem

3. **Conferir que está tudo acessível:**
   ```bash
   npm run audit
   ```
   Lista todas as viagens com nº de fotos e HEAD-checa cada URL (timeout 3s). Não modifica nada.

4. **Publicar:**
   ```bash
   git add data/trips.json
   git commit -m "Fotos de Bruxelas 2026"
   git push
   ```
   GitHub Pages atualiza automaticamente — as fotos aparecem no site.

### Como o script grava as URLs no JSON

Cada viagem ganha três campos preenchidos com as mesmas URLs (em ordem alfabética dos arquivos):

```json
{
  "id": "brussels-2026",
  "photo": "https://res.cloudinary.com/.../viagens/brussels-2026/01-grand-place.jpg",
  "gallery": [
    "https://res.cloudinary.com/.../viagens/brussels-2026/01-grand-place.jpg",
    "https://res.cloudinary.com/.../viagens/brussels-2026/02-atomium.jpg"
  ],
  "fotos": [
    { "url": "https://res.cloudinary.com/.../01-grand-place.jpg", "destaque": true },
    { "url": "https://res.cloudinary.com/.../02-atomium.jpg" }
  ]
}
```

- `gallery` (strings) é o que o `app.js` lê hoje pra galeria e thumbnails.
- `fotos` (objetos) é o formato canônico do `data/schemas/trip.schema.json`.
- `photo` é a capa do hero (primeira foto).

---

### Fluxo automatizado — Google Photos via GitHub Action

A GitHub Action `sync-photos` roda mensalmente (dia 1, 04:13 UTC) e pode ser disparada à mão. Ela:

1. Lista todos os álbuns do seu Google Photos.
2. Para cada álbum cujo **título começa com o slug de uma viagem** em `trips.json`, baixa todas as fotos.
3. Envia cada foto pro Cloudinary (sob `viagens/<slug>/`).
4. Popula `gallery`, `fotos` e `photo` da viagem.
5. Abre um Pull Request com as mudanças pra você revisar e mergear.

#### Setup inicial (uma vez só)

1. **OAuth Google** — siga o `scripts/auth.py` (mesmo refresh token usado pelo `sync.yml` existente; se já configurou esse, está pronto):
   ```bash
   python scripts/auth.py path/to/client_secret.json
   ```
   Copie os três valores impressos como secrets do repositório:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`

2. **Cloudinary secrets** — em **Settings → Secrets and variables → Actions**, adicione:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`

#### Convenção de nomeação dos álbuns

O título do álbum no Google Photos precisa **começar exatamente com o slug** da viagem (o campo `id` em `trips.json`), seguido de fim-de-string ou um separador (espaço, traço, em-dash, dois-pontos):

| Título do álbum | Casa com viagem? |
| --- | --- |
| `iguacu-2021` | ✓ `iguacu-2021` |
| `iguacu-2021 - Foz do Iguaçu` | ✓ `iguacu-2021` |
| `iguacu-2021 — fotos brutas` | ✓ `iguacu-2021` |
| `Iguacu 2021` (sem hífen) | ✗ não casa |
| `iguacu-2021x extras` | ✗ não casa (separador inválido) |

Slugs disponíveis: ver campo `id` de cada entrada em `data/trips.json`.

#### Disparar manualmente

Via Actions na UI do GitHub: aba **Actions → sync-photos → Run workflow**. Inputs opcionais:
- `slug` — sincroniza só uma viagem
- `dry_run` — só lista o mapeamento álbum→viagem, sem upload

Ou localmente (precisa dos secrets no `.env`):
```bash
python scripts/sync_photos.py                          # tudo
python scripts/sync_photos.py --slug iguacu-2021       # uma só
python scripts/sync_photos.py --dry-run --fixture scripts/fixtures/sync_photos_albums.example.json   # teste offline
```

#### Idempotência

Cada foto recebe um `public_id` determinístico no Cloudinary baseado no id estável dela no Google Photos. Rodar a sync N vezes não duplica nada — fotos já enviadas são apenas reutilizadas.

---

### Limites do tier gratuito do Cloudinary

| Recurso | Limite gratuito |
| --- | --- |
| Storage | 25 GB |
| Bandwidth | 25 GB/mês |
| Transformações | 25.000/mês |
| Uploads | sem limite específico (sujeito a rate-limit) |

Para um portfólio de viagens com ~50 fotos por viagem em qualidade web (≈300 KB cada após transformações), isso dá pra **centenas de viagens** sem custo.

**Como monitorar:** dashboard https://cloudinary.com/console — a aba **Usage** mostra storage e bandwidth consumidos no mês.

### Troubleshooting

- **"Credenciais ausentes"** — confira que o `.env` existe na raiz e tem os três `CLOUDINARY_*` preenchidos.
- **"Viagem com id … não encontrada"** — o slug que você passou tem que bater exatamente com o `id` em `data/trips.json`.
- **"Pasta não encontrada"** — confira o caminho `photos-to-upload/<slug>/`.
- **Uploads falhando em massa** — pode ser rate-limit do Cloudinary. Reduza `CONCURRENCY` no topo de `scripts/upload-trip-photos.js` e tente de novo (o script é idempotente).
