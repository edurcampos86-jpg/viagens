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

### Adicionando fotos a uma viagem

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
