// Parser de extratos bancários (OFX e CSV) para transações normalizadas.
//
// Saída de ambos os parsers: array de
//   { fitid, date: 'YYYY-MM-DD', amount: number (débito negativo),
//     currency: 'BRL'|…, description: string }
//
// Funções puras, sem DOM e sem rede. O extrato bruto NUNCA vai ao
// trips.json — quem o persiste localmente é o statement-store (IndexedDB);
// só o valor derivado chega a bookings[*].valor via upsertTrip (Etapa 3).
//
// Linhas/blocos malformados são ignorados em silêncio, mas NUNCA
// importados com valor errado: na dúvida, descarta a linha — não o
// arquivo. Os fitids são determinísticos (mesmo arquivo → mesmos ids) e
// únicos dentro do arquivo mesmo para transações idênticas.

// ── Helpers de número e data ────────────────────────────────────────────

// '1.234,56' → 1234.56 · '1,234.56' → 1234.56 · '-100.00' → -100 ·
// 'R$ 50,00' → 50 · '(30,00)' → -30 · '100,00-' (sinal sufixado) → -100.
// Com ambos os separadores, o ÚLTIMO decide o decimal (cobre BR e US).
// Retorna null se não-numérico.
function parseAmount(rawIn) {
  if (typeof rawIn === 'number') return Number.isFinite(rawIn) ? rawIn : null;
  if (typeof rawIn !== 'string') return null;
  let s = rawIn.trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (!s) return null;
  const negParen = /^\(.*\)$/.test(s);
  if (negParen) s = s.slice(1, -1);
  const negSuffix = /\d-$/.test(s); // formato contábil BR: '100,00-'
  if (negSuffix) s = s.slice(0, -1);
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.'); // BR: 1.234,56
    } else {
      s = s.replace(/,/g, ''); // US: 1,234.56
    }
  } else if (hasComma) {
    s = s.replace(',', '.'); // decimal BR sem milhar
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negParen || negSuffix ? -Math.abs(n) : n;
}

function isValidISODate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
  const dt = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso;
}

// '20240315' | '20240315120000[-3:GMT]' → '2024-03-15'
function ofxDateToISO(raw) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(raw).trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isValidISODate(iso) ? iso : null;
}

// '15/03/2024' | '15/03/24' | '2024-03-15' → '2024-03-15'
function brDateToISO(raw) {
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isValidISODate(s) ? s : null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${yyyy}-${mm}-${dd}`;
  return isValidISODate(iso) ? iso : null;
}

// ── OFX ─────────────────────────────────────────────────────────────────

// Valor de uma tag OFX dentro de um trecho. Cobre SGML (sem fechamento,
// valor até o fim da linha) e XML (valor até a próxima tag '<').
function tagValue(chunk, tag) {
  const m = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i').exec(chunk);
  return m ? m[1].trim() : '';
}

// Parseia um extrato OFX — tanto SGML (v1.x, sem tags de fechamento)
// quanto XML (v2.x). Blocos <STMTTRN> sem DTPOSTED/TRNAMT parseáveis são
// ignorados sem lançar. Débito sai negativo (nega TRNAMT positivo quando
// TRNTYPE=DEBIT).
//
// Moeda: um arquivo pode ter VÁRIOS extratos (<STMTRS>/<CCSTMTRS>), cada
// um com seu CURDEF — processa por seção para não vazar a moeda de uma
// conta na outra. Precedência: CURSYM do bloco (CURRENCY/ORIGCURRENCY) →
// CURDEF da seção → CURDEF do arquivo → 'BRL'.
//
// FITID ausente: fallback determinístico com o índice do bloco no
// arquivo, para duas transações idênticas (mesmo dia/valor/descrição)
// não colidirem no statement-store (id = hash:fitid).
export function parseOFX(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const fileCurdef = tagValue(text, 'CURDEF') || 'BRL';
  const sections = text.split(/<(?:CC)?STMTRS>/i);
  const parts = sections.length > 1 ? sections.slice(1) : sections;
  const txns = [];
  let blockIndex = 0;
  for (const section of parts) {
    const curdef = tagValue(section, 'CURDEF') || fileCurdef;
    const blocks = section
      .split(/<STMTTRN>/i)
      .slice(1)
      .map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
    for (const block of blocks) {
      const i = blockIndex;
      blockIndex++;
      const date = ofxDateToISO(tagValue(block, 'DTPOSTED'));
      let amount = parseAmount(tagValue(block, 'TRNAMT'));
      if (!date || amount === null) continue; // bloco malformado: ignora
      if (tagValue(block, 'TRNTYPE').toUpperCase() === 'DEBIT' && amount > 0) {
        amount = -amount;
      }
      const name = tagValue(block, 'NAME');
      const memo = tagValue(block, 'MEMO');
      const description = [name, memo].filter(Boolean).join(' — ') || '(sem descrição)';
      txns.push({
        fitid: tagValue(block, 'FITID') || `${date}|${amount}|${description.slice(0, 80)}|${i}`,
        date,
        amount,
        currency: tagValue(block, 'CURSYM') || curdef,
        description,
      });
    }
  }
  return txns;
}

// ── CSV ─────────────────────────────────────────────────────────────────

const HEADER_HINTS = {
  date: /\b(data|date|dia)\b/i,
  amount: /(valor|amount|quantia|montante)/i,
  credit: /cr[ée]dito/i,
  debit: /d[ée]bito/i,
  description: /(descri|hist[óo]rico|lan[çc]amento|memo|estabelecimento|detalhe)/i,
};

// Split de uma linha CSV respeitando campos entre aspas duplas.
function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

// Conta ocorrências de um caractere FORA de aspas (um ';' dentro de
// "RESTAURANTE MAR; AZUL" não pode decidir o delimitador do arquivo).
function countOutsideQuotes(line, ch) {
  let n = 0;
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ch && !inQuotes) n++;
  }
  return n;
}

// Célula que é INTEIRAMENTE um valor monetário com centavos (ancorado nas
// duas pontas — 'RECARGA CELULAR 30,00' não pode virar coluna de valor).
function looksMonetary(cell) {
  const s = String(cell || '').trim();
  return (
    /^-?\s*(R\$\s*)?\d[\d.]*,\d{2}-?$/.test(s) || /^-?\s*(R\$\s*)?\d[\d,]*\.\d{2}-?$/.test(s)
  );
}

// Uma linha é CABEÇALHO se tem uma célula com nome de coluna de data E
// outra com nome de coluna de valor/crédito/débito, e essas células não
// são dados parseáveis ('DÉBITO AUTOMÁTICO ENERGIA' numa linha de dados
// não conta — a célula de data dessa linha é uma data real, não um nome).
function isHeaderRow(cells) {
  if (cells.length < 2) return false;
  const dateHint = cells.some((c) => HEADER_HINTS.date.test(c) && brDateToISO(c) === null);
  const amountHint = cells.some(
    (c) =>
      (HEADER_HINTS.amount.test(c) || HEADER_HINTS.credit.test(c) || HEADER_HINTS.debit.test(c)) &&
      parseAmount(c) === null,
  );
  return dateHint && amountHint;
}

// Identifica as colunas. Cada hint reivindica a coluna com EXCLUSIVIDADE,
// em ordem de prioridade data → valor → crédito/débito → descrição — um
// cabeçalho 'Data Lançamento' casa o hint de descrição, mas a coluna já
// foi reivindicada pela data e não pode ser eleita de novo.
// Sem cabeçalho, sonda a linha de dados: data parseável, célula
// inteiramente monetária, e o texto mais longo como descrição.
// Limitação conhecida: sem cabeçalho, a primeira coluna monetária vence —
// em 'data;descrição;valor;saldo' isso pega o valor (vem antes do saldo),
// mas layouts exóticos podem exigir ajuste manual no modal (Etapa 3).
function detectColumns(headerCells, probeRow) {
  const claimed = new Set();
  const claim = (idx) => {
    if (idx !== -1) claimed.add(idx);
    return idx;
  };
  const byHint = (re) =>
    headerCells ? headerCells.findIndex((c, i) => !claimed.has(i) && re.test(c)) : -1;
  const probe = probeRow || [];
  let date = claim(byHint(HEADER_HINTS.date));
  let amount = claim(byHint(HEADER_HINTS.amount));
  // Colunas separadas de crédito/débito (layout comum em CSV de banco BR):
  // só entram quando não há coluna única de valor. Os valores vêm sem
  // sinal — o sinal é dado pela coluna (débito negativo, crédito positivo).
  let credit = -1;
  let debit = -1;
  if (amount === -1) {
    credit = claim(byHint(HEADER_HINTS.credit));
    debit = claim(byHint(HEADER_HINTS.debit));
  }
  let description = claim(byHint(HEADER_HINTS.description));
  if (date === -1) {
    date = claim(probe.findIndex((c, i) => !claimed.has(i) && brDateToISO(c) !== null));
  }
  if (amount === -1 && credit === -1 && debit === -1) {
    amount = claim(probe.findIndex((c, i) => !claimed.has(i) && looksMonetary(c)));
  }
  if (description === -1) {
    let best = -1;
    let bestLen = -1;
    probe.forEach((c, i) => {
      if (claimed.has(i)) return;
      if (brDateToISO(c) !== null || looksMonetary(c)) return;
      if (c.length > bestLen) {
        best = i;
        bestLen = c.length;
      }
    });
    description = best;
  }
  return { date, amount, credit, debit, description };
}

// Valor da linha: coluna única de valor, ou par crédito/débito (débito
// sai negativo, crédito positivo — célula vazia é ignorada).
function rowAmount(cells, cols, normalize) {
  if (cols.amount !== -1) return parseAmount(normalize(cells[cols.amount] ?? ''));
  if (cols.debit !== -1) {
    const deb = parseAmount(normalize(cells[cols.debit] ?? ''));
    if (deb !== null && deb !== 0) return -Math.abs(deb);
  }
  if (cols.credit !== -1) {
    const cred = parseAmount(normalize(cells[cols.credit] ?? ''));
    if (cred !== null && cred !== 0) return Math.abs(cred);
  }
  return null;
}

// Parseia um extrato CSV: detecta delimitador (';' brasileiro vs ','),
// decimal BR '1.234,56', datas dd/mm/aaaa → ISO e colunas por cabeçalho
// (data/valor|crédito/débito/descrição|histórico) ou heurística. O
// cabeçalho é procurado nas primeiras 10 linhas — exports reais de banco
// trazem preâmbulo ('Extrato de Conta...', 'Período: ...') antes dele.
// Linhas sem data/valor parseáveis são ignoradas. CSV não traz moeda:
// assume 'BRL' (câmbio fora de escopo — Etapa 2).
export function parseCSV(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const delim = lines.slice(0, 10).some((l) => countOutsideQuotes(l, ';') > 0) ? ';' : ',';
  const rows = lines.map((l) => splitLine(l, delim));
  const scanLimit = Math.min(rows.length, 10);

  // Acha o cabeçalho (pode haver preâmbulo antes); sem cabeçalho, acha a
  // primeira linha que parseia como dado e usa a heurística de conteúdo.
  let cols = null;
  let startIdx = -1;
  for (let i = 0; i < scanLimit; i++) {
    if (isHeaderRow(rows[i])) {
      cols = detectColumns(rows[i], rows[i + 1] || []);
      startIdx = i + 1;
      break;
    }
  }
  if (!cols) {
    for (let i = 0; i < scanLimit; i++) {
      const probed = detectColumns(null, rows[i]);
      if (probed.date !== -1 && probed.amount !== -1) {
        cols = probed;
        startIdx = i;
        break;
      }
    }
  }
  if (
    !cols ||
    cols.date === -1 ||
    (cols.amount === -1 && cols.credit === -1 && cols.debit === -1)
  ) {
    return [];
  }
  const dataRows = rows.slice(startIdx);

  // Convenção decimal do ARQUIVO: se alguma célula de valor usa vírgula
  // decimal, um '-1.234' (ponto + grupos de 3) é milhar BR sem centavos —
  // importá-lo como -1.234 corromperia o valor 1000x.
  const amountCellsOf = (cells) =>
    [cols.amount, cols.credit, cols.debit]
      .filter((idx) => idx !== -1)
      .map((idx) => String(cells[idx] ?? '').trim());
  const commaDecimal = dataRows.some((cells) =>
    amountCellsOf(cells).some((c) => /,\d{2}-?$/.test(c)),
  );
  const normalize = (cell) => {
    const s = String(cell || '').trim();
    if (commaDecimal && /^-?\d{1,3}(\.\d{3})+-?$/.test(s.replace(/^R\$\s*/i, ''))) {
      return s.replace(/\./g, '');
    }
    return s;
  };

  const txns = [];
  dataRows.forEach((cells, i) => {
    const date = brDateToISO(cells[cols.date] ?? '');
    const amount = rowAmount(cells, cols, normalize);
    if (!date || amount === null) return; // linha malformada: ignora
    const description = (cols.description !== -1 && cells[cols.description]) || '(sem descrição)';
    txns.push({
      // CSV não tem FITID; chave determinística com o índice da linha para
      // duplicatas legítimas não colidirem (descrição truncada ANTES do
      // índice, para ele nunca ser cortado).
      fitid: `${date}|${amount}|${description.slice(0, 80)}|${i}`,
      date,
      amount,
      currency: 'BRL',
      description,
    });
  });
  return txns;
}
