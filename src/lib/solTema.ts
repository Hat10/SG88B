// Auto-tema basert på soloppgang/solnedgang i Bodø, med faste grenser slik at
// midnattssol og mørketid ikke gir absurde byttetidspunkter.
//
//   Lys modus starter ved soloppgang, klemt til [06:00, 09:00].
//   Mørk modus starter ved solnedgang, klemt til [17:00, 20:00].
//
// Midnattssol (sola går ikke ned)  → lys 06:00, mørk 20:00.
// Mørketid (sola står ikke opp)    → lys 09:00, mørk 17:00.
//
// All tid regnes i Europe/Oslo uavhengig av enhetens tidssone, så oppførselen
// er lik på alle enheter og deterministisk i tester.

export const BODO = { lat: 67.2827, lng: 14.3751 };

export const LYS_TIDLIGST = 6 * 60;   // 06:00
export const LYS_SENEST = 9 * 60;     // 09:00
export const MORK_TIDLIGST = 17 * 60; // 17:00
export const MORK_SENEST = 20 * 60;   // 20:00

// ─── Solberegning (samme algoritme som suncalc, h0 = −0,833°) ────────────────
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const J0 = 0.0009;
const OBLIQUITY = RAD * 23.4397;

const toDays = (ms: number) => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY_MS;
const meanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M: number) => {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
};
const transitJ = (ds: number, M: number, L: number) =>
  J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

export type SolDag =
  | { kind: 'normal'; opp: number; ned: number } // epoch-ms
  | { kind: 'midnattssol' }
  | { kind: 'morketid' };

/** Soloppgang/-nedgang for dagen rundt tidspunktet `nearMs` (bør være nær lokal middag). */
export function solTider(nearMs: number, lat = BODO.lat, lng = BODO.lng): SolDag {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(nearMs);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = meanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const jNoon = transitJ(ds, M, L);

  const h0 = RAD * -0.833;
  const cosW = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1) return { kind: 'midnattssol' };
  if (cosW > 1) return { kind: 'morketid' };

  const w = Math.acos(cosW);
  const jSet = transitJ(J0 + (w + lw) / (2 * Math.PI) + n, M, L);
  const jRise = jNoon - (jSet - jNoon);
  return { kind: 'normal', opp: fromJulian(jRise), ned: fromJulian(jSet) };
}

// ─── Oslo-tid ────────────────────────────────────────────────────────────────
const osloFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function osloParts(ms: number) {
  const p: Record<string, number> = {};
  for (const { type, value } of osloFmt.formatToParts(new Date(ms))) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return {
    dayIndex: Date.UTC(p.year, p.month - 1, p.day) / DAY_MS,
    minutes: p.hour * 60 + p.minute,
  };
}

/** Minutter siden Oslo-midnatt på `refDayIndex` (kan være <0 eller >1440). */
function minutterRelativt(ms: number, refDayIndex: number): number {
  const { dayIndex, minutes } = osloParts(ms);
  return (dayIndex - refDayIndex) * 1440 + minutes;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Når lys og mørk modus starter (minutter etter Oslo-midnatt) den Oslo-dagen `now` faller på. */
export function byttetider(now: Date): { lysFra: number; morkFra: number } {
  const { dayIndex } = osloParts(now.getTime());
  // ~12:00 Oslo-tid samme dag, så beregningen treffer riktig soldøgn.
  const sol = solTider(dayIndex * DAY_MS + 10 * 3_600_000);

  if (sol.kind === 'midnattssol') return { lysFra: LYS_TIDLIGST, morkFra: MORK_SENEST };
  if (sol.kind === 'morketid') return { lysFra: LYS_SENEST, morkFra: MORK_TIDLIGST };
  return {
    lysFra: clamp(minutterRelativt(sol.opp, dayIndex), LYS_TIDLIGST, LYS_SENEST),
    morkFra: clamp(minutterRelativt(sol.ned, dayIndex), MORK_TIDLIGST, MORK_SENEST),
  };
}

/** Skal auto-temaet være mørkt akkurat nå? */
export function erMorkAuto(now: Date = new Date()): boolean {
  const { minutes } = osloParts(now.getTime());
  const { lysFra, morkFra } = byttetider(now);
  return minutes < lysFra || minutes >= morkFra;
}
