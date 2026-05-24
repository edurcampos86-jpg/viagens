# Disaster Recovery — Portal de Viagens

Procedimentos para os cenários de falha mais prováveis do site.
Inspirado no padrão do projeto Onix (`cockpit-onix/docs/DISASTER_RECOVERY.md`).

## Cenário 1 — Service Worker preso em cache quebrado

**Sintoma:** site público mostra versão antiga mesmo após deploy, ou alguns recursos 404, OU tela fica em branco com erro de SW no console.

**Causa provável:** SW antigo (de uma versão buggy) ficou registrado no navegador do usuário e está servindo assets ultrapassados ou inválidos.

**Resolução automática (esperada):**
- `sw-workbox.js` tem versionamento explícito (`VERSION = 'viagens-vX-pwa-Y'`).
- Quando a versão muda, o handler `activate` limpa caches antigos.
- O cliente recebe `postMessage({ type: 'sw-activated' })` e o app oferece reload via toast.

**Resolução manual (se a automática falhar):**

1. Abrir https://edurcampos86-jpg.github.io/viagens/ no Chrome.
2. F12 → aba **Application** → seção **Service Workers** no menu lateral.
3. Clicar em **Unregister** ao lado do SW listado.
4. Ainda em **Application**, ir em **Storage** → clicar em **Clear site data**.
5. Fechar o DevTools, recarregar com **Ctrl+Shift+R** (hard refresh).

**Resolução nuclear (último recurso):**

Mergeie um commit que substitua o conteúdo de `sw-workbox.js` por um stub que apenas se auto-desregistra:

```js
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await self.registration.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url));
  })());
});
```

Isso forçará todos os clientes a desregistrar o SW na próxima visita.

## Cenário 2 — Deploy do GitHub Pages quebrou produção

**Sintoma:** site público retorna 404 ou versão completamente quebrada após merge.

**Detecção:** o workflow `post-deploy-smoke.yml` deve ter criado Issue auto-labeled `smoke-fail` E enviado alerta no Slack `#viagens-deploys`.

**Resolução (em ordem de preferência):**

1. **Revert do commit problemático:**
   ```bash
   git checkout main
   git pull
   git revert <hash_do_commit_quebrado>
   git push origin main
   ```
   GitHub Pages re-deploya automaticamente em ~1-2 min. Smoke test rodará e validará.

2. **Reset para commit anterior conhecido bom:**
   ```bash
   git reset --hard <hash_bom>
   git push --force-with-lease origin main
   ```
   (Usar apenas se o revert criar conflito complicado.)

3. **Pausa do GitHub Pages:** Settings → Pages → temporariamente trocar source para outra branch enquanto se resolve.

## Cenário 3 — `trips.json` corrompido após edição manual

**Sintoma:** site carrega mas sem viagens, ou erro no console `JSON parse failed`.

**Resolução:**

1. `git log --oneline data/trips.json` para ver últimos commits que tocaram o arquivo.
2. `git show <hash_bom>:data/trips.json > /tmp/trips_restore.json`
3. Validar JSON: `python -m json.tool /tmp/trips_restore.json > /dev/null && echo OK`
4. Substituir: `cp /tmp/trips_restore.json data/trips.json`
5. Validar schemas: `python scripts/validate_schemas.py`
6. Commit + push.

## Cenário 4 — Anthropic API key vazada

**Sintoma:** custos inesperados no painel da Anthropic, ou alertas de billing.

**Resolução imediata:**

1. https://console.anthropic.com → Settings → API Keys.
2. Localize a chave do projeto → **Revoke**.
3. Crie nova chave com o mesmo nome.
4. Atualize o secret no GitHub:
   ```bash
   gh secret set ANTHROPIC_API_KEY --repo edurcampos86-jpg/viagens
   ```
   (lê do stdin — não eco a chave no terminal).
5. Investigue origem do vazamento (commit acidental? `.env` exposto? log público?).

## Smoke test — como executar manualmente

```bash
# Trigger manual via gh CLI
gh workflow run post-deploy-smoke.yml --repo edurcampos86-jpg/viagens

# Ver status dos últimos runs
gh run list --workflow=post-deploy-smoke.yml --repo edurcampos86-jpg/viagens --limit 3

# Ver logs do último run
gh run view --log --repo edurcampos86-jpg/viagens
```

## Contatos / Recursos

- Repo: https://github.com/edurcampos86-jpg/viagens
- Site público: https://edurcampos86-jpg.github.io/viagens/
- Painel GitHub Actions: https://github.com/edurcampos86-jpg/viagens/actions
- Canal Slack: `#viagens-deploys` (workspace Onix Capital)
- Painel Anthropic: https://console.anthropic.com
