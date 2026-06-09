// Testes dos módulos core do importador de extrato (port do extrato, Etapa 2).
// Mesmo harness leve de tests/trips-api.test.mjs — roda em Node sem deps.
//
// O statement-store NÃO é testado aqui: IndexedDB não existe em Node;
// ele é validado por sintaxe via `node --check` no gate da etapa.

import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    failed++;
  }
}

const { parseOFX, parseCSV } = await import(`${ROOT}/src/core/statement-parser.js`);
const { matchTxnsToTrip, matchTxnToBooking, tripWindow } = await import(
  `${ROOT}/src/core/statement-match.js`
);

// ── parseOFX ────────────────────────────────────────────────────────────

// SGML (OFX 1.x): sem tags de fechamento, valor até o fim da linha.
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240310120000[-3:GMT]
<TRNAMT>-1234,56
<FITID>ABC123
<NAME>LATAM AIRLINES
<MEMO>COMPRA CARTAO
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240315
<TRNAMT>200.00
<FITID>DEF456
<NAME>ESTORNO LOJA
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240318
<TRNAMT>50.00
<FITID>GHI789
<NAME>TAXI AEROPORTO
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1000.00<DTASOF>20240320
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

test('parseOFX (SGML): multi-transação com crédito e débito', () => {
  const txns = parseOFX(OFX_SGML);
  assert.equal(txns.length, 3, 'esperava 3 transações');
  assert.deepEqual(txns[0], {
    fitid: 'ABC123',
    date: '2024-03-10',
    amount: -1234.56,
    currency: 'BRL',
    description: 'LATAM AIRLINES — COMPRA CARTAO',
  });
  assert.equal(txns[1].amount, 200, 'crédito permanece positivo');
  assert.equal(txns[1].date, '2024-03-15', 'DTPOSTED curto (só data) parseia');
  assert.equal(txns[2].amount, -50, 'TRNAMT positivo com TRNTYPE=DEBIT vira negativo');
});

// XML (OFX 2.x): tags de fechamento + moeda original por transação.
const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL</CURDEF>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20240701</DTPOSTED>
<TRNAMT>-99.90</TRNAMT>
<FITID>XML1</FITID>
<MEMO>HOTEL TESTE</MEMO>
<ORIGCURRENCY><CURRATE>5.0</CURRATE><CURSYM>USD</CURSYM></ORIGCURRENCY>
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('parseOFX (XML): tags fechadas e ORIGCURRENCY por transação', () => {
  const txns = parseOFX(OFX_XML);
  assert.equal(txns.length, 1);
  assert.equal(txns[0].date, '2024-07-01');
  assert.equal(txns[0].amount, -99.9);
  assert.equal(txns[0].currency, 'USD', 'CURSYM do bloco vence o CURDEF global');
  assert.equal(txns[0].description, 'HOTEL TESTE');
});

const OFX_MALFORMADO = `<OFX><CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<TRNAMT>-10,00
<FITID>SEM-DATA
<NAME>BLOCO SEM DTPOSTED
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240501
<TRNAMT>abc
<FITID>VALOR-LIXO
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240502
<TRNAMT>-30,00
<FITID>OK1
<NAME>BLOCO BOM
</BANKTRANLIST></OFX>`;

test('parseOFX: blocos sem DTPOSTED/TRNAMT são ignorados sem explodir', () => {
  const txns = parseOFX(OFX_MALFORMADO);
  assert.equal(txns.length, 1, 'só o bloco válido sobrevive');
  assert.equal(txns[0].fitid, 'OK1');
  assert.equal(txns[0].amount, -30);
});

// Banco sem FITID + duas transações idênticas no mesmo dia: o fallback
// determinístico precisa gerar ids ÚNICOS, senão a segunda sobrescreve a
// primeira no statement-store (id = hash:fitid).
const OFX_SEM_FITID = `<OFX><CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240502
<TRNAMT>-30,00
<NAME>TAXI
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240502
<TRNAMT>-30,00
<NAME>TAXI
</BANKTRANLIST></OFX>`;

test('parseOFX: sem FITID, duas txns idênticas geram fitids distintos', () => {
  const txns = parseOFX(OFX_SEM_FITID);
  assert.equal(txns.length, 2);
  assert.notEqual(txns[0].fitid, txns[1].fitid, 'fallback inclui índice do bloco');
  const denovo = parseOFX(OFX_SEM_FITID);
  assert.equal(denovo[0].fitid, txns[0].fitid, 'reimport do mesmo arquivo → mesmos ids');
});

// Arquivo com DOIS extratos (contas/moedas distintas): o CURDEF de cada
// seção <STMTRS> vale só para as transações daquela seção.
const OFX_MULTI = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>USD
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240801
<TRNAMT>-10.00
<FITID>US1
<NAME>COFFEE NYC
</BANKTRANLIST>
</STMTRS></STMTTRNRS><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240805
<TRNAMT>-20,00
<FITID>BR1
<NAME>PADARIA SP
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('parseOFX: multi-extrato — CURDEF não vaza de uma seção para a outra', () => {
  const txns = parseOFX(OFX_MULTI);
  assert.equal(txns.length, 2);
  assert.equal(txns[0].currency, 'USD');
  assert.equal(txns[1].currency, 'BRL');
});

// ── parseCSV ────────────────────────────────────────────────────────────

const CSV_BR = [
  'Data;Histórico;Valor',
  '05/03/2024;PASSAGEM LATAM GRU;-1.234,56',
  '20/03/2024;"RESTAURANTE MAR; AZUL";-150,00',
  ';;linha quebrada',
  '25/03/2024;ESTORNO;200,00',
].join('\r\n');

test('parseCSV: delimitador ";", decimal BR e data dd/mm/aaaa', () => {
  const txns = parseCSV(CSV_BR);
  assert.equal(txns.length, 3, 'linha malformada é ignorada');
  assert.equal(txns[0].date, '2024-03-05');
  assert.equal(txns[0].amount, -1234.56, 'decimal BR "1.234,56" parseado');
  assert.equal(txns[0].description, 'PASSAGEM LATAM GRU');
  assert.equal(txns[0].currency, 'BRL');
  assert.equal(txns[1].description, 'RESTAURANTE MAR; AZUL', 'aspas protegem o delimitador');
  assert.equal(txns[2].amount, 200);
});

const CSV_VIRGULA = [
  'Data,Descricao,Valor',
  '2024-03-05,UBER AEROPORTO,-23.90',
  '06/03/2024,PADARIA,-15.50',
].join('\n');

test('parseCSV: delimitador "," com decimal ponto e data ISO', () => {
  const txns = parseCSV(CSV_VIRGULA);
  assert.equal(txns.length, 2);
  assert.equal(txns[0].date, '2024-03-05', 'data já em ISO é aceita');
  assert.equal(txns[0].amount, -23.9);
  assert.equal(txns[1].date, '2024-03-06');
});

test('parseCSV: ";" dentro de aspas não vira delimitador do arquivo', () => {
  const csv = [
    'Data,Descricao,Valor',
    '05/03/2024,"RESTAURANTE MAR; AZUL",-150.00',
    '06/03/2024,PADARIA,-15.50',
  ].join('\n');
  const txns = parseCSV(csv);
  assert.equal(txns.length, 2, 'arquivo de vírgula com ";" quoted parseia inteiro');
  assert.equal(txns[0].description, 'RESTAURANTE MAR; AZUL');
  assert.equal(txns[0].amount, -150);
});

test('parseCSV: preâmbulo antes do cabeçalho não descarta o arquivo', () => {
  const csv = [
    'Extrato de Conta Corrente',
    'Período: 01/03/2024 a 31/03/2024',
    '',
    'Data;Histórico;Valor',
    '05/03/2024;PIX;-10,00',
    '06/03/2024;MERCADO;-20,00',
  ].join('\n');
  const txns = parseCSV(csv);
  assert.equal(txns.length, 2, 'cabeçalho é procurado nas primeiras linhas');
  assert.equal(txns[0].amount, -10);
});

test('parseCSV: sem cabeçalho, "DEBITO AUTOMATICO" na 1ª linha não vira header', () => {
  const csv = [
    '15/03/2024;DEBITO AUTOMATICO ENERGIA;-100,00',
    '16/03/2024;MERCADO PAO;-30,00',
    '17/03/2024;FARMACIA;-25,00',
  ].join('\n');
  const txns = parseCSV(csv);
  assert.equal(txns.length, 3, 'linha de dados com palavra-hint não é consumida como cabeçalho');
  assert.equal(txns[0].description, 'DEBITO AUTOMATICO ENERGIA');
  assert.equal(txns[0].amount, -100);
});

test('parseCSV: colunas Crédito/Débito separadas — sinal vem da coluna', () => {
  const csv = [
    'Data;Histórico;Docto.;Crédito (R$);Débito (R$);Saldo (R$)',
    '10/03/2024;CONTA DE LUZ;123;;100,00;900,00',
    '11/03/2024;TED RECEBIDA;456;500,00;;1.400,00',
  ].join('\n');
  const txns = parseCSV(csv);
  assert.equal(txns.length, 2, 'linhas de débito E de crédito sobrevivem');
  assert.equal(txns[0].amount, -100, 'débito sai negativo');
  assert.equal(txns[0].description, 'CONTA DE LUZ');
  assert.equal(txns[1].amount, 500, 'crédito sai positivo');
});

test('parseCSV: cabeçalho "Data Lançamento" não rouba a coluna de descrição', () => {
  const csv = ['Data Lançamento;Histórico;Valor', '05/03/2024;PIX SUPERMERCADO;-50,00'].join('\n');
  const txns = parseCSV(csv);
  assert.equal(txns.length, 1);
  assert.equal(txns[0].description, 'PIX SUPERMERCADO', 'descrição não pode ser a própria data');
});

test('parseCSV: sem cabeçalho, valor (antes do saldo) é eleito e descrição é o texto', () => {
  const csv = [
    '05/03/2024;MERCADO;-50,00;1.234,56',
    '06/03/2024;PADARIA;-15,50;1.219,06',
  ].join('\n');
  const txns = parseCSV(csv);
  assert.equal(txns.length, 2);
  assert.equal(txns[0].amount, -50, 'primeira coluna monetária (valor), não o saldo');
  assert.equal(txns[0].description, 'MERCADO');
});

test('parseCSV: sinal sufixado contábil "100,00-" sai negativo', () => {
  const csv = ['Data;Histórico;Valor', '10/03/2024;SAQUE;100,00-', '11/03/2024;DEPOSITO;50,00'].join(
    '\n',
  );
  const txns = parseCSV(csv);
  assert.equal(txns.length, 2, 'linha com sufixo não é descartada');
  assert.equal(txns[0].amount, -100);
  assert.equal(txns[1].amount, 50);
});

test('parseCSV: milhar BR sem centavos ("-1.234") não importa 1000x menor', () => {
  const csv = ['Data;Histórico;Valor', '09/03/2024;TAXA;-50,00', '10/03/2024;PASSAGEM;-1.234'].join(
    '\n',
  );
  const txns = parseCSV(csv);
  assert.equal(txns.length, 2);
  assert.equal(txns[1].amount, -1234, 'arquivo de vírgula decimal → ponto é milhar');
});

// ── matchTxnsToTrip ─────────────────────────────────────────────────────

const tripCanonica = { id: 't1', name: 'Lisboa', startDate: '2024-04-10', endDate: '2024-04-20' };
const txnsJanela = [
  { fitid: 'a', date: '2024-03-26', amount: -1000, currency: 'BRL', description: 'VOO ANTECIPADO' },
  { fitid: 'b', date: '2024-04-15', amount: -50, currency: 'BRL', description: 'JANTAR' },
  { fitid: 'c', date: '2024-04-25', amount: -80, currency: 'BRL', description: 'POS-VIAGEM' },
  { fitid: 'd', date: '2024-02-01', amount: -10, currency: 'BRL', description: 'MUITO ANTES' },
];

test('matchTxnsToTrip: compra 15 dias antes entra (buffer); gasto pós-fim fica fora', () => {
  const { window, matches } = matchTxnsToTrip(txnsJanela, tripCanonica, { bufferDays: 30 });
  assert.equal(window.start, '2024-03-11', 'início = startDate - 30 dias');
  assert.equal(window.end, '2024-04-20', 'fim = endDate, sem buffer pós-viagem');
  assert.deepEqual(
    matches.map((t) => t.fitid),
    ['a', 'b'],
    'antecipada entra; pós-fim e fora do buffer ficam fora',
  );
});

test('matchTxnsToTrip: fallback year+month abraça o mês INTEIRO mesmo com nts', () => {
  // Caso real: 45 das 52 viagens só têm year/month (+ nts). O dia '01' do
  // start é sintético — a viagem pode ter sido na 3ª semana do mês — então
  // a janela nunca fecha antes do fim do mês.
  const tripLegada = { id: 't2', name: 'Iguaçu', year: 2021, month: 11, nts: 4 };
  const txns = [
    { fitid: 'in', date: '2021-11-03', amount: -100, currency: 'BRL', description: 'HOTEL' },
    { fitid: 'in2', date: '2021-11-20', amount: -60, currency: 'BRL', description: 'PASSEIO' },
    { fitid: 'out', date: '2021-12-15', amount: -100, currency: 'BRL', description: 'OUTRA COISA' },
  ];
  const { window, matches } = matchTxnsToTrip(txns, tripLegada, { bufferDays: 30 });
  assert.equal(window.source, 'v1', 'janela veio do fallback year/month');
  assert.equal(window.end, '2021-11-30', 'fim no último dia do mês, não em start+nts');
  assert.deepEqual(matches.map((t) => t.fitid), ['in', 'in2']);
  assert.equal(tripWindow({ id: 'x', name: 'sem data alguma' }), null, 'sem data → janela null');
});

// ── matchTxnToBooking ───────────────────────────────────────────────────

const tripComBookings = {
  id: 't3',
  name: 'Tóquio',
  startDate: '2025-05-01',
  endDate: '2025-05-10',
  bookings: {
    flights: [
      { titulo: 'LATAM GRU-NRT', status: 'confirmado', data: '2025-05-01', valor: 4321.09, moeda: 'BRL' },
    ],
    stays: [
      { titulo: 'Hotel Ueno', status: 'confirmado', data: '2025-05-01', valor: 1500, moeda: 'BRL' },
      { titulo: 'Hostel Shibuya', status: 'confirmado', data: '2025-05-01', valor: 1500, moeda: 'BRL' },
    ],
    experiences: [],
  },
};

test('matchTxnToBooking: casa por |valor| + data ±3 dias', () => {
  const hit = matchTxnToBooking(
    { fitid: 'x', date: '2025-04-29', amount: -4321.09, currency: 'BRL', description: 'LATAM AIR GRU' },
    tripComBookings,
  );
  assert.deepEqual(hit.bookingPath, { category: 'flights', index: 0 });
});

test('matchTxnToBooking: tolerância de centavos no valor', () => {
  const hit = matchTxnToBooking(
    { fitid: 'y', date: '2025-05-02', amount: -4321.1, currency: 'BRL', description: 'LATAM' },
    tripComBookings,
  );
  assert.deepEqual(hit.bookingPath, { category: 'flights', index: 0 }, '1 centavo de diferença casa');
});

test('matchTxnToBooking: null quando valor não bate ou data fora de ±3 dias', () => {
  const valorErrado = matchTxnToBooking(
    { fitid: 'v', date: '2025-05-01', amount: -999, currency: 'BRL', description: 'QUALQUER' },
    tripComBookings,
  );
  assert.equal(valorErrado.bookingPath, null, 'valor sem booking correspondente');
  const dataLonge = matchTxnToBooking(
    { fitid: 'd', date: '2025-04-20', amount: -4321.09, currency: 'BRL', description: 'LATAM' },
    tripComBookings,
  );
  assert.equal(dataLonge.bookingPath, null, 'mesmo valor, mas 11 dias antes da data do booking');
});

test('matchTxnToBooking: similaridade de título desempata valores iguais', () => {
  const hit = matchTxnToBooking(
    { fitid: 's', date: '2025-05-01', amount: -1500, currency: 'BRL', description: 'HOSTEL SHIBUYA TOKYO' },
    tripComBookings,
  );
  assert.deepEqual(hit.bookingPath, { category: 'stays', index: 1 }, 'título mais parecido vence');
});

test('matchTxnToBooking: estorno (crédito) não casa por padrão; allowCredits casa', () => {
  const estorno = {
    fitid: 'e',
    date: '2025-05-02',
    amount: 1500,
    currency: 'BRL',
    description: 'ESTORNO HOTEL UENO',
  };
  assert.equal(
    matchTxnToBooking(estorno, tripComBookings).bookingPath,
    null,
    'crédito reconciliaria o booking como pago e bloquearia o débito real',
  );
  assert.deepEqual(
    matchTxnToBooking(estorno, tripComBookings, { allowCredits: true }).bookingPath,
    { category: 'stays', index: 0 },
    'fatura de cartão (gastos positivos) opta por allowCredits',
  );
});

test('matchTxnToBooking: moeda divergente não casa (US$ 1.500 não é R$ 1.500)', () => {
  const hit = matchTxnToBooking(
    { fitid: 'u', date: '2025-05-01', amount: -1500, currency: 'USD', description: 'HOTEL UENO' },
    tripComBookings,
  );
  assert.equal(hit.bookingPath, null);
});

test('matchTxnToBooking: booking já reconciliado (com fitid) é pulado', () => {
  const tripReconciliada = {
    id: 't5',
    name: 'Reconciliada',
    startDate: '2025-05-01',
    bookings: {
      flights: [
        {
          titulo: 'VOO PAGO',
          status: 'confirmado',
          data: '2025-05-01',
          valor: 900,
          moeda: 'BRL',
          fitid: 'JA-RECONCILIADO',
          source: 'extrato',
        },
      ],
      stays: [],
      experiences: [],
    },
  };
  const hit = matchTxnToBooking(
    { fitid: 'n', date: '2025-05-01', amount: -900, currency: 'BRL', description: 'VOO' },
    tripReconciliada,
  );
  assert.equal(hit.bookingPath, null, 'reimport não re-concilia o mesmo booking');
});

test('matchTxnToBooking: candidato com data vence o sem data; sem data casa só por valor', () => {
  const tripMista = {
    id: 't4',
    name: 'Mista',
    startDate: '2025-05-01',
    bookings: {
      flights: [],
      stays: [
        { titulo: 'Sem Data', status: 'pendente', valor: 777, moeda: 'BRL' },
        { titulo: 'Com Data', status: 'confirmado', data: '2025-05-03', valor: 777, moeda: 'BRL' },
      ],
      experiences: [],
    },
  };
  const empate = matchTxnToBooking(
    { fitid: 'p', date: '2025-05-03', amount: -777, currency: 'BRL', description: 'PAGAMENTO' },
    tripMista,
  );
  assert.deepEqual(empate.bookingPath, { category: 'stays', index: 1 }, 'dated > undated');
  const soValor = matchTxnToBooking(
    { fitid: 'q', date: '2025-12-25', amount: -777, currency: 'BRL', description: 'PAGAMENTO' },
    tripMista,
  );
  assert.deepEqual(soValor.bookingPath, { category: 'stays', index: 0 }, 'sem data casa só por valor');
});

test('matchTxnToBooking: exclude evita duas txns no MESMO booking dentro do lote', () => {
  const txnGenerica = {
    fitid: 'g',
    date: '2025-05-01',
    amount: -1500,
    currency: 'BRL',
    description: 'BOOKING.COM PAGAMENTO',
  };
  const primeira = matchTxnToBooking(txnGenerica, tripComBookings);
  assert.deepEqual(primeira.bookingPath, { category: 'stays', index: 0 });
  const exclude = new Set(['stays:0']);
  const segunda = matchTxnToBooking(txnGenerica, tripComBookings, { exclude });
  assert.deepEqual(segunda.bookingPath, { category: 'stays', index: 1 }, 'path consumido é pulado');
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
