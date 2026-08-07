// Skiller butikktekst fra transportstøy og fanger metadata — sletter aldri
// informasjon, den flyttes til meta og vises i UI-et.
//
// Eksempler fra ekte DNB-rader:
//   "Varekjøp Sykehusapoteket Trondheimsve Oslo Dato 02.06 kl. 18.04"
//        → merchantText «Sykehusapoteket Trondheimsve Oslo», meta.purchasedAt 2026-06-02 18:04
//   "Visa  100122  Usd 25,00 Anthropic: Claude sValutakurs: 9,4840"
//        → merchantText «Anthropic: Claude s», meta {USD 25,00, kurs 9,4840}
//   "TrumfPay, KIWI 274 Hasleveien, 2026-07-15 10.54.33"
//        → merchantText «KIWI 274 Hasleveien», meta.purchasedAt 2026-07-15 10:54

import type { NormTx, RawTx, TxMeta } from './types';
import { parseAmount } from './csv';

// Aliasnøkkel: konservativ normalisering — lowercase + kollapset whitespace.
// Ingen aggressiv vask her; visningsnavnet kommer fra butikken aliaset peker på.
export function aliasKeyOf(merchantText: string): string {
  return merchantText.toLowerCase().replace(/\s+/g, ' ').trim();
}

// "DD.MM" (+ ev. "HH.MM") + transaksjonsdato → 'YYYY-MM-DD[ HH:MM]'.
// Årstall utledes fra transaksjonsdatoen; Dato 28.12 på en januar-transaksjon
// hører til året før.
function purchasedAtFrom(txDate: string, ddmm: string, hhmm?: string): string {
  const [dd, mm] = ddmm.split('.');
  let year = parseInt(txDate.slice(0, 4), 10);
  const txMonth = parseInt(txDate.slice(5, 7), 10);
  if (parseInt(mm, 10) > txMonth + 6) year -= 1;   // årsskifte
  const date = `${year}-${mm}-${dd}`;
  return hhmm ? `${date} ${hhmm.replace('.', ':')}` : date;
}

interface Extracted { merchantText: string; meta: TxMeta; kindHint?: RawTx['kindHint'] }

// ─── DNB ──────────────────────────────────────────────────────────────────────

const DATO_KL = /\s+Dato\s+(\d{2}\.\d{2})(?:\s+kl\.?\s+(\d{2}\.\d{2}))?\s*$/i;
const CURRENCIES = 'Nok|Usd|Eur|Gbp|Sek|Dkk|Chf|Pln|Jpy|Thb';

function extractDnb(raw: string, txDate: string): Extracted {
  let m: RegExpMatchArray | null;

  // Interne kontoflyttinger ("Kontoregulering  723 Mobil Overføring")
  if (/^kontoregulering\b/i.test(raw)) {
    return { merchantText: 'Kontoregulering', meta: { channel: 'kontoregulering' }, kindHint: 'internal' };
  }

  // Boliglån: "Lån  514528 Lån 1516.02.29885 Avdrag Kr 5.563,85Renter Kr 12.679,15"
  if (/^lån\s+/i.test(raw)) {
    const meta: TxMeta = { channel: 'lån' };
    const avdrag = raw.match(/avdrag\s*kr\s*([\d. ]*\d,\d{2})/i);
    const renter = raw.match(/renter\s*kr\s*([\d. ]*\d,\d{2})/i);
    if (avdrag) meta.loanPrincipal = parseAmount(avdrag[1]);
    if (renter) meta.loanInterest = parseAmount(renter[1]);
    const ref = raw.match(/lån\s+([\d.]+)\s+avdrag/i);
    if (ref) meta.reference = ref[1];
    return { merchantText: 'Boliglån', meta };
  }

  // Kortkjøp med kjøpstidspunkt bakerst
  //   "E-varekjøp Vipps MERCHANT Dato DD.MM kl. HH.MM"
  //   "E-varekjøp MERCHANT Dato DD.MM kl. HH.MM"
  //   "Varekjøp MERCHANT Dato DD.MM kl. HH.MM"
  m = raw.match(/^(E-varekjøp\s+Vipps|E-varekjøp|Varekjøp)\s+(.+?)(?=\s+Dato\s+\d)/i);
  if (m) {
    const dk = raw.match(DATO_KL);
    const meta: TxMeta = { channel: /vipps/i.test(m[1]) ? 'vipps' : /^e-/i.test(m[1]) ? 'netthandel' : 'kort' };
    if (dk) meta.purchasedAt = purchasedAtFrom(txDate, dk[1], dk[2]);
    return { merchantText: m[2], meta };
  }
  // Samme mønstre uten "Dato"-hale (defensivt)
  m = raw.match(/^(E-varekjøp\s+Vipps|E-varekjøp|Varekjøp)\s+(.+)$/i);
  if (m) {
    return { merchantText: m[2], meta: { channel: /vipps/i.test(m[1]) ? 'vipps' : 'kort' } };
  }

  // Visa med valuta: "Visa  100122  Usd 25,00 Anthropic: Claude sValutakurs: 9,4840"
  m = raw.match(new RegExp(`^Visa\\s+\\d+\\s+(${CURRENCIES})\\s+([\\d. ]*\\d,\\d{2})\\s+(.+)$`, 'i'));
  if (m) {
    const meta: TxMeta = { channel: 'visa' };
    const cur = m[1].toUpperCase();
    let rest = m[3];
    const kurs = rest.match(/valutakurs:\s*([\d,.]+)/i);
    if (kurs) {
      meta.fxRate = parseAmount(kurs[1]);
      rest = rest.slice(0, rest.toLowerCase().indexOf('valutakurs:')).trim();
    }
    if (cur !== 'NOK') {
      meta.origCurrency = cur;
      meta.origAmount = parseAmount(m[2]);
    }
    return { merchantText: rest, meta };
  }

  // Visa uten valuta: "Visa  100021  Compass Group Norge AS"
  m = raw.match(/^Visa\s+\d+\s+(.+)$/i);
  if (m) return { merchantText: m[1], meta: { channel: 'visa' } };

  // Giro: "Giro  1374 Gjensidige Forsikring Asa AvtalegiroGjensidige…"
  //       "Giro  724 Norgesgruppen Trumf Efaktura"
  //       "Giro  1375 Norgesgruppen Finans AS Mobil Betaling"
  m = raw.match(/^Giro\s+\d+\s+(.+)$/i);
  if (m) {
    const meta: TxMeta = { channel: 'giro' };
    let rest = m[1];
    const cut = rest.match(/\s*(Efaktura|Avtalegiro|Mobil\s+Betaling)/i);
    if (cut && cut.index !== undefined) {
      meta.channel = cut[1].toLowerCase().replace(/\s+/g, ' ');
      const after = rest.slice(cut.index + cut[0].length).trim();
      if (after) meta.message = after;
      rest = rest.slice(0, cut.index).trim();
    }
    return { merchantText: rest, meta };
  }

  // Autogiro: "Autogiro Ark.ref *87153488 Dato 24.06 Kjøp Kron" / "Autogiro Kjøp Kron"
  if (/^autogiro\b/i.test(raw)) {
    const meta: TxMeta = { channel: 'autogiro' };
    const ref = raw.match(/ark\.?ref\s*(\*?\d+)/i);
    if (ref) meta.reference = ref[1];
    const dato = raw.match(/dato\s+(\d{2}\.\d{2})/i);
    if (dato) meta.purchasedAt = purchasedAtFrom(txDate, dato[1]);
    const kjop = raw.match(/kjøp\s+(.+)$/i);
    return { merchantText: kjop ? kjop[1] : raw.replace(/^autogiro\s*/i, ''), meta };
  }

  // Lønn / trygd / utbytte → inntekt
  m = raw.match(/^Lønn\s+(?:\d+\s+)?(.+)$/i);
  if (m) return { merchantText: m[1], meta: { channel: 'lønn' }, kindHint: 'income' };
  m = raw.match(/^Pensjon\s+Eller\s+Trygd\s+(?:\d+\s+)?(.+)$/i);
  if (m) return { merchantText: m[1], meta: { channel: 'trygd' }, kindHint: 'income' };
  m = raw.match(/^Utbytte\s+(?:\d+\s+)?(.+)$/i);
  if (m) return { merchantText: m[1].replace(/^utbytte\s+/i, ''), meta: { channel: 'utbytte' }, kindHint: 'income' };

  // Overføringer: "Overføring Innland  635 Leah Kristoffersen Larsen"
  //               "Overføring  4602960583 Hermann Rødset Theimann FotballTpp: Vipps Mobilepay AS"
  //               "Overføring Jo Mikkel Nysæther Ofrim Ref:8cgg44k8kmhn"
  m = raw.match(/^Overføring(?:\s+Innland)?\s+(.+)$/i);
  if (m) {
    const meta: TxMeta = { channel: 'overføring' };
    let rest = m[1].replace(/^\d+\s+/, '');           // løpenummer foran navnet
    const tpp = rest.match(/\s*(?:Betaling\s*)?Tpp:.*$/i);
    if (tpp && tpp.index !== undefined) {
      meta.message = rest.slice(tpp.index).replace(/^\s*/, '');
      rest = rest.slice(0, tpp.index).trim();
    }
    const ref = rest.match(/\s*Ref:(\S+)\s*$/i);
    if (ref && ref.index !== undefined) {
      meta.reference = ref[1];
      rest = rest.slice(0, ref.index).trim();
    }
    return { merchantText: rest, meta, kindHint: 'transfer' };
  }

  return { merchantText: raw, meta: {} };
}

// ─── Trumf ────────────────────────────────────────────────────────────────────

function extractTrumf(raw: string): Extracted {
  // "TrumfPay, KIWI 274 Hasleveien, 2026-07-15 10.54.33" (klokkeslett kan mangle)
  const tp = raw.match(/^TrumfPay,?\s+(.+?),?\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2})\.(\d{2})(?:\.\d{2})?)?\s*,?$/i);
  if (tp) {
    const meta: TxMeta = { channel: 'trumfpay' };
    meta.purchasedAt = tp[3] ? `${tp[2]} ${tp[3]}:${tp[4]}` : tp[2];
    return { merchantText: tp[1], meta };
  }
  const tpPlain = raw.match(/^TrumfPay,?\s+(.+)$/i);
  if (tpPlain) return { merchantText: tpPlain[1].replace(/,\s*$/, ''), meta: { channel: 'trumfpay' } };

  if (/^innbetaling\b/i.test(raw)) {
    return { merchantText: 'Innbetaling Trumf', meta: { channel: 'giro' }, kindHint: 'card_settlement' };
  }
  return { merchantText: raw, meta: { channel: 'trumf-visa' } };
}

// ─── Felles inngang ───────────────────────────────────────────────────────────

export type SourceKind = 'dnb' | 'revolut' | 'trumf';

export function normalizeTx(tx: RawTx, source: SourceKind): NormTx {
  const ex: Extracted =
    source === 'dnb'   ? extractDnb(tx.rawDescription, tx.date) :
    source === 'trumf' ? extractTrumf(tx.rawDescription) :
    { merchantText: tx.rawDescription, meta: {} };   // Revolut-beskrivelser er allerede rene

  const merchantText = ex.merchantText.replace(/\s+/g, ' ').trim() || tx.rawDescription;
  return {
    ...tx,
    merchantText,
    aliasKey: aliasKeyOf(merchantText),
    meta: { ...ex.meta, ...tx.meta },                 // parserens meta (kjøpstid m.m.) vinner
    kindHint: tx.kindHint ?? ex.kindHint,
  };
}

// ─── Forslag til visningsnavn for NYE butikker ────────────────────────────────
// Brukes kun når fuzzy-match ikke fant noe — brukeren kan alltid overstyre.

const CITY_RE = /\s+(oslo|bergen|stavanger|trondheim|tromsø|drammen|kristiansand|bærum|asker|lillestrøm|sandnes|bodø|skien|tønsberg|ålesund|haugesund|fredrikstad|fredri|moss|hamar|gjøvik|stathelle)\s*$/i;
const STREET_RE = /\s+\S*(?:veien|vegen|gata|gaten|gate|plassen|torget|torvet|allé|alle|svei|vei|vn|gt|sgt)\.?\s*\d*\w*\s*$/i;

export function suggestDisplayName(merchantText: string): string {
  let s = merchantText.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+(asa|as|ab|sa|norge as|norway as)\s*$/i, '');
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(CITY_RE, '');
    s = s.replace(STREET_RE, '');
    s = s.replace(/\s+\d+\s*$/, '');          // butikknummer bakerst
    if (s === before) break;
  }
  s = s.replace(/\s*[,:;*]+\s*$/, '').trim();
  if (!s) s = merchantText.trim();
  // Tittelkasing av HELROPTE navn ("KIWI 336 TORSHOV" → "Kiwi 336 Torshov")
  if (s === s.toUpperCase() && /[A-ZÆØÅ]{4}/.test(s)) {
    s = s.toLowerCase().replace(/(^|[\s\-&/])([a-zæøå])/g, (_, pre, ch) => pre + ch.toUpperCase());
  }
  return s;
}
