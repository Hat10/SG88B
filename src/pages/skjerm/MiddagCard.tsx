import type React from 'react';
import type { MealPlanEntry, Recipe } from '../../contexts/MatplanContext';
import { m, type ScreenSize } from './shared';
import { swipeGlow } from './swipeGlow';
import { PagerArrows } from './PagerArrows';
import { addDaysLocal, consecutiveDays } from '../../lib/dagensMiddag';
import { dateLabel, dateLabelShort } from '../../lib/dayLabel';
import { useSwipePager } from '../../lib/useSwipePager';

// I dag t.o.m. i dag + 13 dager (14 dager). Ingen bakover i tid.
const MAX_DAYS_AHEAD = 13;

interface Props {
  mealPlan: MealPlanEntry[];
  recipes: Recipe[];
  /** yyyy-mm-dd, samme «i dag» som resten av Gangskjerm. */
  today: string;
  /** Fra useIdleReset: endres → kortet glir tilbake til i dag. */
  resetSignal: number;
  /** Trykk på kortet: åpne oppskriften for den VISTE datoen. */
  onOpenRecipe: (date: string) => void;
  /** Trykk på kortet når den viste dagen er tom: åpne «Legg til middag» for den datoen. */
  onAddMeal: (date: string) => void;
  isMobile: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Dagens middag — fra ukeplanen (Middag → Ukeplan). Kompakt, kun navn — trykk
// åpner en modal med full oppskrift; på en tom dag åpner trykk «Legg til middag». Sveip (eller ‹ ›) blar fremover t.o.m. +13 dager.
export function MiddagCard({ mealPlan, recipes, today, resetSignal, onOpenRecipe, onAddMeal, isMobile, screenSize, cell, eyebrow }: Props) {
  const pager = useSwipePager({ max: MAX_DAYS_AHEAD, resetSignal });
  const { offset } = pager;
  const date = addDaysLocal(today, offset);
  const isToday = offset === 0;

  const plan = mealPlan.find(mp => mp.date === date);
  const recipe = plan ? recipes.find(r => r.id === plan.recipeId) : undefined;
  // Samme oppskrift flere dager på rad fra den viste datoen → «×N dager».
  const mealDays = recipe ? consecutiveDays(mealPlan, date) : 0;

  const nameFont: React.CSSProperties = {
    fontSize: isMobile ? m.title : screenSize === 'desktop' ? 20 : screenSize === 'tablet' ? 13 : 17,
    fontWeight: 600, letterSpacing: '-0.01em',
  };
  const gap = isMobile ? 6 : screenSize === 'tablet' ? 3 : 4;
  // Smale mobilkort har ikke plass til «ons 21. okt» ved siden av etiketten.
  const label = isToday ? 'Dagens middag' : `Middag · ${offset === 1 ? 'i morgen' : isMobile ? dateLabelShort(date) : dateLabel(date)}`;

  // Tom dag er også trykkbar (legg til middag). Et sveip utløser aldri klikk — se
  // onClickCapture i useSwipePager.
  const open = () => { if (recipe) onOpenRecipe(date); else onAddMeal(date); };

  return (
    <div
      {...pager.containerProps}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
      style={{
        ...cell, width: '100%', boxSizing: 'border-box', textAlign: 'left', font: 'inherit', color: 'inherit',
        cursor: 'pointer',
        padding: isMobile ? m.pad : screenSize === 'tablet' ? '8px 12px' : screenSize === 'desktop' ? '14px 20px' : '12px 16px',
        display: 'flex', flexDirection: 'column', ...(isMobile ? { minWidth: 0 } : {}),
        // Glød når en annen dag enn i dag vises (felles stil, se swipeGlow.ts).
        ...swipeGlow(!isToday, screenSize),
        ...pager.containerProps.style,
      }}
    >
      {/* Det som glir. Ellers nøytral: bærer gap'en kortet tidligere hadde selv. */}
      <div ref={pager.contentRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <div style={isToday ? eyebrow : { ...eyebrow, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🍽️ {label}</div>
          {/* Ikke plass til piler i de smale 2-kolonne-kortene på mobil — der sveipes det. */}
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <PagerArrows canPrev={pager.canPrev} canNext={pager.canNext} onPrev={pager.prev} onNext={pager.next} isMobile={isMobile} />
            </div>
          )}
        </div>

        {/* Stabil høyde: innholdet ligger oppå en usynlig «strut» med samme skrift
            og reservert linjetall (1 linje på tablet/desktop, 2 på mobil), så kortet
            er like høyt for kort navn, lange navn og tom dag. */}
        <div style={{ display: 'grid' }}>
          <div style={{ gridArea: '1 / 1', minWidth: 0 }}>
            {recipe ? (
              <div style={{
                ...nameFont, color: 'var(--ink-2)',
                ...(isMobile
                  ? { overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
                  : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
              }}>
                {recipe.name}
                {mealDays > 1 && (
                  <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 400, color: 'var(--ink-4)', letterSpacing: 0 }}>
                    ×{mealDays} dager
                  </span>
                )}
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 13, color: 'var(--ink-3)' }}>
                ＋ Legg til middag
              </div>
            )}
          </div>
          <div aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden', pointerEvents: 'none', ...nameFont }}>
            X{isMobile && <><br />X</>}
          </div>
        </div>
      </div>
    </div>
  );
}
