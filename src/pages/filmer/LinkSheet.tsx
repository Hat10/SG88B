// «Koble filmer til TMDB»: søker etter alle ukoblede titler, kjører den strenge
// matchregelen (matchTmdb) og viser en forhåndsvisning. Sikre forslag er
// avkrysset, usikre må velges manuelt. Ingenting lagres før «Koble valgte».
// Frisker samtidig opp koblede titler med data eldre enn 5 måneder (TMDB-vilkår: maks 6).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMovies, type TmdbResult } from '../../contexts/MovieContext';
import {
  findTmdbDuplicate, isLinked, matchTmdb, type MatchReason, type Movie, type TmdbMatch,
} from '../../lib/movies';
import { BULK_REFRESH_DAYS, fieldsFromDetails, isStale, tmdbKindOf, type TmdbCandidate } from '../../lib/tmdb';
import { getTmdbDetails, searchTmdb } from '../../lib/tmdbClient';
import { Sheet } from './Sheet';
import { Poster, fieldsFor } from './tmdbParts';

interface Row {
  movie: Movie;
  match: TmdbMatch | null;     // null = søket feilet
  error: string | null;
  choice: TmdbCandidate | null;
  checked: boolean;
}

type Phase =
  | { t: 'scan'; done: number; total: number }
  | { t: 'review' }
  | { t: 'save'; done: number; total: number }
  | { t: 'done'; linked: number; refreshed: number; failed: number; missing: boolean }
  | { t: 'fatal'; message: string };

const REASON: Record<MatchReason, string> = {
  sequel: 'Nummerert oppfølger – velg riktig',
  ambiguous: 'Flere mulige treff – velg riktig',
  none: 'Ingen sikre treff',
};

/** Kjører `fn` over `items` med begrenset samtidighet. */
async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>, stop: () => boolean) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function LinkSheet({ onClose, onShowUnlinked }: { onClose: () => void; onShowUnlinked: () => void }) {
  const { movies, setTmdb } = useMovies();
  // Øyeblikksbilde ved åpning, så realtime-endringer ikke starter skanningen på nytt.
  const [targets] = useState(() => movies.filter(m => !isLinked(m)));
  const [stale] = useState(() => movies.filter(m => isLinked(m) && isStale(m.tmdbSyncedAt, BULK_REFRESH_DAYS)));
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<Phase>({ t: 'scan', done: 0, total: targets.length });
  // Avbrudd når arket lukkes (settes tilbake ved (re)montering, f.eks. i StrictMode).
  const cancelled = useRef(false);
  useEffect(() => { cancelled.current = false; return () => { cancelled.current = true; }; }, []);

  // 1) Søk og match.
  useEffect(() => {
    let stop = false;
    let firstError: string | null = null;
    const out: Row[] = new Array(targets.length);
    let done = 0;
    void pool(targets, 4, async (movie, i) => {
      try {
        const results = await searchTmdb(movie.title, tmdbKindOf(movie.kind));
        const match = matchTmdb(movie.title, results, tmdbKindOf(movie.kind));
        const choice = match.status === 'sure' ? match.candidate : null;
        out[i] = { movie, match, error: null, choice, checked: !!choice };
      } catch (e) {
        const msg = (e as Error)?.message ?? 'Søket feilet';
        firstError ??= msg;
        out[i] = { movie, match: null, error: msg, choice: null, checked: false };
      }
      done++;
      if (!stop) setPhase({ t: 'scan', done, total: targets.length });
    }, () => stop).then(() => {
      if (stop) return;
      const all = out.filter(Boolean);
      if (all.length && all.every(r => r.error)) { setPhase({ t: 'fatal', message: firstError ?? 'TMDB-søket feilet' }); return; }
      setRows(all);
      setPhase({ t: 'review' });
    });
    return () => { stop = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => (r.movie.id === id ? { ...r, ...patch } : r)));

  // Konflikter: TMDB-tittelen er allerede koblet til en annen rad, eller valgt for flere rader her.
  const conflicts = useMemo(() => {
    const out = new Map<string, string>();
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!r.choice) continue;
      const dup = findTmdbDuplicate(movies, r.choice.kind, r.choice.id, r.movie.id);
      if (dup) { out.set(r.movie.id, `Allerede koblet til «${dup.title}»`); continue; }
      if (!r.checked) continue;
      const key = `${r.choice.kind}-${r.choice.id}`;
      const other = seen.get(key);
      if (other) out.set(r.movie.id, `Samme treff er valgt for «${other}»`);
      else seen.set(key, r.movie.title);
    }
    return out;
  }, [rows, movies]);

  const selected = rows.filter(r => r.checked && r.choice && !conflicts.has(r.movie.id));
  const sure = rows.filter(r => r.match?.status === 'sure');
  const unsure = rows.filter(r => r.match?.status === 'unsure' && r.match.candidates.length > 0);
  const empty = rows.filter(r => r.error || (r.match?.status === 'unsure' && r.match.candidates.length === 0));

  // 2) Lagre valgte + frisk opp gamle.
  const save = async () => {
    const jobs: { movie: Movie; run: () => Promise<TmdbResult> }[] = [
      ...selected.map(r => ({ movie: r.movie, run: async () => setTmdb(r.movie.id, await fieldsFor(r.choice!), { silent: true }) })),
      ...stale.map(m => ({
        movie: m,
        run: async () => setTmdb(m.id, fieldsFromDetails(await getTmdbDetails(m.tmdbKind!, m.tmdbId!)), { silent: true }),
      })),
    ];
    let done = 0, linked = 0, refreshed = 0, failed = 0, missing = false;
    const linkIds = new Set(selected.map(r => r.movie.id));
    setPhase({ t: 'save', done: 0, total: jobs.length });
    await pool(jobs, 3, async job => {
      let r: TmdbResult;
      try { r = await job.run(); } catch { r = 'error'; }
      if (r === 'missing') missing = true;
      else if (r === 'ok') { if (linkIds.has(job.movie.id)) linked++; else refreshed++; }
      else failed++;
      done++;
      if (!cancelled.current) setPhase({ t: 'save', done, total: jobs.length });
    }, () => cancelled.current || missing);
    if (!cancelled.current) setPhase({ t: 'done', linked, refreshed, failed, missing });
  };

  const unlinkedNow = movies.filter(m => !isLinked(m)).length;

  return (
    <Sheet eyebrow="Filmoversikt" title="Koble filmer til TMDB" onClose={onClose} width={560}>
      {phase.t === 'scan' && (
        <Progress label={targets.length ? `Søker på TMDB … ${phase.done} av ${phase.total}` : 'Ingen ukoblede titler'} done={phase.done} total={Math.max(1, phase.total)} />
      )}

      {phase.t === 'fatal' && (
        <div className="mv-stop" role="alert">
          <div>Kunne ikke søke på TMDB: {phase.message}</div>
          <button type="button" className="btn" style={{ minHeight: 44, justifyContent: 'center' }} onClick={onClose}>Lukk</button>
        </div>
      )}

      {phase.t === 'review' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {targets.length === 0
              ? 'Alle titler er allerede koblet.'
              : <><b>{sure.length}</b> sikre forslag (avkrysset) · <b>{unsure.length}</b> usikre · <b>{empty.length}</b> uten treff. Ingenting lagres før du trykker «Koble valgte».</>}
            {stale.length > 0 && <> I tillegg friskes <b>{stale.length}</b> koblede titler opp (TMDB-data eldre enn 5 måneder).</>}
          </div>

          {sure.length > 0 && <Group title="Sikre forslag">{sure.map(r => <RowView key={r.movie.id} row={r} conflict={conflicts.get(r.movie.id)} onChange={p => update(r.movie.id, p)} />)}</Group>}
          {unsure.length > 0 && <Group title="Usikre – velg riktig treff eller la stå">{unsure.map(r => <RowView key={r.movie.id} row={r} conflict={conflicts.get(r.movie.id)} onChange={p => update(r.movie.id, p)} />)}</Group>}
          {empty.length > 0 && (
            <Group title="Uten treff (kan kobles manuelt fra filmen)">
              <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                {empty.map(r => r.movie.title).join(' · ')}
              </div>
            </Group>
          )}

          <div style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', paddingTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" className="btn" style={{ minHeight: 44, justifyContent: 'center' }} onClick={onClose}>Avbryt</button>
            <button type="button" className="btn primary" disabled={!selected.length && !stale.length}
              style={{ flex: 1, minHeight: 44, justifyContent: 'center', opacity: !selected.length && !stale.length ? 0.4 : 1 }}
              onClick={() => void save()}>
              {selected.length ? `Koble valgte (${selected.length})` : stale.length ? `Frisk opp (${stale.length})` : 'Koble valgte'}
            </button>
          </div>
        </>
      )}

      {phase.t === 'save' && <Progress label={`Lagrer … ${phase.done} av ${phase.total}`} done={phase.done} total={Math.max(1, phase.total)} />}

      {phase.t === 'done' && (
        <>
          {phase.missing && (
            <div className="mv-stop" role="alert">
              TMDB-data kan ikke lagres før scripts/movies-tmdb-migration.sql er kjørt i Supabase.
            </div>
          )}
          <div style={{ fontSize: 18, fontWeight: 500 }}>
            {phase.linked} koblet · {unlinkedNow} ukoblet
          </div>
          {(phase.refreshed > 0 || phase.failed > 0) && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {[phase.refreshed > 0 && `${phase.refreshed} frisket opp`, phase.failed > 0 && `${phase.failed} feilet`].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" style={{ flex: 1, minHeight: 44, justifyContent: 'center' }} onClick={onClose}>Lukk</button>
            {unlinkedNow > 0 && (
              <button type="button" className="btn primary" style={{ flex: 1, minHeight: 44, justifyContent: 'center' }} onClick={onShowUnlinked}>Vis ukoblede</button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div style={{ display: 'grid', gap: 8 }} aria-live="polite">
      <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{label}</div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--chip)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.round((done / total) * 100)}%`, background: 'var(--accent)', transition: 'width 0.2s' }} />
      </div>
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div className="card-eyebrow">{title}</div>
    {children}
  </section>
);

function RowView({ row, conflict, onChange }: { row: Row; conflict?: string; onChange: (p: Partial<Row>) => void }) {
  const { movie, match, choice } = row;
  const candidates = match?.status === 'unsure' ? match.candidates : [];
  const checkable = !!choice && !conflict;
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, cursor: checkable ? 'pointer' : 'default' }}>
        <input type="checkbox" checked={row.checked && checkable} disabled={!checkable}
          onChange={e => onChange({ checked: e.target.checked })}
          style={{ width: 22, height: 22, flexShrink: 0 }} aria-label={`Koble ${movie.title}`} />
        <Poster path={choice?.posterPath ?? null} size="w92" width={34} height={51} radius={4} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>{movie.title}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
            {choice ? <>→ {choice.title}{choice.year ? ` (${choice.year})` : ''}</> : match?.status === 'unsure' ? REASON[match.reason] : ''}
          </div>
          {conflict && <div style={{ fontSize: 11, color: 'var(--warn)' }}>{conflict}</div>}
        </div>
      </label>
      {candidates.length > 0 && (
        <div role="radiogroup" aria-label={`Kandidater for ${movie.title}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 32 }}>
          {candidates.map(c => {
            const on = choice?.id === c.id && choice.kind === c.kind;
            return (
              <button key={`${c.kind}-${c.id}`} type="button" role="radio" aria-checked={on}
                onClick={() => onChange(on ? { choice: null, checked: false } : { choice: c, checked: true })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', minHeight: 44, padding: '4px 8px',
                  borderRadius: 8, border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                  background: on ? 'var(--accent-soft)' : 'transparent', color: 'inherit',
                }}>
                <Poster path={c.posterPath} size="w92" width={24} height={36} radius={3} />
                <span style={{ fontSize: 13, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {c.title}{c.year ? ` (${c.year})` : ''}
                  {c.originalTitle && c.originalTitle !== c.title && <span style={{ color: 'var(--ink-4)' }}> · {c.originalTitle}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
