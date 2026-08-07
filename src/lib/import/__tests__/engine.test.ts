import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Merchant, MerchantAlias } from '../types';
import { buildMatchContext, matchMerchant } from '../match';
import { classifyTx } from '../classify';
import { normalizeTx, suggestDisplayName } from '../normalize';
import { DuplicateTracker, fingerprintOf } from '../dedupe';
import { parseDnb } from '../parseDnb';
import { prepareReview, detectMonth, dedupeKeysFor } from '../pipeline';

const m = (id: string, name: string, category: string, kind: Merchant['kind'] = 'merchant'): Merchant =>
  ({ id, name, category, kind });

const MERCHANTS: Merchant[] = [
  m('kiwi', 'Kiwi', 'dagligvarer'),
  m('rema', 'Rema 1000', 'dagligvarer'),
  m('hyre', 'Hyre', 'transport'),
  m('diab', 'Diabetikersenteret', 'helse'),
  m('obs', 'Obs!', 'dagligvarer'),
  m('obsbygg', 'Obs Bygg', 'hjem'),
  m('spar', 'Spar', 'dagligvarer'),
  m('revolut', 'Revolut', 'overføring', 'internal'),
  m('ngf', 'Norgesgruppen Finans', 'finans', 'settlement'),
  m('vipps', 'Vipps', 'annet', 'intermediary'),
  m('intern', 'Intern overføring', 'overføring', 'internal'),
];

const ALIASES: MerchantAlias[] = [
  { alias: 'kiwi 274 hasleveien', merchant_id: 'kiwi' },
  { alias: 'vipps', merchant_id: 'vipps' },
  { alias: 'norgesgruppen finans as', merchant_id: 'ngf' },
  { alias: 'norgesgruppen trumf', merchant_id: 'ngf' },
  { alias: 'taran five', merchant_id: 'intern' },
  { alias: 'andreas attila stenberg', merchant_id: 'intern' },
];

const ctx = buildMatchContext(MERCHANTS, ALIASES);
const dnbTx = (raw: string, amount = -100, date = '2026-06-15') =>
  normalizeTx({ date, amount, rawDescription: raw }, 'dnb');

describe('matchMerchant', () => {
  it('eksakt alias anvendes automatisk', () => {
    const r = matchMerchant(dnbTx('TrumfPay, KIWI 274 Hasleveien, 2026-07-15 10.54.33'), ctx);
    // (DNB-normalisereren rører ikke TrumfPay — testen bruker rå aliasnøkkel her)
    const r2 = matchMerchant(normalizeTx({ date: '2026-07-15', amount: -77.8, rawDescription: 'TrumfPay, KIWI 274 Hasleveien, 2026-07-15 10.54.33' }, 'trumf'), ctx);
    expect(r2).toMatchObject({ type: 'exact', merchant: { name: 'Kiwi' } });
    expect(r.type).not.toBe('exact'); // uten trumf-normalisering finnes ikke aliaset
  });

  it('avkortede butikknavn gir forslag («KIWI 336 Torsho» → Kiwi)', () => {
    expect(matchMerchant(dnbTx('Varekjøp KIWI 336 Torsho Oslo Dato 13.06 kl. 12.00'), ctx))
      .toMatchObject({ type: 'suggestion', merchant: { name: 'Kiwi' } });
    expect(matchMerchant(dnbTx('Varekjøp Diabetikersente Sponhoggvn. Oslo Dato 09.06 kl. 18.01'), ctx))
      .toMatchObject({ type: 'suggestion', merchant: { name: 'Diabetikersenteret' } });
    expect(matchMerchant(dnbTx('Varekjøp Rema Torggata Torggata 2 Oslo Dato 06.06 kl. 13.41'), ctx))
      .toMatchObject({ type: 'suggestion', merchant: { name: 'Rema 1000' } });
  });

  it('mest spesifikke butikk vinner («Obs Bygg Haugen» → Obs Bygg, ikke Obs!)', () => {
    expect(matchMerchant(dnbTx('Varekjøp Obs Bygg Haugen Østre Aker v Oslo Dato 13.06 kl. 20.39'), ctx))
      .toMatchObject({ type: 'suggestion', merchant: { name: 'Obs Bygg' } });
  });

  it('lengre ord matcher ALDRI kortere butikknavn («Sparebanken» ≠ Spar)', () => {
    const r = matchMerchant(dnbTx('Sparebanken Vest'), ctx);
    expect(r.type).toBe('none');
  });

  it('referansehale hindrer ikke forslag («Hyre As: Ylzfawfi» → Hyre)', () => {
    expect(matchMerchant(dnbTx('Visa  100121  Hyre As: Ylzfawfi', -319), ctx))
      .toMatchObject({ type: 'suggestion', merchant: { name: 'Hyre' } });
  });

  it('ukjent butikk får navne- og kategoriforslag', () => {
    const r = matchMerchant(dnbTx('Varekjøp Fotballfesten a Von Øtkens v Oslo Dato 16.06 kl. 19.55'), ctx);
    expect(r.type).toBe('none');
    if (r.type === 'none') expect(r.suggestedName.length).toBeGreaterThan(3);
  });
});

describe('classifyTx', () => {
  const cls = (raw: string, amount = -100) => {
    const tx = dnbTx(raw, amount);
    return { tx, cls: classifyTx(tx, matchMerchant(tx, ctx)) };
  };

  it('kontoregulering → intern, auto-utelatt men synlig', () => {
    const { cls: c } = cls('Kontoregulering  723 Mobil Overføring');
    expect(c).toMatchObject({ kind: 'internal', includedByDefault: false });
  });

  it('Trumf-regningen via DNB utelates (kortoppgjør) — fikser dobbelttelling', () => {
    expect(cls('Giro  1375 Norgesgruppen Finans AS Mobil Betaling', -2000).cls)
      .toMatchObject({ kind: 'card_settlement', includedByDefault: false });
    expect(cls('Giro  724 Norgesgruppen Trumf Efaktura', -12157.59).cls)
      .toMatchObject({ kind: 'card_settlement', includedByDefault: false });
  });

  it('Revolut-påfylling via DNB utelates (full-score forslag mot intern-butikk)', () => {
    expect(cls('Visa  100022  Nok 10000,00 Revolut::6268:', -10000).cls)
      .toMatchObject({ kind: 'internal', includedByDefault: false });
  });

  it('penger inn fra kjent butikk = refusjon, inkludert', () => {
    expect(cls('Visa  100131  Hyre As: Ylzfawfi', 416).cls)
      .toMatchObject({ kind: 'refund', includedByDefault: true });
  });

  it('lønn/utbytte er ALDRI refusjon — selv med alias til en butikk', () => {
    // Netcompany finnes som butikk (kategori inntekt) med alias — lønna skal likevel være inntekt
    const ctxMedLonn = buildMatchContext(
      [...MERCHANTS, m('netc', 'Netcompany', 'inntekt')],
      [...ALIASES, { alias: 'netcompany norway as', merchant_id: 'netc' }],
    );
    const lonn = dnbTx('Lønn Netcompany Norway AS', 50753.15);
    expect(classifyTx(lonn, matchMerchant(lonn, ctxMedLonn)))
      .toMatchObject({ kind: 'income', includedByDefault: true });
  });

  it('sparing er egen type: innskudd OG uttak hos investering-butikk → investment', () => {
    const ctxMedKron = buildMatchContext(
      [...MERCHANTS, m('kron2', 'Kron', 'investering')],
      [...ALIASES, { alias: 'kron', merchant_id: 'kron2' }],
    );
    const innskudd = dnbTx('Autogiro Ark.ref *87153488 Dato 24.06 Kjøp Kron', -17000);
    expect(classifyTx(innskudd, matchMerchant(innskudd, ctxMedKron)))
      .toMatchObject({ kind: 'investment', includedByDefault: true });
    const uttak = dnbTx('Autogiro Ark.ref *1 Dato 24.06 Kjøp Kron', 5000);
    expect(classifyTx(uttak, matchMerchant(uttak, ctxMedKron)))
      .toMatchObject({ kind: 'investment', includedByDefault: true });
  });

  it('overføring til egen/partner-konto → intern; til andre → P2P avhuket', () => {
    expect(cls('Overføring Innland  635 Taran Five', 5000).cls)
      .toMatchObject({ kind: 'internal', includedByDefault: false });
    expect(cls('Overføring  3520870782 Torstein Hauge Tpp: Vipps', 1750).cls)
      .toMatchObject({ kind: 'p2p', includedByDefault: false });
  });

  it('lønn → inntekt, inkludert', () => {
    expect(cls('Lønn Netcompany Norway AS', 50753.15).cls)
      .toMatchObject({ kind: 'income', includedByDefault: true });
  });

  it('Vipps-rad (Revolut) → per-transaksjon-navngiving, aldri felles alias', () => {
    const tx = normalizeTx({ date: '2026-05-01', amount: -23, rawDescription: 'Vipps' }, 'revolut');
    const c = classifyTx(tx, matchMerchant(tx, ctx));
    expect(c.needsPerTxName).toBe(true);
    expect(c.includedByDefault).toBe(true);
  });

  // Formidleren skjulte den ekte butikken: en Klarna-betaling til Akademika ble
  // vist som «Bikester» fordi den første Klarna-raden var navngitt slik, og
  // aliaset «klarna» traff eksakt på alle senere Klarna-rader.
  it('formidlernavn alene gjenkjennes UTEN at formidleren er registrert', () => {
    // Tomt register — ingen butikker, ingen aliaser
    const bare = buildMatchContext([], []);
    for (const raw of ['Klarna', 'Vipps', 'PayPal', 'Vipps Mobilepay AS']) {
      const tx = normalizeTx({ date: '2026-05-01', amount: -499, rawDescription: raw }, 'revolut');
      expect(classifyTx(tx, matchMerchant(tx, bare)).needsPerTxName, raw).toBe(true);
    }
  });

  it('et innlært feilalias kan ikke lenger skjule butikken bak formidleren', () => {
    // Slik feilen oppsto: «klarna» ble lært til Bikester ved første import
    const poisoned = buildMatchContext(
      [m('bikester', 'Bikester', 'klær')],
      [{ alias: 'klarna', merchant_id: 'bikester' }],
    );
    const tx = normalizeTx({ date: '2026-05-01', amount: -499, rawDescription: 'Klarna' }, 'revolut');
    const c = classifyTx(tx, matchMerchant(tx, poisoned));
    // Skal kreve navngiving per rad — IKKE stille bli Bikester
    expect(c.needsPerTxName).toBe(true);
  });

  it('butikk synlig bak formidleren behandles normalt', () => {
    // Her har normalisereren allerede trukket ut butikken — da skal vanlig matching gjelde
    const visible = normalizeTx(
      { date: '2026-06-12', amount: -42, rawDescription: 'E-varekjøp Vipps Ruter Oslo Dato 12.06 kl. 22.25' }, 'dnb');
    expect(classifyTx(visible, matchMerchant(visible, ctx)).needsPerTxName).toBeFalsy();
    // «Klarna Member» er en egen Klarna-post, ikke en skjult butikk
    const member = normalizeTx({ date: '2026-05-01', amount: -39, rawDescription: 'Klarna Member' }, 'revolut');
    expect(classifyTx(member, matchMerchant(member, ctx)).needsPerTxName).toBeFalsy();
  });
});

describe('DuplicateTracker', () => {
  const fp = (raw: string, amount: number, date = '2026-06-01') => fingerprintOf({ date, amount, rawDescription: raw });

  it('DB har 2, fila har 3 → to duplikater, én ny', () => {
    const x = fp('Kiwi', -12.5);
    const t = new DuplicateTracker(new Map([[x, 2]]));
    t.beginFile();
    expect([t.check(x), t.check(x), t.check(x)]).toEqual([true, true, false]);
    t.endFile();
  });

  it('like rader i SAMME fil er aldri duplikater av hverandre', () => {
    const x = fp('Rema 1000', -12.5);
    const t = new DuplicateTracker(new Map());
    t.beginFile();
    expect([t.check(x), t.check(x), t.check(x)]).toEqual([false, false, false]);
  });

  it('samme fil dratt inn to ganger → fil nr. 2 er 100 % duplikat', () => {
    const x = fp('Kiwi', -31.01);
    const t = new DuplicateTracker(new Map());
    t.beginFile(); t.check(x); t.check(x); t.endFile();
    t.beginFile();
    expect([t.check(x), t.check(x)]).toEqual([true, true]);
  });

  it('finner raden igjen selv om eieren er endret til Felles etterpå', () => {
    // Raden kom fra Andreas sin fil, men ble omfordelt → ligger lagret som 'felles'
    const x = fp('Bunnpris', -195.7);
    const t = new DuplicateTracker(new Map([[`felles|${x}`, 1]]));
    t.beginFile();
    expect(t.check(dedupeKeysFor('bank_M', x))).toBe(true);
  });

  it('bruker opp egen kilde før felles-raden', () => {
    const x = fp('Kiwi', -68.3);
    const t = new DuplicateTracker(new Map([[`bank_M|${x}`, 1], [`felles|${x}`, 1]]));
    t.beginFile();
    // to like rader i fila → én match mot bank_M, én mot felles, tredje er ny
    expect([
      t.check(dedupeKeysFor('bank_M', x)),
      t.check(dedupeKeysFor('bank_M', x)),
      t.check(dedupeKeysFor('bank_M', x)),
    ]).toEqual([true, true, false]);
  });

  it('leter ikke i den ANDRE personens kilde', () => {
    const x = fp('Kantina', -89);
    const t = new DuplicateTracker(new Map([[`bank_L|${x}`, 1]]));
    t.beginFile();
    expect(t.check(dedupeKeysFor('bank_M', x))).toBe(false);
  });
});

describe('suggestDisplayName', () => {
  it('rydder adresse/by/org-suffiks kun i VISNINGSforslaget', () => {
    expect(suggestDisplayName('Compass Group Norge AS')).toBe('Compass Group');
    expect(suggestDisplayName('Oslo Fris Oslo')).toBe('Oslo Fris');
    expect(suggestDisplayName('KIWI 336 TORSHOV OSLO')).toBe('Kiwi 336 Torshov');
  });
});

const fixture = (name: string) => fileURLToPath(new URL(`../../../../testdata/${name}`, import.meta.url));

describe.skipIf(!existsSync(fixture('dnb-konto-a.txt')))('prepareReview — hele kjeden på ekte filer', () => {
  const parseA = parseDnb(readFileSync(fixture('dnb-konto-a.txt'), 'utf8'));
  const parseB = parseDnb(readFileSync(fixture('dnb-konto-b.txt'), 'utf8'));
  const files = [
    { id: 'a', zone: 'bank_M', sourceKind: 'dnb' as const, filename: 'a.txt', fileHash: 'h1', parse: parseA },
    { id: 'b', zone: 'bank_M', sourceKind: 'dnb' as const, filename: 'b.txt', fileHash: 'h2', parse: parseB },
  ];

  it('26 + 81 rader — alle synlige, klassifisert og uten duplikater første gang', () => {
    const [a, b] = prepareReview(files, ctx, new Map());
    expect(a.txs).toHaveLength(26);
    expect(b.txs).toHaveLength(81);
    expect(a.txs.filter(t => t.isDuplicate)).toHaveLength(0);
    // 11 kontoreguleringer i fil A — synlige, avhuket (dagens kode SLETTET dem stille)
    expect(a.txs.filter(t => t.cls.kind === 'internal' && !t.cls.includedByDefault).length).toBeGreaterThanOrEqual(11);
  });

  it('samme fil to ganger i SAMME sone → alle rader i fil 2 merkes duplikat', () => {
    const twice = [
      { ...files[0], dedupeScope: 'bank_M' },
      { ...files[0], id: 'a2', dedupeScope: 'bank_M' },
    ];
    const [, second] = prepareReview(twice, ctx, new Map());
    expect(second.txs.every(t => t.isDuplicate)).toBe(true);
  });

  it('identiske rader hos TO personer er IKKE duplikater (scopet per kilde)', () => {
    // Andreas og Taran kjøper lunsj i samme kantine samme dag — begge skal telle
    const two = [
      { ...files[0], dedupeScope: 'bank_M' },
      { ...files[0], id: 'l', zone: 'bank_L', dedupeScope: 'bank_L' },
    ];
    const [, taran] = prepareReview(two, ctx, new Map());
    expect(taran.txs.some(t => t.isDuplicate)).toBe(false);
  });

  it('detectMonth finner dominerende måned', () => {
    expect(detectMonth(parseB.rows.map(r => r.date))).toBe('2026-06');
  });
});
