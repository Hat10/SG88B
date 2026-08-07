// DNB kontoutskrift (.txt/.csv, semikolonseparert).
//
//   "Dato";"Forklaring";"Rentedato";"Ut fra konto";"Inn på konto"
//   "08.06.2026";"Overføring Innland  83328 Andreas Attila Stenberg ";"08.06.2026";"";10027.2
//
// Kolonnene slås opp fra headerraden ved navn, så rekkefølge/ekstra kolonner
// tåles. Hver datarad blir enten en RawTx eller en unparsed-oppføring med
// grunn — aldri et stille drop.

import type { ParseResult, RawTx, UnparsedLine } from './types';
import { splitCsvLine, mapColumns, parseAmount, repairNorwegian7bit, round2 } from './csv';

const COLS = ['Dato', 'Forklaring', 'Ut fra konto', 'Inn på konto'] as const;

// "DD.MM.YYYY" → "YYYY-MM-DD" (null hvis ugyldig)
function parseNorDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${mo}-${d}`;
}

export function parseDnb(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const rows: RawTx[] = [];
  const unparsed: UnparsedLine[] = [];

  // Finn headerraden (første ikke-tomme linje)
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { rows, unparsed, fileError: 'Fila er tom.' };

  const headerFields = splitCsvLine(lines[headerIdx], ';');
  const col = mapColumns(headerFields, [...COLS]);
  if (!col) {
    return {
      rows, unparsed,
      fileError: `Fant ikke DNB-kolonnene (Dato/Forklaring/Ut fra konto/Inn på konto) i headerraden — er dette en DNB-eksport? Header: «${lines[headerIdx].slice(0, 120)}»`,
    };
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const lineNo = i + 1;

    const f = splitCsvLine(line, ';');
    const need = Math.max(...Object.values(col)) + 1;
    if (f.length < need) {
      unparsed.push({ line: lineNo, raw: line, reason: `for få kolonner (${f.length}, trenger ${need})` });
      continue;
    }

    const date = parseNorDate(f[col['Dato']]);
    if (!date) {
      unparsed.push({ line: lineNo, raw: line, reason: `ugyldig dato «${f[col['Dato']]}»` });
      continue;
    }

    const forklaring = repairNorwegian7bit(f[col['Forklaring']]).replace(/\s+/g, ' ').trim();
    if (!forklaring) {
      unparsed.push({ line: lineNo, raw: line, reason: 'mangler forklaring' });
      continue;
    }

    const utStr  = f[col['Ut fra konto']];
    const innStr = f[col['Inn på konto']];
    const ut  = utStr  ? parseAmount(utStr)  : 0;
    const inn = innStr ? parseAmount(innStr) : 0;
    if ((utStr && isNaN(ut)) || (innStr && isNaN(inn))) {
      unparsed.push({ line: lineNo, raw: line, reason: `uparsbart beløp «${utStr || innStr}»` });
      continue;
    }

    const amount = round2(inn > 0 ? inn : -ut);
    if (amount === 0) {
      unparsed.push({ line: lineNo, raw: line, reason: 'beløpet er 0' });
      continue;
    }

    rows.push({ date, amount, rawDescription: forklaring });
  }

  return { rows, unparsed };
}

// Rask innholdssjekk: ser dette ut som en DNB-eksport? (Til sonevalidering.)
export function looksLikeDnb(text: string): boolean {
  const head = text.slice(0, 300);
  return /dato.*;.*forklaring/i.test(head);
}
