// Klassifisering: transaksjonstype + om raden er inkludert som standard.
// ALT vises i review — klassifisering bestemmer bare avhukingen og merkelappen,
// aldri om en rad er synlig.
//
// Viktig sikring: auto-utelatelse skjer kun på EKSAKTE signaler (alias-treff
// eller strukturelt kindHint fra parseren/normalisereren) — aldri på fuzzy-
// forslag, så en gjetning kan ikke stille utelate ekte forbruk.

import type { Classified, MatchResult, Merchant, NormTx } from './types';
import { isBareIntermediary } from './intermediaries';

// Penger INN fra en butikk i disse kategoriene er inntekt — ALDRI refusjon.
// (Lønn fra Netcompany skal ikke nettes mot forbruk.)
const NON_REFUND_CATS = new Set(['inntekt', 'overføring']);

function moneyInKind(tx: NormTx, merchant: Merchant): 'income' | 'refund' | 'investment' {
  // Uttak fra investering (Kron/Nordnet/BSU) er sparing i revers — ikke inntekt
  if (merchant.category === 'investering') return 'investment';
  return tx.kindHint === 'income' || NON_REFUND_CATS.has(merchant.category) ? 'income' : 'refund';
}

export function classifyTx(tx: NormTx, match: MatchResult): Classified {
  // Ikke gjennomførte/tilbakeførte rader (Revolut TILBAKEFØRT)
  if (tx.kindHint === 'reversed') {
    return { kind: 'purchase', includedByDefault: false, excludeReason: 'tilbakeført / ikke gjennomført' };
  }

  // Butikkteksten er BARE en formidler («Vipps», «Klarna») — den ekte butikken
  // står ikke i teksten. Må navngis per rad, og aldri læres som alias: ellers
  // arver hver senere formidlerrad navnet fra den første.
  //
  // Dette står FØR alias-treffet med vilje. Er et slikt alias allerede lært
  // (f.eks. «vipps» → Bikester), skal det ikke lenger kunne overstyre — da ville
  // et gammelt feilnavn fortsatt skjule den faktiske butikken.
  if (isBareIntermediary(tx.merchantText)) {
    return { kind: 'purchase', includedByDefault: true, needsPerTxName: true };
  }

  // Eksakt alias-treff → butikkens kind styrer
  if (match.type === 'exact') {
    switch (match.merchant.kind) {
      case 'internal':
        return { kind: 'internal', includedByDefault: false, excludeReason: 'intern overføring' };
      case 'settlement':
        return { kind: 'card_settlement', includedByDefault: false, excludeReason: 'kortoppgjør — dekkes av kortets egen import' };
      case 'person':
        return { kind: 'p2p', includedByDefault: false, excludeReason: 'privat overføring' };
      case 'intermediary':
        return { kind: 'purchase', includedByDefault: true, needsPerTxName: true };
      case 'merchant':
        // Sparing er en egen førsteklasses type — innskudd OG uttak. Holder
        // fonds-/BSU-bevegelser utenfor både forbruks- og inntektstallene.
        if (match.merchant.category === 'investering') {
          return { kind: 'investment', includedByDefault: true };
        }
        return tx.amount > 0
          ? { kind: moneyInKind(tx, match.merchant), includedByDefault: true }
          : { kind: 'purchase', includedByDefault: true };
    }
  }

  // Unntak fra «aldri utelat på forslag»: interne/oppgjørs-butikker med FULL
  // tokendekning («Revolut::6268:» → Revolut). Uten dette telles Revolut-
  // påfyllinger og kortregninger dobbelt (kjøpene kommer via egen import).
  // Vises som forslag i review og kan hukes på igjen.
  if (match.type === 'suggestion' && match.score === 1) {
    if (match.merchant.kind === 'internal') {
      return { kind: 'internal', includedByDefault: false, excludeReason: 'intern overføring' };
    }
    if (match.merchant.kind === 'settlement') {
      return { kind: 'card_settlement', includedByDefault: false, excludeReason: 'kortoppgjør — dekkes av kortets egen import' };
    }
  }

  // Strukturelle hint fra parser/normaliserer
  switch (tx.kindHint) {
    case 'internal':
      return { kind: 'internal', includedByDefault: false, excludeReason: 'intern overføring' };
    case 'card_settlement':
      return { kind: 'card_settlement', includedByDefault: false, excludeReason: 'kortoppgjør — dekkes av kortets egen import' };
    case 'income':
      return { kind: 'income', includedByDefault: true };
    case 'transfer':
      // Person-/kontooverføring uten kjent mottaker → synlig, men avhuket
      // (huk på for f.eks. husleie betalt med Vipps)
      return { kind: 'p2p', includedByDefault: false, excludeReason: 'overføring til person/konto' };
  }

  // Penger inn uten annen info: refusjon hvis butikken er kjent/foreslått, ellers inntekt
  if (tx.amount > 0) {
    return match.type === 'suggestion' && match.merchant.kind === 'merchant'
      ? { kind: moneyInKind(tx, match.merchant), includedByDefault: true }
      : { kind: 'income', includedByDefault: true };
  }

  return { kind: 'purchase', includedByDefault: true };
}
