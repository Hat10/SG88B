import { describe, it, expect } from 'vitest';
import { getMissingDataTags } from '../missingData';

const ing = (name: string) => ({ name, amount: null, unit: null });
const full = { ingredients: [ing('ris')], instructions: 'Kok risen.' };

describe('getMissingDataTags', () => {
  it('har alt: ingen tagger', () => {
    expect(getMissingDataTags(full)).toEqual([]);
  });

  it('ingen ingredienser: bare «ingredients»', () => {
    expect(getMissingDataTags({ ...full, ingredients: [] })).toEqual(['ingredients']);
  });

  it('ingen oppskrift: bare «instructions»', () => {
    expect(getMissingDataTags({ ...full, instructions: null })).toEqual(['instructions']);
  });

  it('mangler begge: begge tagger', () => {
    expect(getMissingDataTags({ ingredients: [], instructions: null })).toEqual(['ingredients', 'instructions']);
  });

  it('tom streng og whitespace i fremgangsmåte teller som manglende', () => {
    expect(getMissingDataTags({ ...full, instructions: '' })).toEqual(['instructions']);
    expect(getMissingDataTags({ ...full, instructions: '  \n\t ' })).toEqual(['instructions']);
  });

  it('tom ingrediensliste, null og undefined teller likt som manglende', () => {
    expect(getMissingDataTags({ ...full, ingredients: [] })).toEqual(['ingredients']);
    expect(getMissingDataTags({ ...full, ingredients: null as never })).toEqual(['ingredients']);
    expect(getMissingDataTags({ instructions: full.instructions })).toEqual(['ingredients']);
  });

  it('ingredienser med blankt navn teller ikke', () => {
    expect(getMissingDataTags({ ...full, ingredients: [ing(''), ing('  ')] })).toEqual(['ingredients']);
    expect(getMissingDataTags({ ...full, ingredients: [ing(''), ing('ris')] })).toEqual([]);
  });

  it('ukeplan-oppføring uten koblet oppskrift (fritekst/slettet): ingen tagg', () => {
    expect(getMissingDataTags(null)).toEqual([]);
    expect(getMissingDataTags(undefined)).toEqual([]);
  });

  it('«only» begrenser til valgte tagger (ukeplanen viser kun ingredienser)', () => {
    const empty = { ingredients: [], instructions: null };
    expect(getMissingDataTags(empty, ['ingredients'])).toEqual(['ingredients']);
    expect(getMissingDataTags({ ...full, ingredients: [] }, ['instructions'])).toEqual([]);
    expect(getMissingDataTags(null, ['ingredients'])).toEqual([]);
  });
});
