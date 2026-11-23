// Nettverk mot /api/tmdb (proxy med API-nøkkelen). Sender innlogget brukers
// Supabase-token, siden endepunktet krever innlogging.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { TmdbCandidate, TmdbDetails, TmdbKind } from './tmdb';

export class TmdbError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new TmdbError(401, 'Ikke innlogget');
  let res: Response;
  try {
    res = await fetch(`/api/tmdb?${new URLSearchParams(params).toString()}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new TmdbError(0, 'Ingen kontakt med serveren');
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* ikke JSON (f.eks. 404 fra dev-server) */ }
  if (!res.ok) throw new TmdbError(res.status, body?.error ?? `TMDB-oppslag feilet (${res.status})`);
  return body as T;
}

export async function searchTmdb(q: string, kind: TmdbKind, signal?: AbortSignal): Promise<TmdbCandidate[]> {
  const r = await call<{ results: TmdbCandidate[] }>({ action: 'search', kind, q }, signal);
  return Array.isArray(r?.results) ? r.results : [];
}

export function getTmdbDetails(kind: TmdbKind, id: number, signal?: AbortSignal): Promise<TmdbDetails> {
  return call<TmdbDetails>({ action: 'details', kind, id: String(id) }, signal);
}

/** Debounced søk mens man skriver (mønster fra useGeoSearch). */
export function useTmdbSearch(query: string, kind: TmdbKind, enabled = true) {
  const [results, setResults] = useState<TmdbCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) { setResults([]); setLoading(false); setError(null); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchTmdb(q, kind, ctrl.signal);
        setResults(r);
        setError(null);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setResults([]);
        setError((e as Error)?.message ?? 'TMDB-søket feilet');
      }
      setLoading(false);
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, kind, enabled]);

  return { results, loading, error };
}

export type DetailsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: TmdbDetails }
  | { status: 'error'; message: string };

/** Henter details (inkl. skuespillere og strømmetjenester) når popupen åpnes. */
export function useTmdbDetails(kind: TmdbKind | null, id: number | null, reloadKey = 0): DetailsState {
  const [state, setState] = useState<DetailsState>({ status: 'idle' });
  useEffect(() => {
    if (!kind || id == null) { setState({ status: 'idle' }); return; }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    getTmdbDetails(kind, id, ctrl.signal)
      .then(data => setState({ status: 'ok', data }))
      .catch(e => {
        if ((e as Error)?.name === 'AbortError') return;
        setState({ status: 'error', message: (e as Error)?.message ?? 'Kunne ikke hente fra TMDB' });
      });
    return () => ctrl.abort();
  }, [kind, id, reloadKey]);
  return state;
}
