import * as cheerio from 'cheerio';

export const config = { maxDuration: 10 };

// Iris Salten sin tømmekalender-side for denne adressen. Ikke et offisielt
// API — dette er skraping av ekte HTML. Endrer Iris strukturen sin
// (klassenavnene under), slutter parsingen å finne noe, og handleren under
// returnerer da en tom liste i stedet for å krasje.
const URL = 'https://iris-salten.no/privat/tommeplan/?lookup=3f31203b-fd52-4343-afdb-7eff87b1d24e&address=Storgata%2088%20H0303&municipality=Bod%C3%B8%20kommune';
const ADDRESS = 'Storgata 88 H303';

const MONTHS_NO = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
];

export interface WasteType {
  name: string;
  /** Grov kategori for ikon/farge på frontend — ikke fra kilden, utledet av navnet. */
  category: 'plast' | 'mat' | 'papir' | 'rest' | 'glass' | 'hage' | 'annet';
}

export interface Pickup {
  date: string;       // yyyy-mm-dd
  weekday: string;     // «Onsdag» — som oppgitt av kilden
  dateLabel: string;   // «5. august»
  types: WasteType[];
}

function categorize(label: string): WasteType['category'] {
  const l = label.toLowerCase();
  if (l.includes('plast')) return 'plast';
  if (l.includes('mat')) return 'mat';
  if (l.includes('papir') || l.includes('papp')) return 'papir';
  if (l.includes('rest')) return 'rest';
  if (l.includes('glass') || l.includes('metall')) return 'glass';
  if (l.includes('hage')) return 'hage';
  return 'annet';
}

// Kilden oppgir kun dag + måned på hver dato («Onsdag 5. august»), og året
// separat på måned-overskriften («August 2026») — de kombineres her.
function parsePickups(html: string): Pickup[] {
  const $ = cheerio.load(html);
  const out: Pickup[] = [];

  $('.calendar__item').each((_, monthEl) => {
    const titleText = $(monthEl).find('.calendar__title').first().text().trim().toLowerCase();
    const titleMatch = titleText.match(/([a-zæøå]+)\s+(\d{4})/);
    if (!titleMatch) return;
    const monthIdx = MONTHS_NO.indexOf(titleMatch[1]);
    const year = Number(titleMatch[2]);
    if (monthIdx < 0 || !Number.isFinite(year)) return;

    $(monthEl).find('.calendar__list > li').each((_, li) => {
      const dateText = $(li).find('.calendar__date').first().text().trim();
      const dayMatch = dateText.match(/(\d{1,2})\./);
      if (!dayMatch) return;
      const day = Number(dayMatch[1]);
      const weekday = dateText.split(/\s+/)[0] ?? '';

      const types: WasteType[] = [];
      $(li).find('.calendar__fraction .calendar__label').each((_, labelEl) => {
        const name = $(labelEl).text().trim();
        if (name) types.push({ name, category: categorize(name) });
      });
      if (!types.length) return;

      const date = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      out.push({ date, weekday, dateLabel: `${day}. ${MONTHS_NO[monthIdx]}`, types });
    });
  });

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Skraper + parser Iris-siden til den fulle, tidssorterte listen over
// hentinger. Eksportert slik at api/cron/rollover.ts kan lese nøyaktig
// samme kilde som "Neste plast"-linja i klokke-boksen bruker,
// i stedet for å vedlikeholde en egen kopi av skrapingen (jf. Prisjakt-
// dupliseringen lenger opp i rollover.ts — den er kun nødvendig fordi den
// delte filen der ligger under `_lib`, som Vercel utelater fra bygget.
// tommeplan.ts har ikke det problemet: det er en vanlig, ikke-understreket
// fil under /api og kan importeres trygt fra andre funksjoner).
export async function fetchPickups(): Promise<Pickup[]> {
  const resp = await fetch(URL, {
    headers: { 'User-Agent': 'Felles-App/1.0 div@ofrim.no' },
    signal: AbortSignal.timeout(9000),
  });
  if (!resp.ok) throw new Error(`Iris svarte ${resp.status}`);
  const html = await resp.text();
  const all = parsePickups(html);

  // Skrapingen fant ingen datoer i det hele tatt — sannsynligvis har Iris
  // endret HTML-strukturen sin. Behandle det som en feil, ikke en tom (men
  // gyldig) liste, så kallere kan skille «ingen kommende tømming» fra
  // «parsingen er ødelagt».
  if (all.length === 0) throw new Error('Fant ingen tømmedatoer — siden kan ha endret struktur');

  return all;
}

export default async function handler(_req: any, res: any) {
  try {
    const all = await fetchPickups();
    const todayOslo = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
    const upcoming = all.filter(p => p.date >= todayOslo).slice(0, 8);

    res.setHeader('Cache-Control', 's-maxage=3600');
    res.status(200).json({ address: ADDRESS, pickups: upcoming, updatedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Ukjent feil' });
  }
}
