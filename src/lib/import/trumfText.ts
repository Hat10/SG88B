// Trumf Visa-faktura (PDF) — ren tekstlogikk, testbar uten pdfjs.
//
// Tabellformat (kolonner varierer litt mellom seksjoner):
//   Bokf. dato  Kjøpsdato  Spesifikasjon                    [Kurs Valuta Beløp]  Beløp i NOK
//   15.07.26    14.07.26   KIWI 336 Torsho OSLO             NOK -132,70          -132,70
//   13.07.26    13.07.26   TrumfPay, KIWI 274 Hasleveien, 2026-07-13 11.09.32  NOK -395,07  -395,07
//   17.06.26    17.06.26   Innbetaling                                          12.157,59
//
// Fallgruver håndtert her:
//  · Lange TrumfPay-rader bryter klokkeslettet ned på egen linje («18.34.37») —
//    limes tilbake på raden over.
//  · Beløpet som gjelder er ALLTID siste tallkolonne («Beløp i NOK») — ved
//    utenlandskjøp er nest siste beløpet i original valuta.
//  · «Innbetaling» (betaling av forrige faktura) er et kortoppgjør → synlig,
//    auto-utelatt.
// En linje som starter med to datoer, men ikke gir beløp, blir unparsed —
// aldri stille drop.

import type { ParseResult, RawTx, UnparsedLine } from './types';
import { parseAmount, round2 } from './csv';

export interface TextItem { page: number; x: number; y: number; str: string }

// ─── Linjebygging fra posisjonerte tekstelementer ─────────────────────────────
// Klynger elementer per side på Y-akse med toleranse (radavstanden i fakturaen
// er ~9pt; 3pt fanger skjeve grunnlinjer uten å slå sammen naborader).

const Y_TOLERANCE = 3;

export function buildTrumfLines(items: TextItem[]): string[] {
  const lines: string[] = [];
  const pages = [...new Set(items.map(i => i.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const rows: { y: number; items: TextItem[] }[] = [];
    const sorted = items.filter(i => i.page === page && i.str.trim()).sort((a, b) => b.y - a.y);
    for (const item of sorted) {
      const row = rows.find(r => Math.abs(r.y - item.y) <= Y_TOLERANCE);
      if (row) row.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    }
    for (const row of rows) {
      lines.push(row.items.sort((a, b) => a.x - b.x).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  return lines;
}

// ─── Radparsing ───────────────────────────────────────────────────────────────

// "DD.MM.YY" → "YYYY-MM-DD"
function parseShortDate(s: string): string {
  const [d, m, y] = s.split('.');
  const full = parseInt(y, 10) >= 70 ? `19${y}` : `20${y}`;
  return `${full}-${m}-${d}`;
}

// To datoer først = transaksjonsrad (Bokf. dato + Kjøpsdato)
const TX_RE = /^(\d{2}\.\d{2}\.\d{2})\s+(\d{2}\.\d{2}\.\d{2})\s+(.+)$/;
// Hale: [kurs] [valutakode] [beløp i valuta] <beløp i NOK>
const TAIL_RE = /(?:\s+(\d+,\d+))?(?:\s+(NOK|EUR|USD|GBP|SEK|DKK|CHF|PLN|JPY|THB))?(?:\s+(-?[\d. ]*\d,\d{2}))?\s+(-?[\d. ]*\d,\d{2})$/i;
// Brutt klokkeslett på egen linje ("18.34.37")
const WRAPPED_TIME_RE = /^\d{2}\.\d{2}\.\d{2}$/;

export function parseTrumfLines(lines: string[]): ParseResult {
  const rows: RawTx[] = [];
  const unparsed: UnparsedLine[] = [];
  let sawTable = false;

  for (const line of lines) {
    if (/transaksjonsoversikt/i.test(line)) sawTable = true;

    const m = line.match(TX_RE);
    if (!m) {
      // Klokkeslett brutt til egen linje → lim det tilbake på TrumfPay-raden
      // over (dens råtekst slutter da på en ISO-dato uten klokkeslett).
      const last = rows[rows.length - 1];
      if (WRAPPED_TIME_RE.test(line) && last && /\d{4}-\d{2}-\d{2}$/.test(last.rawDescription)) {
        last.rawDescription += ' ' + line;
      }
      continue;
    }

    const [, bookStr, purchStr, rest] = m;
    const tail = rest.match(TAIL_RE);
    if (!tail) {
      unparsed.push({ line: 0, raw: line, reason: 'fant ikke beløp på raden' });
      continue;
    }

    const [, kursStr, curStr, origStr, nokStr] = tail;
    const amount = round2(parseAmount(nokStr));
    if (isNaN(amount) || amount === 0) {
      unparsed.push({ line: 0, raw: line, reason: `uparsbart beløp «${nokStr}»` });
      continue;
    }

    const desc = rest.slice(0, rest.length - tail[0].length).replace(/\s+/g, ' ').trim();
    const date = parseShortDate(purchStr);   // kjøpsdato er den reelle forbruksdatoen
    const booked = parseShortDate(bookStr);

    const tx: RawTx = { date, amount, rawDescription: desc, meta: {} };
    if (booked !== date) tx.meta!.bookedDate = booked;

    const cur = curStr?.toUpperCase();
    if (cur && cur !== 'NOK' && origStr) {
      tx.meta!.origCurrency = cur;
      tx.meta!.origAmount = round2(parseAmount(origStr));
      if (kursStr) tx.meta!.fxRate = parseAmount(kursStr);
    }

    if (/^innbetaling\b/i.test(desc)) tx.kindHint = 'card_settlement';

    rows.push(tx);
  }

  if (!sawTable && rows.length === 0) {
    return { rows, unparsed, fileError: 'Fant ingen transaksjonstabell i PDF-en — er dette en Trumf Visa-faktura?' };
  }
  return { rows, unparsed };
}
