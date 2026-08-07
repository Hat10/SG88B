// Duplikatdeteksjon på tvers av importer.
//
// Fingerprint = dato + beløp + normalisert RÅTEKST (stabil uansett hvordan
// butikken senere mappes). To identiske kjøp samme dag er lovlig (skjer ofte:
// to like Rema-kjøp à 12,50) — derfor telles forekomster i stedet for å
// blokkere på nøkkel:
//
//   · DB har N rader med fingerprint X, fila har K → de N første utelates som
//     duplikat, de K−N siste importeres.
//   · Innenfor ÉN fil teller like rader aldri mot hverandre (K like rader i
//     samme eksport er K ekte transaksjoner).
//   · Rader som inkluderes i én fil regnes som «eksisterende» for NESTE fil i
//     samme økt — så samme fil dratt inn to ganger gir 100 % duplikater.
//   · Nøkkelen er scopet til kilden (bank_M / bank_L / trumf) så to personer
//     kan ha identiske kjøp samme dag. MEN eieren kan endres etter import
//     («Felles»), og da flytter raden seg til et annet scope — derfor slår
//     `check` opp i flere scope, se der.

import type { NormTx } from './types';

// Liten, rask FNV-1a-hash — trenger ikke krypto, bare stabile korte nøkler.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function fingerprintOf(tx: Pick<NormTx, 'date' | 'amount' | 'rawDescription'>): string {
  const raw = tx.rawDescription.toLowerCase().replace(/\s+/g, ' ').trim();
  return fnv1a(`${tx.date}|${tx.amount.toFixed(2)}|${raw}`);
}

export class DuplicateTracker {
  /** Antall rader per fingerprint som finnes i DB + tidligere filer i økten. */
  private pool: Map<string, number>;
  /** Gjenstående «matchbare» eksisterende rader for fila som behandles nå. */
  private available = new Map<string, number>();
  /** Inkluderte (ikke-duplikat) rader i inneværende fil. */
  private fileIncluded = new Map<string, number>();

  constructor(dbCounts: Map<string, number>) {
    this.pool = new Map(dbCounts);
  }

  beginFile() {
    this.available = new Map(this.pool);
    this.fileIncluded = new Map();
  }

  /**
   * true = raden er et duplikat av en eksisterende rad.
   *
   * Tar imot flere kandidatnøkler fordi en rad kan ligge lagret under en annen
   * kilde enn fila den kom fra: setter man eieren til «Felles» (i importen
   * eller på Oversikt etterpå), lagres den som source 'felles'. Uten at vi
   * leter der også, ville nøyaktig de radene sluppet inn på nytt ved neste
   * import. Første nøkkel med ledig kapasitet «brukes opp»; nøkkel nr. 1 er
   * den fila selv tilhører, og det er den nye rader bokføres på.
   */
  check(keys: string | string[]): boolean {
    const list = typeof keys === 'string' ? [keys] : keys;
    for (const k of list) {
      const left = this.available.get(k) ?? 0;
      if (left > 0) {
        this.available.set(k, left - 1);
        return true;
      }
    }
    const primary = list[0];
    this.fileIncluded.set(primary, (this.fileIncluded.get(primary) ?? 0) + 1);
    return false;
  }

  endFile() {
    for (const [fp, n] of this.fileIncluded) {
      this.pool.set(fp, (this.pool.get(fp) ?? 0) + n);
    }
    this.fileIncluded = new Map();
  }
}
