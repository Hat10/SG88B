// Setter sammen hele kjeden: parse-resultat → normaliser → match → klassifiser
// → dedupe. Ren funksjon uten Supabase — UI-et henter kontekst (butikker,
// aliaser, eksisterende fingerprints) og eksekverer skrivingen selv.

import type { ParseResult, ReviewTx } from './types';
import { normalizeTx, type SourceKind } from './normalize';
import { matchMerchant, type MatchContext } from './match';
import { classifyTx } from './classify';
import { DuplicateTracker, fingerprintOf } from './dedupe';

export interface PendingFile {
  /** Stabil nøkkel i UI-et (sone + filnavn + løpenummer) */
  id: string;
  zone: string;            // 'bank_M' | 'bank_L' | 'revolut_M' | 'revolut_L' | 'trumf'
  sourceKind: SourceKind;  // 'dnb' | 'revolut' | 'trumf'
  filename: string;
  fileHash: string;
  parse: ParseResult;
  /**
   * Duplikat-avgrensning — typisk lagret source ('bank_M'/'bank_L'/'trumf').
   * To personer kan lovlig ha identiske transaksjoner samme dag (samme kantine,
   * samme beløp), så duplikater telles kun innenfor samme scope.
   */
  dedupeScope?: string;
}

export interface ReviewFile extends PendingFile {
  txs: ReviewTx[];
}

/**
 * Annoter alle pending-filer for review. Kjøres på nytt når butikkregisteret
 * endres (f.eks. etter at en ukjent butikk er lagt til), men brukervalg
 * (avhuking, løsninger) lever i UI-staten utenpå dette.
 *
 * `dbFingerprints` nøkles `${scope}|${fingerprint}` (scope = lagret source) —
 * samme scoping som `dedupeScope` på filene.
 */
/**
 * Nøklene en rad skal lete etter blant de eksisterende — i prioritert rekkefølge.
 *
 * Egen kilde først, deretter 'felles': en rad som ble omfordelt til Felles
 * (i importen eller på Oversikt) ligger lagret som source 'felles', men kommer
 * fortsatt fra bank_M/bank_L/trumf-fila. Uten oppslaget mot 'felles' ville
 * nøyaktig de radene blitt importert på nytt hver eneste gang.
 *
 * Vi slår bevisst IKKE opp i den andre personens kilde — to personer kan lovlig
 * ha identiske kjøp samme dag, og det skal fortsatt telle som to.
 */
export function dedupeKeysFor(scope: string | undefined, fingerprint: string): string[] {
  const own = `${scope ?? ''}|${fingerprint}`;
  return scope && scope !== 'felles' ? [own, `felles|${fingerprint}`] : [own];
}

export function prepareReview(
  files: PendingFile[],
  ctx: MatchContext,
  dbFingerprints: Map<string, number>,
): ReviewFile[] {
  const tracker = new DuplicateTracker(dbFingerprints);
  return files.map(file => {
    tracker.beginFile();
    const txs: ReviewTx[] = file.parse.rows.map(raw => {
      const norm = normalizeTx(raw, file.sourceKind);
      const match = matchMerchant(norm, ctx);
      const cls = classifyTx(norm, match);
      const fingerprint = fingerprintOf(norm);
      // Alle rader dedupe-sjekkes — også auto-utelatte, så en P2P-rad brukeren
      // hukte på i forrige import ikke kan smyge seg inn dobbelt. Identiske
      // fingerprints klassifiseres alltid likt, så kryssforbruk av plassene
      // mellom inkluderte og utelatte rader er ikke reelt.
      const isDuplicate = tracker.check(dedupeKeysFor(file.dedupeScope, fingerprint));
      return { norm, match, cls, fingerprint, isDuplicate };
    });
    tracker.endFile();
    return { ...file, txs };
  });
}

// Dominerende måned (YYYY-MM) i et sett transaksjoner — til finance_imports.month
export function detectMonth(dates: string[]): string {
  const counts: Record<string, number> = {};
  for (const d of dates) {
    const m = d.slice(0, 7);
    counts[m] = (counts[m] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

// SHA-256 av filbytes → hex (til finance_imports.file_hash)
export async function hashFile(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
