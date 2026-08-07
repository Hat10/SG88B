// Tekst- og CSV-verktøy for bankfiler.

// ─── Dekoding ─────────────────────────────────────────────────────────────────

// Dekod filbytes → tekst. Prøver UTF-8 strengt; faller tilbake til ISO-8859-1
// (eldre DNB-eksporter) hvis UTF-8 feiler. Fjerner BOM.
export function decodeText(buffer: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('iso-8859-1').decode(buffer);
  }
  return text.replace(/^\uFEFF/, '');
}

// ─── 7-bits norsk tegnreparasjon ──────────────────────────────────────────────
// Gamle banksystemer sender æøå som {|} (NS 4551-1): "Nys{ther" = "Nysæther".
// Reparerer kun når tegnet står mellom bokstaver, så ekte klammer overlever.

const SEVEN_BIT: Record<string, string> = { '{': 'æ', '|': 'ø', '}': 'å', '[': 'Æ', '\\': 'Ø', ']': 'Å' };

export function repairNorwegian7bit(s: string): string {
  return s.replace(
    /(?<=[A-Za-zÆØÅæøå])[{|}[\]\\](?=[A-Za-zÆØÅæøå])/g,
    ch => SEVEN_BIT[ch] ?? ch,
  );
}

// ─── CSV-splitting ────────────────────────────────────────────────────────────

// Splitter én CSV-linje med respekt for doble anførselstegn ("" = escaped ").
export function splitCsvLine(line: string, sep: ';' | ','): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(f => f.trim());
}

// Finn kolonneindekser ut fra headernavn (case-/whitespace-tolerant).
// Returnerer null hvis noen av `required` mangler.
export function mapColumns(
  headerFields: string[],
  required: string[],
): Record<string, number> | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const idx: Record<string, number> = {};
  const fields = headerFields.map(norm);
  for (const name of required) {
    const i = fields.indexOf(norm(name));
    if (i === -1) return null;
    idx[name] = i;
  }
  return idx;
}

// ─── Beløp ────────────────────────────────────────────────────────────────────

// Norsk/blandet tallformat → number. Håndterer "10027.2", "1147,02",
// "12.157,59", "1 234,56" og "-345,60". NaN hvis uparsbar.
export function parseAmount(s: string): number {
  const t = s.replace(/[\s ]/g, '');
  if (!t) return NaN;
  if (t.includes(',')) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  return parseFloat(t);
}

// Avrund til 2 desimaler (unngår flyttallsstøy ved summering/gebyrfolding).
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
