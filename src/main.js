// Bootstrap da v2.0 — Fase 1.
//
// Carregado por <script type="module" src="src/main.js"></script> no index.html.
// Não substitui o app legado (`assets/app.js`); apenas adiciona a camada nova
// (editor inline, persistência via GitHub API, agentes novos) sem reformatar
// o que já existe.
//
// Expõe `window.viagensV2` para inspeção via console.

import { openTripEditor } from './components/trip-editor.js';

const v2 = (window.viagensV2 = window.viagensV2 || {});
v2.openTripEditor = openTripEditor;

// Handler de save: substituído por F1.2 (GitHub API). Por padrão baixa um
// rascunho .json para o usuário aplicar manualmente — fluxo fallback.
v2.onSaveTrip =
  v2.onSaveTrip ||
  function defaultDownload(trip) {
    const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trip-${trip.id || 'novo'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    console.info('[v2] Rascunho exportado:', trip.id);
  };

function injectFloatingButton() {
  if (document.getElementById('v2-new-trip-fab')) return;
  const btn = document.createElement('button');
  btn.id = 'v2-new-trip-fab';
  btn.type = 'button';
  btn.textContent = '+ Nova viagem';
  btn.title = 'Adicionar nova viagem (v2 alpha)';
  btn.style.cssText = `
    position: fixed; right: 20px; bottom: 20px; z-index: 9000;
    background: #0f172a; color: #fff; border: 0; border-radius: 999px;
    padding: 12px 18px; font: 600 14px Inter, system-ui, sans-serif;
    box-shadow: 0 10px 20px -5px rgba(15,23,42,0.4); cursor: pointer;
  `;
  btn.addEventListener('click', () => {
    openTripEditor({
      mode: 'create',
      onSave: (trip) => v2.onSaveTrip(trip),
    });
  });
  document.body.appendChild(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFloatingButton);
} else {
  injectFloatingButton();
}
