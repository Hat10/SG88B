// Revolut «account statement» (.csv, kommaseparert):
//   Type,Produkt,Startdato,Fullført på dato,Beskrivelse,Beløp,Gebyr,Valuta,Delstat,Saldo
//   Kortbetaling,Brukskonto,2026-05-01 16:11:13,2026-05-02 11:12:47,Vipps,-23.00,0.00,NOK,Fullført,19817.98
//
// Beskrivelsen er allerede et rent butikknavn. Gebyret er et reelt trekk og
// foldes inn i beløpet. Rader i utenlandsk valuta beholder `currency` slik at
// UI-et kan kreve en vekslingskurs før import. TILBAKEFØRT/ventende rader blir
// synlige rader med kindHint 'reversed' (auto-utelatt) — ikke usynlige.

import type { ParseResult, RawTx, UnparsedLine } from './types';
import { splitCsvLine, mapColumns, parseAmount, round2 } from './csv';

const COLS = ['Type', 'Startdato', 'Beskrivelse', 'Beløp', 'Gebyr', 'Valuta', 'Delstat'] as const;

export function parseRevolut(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const rows: RawTx[] = [];
  const unparsed: UnparsedLine[] = [];

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { rows, unparsed, fileError: 'Fila er tom.' };

  const col = mapColumns(splitCsvLine(lines[headerIdx], ','), [...COLS]);
  if (!col) {
    return {
      rows, unparsed,
      fileError: `Fant ikke Revolut-kolonnene (Type/Startdato/Beskrivelse/Beløp/…) — er dette en Revolut-kontoutskrift? Header: «${lines[headerIdx].slice(0, 120)}»`,
    };
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const lineNo = i + 1;

    const f = splitCsvLine(line, ',');
    const need = Math.max(...Object.values(col)) + 1;
    if (f.length < need) {
      unparsed.push({ line: lineNo, raw: line, reason: `for få kolonner (${f.length}, trenger ${need})` });
      continue;
    }

    const type = f[col['Type']];
    const dateMatch = f[col['Startdato']].match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!dateMatch) {
      unparsed.push({ line: lineNo, raw: line, reason: `ugyldig dato «${f[col['Startdato']]}»` });
      continue;
    }

    const beskrivelse = f[col['Beskrivelse']].replace(/\s+/g, ' ').trim();
    if (!beskrivelse) {
      unparsed.push({ line: lineNo, raw: line, reason: 'mangler beskrivelse' });
      continue;
    }

    const belop = parseAmount(f[col['Beløp']]);
    const gebyr = f[col['Gebyr']] ? parseAmount(f[col['Gebyr']]) : 0;
    if (isNaN(belop)) {
      unparsed.push({ line: lineNo, raw: line, reason: `uparsbart beløp «${f[col['Beløp']]}»` });
      continue;
    }

    // Gebyret trekkes alltid i tillegg — fold det inn så totalen matcher saldoendringen.
    const amount = round2(belop - (isNaN(gebyr) ? 0 : gebyr));
    if (amount === 0) {
      unparsed.push({ line: lineNo, raw: line, reason: 'beløpet er 0' });
      continue;
    }

    const delstat = (f[col['Delstat']] ?? '').toLowerCase();
    const cur = (f[col['Valuta']] || 'NOK').trim().toUpperCase();

    const tx: RawTx = {
      date: dateMatch[1],
      amount,
      rawDescription: beskrivelse,
      meta: dateMatch[2] ? { purchasedAt: `${dateMatch[1]} ${dateMatch[2]}:${dateMatch[3]}` } : {},
    };
    if (cur !== 'NOK') tx.currency = cur;
    if (gebyr > 0) tx.fee = gebyr;

    // Ufullført/tilbakeført → synlig, men auto-utelatt
    if (delstat && delstat !== 'fullført') tx.kindHint = 'reversed';
    // Påfylling / veksling inn på kontoen er en intern flytting
    else if (/påfylling|veksl|exchange|utveksling|overføring/i.test(type)) tx.kindHint = 'internal';
    else if (/belønning/i.test(type)) tx.kindHint = 'income';

    rows.push(tx);
  }

  return { rows, unparsed };
}

export function looksLikeRevolut(text: string): boolean {
  const head = text.slice(0, 300);
  return /type\s*,.*startdato|startdato.*,.*beskrivelse/i.test(head);
}
