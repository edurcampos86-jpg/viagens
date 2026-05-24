// ──────────────────────────────────────────────────────────
// sync-button.js — botão "Sync agora" no header
//
// Dispara o workflow `sync.yml` via GitHub API
// (workflow_dispatch endpoint). Auth com Personal Access Token
// armazenado no localStorage do navegador.
//
// Permissões mínimas do PAT:
//   - Fine-grained: "Actions: Read and write" no repo viagens
//   - Classic:      escopo `workflow`
//
// Long-press (~1.5s) no botão limpa o token salvo.
// ──────────────────────────────────────────────────────────

(function () {
  const OWNER = 'edurcampos86-jpg';
  const REPO = 'viagens';
  const WORKFLOW_FILE = 'sync.yml';
  const TOKEN_KEY = 'gh_sync_token';
  const RUN_URL = `https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}`;

  function inject() {
    const right = document.querySelector('.hdr-right');
    if (!right || document.getElementById('syncBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'syncBtn';
    btn.className = 'icon-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Disparar sincronização de viagens agora');
    btn.title = 'Sincronizar agora (long-press para limpar token)';
    setIdle(btn);
    btn.addEventListener('click', onClick);

    // Long-press → clear stored token
    let pressTimer = null;
    const startPress = () => {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (localStorage.getItem(TOKEN_KEY) && confirm('Limpar token de sync salvo neste navegador?')) {
          localStorage.removeItem(TOKEN_KEY);
          toast('Token limpo. Próximo clique vai pedir um novo.', 'ok');
        }
      }, 1500);
    };
    const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    btn.addEventListener('mousedown', startPress);
    btn.addEventListener('mouseup', cancelPress);
    btn.addEventListener('mouseleave', cancelPress);
    btn.addEventListener('touchstart', startPress, { passive: true });
    btn.addEventListener('touchend', cancelPress);
    btn.addEventListener('touchcancel', cancelPress);

    // Insert as first child (left of dark/install buttons)
    right.insertBefore(btn, right.firstChild);
  }

  function setIdle(btn) {
    btn.disabled = false;
    btn.innerHTML = '<span aria-hidden="true">🔄</span> <span class="btn-label">Sync</span>';
  }
  function setBusy(btn) {
    btn.disabled = true;
    btn.innerHTML = '<span aria-hidden="true">⏳</span> <span class="btn-label">Disparando…</span>';
  }

  async function onClick() {
    const btn = document.getElementById('syncBtn');
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      const msg = [
        'Cole seu GitHub Personal Access Token:',
        '',
        '1. Crie em https://github.com/settings/personal-access-tokens',
        '2. Repository access: edurcampos86-jpg/viagens',
        '3. Permissions: Actions → Read and write',
        '',
        'O token fica salvo SÓ no localStorage deste navegador.',
        '(Long-press no botão limpa o token salvo.)',
      ].join('\n');
      token = window.prompt(msg);
      if (!token) return;
      token = token.trim();
      if (!/^(ghp_|github_pat_)/.test(token)) {
        if (!confirm('Token não começa com `ghp_` ou `github_pat_` — salvar mesmo assim?')) return;
      }
      localStorage.setItem(TOKEN_KEY, token);
    }

    setBusy(btn);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
        {
          method: 'POST',
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main' }),
        }
      );

      if (res.status === 204) {
        toast(`🚀 Sync disparado! Acompanhe em /actions`, 'ok', RUN_URL);
      } else if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        toast('❌ Token inválido ou expirado. Clica de novo pra colar outro.', 'err');
      } else if (res.status === 403) {
        toast('❌ Token sem permissão `Actions: write` no repo. Recria o PAT.', 'err');
      } else if (res.status === 404) {
        toast('❌ Workflow não encontrado (sync.yml não está em main?).', 'err');
      } else if (res.status === 422) {
        const body = await safeJson(res);
        toast(`❌ Workflow rejeitou: ${body?.message || 'parâmetros inválidos'}`, 'err');
      } else {
        const body = await res.text();
        toast(`❌ Erro ${res.status}: ${body.slice(0, 120)}`, 'err');
      }
    } catch (e) {
      toast(`❌ Falha de rede: ${e.message}`, 'err');
    } finally {
      setIdle(btn);
    }
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  // ── Toast ──
  let toastEl = null;
  let toastTimer = null;
  function toast(msg, kind, href) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'syncToast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      Object.assign(toastEl.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        maxWidth: '380px',
        padding: '12px 18px',
        borderRadius: '10px',
        color: 'white',
        fontSize: '0.88rem',
        fontWeight: '600',
        lineHeight: '1.4',
        boxShadow: '0 8px 28px rgba(0,0,0,.32)',
        opacity: '0',
        transform: 'translateY(8px)',
        transition: 'opacity .22s, transform .22s',
        zIndex: '99999',
        pointerEvents: 'auto',
        cursor: href ? 'pointer' : 'default',
      });
      toastEl.addEventListener('click', () => {
        if (toastEl.dataset.href) window.open(toastEl.dataset.href, '_blank', 'noopener');
      });
      document.body.appendChild(toastEl);
    }
    toastEl.style.background = kind === 'err' ? '#b91c1c' : '#0369a1';
    toastEl.textContent = msg;
    toastEl.dataset.href = href || '';
    if (href) {
      toastEl.innerHTML = `${escapeHtml(msg)} <span style="text-decoration:underline;margin-left:4px;">↗</span>`;
    }
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateY(0)';
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(8px)';
    }, kind === 'err' ? 8000 : 5500);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
