import { useState } from 'react';
import { useMatplan, todayKey, type Recipe } from '../../contexts/MatplanContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { Tag } from '../../components';
import { addDaysLocal, formatIngredientAmount } from '../../lib/dagensMiddag';
import { dayLabel } from '../../lib/dayLabel';
import { lastCookedLabel } from '../../lib/middagVelger';

/** Velg dag (fra i dag og fremover) å planlegge oppskriften på. */
function PlanChooser({ recipe, onDone }: { recipe: Recipe; onDone: () => void }) {
  const { mealPlan, recipes, setMealPlan } = useMatplan();
  const { confirm } = useConfirm();
  const { notify } = useSnackbar();
  const [daysShown, setDaysShown] = useState(7);
  const today = todayKey();
  const dates = Array.from({ length: daysShown }, (_, i) => addDaysLocal(today, i));
  const nameOf = (id: string) => recipes.find(r => r.id === id)?.name ?? 'en annen middag';

  const plan = async (date: string, offset: number) => {
    const existing = mealPlan.find(mp => mp.date === date);
    if (existing?.recipeId === recipe.id) { onDone(); return; }
    if (existing && !await confirm({
      title: 'Erstatte middag?', message: `${dayLabel(offset, date)} har allerede «${nameOf(existing.recipeId)}».`, confirmLabel: 'Erstatt',
    })) return;
    await setMealPlan(date, recipe.id);
    notify(`«${recipe.name}» planlagt ${dayLabel(offset, date)}`);
    onDone();
  };

  return (
    <div style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg)' }}>
      <div className="card-eyebrow" style={{ marginBottom: 8 }}>Hvilken dag?</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
        {dates.map((date, i) => {
          const existing = mealPlan.find(mp => mp.date === date);
          const same = existing?.recipeId === recipe.id;
          return (
            <button key={date} onClick={() => void plan(date, i)} className="btn sm" style={{
              flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '6px 8px', textAlign: 'left',
              background: same ? 'var(--chip)' : undefined,
            }}>
              <span style={{ fontSize: 12, color: 'var(--ink)' }}>{dayLabel(i, date)}{same ? ' ✓' : ''}</span>
              <span style={{ fontSize: 10, color: 'var(--ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {existing ? nameOf(existing.recipeId) : 'ledig'}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {daysShown < 14 && <button onClick={() => setDaysShown(14)} className="btn ghost sm">Vis 7 dager til</button>}
        <button onClick={onDone} className="btn ghost sm" style={{ marginLeft: 'auto' }}>Avbryt</button>
      </div>
    </div>
  );
}

export default function RecipeDetail({ recipe, lastCooked, cookCount, onEdit }: {
  recipe: Recipe;
  lastCooked: string | undefined;
  cookCount: number;
  onEdit: () => void;
}) {
  const [planning, setPlanning] = useState(false);
  const today = todayKey();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.6 }}>
        {[
          recipe.cookTimeMinutes != null ? `${recipe.cookTimeMinutes} min` : null,
          cookCount > 0 ? `laget ${cookCount} ${cookCount === 1 ? 'gang' : 'ganger'}` : null,
          lastCookedLabel(lastCooked, today) === 'aldri laget' ? 'aldri laget' : `sist ${lastCookedLabel(lastCooked, today)}`,
        ].filter(Boolean).join(' · ')}
      </div>

      {(recipe.tags.length > 0 || recipe.source === 'spoonacular') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {recipe.source === 'spoonacular' && <Tag>spoonacular</Tag>}
          {recipe.tags.map(t => <Tag key={t}>{t}</Tag>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setPlanning(p => !p)} className="btn primary sm">📅 Planlegg</button>
        <button onClick={onEdit} className="btn sm">✎ Rediger</button>
      </div>
      {planning && <PlanChooser recipe={recipe} onDone={() => setPlanning(false)} />}

      <div>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Ingredienser</div>
        {recipe.ingredients.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>Ingen ingredienser lagt inn</div>
        )}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
          {recipe.ingredients.map((ing, i) => {
            const amount = formatIngredientAmount(ing);
            return (
              <li key={i} style={{
                display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0',
                borderBottom: '1px solid var(--line)', fontSize: 13.5, color: 'var(--ink)',
              }}>
                <span>
                  {ing.name}
                  {ing.onGroceryList === false && (
                    <span style={{ fontSize: 11, color: 'var(--ink-4)' }}> · basisvare, ikke på handleliste</span>
                  )}
                </span>
                {amount && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)', flexShrink: 0 }}>{amount}</span>}
              </li>
            );
          })}
        </ul>
      </div>

      {recipe.instructions && (
        <div>
          <div className="card-eyebrow" style={{ marginBottom: 6 }}>Fremgangsmåte</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{recipe.instructions}</div>
        </div>
      )}
    </div>
  );
}
