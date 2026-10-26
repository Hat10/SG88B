import { useMemo, useState } from 'react';
import { useMatplan, weekDates, todayKey } from '../../contexts/MatplanContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { handleukeStart } from '../../hooks/useWeeklyBucket';
import { Card, SkeletonList, Tag } from '../../components';
import { navigate } from '../../lib/navigate';
import { addDaysLocal } from '../../lib/dagensMiddag';
import { isLeftoverDay, lastCookedByRecipe, recentRecipeIds } from '../../lib/middagVelger';
import MissingDataTags from './MissingDataTags';
import RecipePicker from './RecipePicker';

// Samme anker som resten av handleuke-arkitekturen (lørdag–fredag, se
// handleukeStart) — så Ukeplan og handlelisten alltid viser samme 7-dagers
// vindu, i stedet for Ukeplans tidligere mandag-baserte rutenett.
const WEEKDAY_LABEL = ['Lørdag', 'Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'];

function fmtDay(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}

// Handleuke-starten (lørdag) `offset` uker fra denne handleuken.
function handleukeStartWithOffset(offset: number): string {
  const base = handleukeStart();
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offset * 7);
  return dt.toISOString().slice(0, 10);
}

export default function UkeplanTab() {
  const { recipes, mealPlan, groceryItems, loading, setMealPlan, clearMealPlan, addMealToGroceryListNow } = useMatplan();
  const { confirm } = useConfirm();
  const { notify } = useSnackbar();
  const [weekOffset, setWeekOffset] = useState(0);
  // Datoen der velgeren er åpen (null = ingen).
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const weekStart = handleukeStartWithOffset(weekOffset);
  const days = weekDates(weekStart);
  const today = todayKey();

  const recipeById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes]);
  const lastCooked = useMemo(() => lastCookedByRecipe(mealPlan, today), [mealPlan, today]);
  const recentIds = useMemo(() => recentRecipeIds(mealPlan, today), [mealPlan, today]);

  // «Kopier forrige uke»: kun dager som er tomme denne uka og hadde middag
  // samme ukedag forrige uke — eksisterende planer overskrives aldri.
  const prevDays = weekDates(handleukeStartWithOffset(weekOffset - 1));
  const copyable = days
    .map((date, i) => ({ date, from: mealPlan.find(mp => mp.date === prevDays[i]) }))
    .filter(({ date, from }) => from && !mealPlan.some(mp => mp.date === date));

  const changeWeek = (next: number) => { setActiveDate(null); setWeekOffset(next); };

  const pick = (date: string, recipeId: string) => {
    void setMealPlan(date, recipeId);
    // Hopp videre til neste dag i uka, så hele uka kan planlegges i én flyt.
    const i = days.indexOf(date);
    setActiveDate(i >= 0 && i < 6 ? days[i + 1] : null);
  };

  const repeat = async (date: string, recipeId: string) => {
    const next = addDaysLocal(date, 1);
    const existing = mealPlan.find(mp => mp.date === next);
    if (existing && existing.recipeId !== recipeId) {
      const name = recipeById.get(existing.recipeId)?.name ?? 'en annen middag';
      if (!await confirm({ title: 'Erstatte middag?', message: `${fmtDay(next)} har allerede «${name}».`, confirmLabel: 'Erstatt' })) return;
    }
    void setMealPlan(next, recipeId);
    // Velgeren følger med, så «+1 dag» kan trykkes flere ganger på rad.
    setActiveDate(days.includes(next) ? next : null);
  };

  const copyPrevWeek = async () => {
    if (copying || copyable.length === 0) return;
    setCopying(true);
    try {
      for (const { date, from } of copyable) await setMealPlan(date, from!.recipeId);
      notify(`Kopierte ${copyable.length} ${copyable.length === 1 ? 'middag' : 'middager'} fra forrige uke`);
    } finally { setCopying(false); }
  };

  return (
    <Card
      eyebrow="Ukeplan"
      title={`Uke fra ${fmtDay(days[0])} til ${fmtDay(days[6])}`}
      action={
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => changeWeek(weekOffset - 1)} className="btn ghost sm">← Forrige</button>
          {weekOffset !== 0 && <button onClick={() => changeWeek(0)} className="btn ghost sm">I dag</button>}
          <button onClick={() => changeWeek(weekOffset + 1)} className="btn ghost sm">Neste →</button>
          <button onClick={() => navigate('handleliste')} className="btn ghost sm">🛒 Handleliste</button>
        </div>
      }
    >
      {loading && <SkeletonList rows={7} />}
      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {days.map((date, i) => {
            const planned = mealPlan.find(mp => mp.date === date);
            const recipe = planned ? recipeById.get(planned.recipeId) : undefined;
            const isToday = date === today;
            const isActive = date === activeDate;
            const leftover = isLeftoverDay(mealPlan, date);
            // «Legg til nå» gir kun mening for en middag i en FREMTIDIG
            // handleuke (weekOffset > 0) — inneværende ukes middager fanges
            // uansett automatisk opp av syncGroceryList() neste gang noen
            // åpner Handleliste, se HandlelisteCard.tsx.
            const showAddToGroceryList = !!planned?.recipeId && weekOffset > 0;
            const alreadyAdded = !!planned && groceryItems.some(g => g.mealPlanId === planned.id);
            return (
              <div key={date}>
                <div
                  role="button" tabIndex={0} aria-expanded={isActive}
                  onClick={() => setActiveDate(isActive ? null : date)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDate(isActive ? null : date); } }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', minHeight: 52, cursor: 'pointer',
                    background: isToday || isActive ? 'var(--surface-2)' : 'var(--bg)',
                    border: `1px solid ${isToday || isActive ? 'var(--ink)' : 'var(--line)'}`,
                    borderRadius: isActive ? '6px 6px 0 0' : 6,
                  }}
                >
                  <div style={{ width: 92, flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{WEEKDAY_LABEL[i]}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>{fmtDay(date)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, color: recipe ? 'var(--ink)' : 'var(--ink-4)' }}>
                      {recipe?.name ?? (planned ? 'Slettet oppskrift' : 'Velg middag')}
                    </span>
                    {leftover && <Tag>rester</Tag>}
                    {/* Kun «mangler ingredienser» — den påvirker handlelisten. Ingen koblet oppskrift ⇒ ingen tagg. */}
                    <MissingDataTags recipe={recipe} only={['ingredients']} />
                    {!leftover && recipe?.cookTimeMinutes != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)' }}>{recipe.cookTimeMinutes} min</span>
                    )}
                  </div>
                  {showAddToGroceryList && (
                    <button
                      onClick={e => { e.stopPropagation(); void addMealToGroceryListNow(planned!.id); }}
                      disabled={alreadyAdded}
                      className="btn ghost sm"
                      title={alreadyAdded ? 'Allerede lagt til i handlelisten' : 'Legg til i handlelisten allerede nå'}
                      style={{ flexShrink: 0, opacity: alreadyAdded ? 0.5 : 1 }}
                    >
                      {alreadyAdded ? '✓' : '🛒+'}
                    </button>
                  )}
                  <span aria-hidden style={{ flexShrink: 0, color: 'var(--ink-4)', fontSize: 11 }}>{isActive ? '▴' : '▾'}</span>
                </div>
                {isActive && (
                  <RecipePicker
                    key={date}
                    recipes={recipes}
                    selectedId={planned?.recipeId ?? null}
                    recentIds={recentIds}
                    lastCooked={lastCooked}
                    today={today}
                    canRepeat={!!planned && i < 6}
                    onPick={id => pick(date, id)}
                    onRepeat={() => planned && void repeat(date, planned.recipeId)}
                    onClear={() => { void clearMealPlan(date); setActiveDate(null); }}
                    onClose={() => setActiveDate(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {!loading && copyable.length > 0 && (
        <button onClick={() => void copyPrevWeek()} className="btn ghost sm" style={{ marginTop: 10, opacity: copying ? 0.5 : 1 }}>
          {copying ? 'Kopierer…' : `↻ Kopier forrige uke (${copyable.length} ${copyable.length === 1 ? 'dag' : 'dager'})`}
        </button>
      )}
      {!loading && recipes.length === 0 && (
        <div style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
          Legg til oppskrifter under «Oppskrifter»-fanen for å kunne planlegge middager.
        </div>
      )}
    </Card>
  );
}
