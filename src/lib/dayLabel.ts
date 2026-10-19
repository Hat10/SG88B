/** Etikett for en dag relativt til i dag: «i dag», «i morgen», ellers f.eks. «ons 21. okt». */
export function dayLabel(offset: number, dateIso: string): string {
  if (offset === 0) return 'i dag';
  if (offset === 1) return 'i morgen';
  return dateLabel(dateIso);
}

/** «ons 21. okt» — ukedag, dato og måned uten punktum etter ukedag/måned. */
export function dateLabel(dateIso: string): string {
  const d = new Date(dateIso + 'T12:00:00');
  const wd  = d.toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '');
  const mon = d.toLocaleDateString('nb-NO', { month: 'short' }).replace('.', '');
  return `${wd} ${d.getDate()}. ${mon}`;
}

/** «ons 21.» — som dateLabel, men uten måned (smale kort). */
export function dateLabelShort(dateIso: string): string {
  const d = new Date(dateIso + 'T12:00:00');
  const wd = d.toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '');
  return `${wd} ${d.getDate()}.`;
}
