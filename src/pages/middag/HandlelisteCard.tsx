import { useEffect, useRef, useState } from 'react';
import { useMatplan, weekDates, type GroceryItem, type MealPlanEntry, type Recipe } from '../../contexts/MatplanContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { handleukeStart } from '../../hooks/useWeeklyBucket';
import { Card, Check, SkeletonList } from '../../components';

// Selve handlelisten — vises på src/pages/Handleliste.tsx, som også har
// basisvare-administrasjonen (StapleManager, bevisst IKKE en del av denne
// komponenten). groupByNameUnit under gjenbrukes derimot flere steder
// (Gangskjerm og Hjem-sidens forhåndsvisninger), for samme dedupliserte
// telling/gruppering overalt — se importene av den i Skjerm.tsx/Dashboard.tsx.

// Samme knapp, samme plass (helt til høyre) enten den viser ✎ (lukket) eller
// × (åpen) — den betyr ALLTID «bytt redigeringsmodus», aldri slett. Sletting
// er en egen, rød knapp som kun vises for allerede kjøpte varer, se
// deleteBtnStyle.
const editBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
  cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)', flexShrink: 0,
  minWidth: 32, minHeight: 32, display: 'grid', placeItems: 'center',
};

const stepperBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--line)', borderRadius: 6,
  cursor: 'pointer', fontSize: 14, color: 'var(--ink-3)', fontWeight: 700,
  width: 26, height: 26, display: 'grid', placeItems: 'center', lineHeight: 1,
};

// Kun for allerede KJØPTE varer i redigeringsmodus — mengderedigering gir
// ikke mening for noe som allerede er kjøpt, så stepperen erstattes med
// denne i stedet. Aktive (ikke-kjøpte) varer har aldri noen sletteknapp —
// de kan kun justeres med −/+, ikke fjernes manuelt.
const deleteBtnStyle: React.CSSProperties = {
  background: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 6,
  cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff',
  padding: '0 12px', height: 26, flexShrink: 0, whiteSpace: 'nowrap',
};

// Overgangen (bakgrunn + nedtoning) er den «diskrete visuelle effekten» ved
// avhuking — ren CSS-transition på de samme betingede stilene raden allerede
// hadde, ikke en egen animasjons-mekanikk. Symmetrisk med vilje: den spiller
// av samme myke overgang begge veier (avhuking OG angring), siden angring
// eksplisitt bare skal fortsette å virke som i dag, ikke få sin egen greie.
const rowTransition = 'background 240ms ease, opacity 240ms ease';

function fmtShortDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}

// +/- og slett er skjult som standard — kun navn + mengde/enhet vises, siden
// hoved-interaksjonen med lista er avhuking, ikke redigering. Knappen helt
// til høyre (✎/×) åpner/lukker redigering for akkurat denne raden
// (uavhengig per rad, ikke én global «rediger»-modus for hele lista — se
// samtalen for hvorfor det passer bedre med hvordan lista faktisk brukes),
// men den × betyr ALDRI slett — kun «lukk redigering». I redigeringsmodus:
// aktiv vare viser −/+ (ingen sletteknapp, aktive varer kan ikke fjernes
// manuelt), kjøpt vare viser en rød «Slett»-knapp i stedet (mengde gir ikke
// mening for noe som allerede er kjøpt).
function GroceryRow({ name, amount, amountRange, approx, unit, done, editing, onToggle, onEditToggle, onRemove, onDecrement, onIncrement }: {
  name: string; amount: number | null; amountRange: string | null; approx?: boolean; unit: string | null; done: boolean;
  editing: boolean;
  onToggle: () => void; onEditToggle: () => void; onRemove: () => void;
  /** Kun satt for enkeltstående, tallbaserte rader — se groupByNameUnit-kallstedet for hvorfor sammenslåtte grupper ikke får stepper her (de får en utvidet visning i stedet, se GroupBreakdown). */
  onDecrement?: () => void; onIncrement?: () => void;
}) {
  const steppable = !!(onDecrement && onIncrement);
  const showStepper = editing && steppable && !done;
  const showDelete = editing && done;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: done ? 'var(--surface-2)' : 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
      opacity: done ? 0.55 : 1, transition: rowTransition,
    }}>
      <Check on={done} onClick={onToggle} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span onClick={onToggle} style={{ fontSize: 14, color: 'var(--ink)', textDecoration: done ? 'line-through' : 'none', cursor: 'pointer' }}>{name}</span>
        {!showStepper && !showDelete && (amount != null || amountRange != null || unit) && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)', marginLeft: 8 }}>
            {amountRange ?? amount ?? ''}{approx ? '+' : ''} {unit ?? ''}
          </span>
        )}
      </div>
      {showStepper && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button onClick={onDecrement} aria-label="Færre" style={stepperBtnStyle}>−</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'center' }}>
            {amount ?? 1}{unit ? ` ${unit}` : ''}
          </span>
          <button onClick={onIncrement} aria-label="Flere" style={stepperBtnStyle}>+</button>
        </div>
      )}
      {showDelete && <button onClick={onRemove} style={deleteBtnStyle}>Slett</button>}
      <button onClick={onEditToggle} aria-label={editing ? 'Lukk redigering' : 'Rediger mengde'} style={editBtnStyle}>{editing ? '×' : '✎'}</button>
    </div>
  );
}

// En sammenslått gruppe (flere planlagte middager som trenger samme
// ingrediens/enhet) har ingen ÉN tallverdi å justere med +/- på selve
// oppsummeringsraden — se mealStepperProps. I redigeringsmodus vises derfor
// hver underliggende grocery_items-rad for seg her, med sin egen +/- og ×,
// slik at man redigerer det faktiske, enkeltstående tallet i stedet for å
// gjette en andel av en sum.
// Vises kun mens foreldregruppen er i redigeringsmodus (styrt av
// editingKeys på gruppens key, ikke noe eget åpen/lukket-state per rad her)
// — så hver underrad trenger ikke sin egen ✎/×-knapp. Samme aktiv/kjøpt-
// regel som de andre radtypene: aktiv vare får kun stepper, kjøpt vare får
// kun rød «Slett» (ingen sletteknapp for aktive varer, ingen mengderedigering
// for kjøpte).
function GroupBreakdown({ items, mealPlan, recipes, onDecrement, onIncrement, onRemove }: {
  items: GroceryItem[]; mealPlan: MealPlanEntry[]; recipes: Recipe[];
  onDecrement: (id: string) => void; onIncrement: (id: string) => void; onRemove: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '0 0 0 40px' }}>
      {items.map(item => {
        const entry = item.mealPlanId ? mealPlan.find(mp => mp.id === item.mealPlanId) : undefined;
        const recipe = entry ? recipes.find(r => r.id === entry.recipeId) : undefined;
        const label = entry ? `${recipe?.name ?? 'Ukjent oppskrift'} · ${fmtShortDate(entry.date)}` : 'Ukjent middag';
        const steppable = item.amountRange == null && !item.done;
        return (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
            background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6,
          }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label}
            </span>
            {item.done ? (
              <button onClick={() => onRemove(item.id)} style={deleteBtnStyle}>Slett</button>
            ) : steppable ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button onClick={() => onDecrement(item.id)} aria-label="Færre" style={stepperBtnStyle}>−</button>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, minWidth: 14, textAlign: 'center' }}>
                  {item.amount ?? 1}{item.unit ? ` ${item.unit}` : ''}
                </span>
                <button onClick={() => onIncrement(item.id)} aria-label="Flere" style={stepperBtnStyle}>+</button>
              </div>
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)', flexShrink: 0 }}>
                {item.amountRange} {item.unit ?? ''}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Frittstående dagligvare (ikke koblet til middag/basisvare) — samme
// avkrysning som GroceryRow, men med +/- for antall i stedet for en fast
// mengde fra en oppskrift/basisvare-definisjon.
function FreeGroceryRow({ item, editing, onToggle, onEditToggle, onDecrement, onIncrement, onRemove }: {
  item: GroceryItem; editing: boolean;
  onToggle: () => void; onEditToggle: () => void; onDecrement: () => void; onIncrement: () => void; onRemove: () => void;
}) {
  const showStepper = editing && !item.done;
  const showDelete = editing && item.done;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: item.done ? 'var(--surface-2)' : 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
      opacity: item.done ? 0.55 : 1, transition: rowTransition,
    }}>
      <Check on={item.done} onClick={onToggle} />
      <span onClick={onToggle} style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ink)', textDecoration: item.done ? 'line-through' : 'none', cursor: 'pointer' }}>
        {item.name}
      </span>
      {showStepper && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button onClick={onDecrement} aria-label="Færre" style={stepperBtnStyle}>−</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'center' }}>{item.amount ?? 1}</span>
          <button onClick={onIncrement} aria-label="Flere" style={stepperBtnStyle}>+</button>
        </div>
      )}
      {showDelete && <button onClick={onRemove} style={deleteBtnStyle}>Slett</button>}
      {!showStepper && !showDelete && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>{item.amount ?? 1}</span>
      )}
      <button onClick={onEditToggle} aria-label={editing ? 'Lukk redigering' : 'Rediger mengde'} style={editBtnStyle}>{editing ? '×' : '✎'}</button>
    </div>
  );
}

export interface MergedGroup {
  key: string;
  name: string;
  unit: string | null;
  amount: number | null;
  amountRange: string | null;
  /** true når minst én rad i gruppen manglet mengde (og ikke hadde et intervall i stedet) — summen er da et minimum, ikke eksakt. */
  approx: boolean;
  done: boolean;
  /** Seneste done_at blant radene i gruppen — brukes til å sortere «Vis handlet» med sist avhuket øverst. */
  doneAt: string | null;
  ids: string[];
  /** Fra første rad i gruppen — se GroceryItem.category. Brukes til å gruppere under butikkavdeling i Handlemodus (ShoppingMode.tsx), ikke av HandlelisteCard selv. */
  category: string | null;
}

// Samme ingrediens (navn+enhet) fra flere planlagte middager denne uken skal
// vises som ÉN rad med summert mengde, ikke én rad per middag — men radene i
// databasen holdes fortsatt separate (én per meal_plan_id), så sporbarhet til
// hvilken middag som trenger hva består, og fjernes en middag fra ukeplanen
// forsvinner riktig kun DEN middagens bidrag (on delete cascade). Grupperingen
// skjer derfor kun her, i visningslaget — se samtalen for hvorfor det er
// tryggere enn å slå sammen ved innsetting.
// Ulik enhet slås aldri sammen (nøkkelen inkluderer enheten), så «1 Liter» og
// «500 ml» melk forblir to rader i stedet for feilaktig 501.
// Et intervall (amountRange, f.eks. "0.5-1" ts salt) kan ikke summeres
// numerisk med noe annet — verken med et rent tall eller et ANNET intervall
// (bevisst avgrensning: ingen utledet «kombinert» intervall bygges). Derfor
// er amountRange også en del av nøkkelen: en rad med intervall grupperes
// aldri sammen med en tallverdi-rad for samme ingrediens/enhet, kun med
// andre rader som har PRESIS samme intervalltekst (det er ren visnings-
// konsolidering — ingen tall regnes om — så to middager som begge trenger
// nøyaktig «0.5-1» vises fortsatt som én rad, med checkboxen koblet til
// begge underliggende radene).
export function groupByNameUnit(items: GroceryItem[]): MergedGroup[] {
  const groups = new Map<string, MergedGroup>();
  for (const g of items) {
    const key = `${g.name.trim().toLowerCase()}|${(g.unit ?? '').trim().toLowerCase()}|${g.amountRange ?? ''}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key, name: g.name, unit: g.unit, amount: g.amount, amountRange: g.amountRange,
        approx: g.amount == null && g.amountRange == null, done: g.done, doneAt: g.doneAt, ids: [g.id],
        category: g.category,
      });
      continue;
    }
    existing.ids.push(g.id);
    existing.done = existing.done && g.done;
    if (existing.doneAt == null || (g.doneAt != null && g.doneAt > existing.doneAt)) existing.doneAt = g.doneAt;
    if (g.amount == null && g.amountRange == null) existing.approx = true;
    else if (g.amount != null) existing.amount = (existing.amount ?? 0) + g.amount;
  }
  return [...groups.values()];
}

// Hvor lenge en nettopp avhuket rad holdes synlig på sin opprinnelige plass
// (med done-utseendet — nedtonet bakgrunn, strek gjennom navnet — allerede
// påført) før den faktisk flyttes til «Vis handlet». Uten dette forsvinner
// raden fra visningen i det databaseoppdateringen (og påfølgende load()) er
// ferdig, typisk raskere enn CSS-overgangen — man rekker aldri å SE den.
// done-status i databasen oppdateres med det samme, uendret; det er kun
// UI-plasseringen som venter.
const DONE_HOLD_MS = 1500;

export default function HandlelisteCard() {
  const { groceryItems, mealPlan, recipes, loading, syncGroceryList, addGroceryItem, setGroceryAmount, toggleGroceryItem, removeGroceryItem } = useMatplan();
  const { confirm } = useConfirm();
  const { notify } = useSnackbar();
  const [showDone, setShowDone] = useState(false);
  const [newItem, setNewItem] = useState('');
  // id-er som nettopp ble huket av og fortsatt holdes i sin opprinnelige
  // seksjon (se DONE_HOLD_MS). Timerne holdes i et eget ref-Map (id → timer),
  // slik at et raskt av-og-på-klikk på samme rad kan rydde/erstatte sin egen
  // tidligere timer i stedet for å stable flere.
  const [pendingDoneIds, setPendingDoneIds] = useState<Set<string>>(new Set());
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Speilvendt motstykke til pendingDoneIds: id-er som nettopp ble ANGRET
  // (huket av) og fortsatt holdes i «Vis handlet» i DONE_HOLD_MS, slik at den
  // omvendte overgangen (avkrysning fjernes, strek gjennom fjernes, full
  // opacity) rekker å spille av på sin opprinnelige plass før raden faktisk
  // flyttes til aktiv-lista. done_at nullstilles i databasen med det samme,
  // uendret — kun UI-plasseringen venter, samme prinsipp som avhuking.
  // pendingUndoneDoneAt fanger den forrige done_at-verdien synkront, FØR
  // toggleGroceryItem nullstiller den, slik at raden fortsatt sorterer riktig
  // i «Vis handlet» (sist avhuket øverst) mens den holdes der.
  const [pendingUndoneIds, setPendingUndoneIds] = useState<Set<string>>(new Set());
  const pendingUndoneDoneAt = useRef<Map<string, string>>(new Map());
  // Hvilke rader som viser +/- og × akkurat nå — nøklet på group.key (Fra
  // ukens middager) eller g.id (Andre varer/Basisvarer), aldri kollisjon
  // siden formatene er helt ulike. Uavhengig per rad, med vilje — se
  // GroceryRow sin kommentar.
  const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set());
  const toggleEditKey = (key: string) => {
    setEditingKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  useEffect(() => () => {
    // Avmontering midt i en holdeperiode (f.eks. bytter side rett etter
    // avhuking) skal ikke prøve å sette state på en komponent som er borte.
    pendingTimers.current.forEach(t => clearTimeout(t));
  }, []);

  // Genererer manglende rader (planlagte middager denne uken + forfalte
  // basisvarer) én gang når dataene er klare — idempotent (databasen håndhever
  // det, se syncGroceryList), rører aldri eksisterende avhukinger. Kjører
  // uansett hvilken side komponenten monteres på.
  useEffect(() => {
    if (!loading) void syncGroceryList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Avhuking/angring for rader som kan forsvinne inn i eller ut av en skjult
  // «Vis handlet»-seksjon — Fra ukens middager / Basisvarer / Andre varer,
  // alle tre likt siden alle tre kan flytte seg dit.
  //
  // Race-vern: ids legges i pendingDoneIds/pendingUndoneIds SYNKRONT her, før
  // noen await — et sanntidsoppdatering fra en annen enhet som lander midt i
  // holdeperioden endrer bare de underliggende radenes egne felt (done,
  // amount, ...), aldri selve pending-settene, så en rad som allerede holdes
  // synlig fortsetter å holdes synlig uansett hva som skjer ellers i lista —
  // ingen «hopp». Slettes raden fullstendig et annet sted mens den er
  // pending, forsvinner den ganske enkelt fra groceryItems/linked som
  // normalt; den nå ubrukte id-en i pending-settet er harmløs og ryddes bort
  // av sin egen timer uansett.
  const toggleWithHold = (ids: string[]) => {
    const turningOn = ids.some(id => groceryItems.find(g => g.id === id)?.done === false);
    // Fanges FØR toggleGroceryItem nullstiller done_at i databasen — se
    // pendingUndoneDoneAt over for hvorfor.
    if (!turningOn) {
      ids.forEach(id => {
        const doneAt = groceryItems.find(g => g.id === id)?.doneAt;
        pendingUndoneDoneAt.current.set(id, doneAt ?? new Date().toISOString());
      });
    }
    ids.forEach(id => void toggleGroceryItem(id));

    ids.forEach(id => {
      const t = pendingTimers.current.get(id);
      if (t) { clearTimeout(t); pendingTimers.current.delete(id); }
    });

    if (turningOn) {
      // Rask av-og-på igjen mens en angrings-holdeperiode fortsatt pågikk:
      // ikke la raden bli hengende i pendingUndoneIds forbi sin egen re-avhuking.
      setPendingUndoneIds(prev => {
        if (!ids.some(id => prev.has(id))) return prev;
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      setPendingDoneIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.add(id));
        return next;
      });
      ids.forEach(id => {
        const timer = setTimeout(() => {
          setPendingDoneIds(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          pendingTimers.current.delete(id);
        }, DONE_HOLD_MS);
        pendingTimers.current.set(id, timer);
      });
    } else {
      // Speilvendt av over: raden holdes nå i «Vis handlet» i stedet for å
      // hoppe rett til aktiv-lista, slik at den omvendte CSS-overgangen
      // rekker å spille av på sin opprinnelige plass. Samme rydding av en
      // eventuell pågående avhukings-holdeperiode som over, motsatt vei.
      setPendingDoneIds(prev => {
        if (!ids.some(id => prev.has(id))) return prev;
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      setPendingUndoneIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.add(id));
        return next;
      });
      ids.forEach(id => {
        const timer = setTimeout(() => {
          setPendingUndoneIds(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          pendingUndoneDoneAt.current.delete(id);
          pendingTimers.current.delete(id);
        }, DONE_HOLD_MS);
        pendingTimers.current.set(id, timer);
      });
    }
  };

  const submitNewItem = async () => {
    const name = newItem.trim();
    if (!name) return;
    setNewItem('');
    try {
      await addGroceryItem({ name, amount: 1 });
    } catch (err) {
      // Gi varen tilbake i feltet slik at forsøket ikke går tapt, og vis
      // hvorfor det ikke gikk — uten dette forsvinner en avvist innsetting
      // sporløst, se addGroceryItem i MatplanContext.tsx.
      setNewItem(name);
      const message = err instanceof Error ? err.message : String(err);
      notify(`Klarte ikke å legge til «${name}»: ${message}`);
    }
  };

  // Middag/basisvare-genererte rader. Aktive ruller over uendret (ingen
  // dato-avgrensning), men «vis handlet» skal kun vise det som ble kjøpt i
  // INNEVÆRENDE handleuke — ellers ville avhukede rader fra uker tilbake i
  // tid bare hope seg opp der for alltid. Rader uten done_at (avhuket før
  // denne kolonnen fantes) matcher aldri — de forsvinner fra «vis handlet»,
  // men slettes ikke fra databasen.
  const linked = groceryItems.filter(g => g.mealPlanId || g.stapleItemId);
  // pendingDoneIds holder en nettopp avhuket rad i «active» (visuelt uendret
  // plass) i DONE_HOLD_MS etter avhuking, selv om den reelt sett allerede er
  // done i databasen — se toggleWithHold. Radens EGEN done-styling (avkrysset,
  // nedtonet, strek gjennom) leser fortsatt det reelle g.done, så overgangen
  // faktisk får tid til å spille av på sin opprinnelige plass før den flyttes.
  // pendingUndoneIds er speilvendt: holder en nettopp angret rad i «done»
  // (visuelt uendret plass), selv om den reelt sett allerede er ikke-done —
  // derfor ekskluderes den eksplisitt fra active til holdeperioden er over.
  const active = linked.filter(g => (!g.done || pendingDoneIds.has(g.id)) && !pendingUndoneIds.has(g.id));
  const handleukeDays = new Set(weekDates(handleukeStart()));
  const doneThisHandleuke = (g: GroceryItem) =>
    g.doneAt != null && handleukeDays.has(new Date(g.doneAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' }));
  const done = linked.filter(g => (g.done && doneThisHandleuke(g) && !pendingDoneIds.has(g.id)) || pendingUndoneIds.has(g.id));
  // done_at er allerede nullstilt i databasen for en pending-angret rad (se
  // toggleWithHold) — bruk den fangede verdien i stedet, kun for sortering,
  // så «Vis handlet» ikke mister rekkefølgen mens raden holdes der.
  const doneSortable = done.map(g => g.doneAt != null ? g : { ...g, doneAt: pendingUndoneDoneAt.current.get(g.id) ?? g.doneAt });
  const fromMeals     = groupByNameUnit(active.filter(g => g.mealPlanId));
  const fromMealsDone = groupByNameUnit(doneSortable.filter(g => g.mealPlanId));
  const staples     = active.filter(g => g.stapleItemId);
  const staplesDone = doneSortable.filter(g => g.stapleItemId);

  // Frittstående varer (verken meal_plan_id eller staple_item_id) — den enkle
  // handlelisten («Andre varer»). Bruker nå nøyaktig samme regler som Fra
  // ukens middager/Basisvarer over: hold ved avhuking/angring (toggleWithHold)
  // og samme handleuke-avgrensede flytting til «Vis handlet», se doneEntries
  // under. Dette var opprinnelig en bevisst egen, alltid-synlig seksjon (fra
  // commit c9991fb, FØR «Vis handlet» og holde-mekanikken fantes i det hele
  // tatt) — ikke feil fra starten av, men ble aldri revurdert da de to senere
  // ble bygget kun for middag-/basisvare-rader (commit bdcc2d9/8a4b549), så
  // asymmetrien sto igjen.
  const freeform        = groceryItems.filter(g => !g.mealPlanId && !g.stapleItemId);
  const freeformActive = freeform.filter(g => (!g.done || pendingDoneIds.has(g.id)) && !pendingUndoneIds.has(g.id));
  const freeformDone    = freeform.filter(g => (g.done && doneThisHandleuke(g) && !pendingDoneIds.has(g.id)) || pendingUndoneIds.has(g.id));
  const freeformDoneSortable = freeformDone.map(g => g.doneAt != null ? g : { ...g, doneAt: pendingUndoneDoneAt.current.get(g.id) ?? g.doneAt });

  // Nøyaktig de underliggende grocery_items-id-ene som faktisk vises i «Vis
  // handlet» akkurat nå — brukt av «Tøm handlet»-knappen under.
  //
  // Trygt å slette permanent, også for en basisvare-rad: last_bought_at
  // ligger på selve staple_items-raden (satt av toggleGroceryItem() i
  // MatplanContext.tsx), ikke på denne grocery_items-raden — kjøpshistorikken
  // overlever altså at raden slettes. Neste gang varen forfaller (isStapleDue
  // i MatplanContext.tsx), finner syncGroceryList()'s upsert (onConflict:
  // 'staple_item_id') ingen eksisterende rad å oppdatere og setter i stedet
  // inn en helt fersk — samme sluttresultat som gjenbruk-stien, bare insert
  // fremfor update. Verifisert i koden, ikke bare antatt.
  const doneIds = [...fromMealsDone.flatMap(g => g.ids), ...staplesDone.map(g => g.id), ...freeformDoneSortable.map(g => g.id)];

  const clearDone = async () => {
    if (!await confirm({
      title: 'Tøm handlet?',
      message: `Sletter ${doneIds.length} ${doneIds.length === 1 ? 'vare' : 'varer'} fra «Vis handlet» permanent. Dette kan ikke angres.`,
      confirmLabel: 'Tøm handlet',
    })) return;
    doneIds.forEach(id => void removeGroceryItem(id));
  };

  // +/- på selve oppsummeringsraden er kun meningsfullt når gruppen faktisk
  // er ÉN grocery_items-rad (group.ids.length === 1) med et rent tall — ikke
  // et intervall (amountRange, f.eks. "0.5-1", har ingen tallverdi å telle
  // fra). Er gruppen sammenslått fra flere planlagte middager, er group.amount
  // en SUM — se GroupBreakdown for hvordan +/- løses der i stedet (redigerer
  // hver underliggende rad for seg, ikke en gjettet andel av summen).
  const mealStepperProps = (group: MergedGroup) => {
    if (group.ids.length !== 1 || group.amountRange != null) return {};
    const id = group.ids[0];
    return {
      onDecrement: () => void setGroceryAmount(id, Math.max(1, (group.amount ?? 1) - 1)),
      onIncrement: () => void setGroceryAmount(id, (group.amount ?? 1) + 1),
    };
  };

  // Utvidet visning for en sammenslått gruppe i redigeringsmodus — én rad per
  // underliggende grocery_items-id, med hvilken middag/dato den stammer fra.
  const renderBreakdown = (group: MergedGroup) => (
    editingKeys.has(group.key) && group.ids.length > 1 && (
      <GroupBreakdown
        items={group.ids.map(id => groceryItems.find(g => g.id === id)).filter((g): g is GroceryItem => !!g)}
        mealPlan={mealPlan} recipes={recipes}
        onDecrement={id => void setGroceryAmount(id, Math.max(1, (groceryItems.find(g => g.id === id)?.amount ?? 1) - 1))}
        onIncrement={id => void setGroceryAmount(id, (groceryItems.find(g => g.id === id)?.amount ?? 1) + 1)}
        onRemove={id => void removeGroceryItem(id)}
      />
    )
  );

  // «Vis handlet» — én sammenslått liste (middag-grupper + basisvarer om
  // hverandre, det er ingen visuell overskrift mellom dem i dag heller) sortert
  // med sist avhuket øverst, i stedet for databasens naturlige rekkefølge.
  // doneSortable (over) garanterer at doneAt aldri er null for noe som havner
  // her, selv for en pending-angret rad hvis ekte done_at allerede er nullstilt.
  type DoneEntry = { doneAt: string; render: () => React.ReactNode };
  const doneEntries: DoneEntry[] = [
    ...fromMealsDone.map(group => ({
      doneAt: group.doneAt!,
      render: () => (
        <div key={group.key}>
          <GroceryRow name={group.name} amount={group.amount} amountRange={group.amountRange} approx={group.approx} unit={group.unit} done={group.done}
            editing={editingKeys.has(group.key)} onEditToggle={() => toggleEditKey(group.key)}
            onToggle={() => toggleWithHold(group.ids)}
            onRemove={() => group.ids.forEach(id => void removeGroceryItem(id))}
            {...mealStepperProps(group)} />
          {renderBreakdown(group)}
        </div>
      ),
    })),
    ...staplesDone.map(g => ({
      doneAt: g.doneAt!,
      render: () => (
        <GroceryRow key={g.id} name={g.name} amount={g.amount} amountRange={g.amountRange} unit={g.unit} done={g.done}
          editing={editingKeys.has(g.id)} onEditToggle={() => toggleEditKey(g.id)}
          onToggle={() => toggleWithHold([g.id])} onRemove={() => void removeGroceryItem(g.id)}
          {...(g.amountRange == null ? {
            onDecrement: () => void setGroceryAmount(g.id, Math.max(1, (g.amount ?? 1) - 1)),
            onIncrement: () => void setGroceryAmount(g.id, (g.amount ?? 1) + 1),
          } : {})} />
      ),
    })),
    ...freeformDoneSortable.map(g => ({
      doneAt: g.doneAt!,
      render: () => (
        <FreeGroceryRow key={g.id} item={g}
          editing={editingKeys.has(g.id)} onEditToggle={() => toggleEditKey(g.id)}
          onToggle={() => toggleWithHold([g.id])}
          onDecrement={() => void setGroceryAmount(g.id, Math.max(1, (g.amount ?? 1) - 1))}
          onIncrement={() => void setGroceryAmount(g.id, (g.amount ?? 1) + 1)}
          onRemove={() => void removeGroceryItem(g.id)} />
      ),
    })),
  ].sort((a, b) => b.doneAt.localeCompare(a.doneAt));

  return (
    <Card eyebrow="Dagligvarer" title="Handleliste">
      {loading && <SkeletonList rows={5} />}
      {!loading && active.length === 0 && done.length === 0 && freeform.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
          Ingenting på handlelisten — legg til en vare under, planlegg middager i Ukeplan, eller legg til basisvarer nederst.
        </div>
      )}

      {!loading && (
        <div style={{ marginBottom: (fromMeals.length || staples.length) ? 16 : 0 }}>
          <div className="card-eyebrow" style={{ marginBottom: 8 }}>Andre varer</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input className="input" placeholder="Legg til vare…" value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void submitNewItem()}
              style={{ flex: 1 }} />
            <button onClick={() => void submitNewItem()} className="btn primary sm" disabled={!newItem.trim()}
              style={{ opacity: !newItem.trim() ? 0.4 : 1 }}>+ Legg til</button>
          </div>
          {freeformActive.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {freeformActive.map(g => (
                <FreeGroceryRow key={g.id} item={g}
                  editing={editingKeys.has(g.id)} onEditToggle={() => toggleEditKey(g.id)}
                  onToggle={() => toggleWithHold([g.id])}
                  onDecrement={() => void setGroceryAmount(g.id, Math.max(1, (g.amount ?? 1) - 1))}
                  onIncrement={() => void setGroceryAmount(g.id, (g.amount ?? 1) + 1)}
                  onRemove={() => void removeGroceryItem(g.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && fromMeals.length > 0 && (
        <div style={{ marginBottom: staples.length ? 16 : 0 }}>
          <div className="card-eyebrow" style={{ marginBottom: 8 }}>Fra ukens middager</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {fromMeals.map(group => (
              <div key={group.key}>
                <GroceryRow name={group.name} amount={group.amount} amountRange={group.amountRange} approx={group.approx} unit={group.unit} done={group.done}
                  editing={editingKeys.has(group.key)} onEditToggle={() => toggleEditKey(group.key)}
                  onToggle={() => toggleWithHold(group.ids)}
                  onRemove={() => group.ids.forEach(id => void removeGroceryItem(id))}
                  {...mealStepperProps(group)} />
                {renderBreakdown(group)}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && staples.length > 0 && (
        <div>
          <div className="card-eyebrow" style={{ marginBottom: 8 }}>Basisvarer</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {staples.map(g => (
              <GroceryRow key={g.id} name={g.name} amount={g.amount} amountRange={g.amountRange} unit={g.unit} done={g.done}
                editing={editingKeys.has(g.id)} onEditToggle={() => toggleEditKey(g.id)}
                onToggle={() => toggleWithHold([g.id])} onRemove={() => void removeGroceryItem(g.id)}
                {...(g.amountRange == null ? {
                  onDecrement: () => void setGroceryAmount(g.id, Math.max(1, (g.amount ?? 1) - 1)),
                  onIncrement: () => void setGroceryAmount(g.id, (g.amount ?? 1) + 1),
                } : {})} />
            ))}
          </div>
        </div>
      )}

      {!loading && (done.length > 0 || freeformDone.length > 0) && (
        <div style={{ marginTop: active.length ? 16 : 0 }}>
          <button onClick={() => setShowDone(s => !s)}
            style={{ width: '100%', padding: '8px 0', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
            {showDone ? '↑ Skjul handlet' : `↓ Vis handlet (${fromMealsDone.length + staplesDone.length + freeformDoneSortable.length})`}
          </button>
          {showDone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              <button onClick={() => void clearDone()} className="btn danger sm" style={{ alignSelf: 'flex-end' }}>
                Tøm handlet
              </button>
              {doneEntries.map(entry => entry.render())}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
