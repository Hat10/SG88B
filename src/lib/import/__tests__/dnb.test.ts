import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDnb, looksLikeDnb } from '../parseDnb';
import { normalizeTx } from '../normalize';

const fixture = (name: string) => fileURLToPath(new URL(`../../../../testdata/${name}`, import.meta.url));
const hasFixtures = existsSync(fixture('dnb-konto-a.txt'));

describe.skipIf(!hasFixtures)('parseDnb — ekte eksportfiler', () => {
  const fileA = readFileSync(fixture('dnb-konto-a.txt'), 'utf8');
  const fileB = readFileSync(fixture('dnb-konto-b.txt'), 'utf8');

  it('gjør rede for HVER datarad i fil A (26 rader, ingenting stille droppet)', () => {
    const { rows, unparsed, fileError } = parseDnb(fileA);
    expect(fileError).toBeUndefined();
    expect(unparsed).toEqual([]);
    expect(rows).toHaveLength(26);
  });

  it('gjør rede for HVER datarad i fil B (81 rader)', () => {
    const { rows, unparsed, fileError } = parseDnb(fileB);
    expect(fileError).toBeUndefined();
    expect(unparsed).toEqual([]);
    expect(rows).toHaveLength(81);
  });

  it('reparerer 7-bits norsk («Nys{ther» → «Nysæther»)', () => {
    const { rows } = parseDnb(fileA);
    const tx = rows.find(r => r.rawDescription.includes('Ofrim'))!;
    expect(tx.rawDescription).toContain('Nysæther');
    expect(tx.rawDescription).not.toContain('{');
  });

  it('leser beløp og fortegn riktig (inn = positivt, ut = negativt)', () => {
    const { rows } = parseDnb(fileA);
    expect(rows[0].amount).toBe(10027.2);    // inn på konto
    expect(rows[1].amount).toBe(-10027.2);   // ut fra konto
  });

  it('gjenkjenner filtypen', () => {
    expect(looksLikeDnb(fileA)).toBe(true);
    expect(looksLikeDnb('Type,Produkt,Startdato')).toBe(false);
  });
});

describe.skipIf(!hasFixtures)('normalize — DNB-mønstre fra ekte data', () => {
  const norm = (raw: string, date = '2026-06-15', amount = -100) =>
    normalizeTx({ date, amount, rawDescription: raw }, 'dnb');

  it('Varekjøp: skiller butikk fra Dato/kl.-halen og BEVARER kjøpstidspunktet', () => {
    const tx = norm('Varekjøp Sykehusapoteket Trondheimsve Oslo Dato 02.06 kl. 18.04');
    expect(tx.merchantText).toBe('Sykehusapoteket Trondheimsve Oslo');
    expect(tx.meta.purchasedAt).toBe('2026-06-02 18:04');
    expect(tx.meta.channel).toBe('kort');
  });

  it('E-varekjøp Vipps: butikken bak Vipps beholdes («Oslo Fris»)', () => {
    const tx = norm('E-varekjøp Vipps Oslo Fris Oslo Dato 02.06 kl. 17.35');
    expect(tx.merchantText).toBe('Oslo Fris Oslo');
    expect(tx.meta.channel).toBe('vipps');
  });

  it('Visa med valuta: fanger USD-beløp og kurs — også med sammenlimt «sValutakurs»', () => {
    const tx = norm('Visa 100122 Usd 25,00 Anthropic: Claude sValutakurs: 9,4840');
    expect(tx.merchantText).toBe('Anthropic: Claude s');
    expect(tx.meta.origCurrency).toBe('USD');
    expect(tx.meta.origAmount).toBe(25);
    expect(tx.meta.fxRate).toBe(9.484);
  });

  it('Visa uten valuta', () => {
    expect(norm('Visa  100021  Compass Group Norge AS').merchantText).toBe('Compass Group Norge AS');
  });

  it('Giro: kanal (Efaktura/Avtalegiro/Mobil Betaling) skilles fra mottaker', () => {
    expect(norm('Giro  724 Norgesgruppen Trumf Efaktura').merchantText).toBe('Norgesgruppen Trumf');
    const tekna = norm('Giro  1376 Tekna-Teknisk Naturvit.foren. AvtalegiroPeriode: 01.07.2026 - 31.12.2026');
    expect(tekna.merchantText).toBe('Tekna-Teknisk Naturvit.foren.');
    expect(tekna.meta.message).toContain('Periode: 01.07.2026');
    expect(norm('Giro  1375 Norgesgruppen Finans AS Mobil Betaling').merchantText).toBe('Norgesgruppen Finans AS');
  });

  it('Lån: fast navn + avdrag/renter i meta (sammenlimte beløp)', () => {
    const tx = norm('Lån  514528 Lån 1516.02.29885 Avdrag Kr 5.563,85Renter Kr 12.679,15', '2026-06-22', -18308);
    expect(tx.merchantText).toBe('Boliglån');
    expect(tx.meta.loanPrincipal).toBe(5563.85);
    expect(tx.meta.loanInterest).toBe(12679.15);
  });

  it('Autogiro: referanse + kjøpsdato + mottaker', () => {
    const tx = norm('Autogiro Ark.ref *87153488 Dato 24.06 Kjøp Kron', '2026-06-24', -17000);
    expect(tx.merchantText).toBe('Kron');
    expect(tx.meta.reference).toBe('*87153488');
    expect(tx.meta.purchasedAt).toBe('2026-06-24');
  });

  it('Overføring: løpenummer og Tpp:-hale bort, Ref: til meta', () => {
    expect(norm('Overføring Innland  635 Leah Kristoffersen Larsen', '2026-06-01', 5000).merchantText)
      .toBe('Leah Kristoffersen Larsen');
    const ref = norm('Overføring Jo Mikkel Nysæther Ofrim Ref:8cgg44k8kmhn', '2026-06-10', 1147.02);
    expect(ref.merchantText).toBe('Jo Mikkel Nysæther Ofrim');
    expect(ref.meta.reference).toBe('8cgg44k8kmhn');
    const tpp = norm('Overføring  4602960583 Hermann Rødset Theimann FotballTpp: Vipps Mobilepay AS', '2026-06-18', -1146);
    expect(tpp.merchantText).toBe('Hermann Rødset Theimann Fotball');
    expect(tpp.kindHint).toBe('transfer');
  });

  it('Kontoregulering / Lønn / Trygd → riktige hint', () => {
    expect(norm('Kontoregulering  723 Mobil Overføring').kindHint).toBe('internal');
    const lonn = norm('Lønn Netcompany Norway AS', '2026-06-19', 50753.15);
    expect(lonn.merchantText).toBe('Netcompany Norway AS');
    expect(lonn.kindHint).toBe('income');
    expect(norm('Pensjon Eller Trygd  295615399 Nav', '2026-06-18', 1146).merchantText).toBe('Nav');
  });

  it('ingen normaliserte navn inneholder transportstøy (hele fil B)', () => {
    const { rows } = parseDnb(readFileSync(fixture('dnb-konto-b.txt'), 'utf8'));
    for (const raw of rows) {
      const tx = normalizeTx(raw, 'dnb');
      expect(tx.merchantText).not.toMatch(/dato \d{2}\.\d{2}|kl\. \d|valutakurs|^visa \d|^varekjøp|^e-varekjøp|tpp:/i);
    }
  });
});
