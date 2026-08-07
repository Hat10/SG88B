// Betalingsformidlere (Vipps, Klarna, PayPal …).
//
// Problemet dette løser: når banken bare skriver formidlerens navn — «Vipps»,
// «Klarna» — er den faktiske butikken ikke i teksten i det hele tatt. Alle slike
// rader normaliserer da til SAMME aliasnøkkel. Navngir man den første («Bikester»),
// treffer hver senere rad det aliaset eksakt og blir stille omdøpt til Bikester —
// selv om kjøpet i virkeligheten var hos Akademika.
//
// Derfor gjenkjennes formidlere på teksten, ikke bare på butikkregisteret: vernet
// virker fra første import, og et allerede innlært (feil) alias kan ikke overstyre det.
//
// Rader der butikken ER synlig bak formidleren («Vipps Ruter Oslo», «Svea
// brekkesport.no») er IKKE dekket her — der har normalisereren allerede trukket ut
// butikken, og vanlig matching skal gjelde.

// Navn som i seg selv bare betyr «en betaling gikk via denne aktøren»
const INTERMEDIARY = new Set([
  'vipps', 'mobilepay', 'klarna', 'paypal', 'stripe', 'svea', 'walley',
  'collector', 'qliro', 'resurs', 'zettle', 'izettle', 'sumup', 'nets',
]);

// Selskapshaler som ikke gjør teksten mer identifiserende
const FILLER = new Set([
  'as', 'asa', 'ab', 'a/s', 'sa', 'no', 'norge', 'norway', 'nuf', 'oy', 'aps',
  'bank', 'payments', 'payment', 'pay', 'group', 'checkout', 'financial', 'services',
]);

const tokens = (s: string) =>
  s.toLowerCase().split(/[^a-zæøåéèüöä0-9]+/).filter(Boolean);

/**
 * Er butikkteksten BARE en formidler, uten noe som identifiserer butikken bak?
 *
 *   «Vipps»                → true   (butikken er skjult)
 *   «Vipps Mobilepay AS»   → true   (formidlerselskapet selv)
 *   «Klarna»               → true
 *   «Vipps Ruter Oslo»     → false  (Ruter er synlig)
 *   «Svea brekkesport.no»  → false  (brekkesport er synlig)
 *   «Klarna Member»        → false  (egen Klarna-post, ikke en skjult butikk)
 */
export function isBareIntermediary(merchantText: string): boolean {
  const ts = tokens(merchantText);
  if (!ts.length) return false;
  // Minst ett formidlernavn, og ingenting annet enn formidlernavn/selskapshaler
  return ts.some(t => INTERMEDIARY.has(t))
    && ts.every(t => INTERMEDIARY.has(t) || FILLER.has(t) || /^\d+$/.test(t));
}
