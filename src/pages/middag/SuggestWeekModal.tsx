import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMatplan } from '../../contexts/MatplanContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useScrollLock } from '../../lib/useScrollLock';
import { addDaysLocal } from '../../lib/dagensMiddag';
import { lastCookedByRecipe, recentRecipeIds } from '../../lib/middagVelger';
import {
  DEFAULT_DINNER_PATTERN, dayRangeLabel, suggestWeek, suggestionEntries, weekdayName,
  type SuggestedBlock, type VariableMode,
} from '../../lib/suggestWeek';
import MissingDataTags from './MissingDataTags';
import RecipePicker from './RecipePicker';

const MODE_LABEL: Record<VariableMode, string> = {
  leftover: 'Rester fra onsdag',
  new: 'Ny middag',
  none: 'Ingen',
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return isMobile;
}

// Blokkene som har en oppskrift brukeren (eller et tidligere trekk) har landet på.
const recipesOf = (blocks: SuggestedBlock[]): Record<string, string> =>
  Object.fromEntries(blocks.filter(b => b.recipeId && (b.origin === 'suggested' || b.origin === 'fixed')).map(b => [b.id, b.recipeId!]));

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{
      padding: '8px 12px', minHeight: 36, borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
      background: on ? 'var(--ink)' : 'var(--surface-2)', color: on ? 'var(--bg)' : 'var(--ink-3)',
      border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, fontFamily: 'var(--font-mono)', fontSize: 11.5,
    }}>{children}</button>
  );
}

interface Props {
  /** Handleukens lørdag. */
  weekStart: string;
  today: string;
  onClose: () => void;
}

// Forhåndsvisning av «Foreslå uke»: ingenting skrives før «Legg inn i
// ukeplan». Dager som allerede har middag vises låst og røres aldri — lagringen
// bruker addMealEntries (INSERT mot unik dato), så noe annet er heller ikke mulig.
export default function SuggestWeekModal({ weekStart, today, onClose }: Props) {
  const { recipes, mealPlan, addMealEntries } = useMatplan();
  const { notify } = useSnackbar();
  const isMobile = useIsMobile();
  useScrollLock();

  const [mode, setMode] = useState<VariableMode>(DEFAULT_DINNER_PATTERN.variable.defaultMode);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const draw = (over: { mode?: VariableMode; fixed?: Record<string, string>; exclude?: string[] } = {}) =>
    suggestWeek({
      weekStart, today, recipes, history: mealPlan, existing: mealPlan,
      variableMode: over.mode ?? mode, fixed: over.fixed, exclude: over.exclude, rng: Math.random,
    });

  const [blocks, setBlocks] = useState<SuggestedBlock[]>(() => draw());

  // Realtime: en annen telefon kan legge inn middag mens forhåndsvisningen er
  // åpen. Tegn om med dagens valg som faste, så låste dager følger med.
  const liveSig = useMemo(() => {
    const last = addDaysLocal(weekStart, 6);
    return JSON.stringify([
      mealPlan.filter(mp => mp.date >= weekStart && mp.date <= last).map(mp => mp.date + mp.recipeId).sort(),
      recipes.map(r => r.id).sort(),
    ]);
  }, [mealPlan, recipes, weekStart]);
  const firstSig = useRef(liveSig);
  useEffect(() => {
    if (firstSig.current === liveSig) return;
    firstSig.current = liveSig;
    setBlocks(prev => draw({ fixed: recipesOf(prev) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSig]);

  const byId = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);
  const recentIds = useMemo(() => recentRecipeIds(mealPlan, today), [mealPlan, today]);
  const lastCooked = useMemo(() => lastCookedByRecipe(mealPlan, today), [mealPlan, today]);

  const entries = useMemo(() => suggestionEntries(blocks), [blocks]);
  const label = (dates: string[]) => dayRangeLabel(weekStart, dates);

  const changeMode = (m: VariableMode) => {
    if (m === mode) return;
    setMode(m);
    setPicking(null);
    setNotice(null);
    setBlocks(prev => draw({ mode: m, fixed: recipesOf(prev) }));
  };

  const regenerate = () => {
    setPicking(null);
    setNotice(null);
    const keep = recipesOf(blocks);
    setBlocks(draw({ fixed: Object.fromEntries(Object.entries(keep).filter(([id]) => locked.has(id))) }));
  };

  const swap = (id: string) => {
    const current = blocks.find(b => b.id === id);
    if (!current) return;
    const others = recipesOf(blocks.filter(b => b.id !== id));
    const next = draw({ fixed: others, exclude: current?.recipeId ? [current.recipeId] : [] });
    const nb = next.find(b => b.id === id);
    if (!nb?.recipeId) { notify('Ingen andre oppskrifter å foreslå'); return; }
    setNotice(null);
    setBlocks(next);
  };

  const pickManually = (id: string, recipeId: string) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, recipeId, origin: 'fixed' } : b));
    setLocked(prev => new Set(prev).add(id));
    setPicking(null);
  };

  const clearBlock = (id: string) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, recipeId: null, origin: 'none' } : b));
    setLocked(prev => { const n = new Set(prev); n.delete(id); return n; });
    setPicking(null);
  };

  const toggleLock = (id: string) =>
    setLocked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    if (saving || entries.length === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await addMealEntries(entries);
      if (res.ok) {
        notify(`La inn ${entries.length} ${entries.length === 1 ? 'middag' : 'middager'} i ukeplanen`);
        onClose();
      } else if (res.reason === 'taken') {
        setNotice('Noen rakk det først — en av dagene har fått middag. Forhåndsvisningen er oppdatert.');
        setBlocks(prev => draw({ fixed: recipesOf(prev) }));
      } else {
        setNotice('Kunne ikke lagre. Prøv igjen.');
      }
    } finally { setSaving(false); }
  };

  const nameOf = (id: string | null) => (id ? byId.get(id)?.name ?? 'Slettet oppskrift' : null);

  const renderBlock = (b: SuggestedBlock) => {
    const recipe = b.recipeId ? byId.get(b.recipeId) : undefined;
    const isLocked = locked.has(b.id);
    const editable = b.origin === 'suggested' || b.origin === 'fixed' || b.origin === 'none';
    const isPicking = picking === b.id;
    const existingDays = b.days.filter(d => d.existingRecipeId);
    const when = b.origin === 'anchored' ? `rester av ${weekdayName(weekStart, b.cookDate)}`
      : b.origin === 'locked' ? 'allerede planlagt'
      : b.days.length > 1 ? `lages ${weekdayName(weekStart, b.cookDate)}` : null;
    const title = b.origin === 'locked'
      ? Array.from(new Set(existingDays.map(d => nameOf(d.existingRecipeId)))).join(' / ')
      : nameOf(b.recipeId);

    return (
      <div key={b.id}>
        <div style={{
          padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
          background: b.origin === 'locked' ? 'var(--surface-2)' : 'var(--bg)',
          border: `1px solid ${isPicking ? 'var(--ink)' : 'var(--line)'}`,
          borderRadius: isPicking ? '6px 6px 0 0' : 6,
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.4 }}>
            <strong style={{ fontWeight: 600 }}>{label(b.days.map(d => d.date))}:</strong>{' '}
            {title ? (
              <>
                <span>{b.origin === 'locked' ? '🔒 ' : ''}{title}</span>
                {when && <span style={{ color: 'var(--ink-4)' }}> ({when})</span>}
                {recipe && <MissingDataTags recipe={recipe} only={['ingredients']} compact />}
              </>
            ) : (
              <span style={{ color: 'var(--ink-4)' }}>Ingen oppskrift igjen å foreslå</span>
            )}
          </div>

          {b.origin !== 'locked' && existingDays.map(d => (
            <div key={d.date} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
              🔒 {label([d.date])}: {nameOf(d.existingRecipeId)} (står fra før)
            </div>
          ))}

          {editable && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button onClick={() => swap(b.id)} disabled={isLocked || saving} className="btn sm"
                title={isLocked ? 'Lås opp for å bytte' : 'Nytt forslag for denne blokken'}
                style={{ minHeight: 36, opacity: isLocked ? 0.45 : 1 }}>Bytt</button>
              <button onClick={() => setPicking(isPicking ? null : b.id)} disabled={saving} className="btn sm"
                aria-expanded={isPicking} style={{ minHeight: 36 }}>Velg selv</button>
              <button onClick={() => toggleLock(b.id)} disabled={!b.recipeId || saving} aria-pressed={isLocked}
                className={'btn sm' + (isLocked ? ' primary' : '')} style={{ minHeight: 36, opacity: b.recipeId ? 1 : 0.45 }}
                title="Låste blokker beholdes når du foreslår på nytt">{isLocked ? '🔒 Låst' : 'Lås'}</button>
            </div>
          )}
        </div>
        {isPicking && (
          <RecipePicker
            key={b.id}
            recipes={recipes}
            selectedId={b.recipeId}
            recentIds={recentIds}
            lastCooked={lastCooked}
            today={today}
            canRepeat={false}
            onPick={id => pickManually(b.id, id)}
            onRepeat={() => undefined}
            onClear={() => clearBlock(b.id)}
            onClose={() => setPicking(null)}
          />
        )}
      </div>
    );
  };

  const unfilled = blocks.filter(b => b.origin === 'none').length;

  return createPortal((
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 301, background: 'rgba(11,37,69,0.45)',
        display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Foreslå uke"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column',
          border: isMobile ? 'none' : '1px solid var(--line)', borderRadius: isMobile ? 0 : 14,
          boxShadow: isMobile ? 'none' : '0 16px 50px rgba(11,37,69,0.3)',
          height: isMobile ? '100%' : undefined, maxHeight: isMobile ? '100%' : 'min(90vh, 780px)',
        }}
      >
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 20px 12px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="card-eyebrow">Ukeplan</div>
            <h3 className="card-title" style={{ marginTop: 2 }}>Foreslå uke</h3>
          </div>
          <button onClick={onClose} aria-label="Lukk" style={{
            background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer',
            fontSize: 16, color: 'var(--ink-3)', minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="card-eyebrow" style={{ marginBottom: 6 }}>Fredag</div>
            <div role="group" aria-label="Fredag" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(Object.keys(MODE_LABEL) as VariableMode[]).map(m => (
                <Chip key={m} on={mode === m} onClick={() => changeMode(m)}>{MODE_LABEL[m]}</Chip>
              ))}
            </div>
          </div>

          {blocks.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-4)' }}>
              Ingen dager igjen å foreslå for i denne uka.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{blocks.map(renderBlock)}</div>
          )}

          {recipes.length === 0 && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-4)' }}>
              Legg til oppskrifter under «Oppskrifter»-fanen for å få forslag.
            </div>
          )}
          {recipes.length > 0 && unfilled > 0 && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-4)' }}>
              Det er færre oppskrifter enn blokker, så {unfilled === 1 ? 'én blokk' : `${unfilled} blokker`} står tomt. Bruk «Velg selv» eller legg til flere oppskrifter.
            </div>
          )}
          {notice && <div role="status" style={{ fontSize: 13, color: '#C9963A' }}>{notice}</div>}
        </div>

        <div style={{
          flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--line)',
        }}>
          <button onClick={regenerate} disabled={saving || blocks.length === 0} className="btn" style={{ minHeight: 40 }}>
            Foreslå på nytt
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} className="btn ghost" style={{ minHeight: 40 }}>Avbryt</button>
            <button onClick={() => void save()} disabled={saving || entries.length === 0} className="btn primary"
              style={{ minHeight: 40, opacity: saving || entries.length === 0 ? 0.5 : 1 }}>
              {saving ? 'Lagrer…' : `Legg inn i ukeplan${entries.length ? ` (${entries.length})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
