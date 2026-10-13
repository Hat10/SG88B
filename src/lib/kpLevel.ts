// Kp-nivå til fargekoding i Kp-visningen av nordlys-grafen. Bevisst skilt fra
// kpScore()/chanceFromScore() i api/nordlys.ts: de hører til sannsynlighets-
// beregningen og har egne terskler (3 og 5).
export type KpLevel = 'lav' | 'middels' | 'hoy';

export const KP_MIDDELS_FRA = 2;
export const KP_HOY_FRA = 4;

export function kpLevel(kp: number): KpLevel {
  if (kp >= KP_HOY_FRA) return 'hoy';
  if (kp >= KP_MIDDELS_FRA) return 'middels';
  return 'lav';
}
