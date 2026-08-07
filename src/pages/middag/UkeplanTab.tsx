import { useState } from 'react';
import { useMatplan, weekDates } from '../../contexts/MatplanContext';
import { osloMondayKey } from '../../hooks/useWeeklyBucket';
import { Card, SkeletonList } from '../../components';

const WEEKDAY_LABEL = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function fmtDay(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}

// Mandagen `offset` uker fra denne uken.
function mondayWithOffset(offset: number): string {
  const base = osloMondayKey();
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offset * 7);
  return dt.toISOString().slice(0, 10);
}

export default function UkeplanTab() {
  const { recipes, mealPlan, loading, setMealPlan, clearMealPlan } = useMatplan();
  const [weekOffset, setWeekOffset] = useState(0);

  const monday = mondayWithOffset(weekOffset);
  const days = weekDates(monday);
  const today = osloMondayKey() === monday ? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }) : null;

  return (
    <Card
      eyebrow="Ukeplan"
      title={`Uke fra ${fmtDay(days[0])} til ${fmtDay(days[6])}`}
      action={
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setWeekOffset(o => o - 1)} className="btn ghost sm">← Forrige</button>
          {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} className="btn ghost sm">I dag</button>}
          <button onClick={() => setWeekOffset(o => o + 1)} className="btn ghost sm">Neste →</button>
        </div>
      }
    >
      {loading && <SkeletonList rows={7} />}
      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {days.map((date, i) => {
            const planned = mealPlan.find(mp => mp.date === date);
            const isToday = date === today;
            return (
              <div key={date} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                background: isToday ? 'var(--surface-2)' : 'var(--bg)',
                border: `1px solid ${isToday ? 'var(--ink)' : 'var(--line)'}`, borderRadius: 6,
              }}>
                <div style={{ width: 92, flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{WEEKDAY_LABEL[i]}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>{fmtDay(date)}</div>
                </div>
                <select
                  value={planned?.recipeId ?? ''}
                  onChange={e => { const id = e.target.value; if (id) void setMealPlan(date, id); else void clearMealPlan(date); }}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--ink)',
                  }}
                >
                  <option value="">— Ingen middag planlagt —</option>
                  {recipes.map(r => <option key={r.id} value={r.id}>{r.name}{r.cookTimeMinutes != null ? ` (${r.cookTimeMinutes} min)` : ''}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      )}
      {!loading && recipes.length === 0 && (
        <div style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
          Legg til oppskrifter under «Oppskrifter»-fanen for å kunne planlegge middager.
        </div>
      )}
    </Card>
  );
}
