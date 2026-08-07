// Delte typer for importpipelinen (v2).
//
// Kjedens flyt:  fil → parse<Kilde>() → RawTx[] (+ unparsed-regnskap)
//                → normalize<Kilde>() → NormTx (butikktekst skilt fra støy, metadata fanget)
//                → match()            → alias-treff / fuzzy-forslag
//                → classify()         → kind + inkludert/utelatt som standard
//                → dedupe()           → fingerprint + duplikatmerking

// Transaksjonstype — styrer standardvalg i review og lagres på raden.
export type TxKind =
  | 'purchase'        // vanlig kjøp (utgift)
  | 'refund'          // penger inn fra butikk — motregnes i butikkens kategori
  | 'income'          // lønn, trygd, utbytte, annen inntekt
  | 'investment'      // sparing: innskudd til / uttak fra fond, BSU o.l. — verken forbruk eller inntekt
  | 'internal'        // flytting mellom egne kontoer (kontoregulering, Revolut-påfylling)
  | 'card_settlement' // innbetaling til kredittkort (dekkes av kortets egen import)
  | 'p2p';            // privat overføring til/fra person (Vipps o.l.)

// Strukturert metadata trukket ut av råteksten — bevares i stedet for å slettes.
export interface TxMeta {
  channel?: string;       // 'visa' | 'vipps' | 'kort' | 'giro' | 'avtalegiro' | 'efaktura' | 'autogiro' | 'trumfpay' | ...
  purchasedAt?: string;   // 'YYYY-MM-DD' eller 'YYYY-MM-DD HH:MM' — faktisk kjøpstidspunkt
  bookedDate?: string;    // bokføringsdato når den avviker fra kjøpsdato
  origCurrency?: string;  // 'USD' — når kjøpet var i utenlandsk valuta
  origAmount?: number;    // beløp i origCurrency
  fxRate?: number;        // valutakurs brukt (fra banken eller lagt inn ved import)
  reference?: string;     // bankens referanse ('Ark.ref *87153488', 'Ref:8cgg…')
  message?: string;       // fritekstmelding ('Periode: 01.07.2026 - …')
  intermediary?: string;  // 'vipps' | 'klarna' | … når butikken ble navngitt bak en betalingsformidler
  loanPrincipal?: number; // avdrag (lånerader)
  loanInterest?: number;  // renter (lånerader)
}

// Rå transaksjon rett fra parseren — før normalisering.
export interface RawTx {
  date: string;            // 'YYYY-MM-DD'
  amount: number;          // negativ = ut, positiv = inn (NOK med mindre currency er satt)
  rawDescription: string;  // bankens tekst, 7-bits-reparert men ellers urørt
  currency?: string;       // satt når beløpet IKKE er NOK ennå (Revolut-lomme)
  fee?: number;            // gebyr som er foldet inn i amount (Revolut)
  meta?: TxMeta;           // kildespesifikke felt parseren allerede vet (Trumf: kjøpstid)
  kindHint?: 'internal' | 'income' | 'card_settlement' | 'transfer' | 'reversed';
}

// Linje som ikke kunne tolkes — vises i UI så ingenting forsvinner stille.
export interface UnparsedLine {
  line: number;   // 1-basert linjenummer i fila (0 = ukjent, f.eks. PDF)
  raw: string;
  reason: string; // 'feil antall kolonner', 'ugyldig dato', 'mangler beløp', …
}

export interface ParseResult {
  rows: RawTx[];
  unparsed: UnparsedLine[];
  /** Feil som gjelder hele fila (feil filtype i sonen o.l.) — ingen rader da. */
  fileError?: string;
}

// Normalisert transaksjon — butikktekst skilt fra transportstøy.
export interface NormTx extends RawTx {
  merchantText: string; // teksten som identifiserer motparten ('KIWI 274 Hasleveien')
  aliasKey: string;     // normalisert nøkkel for merchant_aliases ('kiwi 274 hasleveien')
  meta: TxMeta;
}

// ─── Butikkregister (speiler DB-tabellene) ────────────────────────────────────

export type MerchantKind = 'merchant' | 'person' | 'internal' | 'settlement' | 'intermediary';

export interface Merchant {
  id: string;
  name: string;
  category: string;
  kind: MerchantKind;
}

export interface MerchantAlias {
  alias: string;
  merchant_id: string;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

export type MatchResult =
  | { type: 'exact'; merchant: Merchant }                       // alias-treff → anvendes automatisk
  | { type: 'suggestion'; merchant: Merchant; score: number }   // fuzzy — må bekreftes
  | { type: 'none'; suggestedName: string; suggestedCategory: string };

// ─── Klassifisering ───────────────────────────────────────────────────────────

export interface Classified {
  kind: TxKind;
  includedByDefault: boolean;
  excludeReason?: string;   // 'intern overføring', 'kortoppgjør', 'duplikat', 'tilbakeført', …
  /** Vipps/Klarna-rad der hver transaksjon er en egen butikk — navngis per rad, aldri alias. */
  needsPerTxName?: boolean;
}

// Én ferdig annotert rad klar for review-UI-et.
export interface ReviewTx {
  norm: NormTx;
  match: MatchResult;
  cls: Classified;
  fingerprint: string;
  isDuplicate: boolean;
}
