// Kill-switch client-side mínimo. Não há framework de feature-flag no repo
// (git grep vazio), então este é o padrão: um default por flag, sobreponível
// em runtime sem deploy via:
//   - querystring:  ?heroMemoria=0   (ou =1 / true / false / on / off)
//   - localStorage: vc:flag:heroMemoria = "0"
// Puro client — nunca toca trips.json, schema ou putTripsFile.

const TRUEY = new Set(['1', 'true', 'on']);
const FALSEY = new Set(['0', 'false', 'off']);

export function isEnabled(name, defaultOn = true) {
  try {
    const q = new URL(window.location.href).searchParams.get(name);
    if (q != null) {
      if (TRUEY.has(q)) return true;
      if (FALSEY.has(q)) return false;
    }
    const ls = window.localStorage?.getItem('vc:flag:' + name);
    if (ls != null) {
      if (TRUEY.has(ls)) return true;
      if (FALSEY.has(ls)) return false;
    }
  } catch {
    // sem window/localStorage (ex.: Node/sandbox) → usa o default
  }
  return defaultOn;
}
