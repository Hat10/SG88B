import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRevolut, looksLikeRevolut } from '../parseRevolut';

const fixturePath = fileURLToPath(new URL('../../../../testdata/revolut-mai.csv', import.meta.url));
const hasFixture = existsSync(fixturePath);

describe.skipIf(!hasFixture)('parseRevolut — ekte kontoutskrift', () => {
  const text = readFileSync(fixturePath, 'utf8');
  const { rows, unparsed, fileError } = parseRevolut(text);

  it('gjør rede for hver datarad (83 rader)', () => {
    expect(fileError).toBeUndefined();
    expect(unparsed).toEqual([]);
    expect(rows).toHaveLength(83);
  });

  it('TILBAKEFØRT-raden er synlig med reversed-hint (ikke stille droppet)', () => {
    const finn = rows.find(r => r.rawDescription === 'FINN.no')!;
    expect(finn).toBeDefined();
    expect(finn.kindHint).toBe('reversed');
    expect(finn.amount).toBe(-1501);
  });

  it('Påfylling → internal, Belønning → income', () => {
    expect(rows.filter(r => r.kindHint === 'internal')).toHaveLength(6);
    const bonus = rows.find(r => r.kindHint === 'income')!;
    expect(bonus.amount).toBe(200);
  });

  it('gebyret foldes inn i beløpet (CLAUDE −58,40 − 0,58 = −58,98)', () => {
    const claude = rows.filter(r => r.rawDescription === 'CLAUDE');
    expect(claude.map(c => c.amount)).toContain(-58.98);
  });

  it('kjøpstidspunktet bevares fra Startdato', () => {
    const kiwi = rows.find(r => r.rawDescription === 'Kiwi')!;
    expect(kiwi.meta?.purchasedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('gjenkjenner filtypen', () => {
    expect(looksLikeRevolut(text)).toBe(true);
    expect(looksLikeRevolut('"Dato";"Forklaring";"Rentedato"')).toBe(false);
  });
});
