import { describe, it, expect } from 'vitest';
import { formatError } from '../formatError';

describe('formatError', () => {
  it('leser message fra vanlige Error-objekter', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('leser message fra PostgrestError-lignende objekter', () => {
    expect(formatError({ message: 'Could not find the column', details: '', hint: '', code: 'PGRST204' }))
      .toBe('Could not find the column');
  });

  it('tar med details og hint når de finnes', () => {
    expect(formatError({ message: 'violates check constraint', details: 'Failing row', hint: 'Fix it', code: '23514' }))
      .toBe('violates check constraint (Failing row — Fix it)');
  });

  it('returnerer strenger som de er', () => {
    expect(formatError('oops')).toBe('oops');
  });

  it('faller tilbake til String(err) ellers', () => {
    expect(formatError(null)).toBe('null');
    expect(formatError(42)).toBe('42');
    expect(formatError({})).toBe('[object Object]');
  });
});
