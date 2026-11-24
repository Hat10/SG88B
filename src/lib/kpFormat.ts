// Visningsformat for Kp i nordlys-UI-et (kort, modal, netter, graf). Én
// avrunding for alt: én desimal, norsk komma. Kp er tredjedeler (0,33 / 0,67 …),
// så 1,67 vises som «1,7» overalt — aldri «1.67» ett sted og «1,7» et annet.
// API-et (api/nordlys.ts) runder til samme presisjon, men UI-et formaterer alltid selv.

export function formatKp(kp: number): string {
  return (Math.round(kp * 10) / 10).toFixed(1).replace('.', ',');
}

export interface KpSlotIso { start: string; end: string }

const osloHour = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' });

/** Bolken i Oslo-tid, f.eks. «10–13» (vinter) eller «11–14» (sommer) for 09–12 UTC. Aldri hardkodet +1. */
export function kpSlotLabel(slot: KpSlotIso): string {
  return `${osloHour.format(new Date(slot.start))}–${osloHour.format(new Date(slot.end))}`;
}

/** «observert 10–13», evt. «observert 10–13 · utdatert». Tom streng uten bolkinfo (eldre API-svar). */
export function kpNowText(slot: KpSlotIso | undefined, stale: boolean | undefined): string {
  if (!slot) return '';
  return `observert ${kpSlotLabel(slot)}${stale ? ' · utdatert' : ''}`;
}

/** «pågår: ≥ 0,7 så langt» — et minimum, siden 1-minutts-maksen bare kan stige gjennom bolken. null = skjul. */
export function kpOngoingText(ongoing: { kpMin: number } | null | undefined): string | null {
  if (!ongoing || !Number.isFinite(ongoing.kpMin)) return null;
  return `pågår: ≥ ${formatKp(ongoing.kpMin)} så langt`;
}
