// Små kontroller og visningshjelpere for Filmoversikten.
import { WHO_NAME, nextRating, type MovieKind, type MovieWho } from '../../lib/movies';

export const KIND_LABEL: Record<MovieKind, string> = { film: 'Film', serie: 'Serie' };
export const WHOS: MovieWho[] = ['M', 'L'];

const pad = (n: number) => String(n).padStart(2, '0');
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// 'YYYY-MM-DD' tolkes lokalt (ikke som UTC) så datoen ikke skifter en dag.
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const fmtAvg = (n: number) => n.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** Bryter i skjema (Ny tittel / Rediger). Eneste sted obligatorisk kan endres. */
export function MustToggle({ who, on, onClick }: { who: MovieWho; on: boolean; onClick: () => void }) {
  const name = WHO_NAME[who];
  return (
    <button type="button" role="switch" aria-checked={on} className={'mv-must' + (on ? ' on' : '')} onClick={onClick}
      aria-label={`${name} må være med: ${on ? 'på' : 'av'}`}>
      <b>{name}</b>
      <span>{on ? 'Må være med' : 'Trenger ikke'}</span>
    </button>
  );
}

/** Ren status i listen (ikke en kontroll). Endres via Rediger. */
export function MustBadge({ who, on }: { who: MovieWho; on: boolean }) {
  const name = WHO_NAME[who];
  return (
    <span role="img" className={'mv-must static' + (on ? ' on' : '')}
      aria-label={`${name}: ${on ? 'må være med' : 'trenger ikke være med'}`}>
      <b>{name}</b>
      <span>{on ? 'Må være med' : 'Trenger ikke'}</span>
    </span>
  );
}

export function Stars({ who, value, onChange }: { who: MovieWho; value: number | null; onChange: (v: number | null) => void }) {
  const name = WHO_NAME[who];
  return (
    <div className="mv-stars" role="group" aria-label={`Rating fra ${name}`}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" className={'mv-star' + (value != null && n <= value ? ' on' : '')}
          aria-pressed={value === n}
          aria-label={value === n ? `${name}: ${n} av 5 stjerner, trykk for å fjerne` : `${name}: ${n} av 5 stjerner`}
          onClick={() => onChange(nextRating(value, n))}>★</button>
      ))}
    </div>
  );
}

export function KindPicker({ value, onChange }: { value: MovieKind; onChange: (k: MovieKind) => void }) {
  return (
    <div className="mv-chips">
      {(['film', 'serie'] as MovieKind[]).map(k => (
        <button key={k} type="button" className={'mv-chip' + (value === k ? ' on' : '')} aria-pressed={value === k}
          style={{ minHeight: 44, flex: 1, justifyContent: 'center' }} onClick={() => onChange(k)}>{KIND_LABEL[k]}</button>
      ))}
    </div>
  );
}
