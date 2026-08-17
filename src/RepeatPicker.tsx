import { REPEAT_LABELS, type RepeatInterval, type RepeatUnit } from './contexts/TodoContext';

export interface RepeatState {
  repeat: RepeatInterval | '';
  repeatInterval: number;
  repeatUnit: RepeatUnit;
}

export const EMPTY_REPEAT: RepeatState = { repeat: '', repeatInterval: 1, repeatUnit: 'day' };

// Delt mellom Gjøremål-hovedskjemaet (pages/Gjoremal.tsx) og hurtig-
// registrering (QuickAdd.tsx) — samme gjentakelsesvalg begge steder, inkludert
// den betingede visningen av intervall+enhet for "Egendefinert". repeat,
// repeatInterval og repeatUnit bundles i én verdi/onChange (som TimePicker),
// slik at hele grenen for "custom" kun finnes ett sted i stedet for duplisert
// i to skjemaer.
export default function RepeatPicker({ value, onChange, disabled }: {
  value: RepeatState;
  onChange: (next: RepeatState) => void;
  disabled?: boolean;
}) {
  const { repeat, repeatInterval, repeatUnit } = value;

  return (
    <div>
      <select className="input" value={repeat} disabled={disabled}
        onChange={e => onChange({ ...value, repeat: e.target.value as RepeatInterval | '' })}
        style={{ width: '100%' }}>
        <option value="">Ingen gjentakelse</option>
        {(Object.entries(REPEAT_LABELS) as [RepeatInterval, string][]).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
        <option value="custom">Egendefinert…</option>
      </select>

      {repeat === 'custom' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--ink-3)', flexShrink: 0 }}>Hver</span>
          <input className="input" type="number" min={1} value={repeatInterval} disabled={disabled}
            onChange={e => onChange({ ...value, repeatInterval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            style={{ width: 64, flexShrink: 0 }} />
          <select className="input" value={repeatUnit} disabled={disabled}
            onChange={e => onChange({ ...value, repeatUnit: e.target.value as RepeatUnit })}
            style={{ flex: 1 }}>
            <option value="day">dag(er)</option>
            <option value="week">uke(r)</option>
          </select>
        </div>
      )}
    </div>
  );
}
