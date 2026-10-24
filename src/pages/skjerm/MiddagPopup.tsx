import type React from 'react';
import type { MealPlanEntry, Recipe } from '../../contexts/MatplanContext';
import { PagerArrows } from './PagerArrows';
import { MAX_DAYS_AHEAD } from './MiddagCard';
import { useGrowOnlyHeight } from './popupPaging';
import { addDaysLocal, consecutiveDays, formatIngredientAmount, mealRangeLabel } from '../../lib/dagensMiddag';
import { dateLabel } from '../../lib/dayLabel';
import { useSwipePager } from '../../lib/useSwipePager';

interface Props {
  mealPlan: MealPlanEntry[];
  recipes: Recipe[];
  /** yyyy-mm-dd, samme «i dag» som resten av Gangskjerm. */
  today: string;
  /** Dagen kortet viste da det ble trykket på (offset fra i dag). */
  initialOffset: number;
  /** Bladning i popupen: kortet bak blar til samme dag. */
  onNavigate: (offset: number) => void;
  /** «Legg til middag» på en tom dag: åpner MiddagAddModal oppå popupen. */
  onAddMeal: (date: string) => void;
  onClose: () => void;
  isMobile: boolean;
  viewportH: number;
}

const MUTED = 'rgba(207,224,239,0.4)';
const sectionLabel: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 };

// Dagens middag: full oppskrift. Sveip (eller ‹ ›) blar i dag … i dag + 13, i takt med
// MiddagCard; dagen står i etiketten, som på kortet (ingen prikker). Dag uten middag: «Ingen middag planlagt» + «Legg til middag».
export function MiddagPopup({ mealPlan, recipes, today, initialOffset, onNavigate, onAddMeal, onClose, isMobile, viewportH }: Props) {
  const pager = useSwipePager({ max: MAX_DAYS_AHEAD, initialOffset, onNavigate });
  const { offset } = pager;
  const date = addDaysLocal(today, offset);
  const plan = mealPlan.find(mp => mp.date === date);
  const recipe = plan ? recipes.find(r => r.id === plan.recipeId) : undefined;
  // Samme oppskrift flere dager på rad fra den viste datoen → ingredienser vises for hele serien.
  const days = recipe ? consecutiveDays(mealPlan, date) : 0;
  const range = mealRangeLabel(date, days, offset === 0);
  const label = offset === 0 ? 'Dagens middag' : `Middag · ${offset === 1 ? 'i morgen' : dateLabel(date)}`;
  const modalRef = useGrowOnlyHeight<HTMLDivElement>();

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 12 : 20 }}
    >
      <div
        {...pager.containerProps}
        ref={modalRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--ink-fixed)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: isMobile ? '18px 16px' : '28px 32px',
          width: 640, maxWidth: isMobile ? '100%' : 'calc(100vw - 48px)', maxHeight: isMobile ? viewportH - 24 : 'calc(100vh - 48px)',
          overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20,
          ...pager.containerProps.style,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 300, marginTop: 6, color: recipe ? '#E8EFF7' : 'rgba(207,224,239,0.55)', letterSpacing: '-0.01em' }}>
              {recipe ? recipe.name : 'Ingen middag planlagt'}
            </div>
            {recipe?.cookTimeMinutes != null && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)', marginTop: 6 }}>⏱ {recipe.cookTimeMinutes} min</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <PagerArrows canPrev={pager.canPrev} canNext={pager.canNext} onPrev={pager.prev} onNext={pager.next} isMobile={isMobile} popup />
            <button
              onClick={onClose}
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'default', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
            >✕</button>
          </div>
        </div>

        {/* Det som glir ved bladning. Tittelen over byttes når den nye dagen glir inn. */}
        <div ref={pager.contentRef} style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20 }}>
          {!recipe ? (
            <div>
              <button
                data-no-swipe
                onClick={() => onAddMeal(date)}
                style={{
                  background: 'transparent', border: '1px dashed rgba(207,224,239,0.35)', borderRadius: 8, cursor: 'pointer',
                  color: '#E8EFF7', fontFamily: 'var(--font-mono)', fontSize: 15, padding: '12px 18px', minHeight: 48,
                }}
              >＋ Legg til middag</button>
            </div>
          ) : (
            <>
              {recipe.ingredients.length > 0 && (
                <div>
                  <div style={sectionLabel}>Ingredienser</div>
                  {days > 1 && (
                    <div style={{ fontSize: 13, color: '#C9963A', marginBottom: 10 }}>
                      Mengder for {days} dager ({range})
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {recipe.ingredients.map((ing, i) => {
                      const qty = formatIngredientAmount(ing, days);
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, ...(isMobile ? { flexWrap: 'wrap' } : {}), fontSize: 15, color: '#E8EFF7', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          <span>{ing.name}</span>
                          {qty && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)', flexShrink: 0 }}>
                              {qty}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {recipe.instructions && (
                <div>
                  <div style={sectionLabel}>Fremgangsmåte</div>
                  <div style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(207,224,239,0.85)', whiteSpace: 'pre-wrap' }}>{recipe.instructions}</div>
                </div>
              )}

              {recipe.ingredients.length === 0 && !recipe.instructions && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: MUTED }}>Ingen detaljer lagt til for denne oppskriften ennå.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
