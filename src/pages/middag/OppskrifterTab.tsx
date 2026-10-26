import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMatplan, todayKey, type Recipe } from '../../contexts/MatplanContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { Card, Tag, SkeletonList } from '../../components';
import { useScrollLock } from '../../lib/useScrollLock';
import {
  searchRecipes, sortRecipes, lastCookedByRecipe, cookCountByRecipe, lastCookedLabel, type RecipeSort,
} from '../../lib/middagVelger';
import { getMissingDataTags, MISSING_DATA_LABEL, type MissingDataTag } from '../../lib/missingData';
import MissingDataTags from './MissingDataTags';
import RecipeDetail from './RecipeDetail';
import RecipeForm from './RecipeForm';

// Spesialverdi for «ingen tags»-filteret — kan ikke kollidere med en ekte tag
// siden brukerens tags trimmes og aldri kan bli tom streng.
const NO_TAGS = '';

const SORT_LABEL: Record<RecipeSort, string> = { az: 'A–Å', sist: 'Sist laget', mest: 'Mest laget', tid: 'Koketid' };
const SORT_STORAGE_KEY = 'sg88b.oppskrifter.sort';

// Sorteringsvalget huskes per nettleser (kun en bekvemmelighet — tåler at
// lagringen er blokkert eller tom).
function loadSort(): RecipeSort {
  try {
    const v = localStorage.getItem(SORT_STORAGE_KEY);
    if (v && v in SORT_LABEL) return v as RecipeSort;
  } catch { /* ignorer */ }
  return 'az';
}

type Panel = { kind: 'none' } | { kind: 'view'; id: string } | { kind: 'edit'; id: string } | { kind: 'new' };

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return isMobile;
}

/** Fullskjerm på mobil (samme mønster som EditScreen i Onskeliste.tsx). */
function MobileSheet({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  useScrollLock();
  return createPortal((
    <div style={{ position: 'fixed', inset: 0, zIndex: 301, background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 20px 12px' }}>
          <div style={{ minWidth: 0 }}>
            <div className="card-eyebrow">{eyebrow}</div>
            <h3 className="card-title" style={{ marginTop: 2 }}>{title}</h3>
          </div>
          <button onClick={onClose} aria-label="Lukk" style={{
            background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer',
            fontSize: 16, color: 'var(--ink-3)', minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>×</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
        {children}
      </div>
    </div>
  ), document.body);
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{
      padding: '5px 11px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
      background: on ? 'var(--ink)' : 'var(--surface-2)', color: on ? 'var(--bg)' : 'var(--ink-3)',
      border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, fontFamily: 'var(--font-mono)', fontSize: 11,
    }}>{children}</button>
  );
}

export default function OppskrifterTab() {
  const { recipes, mealPlan, loading, removeRecipe, restoreRecipe } = useMatplan();
  const { notify } = useSnackbar();
  const { confirm } = useConfirm();
  const isMobile = useIsMobile();

  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  // Filter på avledede varseltagger (OR innad, som tag-filteret); kombineres med AND mot tag-filteret.
  const [missingFilter, setMissingFilter] = useState<Set<MissingDataTag>>(new Set());
  const [sort, setSortState] = useState<RecipeSort>(loadSort);
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });

  const setSort = (s: RecipeSort) => {
    setSortState(s);
    try { localStorage.setItem(SORT_STORAGE_KEY, s); } catch { /* ignorer */ }
  };

  const today = todayKey();
  const lastCooked = useMemo(() => lastCookedByRecipe(mealPlan, today), [mealPlan, today]);
  const cookCount = useMemo(() => cookCountByRecipe(mealPlan, today), [mealPlan, today]);
  const allTags = useMemo(
    () => Array.from(new Set(recipes.flatMap(r => r.tags))).sort((a, b) => a.localeCompare(b, 'nb')),
    [recipes],
  );
  const hasUntagged = recipes.some(r => r.tags.length === 0);
  const missingKinds = useMemo(() => {
    const present = new Set<MissingDataTag>();
    for (const r of recipes) getMissingDataTags(r).forEach(t => present.add(t));
    return (Object.keys(MISSING_DATA_LABEL) as MissingDataTag[]).filter(k => present.has(k) || missingFilter.has(k));
  }, [recipes, missingFilter]);

  const visible = useMemo(() => {
    const byTag = tagFilter.size === 0
      ? recipes
      : recipes.filter(r => (tagFilter.has(NO_TAGS) && r.tags.length === 0) || r.tags.some(t => tagFilter.has(t)));
    const byMissing = missingFilter.size === 0
      ? byTag
      : byTag.filter(r => getMissingDataTags(r).some(t => missingFilter.has(t)));
    const searched = query.trim() ? searchRecipes(byMissing, query) : byMissing;
    return sortRecipes(searched, sort, lastCooked, cookCount);
  }, [recipes, tagFilter, missingFilter, query, sort, lastCooked, cookCount]);

  const toggleTag = (t: string) => {
    setTagFilter(prev => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  };

  const toggleMissing = (k: MissingDataTag) => {
    setMissingFilter(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  };

  const panelRecipe: Recipe | undefined = panel.kind === 'view' || panel.kind === 'edit'
    ? recipes.find(r => r.id === panel.id) : undefined;
  // En oppskrift som forsvinner (slettet fra den andre telefonen) lukker panelet.
  const effectivePanel: Panel = (panel.kind === 'view' || panel.kind === 'edit') && !panelRecipe ? { kind: 'none' } : panel;
  const closePanel = () => setPanel({ kind: 'none' });

  const handleRemove = async (r: Recipe) => {
    if (!await confirm({ title: 'Slett oppskrift?', message: `«${r.name}»`, confirmLabel: 'Slett' })) return;
    closePanel();
    await removeRecipe(r.id);
    notify('Oppskrift slettet', { actionLabel: 'Angre', onAction: () => void restoreRecipe(r) });
  };

  const panelHeader = effectivePanel.kind === 'new' ? { eyebrow: 'Legg til', title: 'Ny oppskrift' }
    : effectivePanel.kind === 'edit' ? { eyebrow: 'Rediger', title: panelRecipe!.name }
    : effectivePanel.kind === 'view' ? { eyebrow: 'Oppskrift', title: panelRecipe!.name }
    : null;

  const panelBody = effectivePanel.kind === 'new' ? (
    <RecipeForm recipe={null} allTags={allTags} onCancel={closePanel}
      onSaved={() => { closePanel(); notify('Oppskrift lagt til'); }} />
  ) : effectivePanel.kind === 'edit' ? (
    <RecipeForm recipe={panelRecipe!} allTags={allTags}
      onCancel={() => setPanel({ kind: 'view', id: panelRecipe!.id })}
      onSaved={() => setPanel({ kind: 'view', id: panelRecipe!.id })}
      onDelete={() => void handleRemove(panelRecipe!)} />
  ) : effectivePanel.kind === 'view' ? (
    <RecipeDetail recipe={panelRecipe!} lastCooked={lastCooked.get(panelRecipe!.id)}
      cookCount={cookCount.get(panelRecipe!.id) ?? 0}
      onEdit={() => setPanel({ kind: 'edit', id: panelRecipe!.id })} />
  ) : null;

  const selectedId = effectivePanel.kind === 'view' || effectivePanel.kind === 'edit' ? effectivePanel.id : null;

  const list = (
    <Card eyebrow="Oppskrifter" title={`${visible.length === recipes.length ? 'Alle oppskrifter' : 'Treff'} (${visible.length})`}
      action={<button onClick={() => setPanel({ kind: 'new' })} className="btn primary sm">+ Ny oppskrift</button>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input className="input" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Søk på navn, ingrediens eller tag" style={{ flex: 1, minWidth: 0 }} />
        <select className="input" value={sort} onChange={e => setSort(e.target.value as RecipeSort)}
          aria-label="Sortering" style={{ width: 'auto', flexShrink: 0, cursor: 'pointer' }}>
          {(Object.keys(SORT_LABEL) as RecipeSort[]).map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </select>
      </div>

      {(allTags.length > 0 || hasUntagged || missingKinds.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {allTags.map(t => <Chip key={t} on={tagFilter.has(t)} onClick={() => toggleTag(t)}>{t}</Chip>)}
          {hasUntagged && allTags.length > 0 && <Chip on={tagFilter.has(NO_TAGS)} onClick={() => toggleTag(NO_TAGS)}>ingen tags</Chip>}
          {missingKinds.map(k => <Chip key={k} on={missingFilter.has(k)} onClick={() => toggleMissing(k)}>⚠ {MISSING_DATA_LABEL[k]}</Chip>)}
          {(tagFilter.size > 0 || missingFilter.size > 0) && (
            <button onClick={() => { setTagFilter(new Set()); setMissingFilter(new Set()); }} className="btn ghost sm">Nullstill</button>
          )}
        </div>
      )}

      {loading && <SkeletonList rows={4} />}
      {!loading && recipes.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
          Ingen oppskrifter ennå — trykk «+ Ny oppskrift»
        </div>
      )}
      {!loading && recipes.length > 0 && visible.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
          Ingen oppskrifter matcher søket
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map(r => {
          const on = r.id === selectedId;
          return (
            <button key={r.id} onClick={() => setPanel({ kind: 'view', id: r.id })} style={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
              padding: '12px 14px', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
              background: on ? 'var(--surface-2)' : 'var(--bg)',
              border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, borderRadius: 6,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{r.name}</div>
                {(r.tags.length > 0 || r.source === 'spoonacular' || getMissingDataTags(r).length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {r.source === 'spoonacular' && <Tag>spoonacular</Tag>}
                    {r.tags.map(t => <Tag key={t}>{t}</Tag>)}
                    <MissingDataTags recipe={r} />
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)', lineHeight: 1.6 }}>
                {r.cookTimeMinutes != null && <div>{r.cookTimeMinutes} min</div>}
                <div>{lastCookedLabel(lastCooked.get(r.id), today)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );

  if (isMobile) {
    return (
      <>
        {list}
        {panelHeader && (
          <MobileSheet eyebrow={panelHeader.eyebrow} title={panelHeader.title} onClose={closePanel}>{panelBody}</MobileSheet>
        )}
      </>
    );
  }

  return (
    <div className="grid grid-12">
      <div className="col-7">{list}</div>
      <div className="col-5">
        <div style={{ position: 'sticky', top: 16 }}>
          {panelHeader ? (
            <Card eyebrow={panelHeader.eyebrow} title={panelHeader.title}
              action={<button onClick={closePanel} className="btn ghost sm" aria-label="Lukk">×</button>}>
              {panelBody}
            </Card>
          ) : (
            <Card eyebrow="Oppskrift" title="Velg en oppskrift">
              <div style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.6 }}>
                Trykk på en oppskrift for å se ingredienser og fremgangsmåte, eller planlegge den på en dag.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
