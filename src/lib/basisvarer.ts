// Ren logikk for «Legg til basisvarer for neste uke» (StapleManager på
// Handleliste-siden): hva som faktisk blir lagt til, bekreftelsesdialogens
// tekster, og hva «Angre» skal gjøre. Holdt utenfor komponenten/konteksten så
// den kan testes uten React og uten database — og så dialogen og selve
// innsettingen garantert bruker samme utregning (planBasisBatch).
//
// Viktig om datamodellen: grocery_items har en unik indeks på staple_item_id
// (grocery_items_staple_uidx) — én rad per basisvare for alltid. «Legge til»
// er derfor en upsert: enten opprettes en ny rad, eller en eksisterende
// AVHUKET rad (kjøpt tidligere) flippes tilbake til done: false. Angring må
// skille på de to: en ny rad slettes, mens en gjenaktivert rad settes tilbake
// til avhuket med sin gamle done_at (basis_prev_done_at) — den sto der fra
// før og skal aldri slettes.
import { handleukeStart } from '../hooks/useWeeklyBucket';
import { isStapleDueNextWeek, type GroceryItem, type StapleItem } from '../contexts/MatplanContext';

const addDaysKey = (key: string, n: number): string => {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Første dag (lørdag, yyyy-mm-dd) i handleuken ETTER den `today` ligger i. */
export function nextHandleukeStart(today: string): string {
  return addDaysKey(handleukeStart(new Date(today + 'T00:00:00Z')), 7);
}

/**
 * Brukt som basis_prev_done_at for en gjenaktivert rad som var avhuket uten
 * done_at (rader fra før done_at-kolonnen fantes). Ved angring blir raden
 * avhuket igjen med dette tidspunktet — langt utenfor «Vis handlet»-vinduet,
 * akkurat som en null done_at ville vært.
 */
export const LEGACY_DONE_AT = '1970-01-01T00:00:00.000Z';

export interface BasisAddition {
  staple: StapleItem;
  /** Eksisterende (avhuket) rad for basisvaren som gjenaktiveres, ellers null. */
  existingRowId: string | null;
  /** Lagres som basis_prev_done_at: null ⇒ ny rad (slettes ved angring). */
  prevDoneAt: string | null;
}

export interface BasisPlan {
  /** Lørdagen neste handleuke starter. */
  weekStart: string;
  /** Fredagen neste handleuke slutter. */
  weekEnd: string;
  toAdd: BasisAddition[];
  /** Forfaller neste uke, men står allerede (uavhuket) på listen. */
  skipped: StapleItem[];
}

/** En uavhuket rad for basisvaren finnes allerede ⇒ ingenting å legge til. */
export const isStapleOnList = (s: StapleItem, items: GroceryItem[]) =>
  items.some(g => g.stapleItemId === s.id && !g.done);

/**
 * Hva «Legg til basisvarer» kommer til å gjøre akkurat nå. Samme utvalg som
 * knappen alltid har brukt: basisvarer som forfaller neste handleuke
 * (isStapleDueNextWeek — lørdag-anker via handleukeStart) og som ikke
 * allerede står uavhuket på listen. Rekkefølgen følger `staples`.
 */
export function planBasisBatch(staples: StapleItem[], items: GroceryItem[], today: string): BasisPlan {
  const weekStart = nextHandleukeStart(today);
  const toAdd: BasisAddition[] = [];
  const skipped: StapleItem[] = [];
  for (const s of staples) {
    if (!isStapleDueNextWeek(s, today)) continue;
    if (isStapleOnList(s, items)) { skipped.push(s); continue; }
    const existing = items.find(g => g.stapleItemId === s.id);
    toAdd.push({
      staple: s,
      existingRowId: existing?.id ?? null,
      prevDoneAt: existing ? (existing.doneAt ?? LEGACY_DONE_AT) : null,
    });
  }
  return { weekStart, weekEnd: addDaysKey(weekStart, 6), toAdd, skipped };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

/** «lør 7.–fre 13. nov», eller «lør 31. okt–fre 6. nov» over et månedsskifte. */
export function formatHandleukeRange(weekStart: string): string {
  const end = addDaysKey(weekStart, 6);
  const [, sm, sd] = weekStart.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  const startPart = sm === em ? `lør ${sd}.` : `lør ${sd}. ${MONTHS[sm - 1]}`;
  return `${startPart}–fre ${ed}. ${MONTHS[em - 1]}`;
}

/** Forhåndsvisning av varenavn: de første `max`, og hvor mange som gjenstår. */
export function previewNames(names: string[], max = 7): { shown: string[]; rest: number } {
  return { shown: names.slice(0, max), rest: Math.max(0, names.length - max) };
}

export const varer = (n: number) => `${n} ${n === 1 ? 'vare' : 'varer'}`;
export const basisvarer = (n: number) => `${n} ${n === 1 ? 'basisvare' : 'basisvarer'}`;

// ── Batch-id ────────────────────────────────────────────────────────────────

/**
 * UUIDv7 (RFC 9562): de første 48 bitene er et millisekund-tidsstempel. Da
 * kan både «siste innsetting» og «hvilken uke den gjaldt» leses rett ut av
 * basis_batch_id — uten en ekstra tidsstempel-kolonne — og id-ene sorteres
 * leksikografisk i tidsrekkefølge. Fortsatt en helt vanlig uuid for Postgres.
 */
export function newBatchId(now = Date.now(), rand: (n: number) => Uint8Array = randomBytes): string {
  const b = rand(16);
  let ts = now;
  for (let i = 5; i >= 0; i--) { b[i] = ts % 256; ts = Math.floor(ts / 256); }
  b[6] = (b[6] & 0x0f) | 0x70; // versjon 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Tidsstempelet (ms) i en UUIDv7, eller null for andre uuid-versjoner. */
export function batchTimestamp(id: string): number | null {
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32 || hex[12] !== '7') return null;
  return parseInt(hex.slice(0, 12), 16);
}

// ── Angre ───────────────────────────────────────────────────────────────────

export interface UndoPlan {
  /** Nye rader fra innsettingen som ikke er krysset av — slettes. */
  deleteIds: string[];
  /** Gjenaktiverte rader som ikke er krysset av — settes tilbake til avhuket. */
  restore: { id: string; doneAt: string }[];
  /** Rader fra innsettingen som er krysset av — beholdes urørt. */
  keptIds: string[];
}

/**
 * Hva angring av `batchId` gjør med radene. Bare rader med akkurat denne
 * basis_batch_id røres; rader som er krysset av beholdes. Rader som sto der
 * fra før (uten batch-id, eller fra en annen innsetting) er aldri med.
 * En rad som har fått endret mengde etter innsettingen har fått batch-id-en
 * fjernet (se setGroceryAmount) og er derfor heller ikke med.
 */
export function planUndo(items: GroceryItem[], batchId: string): UndoPlan {
  const plan: UndoPlan = { deleteIds: [], restore: [], keptIds: [] };
  for (const g of items) {
    if (g.basisBatchId !== batchId) continue;
    if (g.done) plan.keptIds.push(g.id);
    else if (g.basisPrevDoneAt) plan.restore.push({ id: g.id, doneAt: g.basisPrevDoneAt });
    else plan.deleteIds.push(g.id);
  }
  return plan;
}

export interface UndoableBatch {
  batchId: string;
  /** Antall rader angring vil fjerne fra listen (ikke krysset av). */
  count: number;
}

/**
 * Den siste innsettingen, hvis den fortsatt kan angres: den gjaldt en
 * handleuke som ennå ikke har startet (når lørdagen kommer, er varene
 * ordinære varer på ukens liste — da ville syncGroceryList uansett lagt dem
 * til), og minst én rad fra den er ikke krysset av. Bare den aller siste
 * innsettingen vurderes — en eldre blir aldri «angrebar» igjen av at en nyere
 * er angret.
 */
export function latestUndoableBatch(items: GroceryItem[], today: string): UndoableBatch | null {
  let latest: string | null = null;
  for (const g of items) {
    if (g.basisBatchId && batchTimestamp(g.basisBatchId) != null && (latest == null || g.basisBatchId > latest)) {
      latest = g.basisBatchId;
    }
  }
  if (!latest) return null;
  const ts = batchTimestamp(latest)!;
  const addedDay = new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const targetWeek = nextHandleukeStart(addedDay);
  if (handleukeStart(new Date(today + 'T00:00:00Z')) >= targetWeek) return null;
  const plan = planUndo(items, latest);
  const count = plan.deleteIds.length + plan.restore.length;
  return count ? { batchId: latest, count } : null;
}

export function undoMessage(removed: number, kept: number): string {
  const head = `${removed} fjernet`;
  return kept ? `${head}, ${kept} beholdt fordi ${kept === 1 ? 'den er' : 'de er'} krysset av` : head;
}
