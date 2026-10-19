/** Etikett for en dag relativt til i dag: «i dag», «i morgen», ellers f.eks. «ons 21. okt». */
export function dayLabel(offset: number, dateIso: string): string {
  if (offset === 0) return 'i dag';
  if (offset === 1) return 'i morgen';
  const d = new Date(dateIso + 'T12:00:00');
  const wd  = d.toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '');
  const mon = d.toLocaleDateString('nb-NO', { month: 'short' }).replace('.', '');
  return `${wd} ${d.getDate()}. ${mon}`;
}
