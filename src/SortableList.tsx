import { useEffect, useRef, type ReactNode } from 'react';
import {
  DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type Announcements, type DragEndEvent, type Modifier, type ScreenReaderInstructions, type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { canMoveDown, canMoveUp, moveByStep, moveItem } from './lib/reorder';

// Gjenbrukbar sorterbar liste: dra i grepet (☰) med mus, finger eller
// tastatur, eller — i «Endre rekkefølge»-modus — ▲▼-knapper per linje.
// Brukt for ingredienser i RecipeForm. Selve rekkefølge-logikken ligger i
// lib/reorder.ts (testet der); her er bare dnd-kit-oppsett og UI.

// Linjene flyttes bare loddrett — uten dette ville linjen som dras også
// følge fingeren sidelengs.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface SortableListProps<T> {
  items: T[];
  /** Stabil id per element — IKKE indeksen, ellers følger ikke lokal state i linjen med når den flyttes. */
  getId: (item: T) => string;
  /** Menneskelig navn på elementet, brukt i skjermleser-meldinger og ▲▼-etiketter. */
  getLabel: (item: T, index: number) => string;
  onReorder: (next: T[]) => void;
  /** true ⇒ ▲▼-knapper i stedet for grep (reserveløsning for berøring/tilgjengelighet). */
  stepMode?: boolean;
  /** Ubestemt form, f.eks. «ingrediens» — brukes i «Flytt ingrediens» og meldingene. */
  noun: string;
  renderItem: (item: T, index: number) => ReactNode;
}

export default function SortableList<T>({ items, getId, getLabel, onReorder, stepMode = false, noun, renderItem }: SortableListProps<T>) {
  const sensors = useSensors(
    // Mus starter dra nesten med en gang (4 px, så et klikk på grepet ikke blir et dra).
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Berøring: kort trykk-og-hold, så et vanlig sveip forbi grepet ikke starter dra.
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = items.map(getId);
  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const labelOf = (id: UniqueIdentifier) => {
    const i = ids.indexOf(String(id));
    return i >= 0 ? (getLabel(items[i], i).trim() || `${noun} ${i + 1}`) : noun;
  };
  const n = items.length;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Løftet ${labelOf(active.id)}. Posisjon ${position(active.id)} av ${n}.`,
    onDragOver: ({ active, over }) => over
      ? `${labelOf(active.id)} er flyttet til posisjon ${position(over.id)} av ${n}.`
      : `${labelOf(active.id)} er utenfor listen.`,
    onDragEnd: ({ active, over }) => over
      ? `${labelOf(active.id)} er sluppet på posisjon ${position(over.id)} av ${n}.`
      : `${labelOf(active.id)} er sluppet.`,
    onDragCancel: ({ active }) => `Flytting avbrutt. ${labelOf(active.id)} er tilbake på posisjon ${position(active.id)} av ${n}.`,
  };
  const screenReaderInstructions: ScreenReaderInstructions = {
    draggable: `Trykk mellomrom eller Enter for å løfte. Flytt med piltastene, trykk mellomrom eller Enter igjen for å slippe, eller Escape for å avbryte.`,
  };

  const endDragCursor = () => document.body.classList.remove('sort-dragging');
  useEffect(() => endDragCursor, []);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    endDragCursor();
    if (!over || active.id === over.id) return;
    onReorder(moveItem(items, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  // ▲▼: etter en flytting skal fokus følge elementet til ny plass, så man kan
  // trykke flere ganger på rad. Blir knappen deaktivert (havnet øverst/nederst),
  // flyttes fokus til den andre pilen på samme linje.
  const stepButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const pendingFocus = useRef<{ id: string; direction: 'up' | 'down' } | null>(null);
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    const same = stepButtons.current.get(`${p.id}:${p.direction}`);
    const other = stepButtons.current.get(`${p.id}:${p.direction === 'up' ? 'down' : 'up'}`);
    (same && !same.disabled ? same : other)?.focus();
  });
  const step = (index: number, direction: 'up' | 'down') => {
    pendingFocus.current = { id: ids[index], direction };
    onReorder(moveByStep(items, index, direction));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={() => {
        document.body.classList.add('sort-dragging');
        navigator.vibrate?.(10);
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={endDragCursor}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map((item, i) => (
          <SortableRow key={ids[i]} id={ids[i]} noun={noun} disabled={stepMode}>
            {stepMode && (() => {
              const label = getLabel(item, i).trim() || `${noun} ${i + 1}`;
              return (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button type="button" className="sort-step" aria-label={`Flytt ${label} opp`}
                    disabled={!canMoveUp(i, n)} onClick={() => step(i, 'up')}
                    ref={el => { stepButtons.current.set(`${ids[i]}:up`, el); }}>▲</button>
                  <button type="button" className="sort-step" aria-label={`Flytt ${label} ned`}
                    disabled={!canMoveDown(i, n)} onClick={() => step(i, 'down')}
                    ref={el => { stepButtons.current.set(`${ids[i]}:down`, el); }}>▼</button>
                </div>
              );
            })()}
            <div className="sort-row-body">{renderItem(item, i)}</div>
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, noun, disabled, children }: { id: string; noun: string; disabled: boolean; children: ReactNode }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id, disabled, attributes: { roleDescription: 'sorterbar' } });

  return (
    <div ref={setNodeRef} className={`sort-row${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}>
      {!disabled && (
        // Bare grepet starter dra (listeners + activator her, ikke på linjen),
        // så input-feltene på linjen oppfører seg som før. data-swipe-pager /
        // data-no-swipe: grepet eier berøringen sin, så sidemeny-sveipet i
        // App.tsx ikke tar den når grepet ligger nær venstre skjermkant.
        <button type="button" ref={setActivatorNodeRef} className="sort-grip"
          {...attributes} {...listeners} aria-label={`Flytt ${noun}`}
          data-swipe-pager="" data-no-swipe="">☰</button>
      )}
      {children}
    </div>
  );
}
