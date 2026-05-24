// ONE-TIME CLEANUP B-N1 — remove PATs armazenados em texto claro
// pelo antigo sync-button.js (desativado em 2026-05-24, Sprint 1 T2).
//
// Pode ser removido após ~90 dias (alvo: agosto/2026), quando a janela
// de visitantes recorrentes com a chave antiga estiver razoavelmente vazia.
// Para remover: apagar este arquivo, a entrada de precache em sw-workbox.js
// e o <script> em index.html. Sem efeito colateral além do flag remanescente
// no localStorage do usuário (também inerte).

(function cleanupPATPlaintext() {
  const FLAG = 'viagens.cleanup.b-n1.done';
  if (localStorage.getItem(FLAG)) return;

  const KEYS_TO_REMOVE = ['gh_sync_token'];
  KEYS_TO_REMOVE.forEach((k) => localStorage.removeItem(k));
  localStorage.setItem(FLAG, new Date().toISOString());
  console.info('[cleanup] B-N1 PAT keys removed:', KEYS_TO_REMOVE);
})();
