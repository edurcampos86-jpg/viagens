// Testes do gate de blindagem de putTripsFile (incidente 2026-06).
// Mesmo harness leve de tests/v2-modules.test.mjs — roda em Node sem deps.

import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

let passed = 0;
let failed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    failed++;
  }
}

const { putTripsFile } = await import(`${ROOT}/src/core/trips-api.js`);

// token/sha/message dummy para passar pelas guardas iniciais e alcançar o gate.
const DUMMY = { token: 'dummy-token', sha: 'dummy-sha', message: 'test commit' };

// Stub de fetch que registra chamadas; resposta OK para o caminho feliz.
function spyFetch() {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

const originalFetch = globalThis.fetch; // restaurar ao fim

try {
  // 1) Conteúdo corrompido (prefixo de UI antes do JSON) → JSON inválido.
  await asyncTest(
    'putTripsFile: rejeita conteúdo com prefixo de UI (JSON inválido) e NÃO chama fetch',
    async () => {
      const spy = spyFetch();
      globalThis.fetch = spy;
      await assert.rejects(
        putTripsFile({ ...DUMMY, content: 'San Island\r\n{ "config": {}, "trips": [] }' }),
        /JSON válido/,
      );
      assert.equal(spy.calls.length, 0, 'fetch não pode ser chamado quando o JSON é inválido');
    },
  );

  // 2) JSON válido mas sem a estrutura {config, trips[]}.
  await asyncTest(
    'putTripsFile: rejeita JSON válido sem estrutura {config, trips[]} e NÃO chama fetch',
    async () => {
      const spy = spyFetch();
      globalThis.fetch = spy;
      await assert.rejects(
        putTripsFile({ ...DUMMY, content: '{"foo":1}' }),
        /estrutura inválida/,
      );
      assert.equal(spy.calls.length, 0, 'fetch não pode ser chamado quando falta config/trips');
    },
  );

  // 3) Payload válido → passa do gate e chama fetch (resolve normalmente).
  await asyncTest(
    'putTripsFile: payload válido passa do gate e chama fetch',
    async () => {
      const spy = spyFetch();
      globalThis.fetch = spy;
      const res = await putTripsFile({ ...DUMMY, content: { config: {}, trips: [] } });
      assert.equal(spy.calls.length, 1, 'fetch deve ser chamado uma vez para payload válido');
      assert.deepEqual(res, {}, 'deve retornar o json() da resposta');
    },
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
