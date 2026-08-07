import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTrumfLines, parseTrumfLines, type TextItem } from '../trumfText';
import { normalizeTx } from '../normalize';
import { round2 } from '../csv';

// Fixturen er dumpet fra den ekte PDF-en med scripts/extract-trumf-items.mjs —
// samme tekstelementer som pdfjs gir i nettleseren.
const fixturePath = fileURLToPath(new URL('../../../../testdata/trumf-items.json', import.meta.url));
const hasFixture = existsSync(fixturePath);

describe.skipIf(!hasFixture)('parseTrumf — ekte faktura', () => {
  const items: TextItem[] = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const { rows, unparsed, fileError } = parseTrumfLines(buildTrumfLines(items));

  it('finner alle 73 transaksjonsrader uten uleselige', () => {
    expect(fileError).toBeUndefined();
    expect(unparsed).toEqual([]);
    expect(rows).toHaveLength(73);
  });

  it('kjøpssummen stemmer NØYAKTIG med fakturaens «Nytt skyldig beløp» (−7 703,96)', () => {
    const sum = rows.filter(r => r.kindHint !== 'card_settlement').reduce((s, r) => s + r.amount, 0);
    expect(round2(sum)).toBe(-7703.96);
  });

  it('Innbetaling er et synlig kortoppgjør (+12 157,59)', () => {
    const inn = rows.find(r => r.kindHint === 'card_settlement')!;
    expect(inn.amount).toBe(12157.59);
  });

  it('klokkeslett brutt til egen linje limes tilbake på TrumfPay-raden', () => {
    const herbarium = rows.find(r => r.rawDescription.includes('Helgø MENY Herbarium'))!;
    expect(herbarium.rawDescription).toBe('TrumfPay, Helgø MENY Herbarium, 2026-07-10 18.34.37');
  });

  it('datoen er KJØPSdato, bokføringsdato bevares i meta', () => {
    const kiwi = rows.find(r => r.rawDescription.startsWith('KIWI 336 Torsho'))!;
    expect(kiwi.date).toBe('2026-07-14');
    expect(kiwi.meta?.bookedDate).toBe('2026-07-15');
  });

  it('normalisering: TrumfPay-prefiks og tidsstempel ut av navnet, inn i meta', () => {
    const tx = normalizeTx(
      rows.find(r => r.rawDescription.includes('KIWI 274 Hasleveien') && / \d{2}\.\d{2}\.\d{2}$/.test(r.rawDescription))!,
      'trumf',
    );
    expect(tx.merchantText).toBe('KIWI 274 Hasleveien');
    expect(tx.aliasKey).toBe('kiwi 274 hasleveien');
    expect(tx.meta.purchasedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(tx.meta.channel).toBe('trumfpay');
  });

  it('ingen normaliserte navn inneholder TrumfPay/tidsstempler/beløp', () => {
    for (const raw of rows) {
      const tx = normalizeTx(raw, 'trumf');
      expect(tx.merchantText).not.toMatch(/trumfpay|\d{4}-\d{2}-\d{2}|nok\s|-?\d+,\d{2}/i);
    }
  });
});
