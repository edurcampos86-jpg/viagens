# Prompt para Claude Code — Setup do Auto-Sync (OAuth + Secrets)

Use uma vez pra ativar o workflow `sync.yml` (Gmail + Google Photos).
Depois disso, o agente roda sozinho a cada 6h e o botão **🔄 Sync** no
header consegue disparar on-demand.

**Pré-requisito**: clone do repo `edurcampos86-jpg/viagens` no seu Mac,
com `python3` e `node` instalados (Claude Code já garante isso).

Cole o bloco abaixo numa sessão do **Claude Code** rodando dentro da
pasta local do repo:

---

```
Quero ativar o auto-sync de viagens (Gmail + Google Photos) configurando
OAuth no Google Cloud e gravando as secrets no GitHub. Você vai me guiar
passo a passo, executando comandos quando puder e pausando para eu fazer
as partes manuais no browser.

CONTEXTO:
- Repo: edurcampos86-jpg/viagens
- Infra do agente: scripts/sync.py + .github/workflows/sync.yml (já em main)
- 3 secrets que preciso criar: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN
- Guia humano completo: docs/SETUP.md

ROTEIRO:

[fase 0] Sanity
  - pwd, git status, git branch --show-current
  - Confirma raiz do repo viagens em main sem mudanças locais
  - git pull origin main → sincroniza
  - Verifica que scripts/auth.py + scripts/requirements.txt + 
    .github/workflows/sync.yml existem; se não, pare

[fase 1] Ambiente Python
  - Cria venv: python3 -m venv .venv
  - Ativa: source .venv/bin/activate
  - pip install -r scripts/requirements.txt
  - Confirma que google-auth-oauthlib instalou sem erro

[fase 2] Google Cloud Console (manual — me guie)
  PARE de executar comandos. Imprima um checklist numerado com cada
  ação que preciso fazer no browser, EXATAMENTE nessa ordem:
  
    a) Abrir https://console.cloud.google.com/ e criar projeto chamado
       "viagens-sync" (ou outro nome qualquer). Sem cobrança.
    b) Menu lateral → APIs e serviços → Biblioteca:
         - Procurar "Gmail API" → Ativar
         - Voltar → procurar "Photos Library API" → Ativar
    c) APIs e serviços → Tela de consentimento OAuth:
         - Tipo de usuário: Externo → Criar
         - Nome do app: "Viagens Sync"
         - E-mail de suporte: meu Gmail
         - E-mail de contato do desenvolvedor: meu Gmail
         - Salvar e continuar
    d) Escopos → Adicionar ou remover escopos → marcar:
         - https://www.googleapis.com/auth/gmail.readonly
         - https://www.googleapis.com/auth/photoslibrary.readonly
       Atualizar → Salvar e continuar
    e) Usuários de teste: adicionar meu próprio e-mail Gmail
       Salvar e continuar → Voltar ao painel
    f) APIs e serviços → Credenciais → Criar credenciais →
       ID do cliente OAuth → Tipo: "Aplicativo para computador" →
       Nome: "viagens-bootstrap" → Criar
    g) Janela abre com client_id e client_secret → clicar
       "Fazer download do JSON"
    h) Salvar o arquivo em ~/Downloads/client_secret.json
  
  Depois pergunte: "Concluiu tudo? Onde está o client_secret.json?"
  Default: ~/Downloads/client_secret.json

[fase 3] Bootstrap OAuth
  - Executar: python scripts/auth.py <caminho-do-client_secret.json>
  - Vai abrir browser pedindo login no Google → eu autorizo → terminal
    imprime 3 valores: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN
  - CAPTURE esses 3 valores da saída do comando, mas NÃO os ecoe de
    volta pra mim em texto puro. Guarde em variáveis locais da sessão
    pra usar na fase 4.

[fase 4] GitHub Secrets — duas opções
  Detecte se `gh` CLI está instalado e autenticado (gh auth status).
  
  Com gh CLI:
    - Pergunta: "Posso criar as 3 secrets via gh secret set?"
    - Se sim, executa (sem ecoar valores):
        gh secret set GOOGLE_CLIENT_ID -R edurcampos86-jpg/viagens
        gh secret set GOOGLE_CLIENT_SECRET -R edurcampos86-jpg/viagens
        gh secret set GOOGLE_REFRESH_TOKEN -R edurcampos86-jpg/viagens
      (cada um via stdin com o valor capturado)
    - Confirma com: gh secret list -R edurcampos86-jpg/viagens

  Sem gh CLI:
    - Abre https://github.com/edurcampos86-jpg/viagens/settings/secrets/actions
    - Dita os 3 nomes
    - Pergunta se posso copiar cada valor pro clipboard via pbcopy
      um a um (pra eu colar em cada secret sem você precisar imprimir
      o valor)
    - Aguarda eu confirmar que criei cada uma

[fase 5] Segurança
  - Pergunta se posso deletar ~/Downloads/client_secret.json
  - Grep recursivo no repo por "GOCSPX", "1//0" e o client_id pra
    confirmar que nada vazou em código
  - Confirma que .venv/ e client_secret.json estão no .gitignore

[fase 6] Teste manual
  Com gh CLI:
    - gh workflow run sync-trips -R edurcampos86-jpg/viagens --ref main
    - Aguarda 5s, lista runs em andamento:
        gh run list -R edurcampos86-jpg/viagens -w sync-trips --limit 1
    - Pega o ID da run e monitora:
        gh run watch <id> -R edurcampos86-jpg/viagens
    - Reporta resultado: success, failure ou em andamento

  Sem gh CLI:
    - Imprime link direto pra disparar:
      https://github.com/edurcampos86-jpg/viagens/actions/workflows/sync.yml
    - Explica onde clicar (botão "Run workflow")
    - Espera ~3 min e me pede pra abrir a Action page

[fase 7] Verificar resultado
  Após sucesso, checa se foi aberto um PR labeled "auto-sync":
    gh pr list -R edurcampos86-jpg/viagens --label auto-sync
  Se aberto:
    - Mostra link
    - Sugere abrir, ler data/sync-report.md
    - Aguardar minha confirmação antes de mergear

  Se a run falhou:
    gh run view <id> -R edurcampos86-jpg/viagens --log-failed
    - Mostra parte relevante do erro
    - Diagnóstico provável (token expirou, escopo errado, parsing crash)

[fase 8] Lembretes finais
  - Em modo "Teste" no Google Cloud, o refresh token expira em 7 dias.
    Pra durar pra sempre, vou em Tela de consentimento OAuth → "Publicar
    app". Não exige verificação porque é uso pessoal.
  - O botão "🔄 Sync" no header do site agora dispara o workflow on-demand
    (precisa só do PAT do GitHub salvo no localStorage).
  - Parsers novos (Hilton, Marriott, TAP, etc.) — copiar uma função de
    scripts/parsers.py e ajustar regex; me chamar com um exemplo de
    e-mail.

REGRAS:
- Nunca eche/imprima/comite o GOOGLE_REFRESH_TOKEN ou
  GOOGLE_CLIENT_SECRET — trate como senha
- Use pbcopy quando precisar transferir valores sensíveis (não exibe)
- Não rode comandos destrutivos (gh secret delete, rm -rf, git reset
  --hard, git push --force) sem confirmação dupla
- Se um comando der erro inesperado, pare e mostre o erro com hipótese
  do que pode estar errado — não tente "consertar" automaticamente
- Pare a qualquer momento se eu mandar

Comece pela fase 0.
```

---

## Troubleshooting comum

### `invalid_grant` no log da Action
- Refresh token expirou (apps em modo "Teste" expiram em 7 dias)
- Solução A: publica o app no Google Cloud (Tela de consentimento → Publicar)
- Solução B: rodar `scripts/auth.py` de novo, atualizar a secret
  `GOOGLE_REFRESH_TOKEN`

### `403 — Photos API not enabled`
- Faltou ativar uma das duas APIs no fase 2(b)
- Volta no Console → Biblioteca → ativa a que faltou

### Workflow dispara mas não cria PR
- Provável: não tem nenhuma confirmação de viagem nova no Gmail desde a
  última run. Veja `data/sync-state.json` no main pra ver o último
  marker. Pra forçar busca mais ampla, dispare manualmente com input
  `lookback_days=730` (2 anos).

### Quero adicionar parser novo (ex.: Hilton)
- Edite `scripts/parsers.py`
- Copie uma função `parse_*` existente como template
- Ajuste `from_addr` check + regex do destino/datas/ref
- Adicione à lista `PARSERS` no fim do arquivo
- Mande PR
