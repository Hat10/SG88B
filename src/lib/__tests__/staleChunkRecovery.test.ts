import { describe, it, expect } from 'vitest';
import { isStaleChunkError } from '../staleChunkRecovery';

// Kun isStaleChunkError testes her — recoverFromStaleChunk/
// installStaleChunkRecovery er tynne sessionStorage/window-sideeffekter uten
// noe eget testmiljø (jsdom) i dette prosjektet, og gir lite igjen for
// risikoen ved å håndrigge en falsk window her.
describe('isStaleChunkError', () => {
  it('kjenner igjen Chrome/Edge sin feilmelding', () => {
    expect(isStaleChunkError(new Error('Failed to fetch dynamically imported module: https://example.com/assets/Trening-abc123.js'))).toBe(true);
  });

  it('kjenner igjen Firefox sin feilmelding', () => {
    expect(isStaleChunkError(new Error('error loading dynamically imported module: https://example.com/assets/Trening-abc123.js'))).toBe(true);
  });

  it('kjenner igjen Safari sin feilmelding', () => {
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('er case-insensitiv', () => {
    expect(isStaleChunkError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'))).toBe(true);
  });

  it('lar vanlige feil være uendret', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError(new TypeError('fetch failed'))).toBe(false);
  });

  it('håndterer ikke-Error-verdier uten å kaste', () => {
    expect(isStaleChunkError('en streng, ikke en Error')).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});
