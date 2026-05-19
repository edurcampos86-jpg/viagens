// Benchmark — compara um trip com o histórico (F3.2).
//
// loadBenchmarks() lê data/benchmarks.json (gerado por
// scripts/compute_benchmarks.py). renderBenchmarkBanner(container, trip)
// gera um pequeno card com "Sua diária média em Europa = R$ X" e, se há
// stays/hotel, a comparação versus média.

let cached = null;
let cachedPromise = null;

export async function loadBenchmarks({ url = 'data/benchmarks.json' } = {}) {
  if (cached) return cached;
  if (cachedPromise) return cachedPromise;
  cachedPromise = fetch(url, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { by_continent: {}, by_country: {}, hotels: [] }))
    .then((data) => {
      cached = data;
      cachedPromise = null;
      return data;
    })
    .catch(() => ({ by_continent: {}, by_country: {}, hotels: [] }));
  return cachedPromise;
}

function fmtCurrency(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(n);
}

function diffPct(actual, baseline) {
  if (!baseline) return null;
  return Math.round(((actual - baseline) / baseline) * 100);
}

// Constrói as comparações para um trip — usado pela UI e por agentes.
export function compareTrip(trip, benchmarks) {
  const result = { has_data: false, lines: [] };
  if (!trip || !benchmarks) return result;
  const continent = trip.continent;
  const country = trip.country;
  const contStats = continent ? benchmarks.by_continent?.[continent] : null;
  const countryStats = country ? benchmarks.by_country?.[country] : null;
  const stats = countryStats || contStats;
  if (!stats?.daily?.avg) {
    return result;
  }
  result.has_data = true;
  const where = countryStats ? country : continent;
  result.lines.push(
    `Sua diária média em <strong>${where}</strong> = ${fmtCurrency(stats.daily.avg)} (n=${stats.daily.n}).`
  );

  const flightAvg = stats.flight?.avg;
  if (flightAvg) {
    const tripFlight = trip.budget?.actual?.flights || trip.budget?.planned?.flights;
    if (tripFlight) {
      const d = diffPct(tripFlight, flightAvg);
      result.lines.push(
        `Seu voo (${fmtCurrency(tripFlight)}) está ${d >= 0 ? `${d}% acima` : `${Math.abs(d)}% abaixo`} da média (${fmtCurrency(flightAvg)}).`
      );
    } else {
      result.lines.push(`Média de voo histórica para ${where}: ${fmtCurrency(flightAvg)}.`);
    }
  }

  // Hotel match — se algum stay.name bate com um nome cadastrado em logistics.hotels
  const stays = trip.bookings?.stays || [];
  const hotelComparisons = [];
  for (const stay of stays) {
    if (!stay.name) continue;
    const hit = (benchmarks.hotels || []).find(
      (h) => h.country === country && h.name.toLowerCase() === stay.name.toLowerCase()
    );
    if (hit?.avg_price_per_night) {
      const tripNights =
        stay.check_in && stay.check_out
          ? Math.max(1, Math.round((new Date(stay.check_out) - new Date(stay.check_in)) / 86400000))
          : null;
      if (tripNights && stay.price_brl) {
        const tripPerNight = stay.price_brl / tripNights;
        const d = diffPct(tripPerNight, hit.avg_price_per_night);
        hotelComparisons.push(
          `${hit.name}: ${fmtCurrency(tripPerNight)}/noite (${d >= 0 ? `${d}% acima` : `${Math.abs(d)}% abaixo`} da média histórica ${fmtCurrency(hit.avg_price_per_night)}).`
        );
      }
    }
  }
  result.lines.push(...hotelComparisons);
  return result;
}

let cssInjected = false;
const CSS = `
.bm-card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;
  padding: 10px 12px; font: 13px Inter, system-ui, sans-serif; color: #14532d; }
.bm-card.empty { background: #f8fafc; border-color: #e2e8f0; color: #475569; }
.bm-card h4 { margin: 0 0 6px; font-size: 13px; font-weight: 700; }
.bm-card ul { margin: 0; padding-left: 18px; }
.bm-card li { margin-bottom: 2px; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'bm-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

export async function renderBenchmarkBanner(container, trip) {
  ensureCss();
  container.innerHTML = '';
  const benchmarks = await loadBenchmarks();
  const cmp = compareTrip(trip, benchmarks);
  const card = document.createElement('div');
  card.className = cmp.has_data ? 'bm-card' : 'bm-card empty';
  const heading = document.createElement('h4');
  heading.textContent = '📊 Benchmark próprio';
  card.appendChild(heading);
  if (!cmp.has_data) {
    const empty = document.createElement('p');
    empty.style.margin = '0';
    empty.innerHTML = trip?.continent || trip?.country
      ? `Ainda não há histórico de custos para <strong>${trip.country || trip.continent}</strong>. Preencha <code>budget.actual</code> nas próximas viagens (via inbox do Gmail ou edição manual) para alimentar o comparativo.`
      : 'Selecione um destino para ver comparativos históricos.';
    card.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    cmp.lines.forEach((l) => {
      const li = document.createElement('li');
      li.innerHTML = l;
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }
  container.appendChild(card);
  return cmp;
}
