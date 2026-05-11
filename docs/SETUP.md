# Setup do Auto-Sync (Gmail + Google Photos → trips.json)

Esse guia te leva do zero até o sync rodando sozinho a cada 6h. Vai te tomar uns 30–45 minutos. Você só faz **uma vez**.

---

## Visão geral

```
A cada 6h, GitHub Actions roda scripts/sync.py:
   1. Faz refresh do OAuth com seu refresh_token
   2. Procura no Gmail confirmações de Booking / Latam / Airbnb / Decolar / Smiles / Gol
      desde o último sync
   3. Extrai destino, datas, código de reserva, voos
   4. Geocodifica destino com Nominatim (OpenStreetMap, sem API key)
   5. Busca fotos do Google Photos no período de cada viagem nova
   6. Abre um Pull Request com as viagens novas em data/trips.json
   7. Você revisa o PR e mergeia → GitHub Pages republica
```

Você só precisa fazer **2 coisas**:

1. **Setup Google Cloud** (≈25 min) — Criar projeto, ativar 2 APIs, gerar OAuth client
2. **Bootstrap local + GitHub Secrets** (≈10 min) — Rodar 1 script, copiar 3 valores

---

## 1. Google Cloud Console — criar projeto + OAuth

### 1.1 Criar projeto
1. Abre <https://console.cloud.google.com/>
2. Topo da página, clica no seletor de projeto → **Novo projeto**
3. Nome: `viagens-sync` (ou outro), local de cobrança: nenhum (é grátis dentro de free tier)
4. Clica **Criar** e espera ~30s

### 1.2 Ativar APIs
1. Menu lateral → **APIs e serviços** → **Biblioteca**
2. Procura **Gmail API** → **Ativar**
3. Volta pra Biblioteca → procura **Photos Library API** → **Ativar**

### 1.3 Configurar tela de consentimento OAuth
1. Menu lateral → **APIs e serviços** → **Tela de consentimento OAuth**
2. **Tipo de usuário**: Externo → Criar
3. Preenche:
   - Nome do app: `Viagens Sync`
   - E-mail de suporte: o seu
   - E-mail de contato do desenvolvedor: o seu
4. **Salvar e continuar**
5. **Escopos**: clica **Adicionar ou remover escopos**, marca:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/photoslibrary.readonly`
6. **Atualizar** → **Salvar e continuar**
7. **Usuários de teste**: adiciona o teu próprio e-mail Gmail
8. **Salvar e continuar** → **Voltar ao painel**

> 💡 O app fica em modo "Teste" — só seus próprios usuários de teste podem usar. Refresh tokens em modo teste **expiram em 7 dias**. Para refresh tokens que duram para sempre, depois de tudo funcionar, vá em **Tela de consentimento** → **Publicar app**. Você não precisa passar por verificação porque está usando como uso pessoal.

### 1.4 Criar credenciais OAuth
1. Menu lateral → **APIs e serviços** → **Credenciais**
2. **Criar credenciais** → **ID do cliente OAuth**
3. **Tipo de aplicativo**: **Aplicativo para computador**
4. Nome: `viagens-bootstrap`
5. **Criar** → janela mostra `client_id` e `client_secret` → clica **Fazer download do JSON**
6. Salva como `client_secret.json` (vai usar no passo 2)

---

## 2. Bootstrap local + GitHub Secrets

### 2.1 Clonar repo e instalar deps (se ainda não tem)
```bash
git clone https://github.com/edurcampos86-jpg/viagens.git
cd viagens
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
```

### 2.2 Rodar o bootstrap OAuth
```bash
python scripts/auth.py ~/Downloads/client_secret.json
```

O que acontece:
- Abre uma janela do browser pedindo pra você fazer login no Google
- Você seleciona sua conta, dá consentimento aos escopos (Gmail + Photos read-only)
- Você verá uma página "The authentication flow has completed" — pode fechar
- O terminal vai imprimir:

```
============================================================
Copy each of these as a GitHub repository secret:
============================================================
GOOGLE_CLIENT_ID     = 1234567890-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET = GOCSPX-xxxxxxxxxxxxxxx
GOOGLE_REFRESH_TOKEN = 1//0fxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
============================================================
```

**Copia esses 3 valores.** O `refresh_token` é especialmente sensível — não comita em lugar nenhum.

### 2.3 Criar GitHub Secrets
1. Abre <https://github.com/edurcampos86-jpg/viagens>
2. **Settings** (do repo, não da conta) → **Secrets and variables** → **Actions**
3. **New repository secret** três vezes, criando exatamente esses nomes:
   - `GOOGLE_CLIENT_ID` — colar valor
   - `GOOGLE_CLIENT_SECRET` — colar valor
   - `GOOGLE_REFRESH_TOKEN` — colar valor

---

## 3. Testar manualmente

1. Abre <https://github.com/edurcampos86-jpg/viagens/actions/workflows/sync.yml>
2. Botão **Run workflow** (canto direito) → **Run workflow**
3. Espera ~3–5 min
4. Se rodou bem e tinha viagem nova → vai aparecer um Pull Request com label `auto-sync`
5. Abre o PR, lê o `data/sync-report.md` para ver o que foi importado
6. Se tudo OK → **Squash and merge**

A partir daí, o workflow roda sozinho **a cada 6h**.

---

## 4. Ajustes finos depois

### Adicionar mais parsers de email
Edita `scripts/parsers.py` — copia uma das funções `parse_*` existentes, troca o domínio em `from_addr` e ajusta as regex. Adiciona a função em `PARSERS` no fim do arquivo.

Provedores que já tem suporte:
- `booking.com` (hotéis)
- `airbnb.com` (stays)
- `latam.com` (voos)
- `decolar.com` / `despegar.com` (voos/pacotes)
- `smiles.com.br` (voos)
- `voegol.com.br` (voos)

Para adicionar (exemplos pendentes): `hilton.com`, `marriott.com`, `accor.com`, `lufthansa.com`, `tap.pt`, etc.

### Acelerar a janela de descoberta
Por padrão, o primeiro run busca **365 dias** atrás. Depois, cada run só busca desde o último sync. Você pode forçar uma janela específica usando **Run workflow** → campo `lookback_days`.

### Refresh token expirou ("invalid_grant")
1. Repete o passo **1.3** (publicar o app na tela de consentimento OAuth) — em modo "Teste" o token expira em 7 dias
2. OU repete o passo **2.2** (gera um novo refresh token) e atualiza a secret `GOOGLE_REFRESH_TOKEN`

### iCloud Photos
Apple não tem API pública. Duas alternativas:
- **Shared Album público**: cria um álbum compartilhado no iCloud, marca como "Site público", cola a URL no app (precisa de feature client-side a desenvolver)
- **Apple Shortcuts**: cria atalho que copia fotos novas para um álbum do Google Photos automaticamente — daí o sync já pega

---

## 5. Custos

Tudo gratuito dentro do free tier:
- **Gmail API**: 1 bilhão de quota/dia (você usa ~50/sync)
- **Photos Library API**: 75k requests/dia (você usa ~10/sync)
- **GitHub Actions**: 2.000 min/mês gratuitos em repo público (você usa ~3 min × 4×/dia × 30 = ~360 min/mês)
- **Nominatim**: gratuito para uso pessoal, máx 1 req/seg (respeitado pelo script)
