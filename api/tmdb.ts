import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 10 };

// Proxy mot TMDB (themoviedb.org) for Filmoversikten. API-nøkkelen ligger bare
// i Vercel (TMDB_API_KEY) og når aldri frontend.
//
//   GET /api/tmdb?action=search&kind=movie|tv&q=…
//   GET /api/tmdb?action=details&kind=movie|tv&id=…
//
// Krever innlogget bruker (Supabase-JWT i Authorization: Bearer …), samme sjekk
// som api/middag-kalender.ts. Koden er duplisert med vilje: imports mellom
// api/-filer fungerer ikke pålitelig på Vercel.
//
// TMDB_API_KEY kan være en v4 «API Read Access Token» (JWT, starter med «eyJ»,
// sendes som Bearer) eller en v3-nøkkel (sendes som api_key-parameter).
//
// Mellomlagring: kort Map i minnet (forsvinner ved redeploy/kald start) og
// `Cache-Control: private` (svarene er knyttet til en innlogget bruker, så
// CDN-en skal ikke dele dem). Alt er langt under TMDBs grense på 6 måneder.

const TMDB = 'https://api.themoviedb.org/3';
const LANG = 'nb-NO';
const FALLBACK_LANG = 'en-US';
const REGION = 'NO';

type Kind = 'movie' | 'tv';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ─── cache ──────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: any; expires: number }>();
const MAX_CACHE = 500;

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) { cache.delete(key); return undefined; }
  return hit.data;
}
function cacheSet(key: string, data: any, ttlMs: number) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ─── auth ───────────────────────────────────────────────────────────────────

// Godkjente tokens huskes kort, så en «Koble filmer»-runde med mange kall ikke
// gjør ett Supabase-oppslag per film.
const okTokens = new Map<string, number>();
const TOKEN_TTL = 5 * 60_000;

async function requireUser(req: any): Promise<void> {
  const authHeader = req.headers?.['authorization'] as string | undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new HttpError(401, 'Ikke innlogget');

  const until = okTokens.get(token);
  if (until && until > Date.now()) return;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, 'Supabase er ikke konfigurert på serveren');
  const supabase = createClient(url, key);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Ikke innlogget');

  if (okTokens.size > 100) okTokens.clear();
  okTokens.set(token, Date.now() + TOKEN_TTL);
}

// ─── TMDB ───────────────────────────────────────────────────────────────────

async function tmdb(path: string, params: Record<string, string>, ttlMs: number): Promise<any> {
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!apiKey) throw new HttpError(500, 'TMDB_API_KEY er ikke satt på serveren');

  const qs = new URLSearchParams(params);
  const cacheKey = `${path}?${qs.toString()}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;
  else qs.set('api_key', apiKey);

  const r = await fetch(`${TMDB}${path}?${qs.toString()}`, { headers, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) throw new HttpError(404, 'Fant ikke tittelen på TMDB');
  if (r.status === 401) throw new HttpError(502, 'TMDB avviste API-nøkkelen (sjekk TMDB_API_KEY)');
  if (r.status === 429) throw new HttpError(503, 'TMDB er opptatt – prøv igjen om litt');
  if (!r.ok) throw new HttpError(502, `TMDB svarte ${r.status}`);
  const data = await r.json();
  cacheSet(cacheKey, data, ttlMs);
  return data;
}

const yearOf = (date: unknown): number | null => {
  const y = typeof date === 'string' ? parseInt(date.slice(0, 4), 10) : NaN;
  return Number.isFinite(y) && y > 1800 ? y : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strOrNull = (v: unknown): string | null => str(v) || null;
const posInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

async function search(kind: Kind, q: string) {
  const data = await tmdb(`/search/${kind}`, { query: q, language: LANG, include_adult: 'false', page: '1' }, 60 * 60_000);
  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    results: results.map((r: any) => ({
      id: r.id as number,
      kind,
      title: str(kind === 'movie' ? r.title : r.name) || str(kind === 'movie' ? r.original_title : r.original_name),
      originalTitle: str(kind === 'movie' ? r.original_title : r.original_name),
      year: yearOf(kind === 'movie' ? r.release_date : r.first_air_date),
      posterPath: strOrNull(r.poster_path),
      popularity: typeof r.popularity === 'number' ? r.popularity : 0,
    })).filter((r: any) => typeof r.id === 'number' && r.title),
  };
}

type Provider = { id: number; name: string; logoPath: string | null };
const providerList = (list: unknown): Provider[] =>
  (Array.isArray(list) ? list : [])
    .slice()
    .sort((a: any, b: any) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
    .map((p: any) => ({ id: p.provider_id as number, name: str(p.provider_name), logoPath: strOrNull(p.logo_path) }))
    .filter(p => typeof p.id === 'number' && p.name);

async function details(kind: Kind, id: string) {
  const d = await tmdb(`/${kind}/${id}`, { language: LANG, append_to_response: 'credits,watch/providers' }, 6 * 60 * 60_000);

  let title = str(kind === 'movie' ? d.title : d.name);
  let overview = str(d.overview);
  // Engelsk som reserve der TMDB mangler norsk tekst.
  if (!overview || !title) {
    try {
      const en = await tmdb(`/${kind}/${id}`, { language: FALLBACK_LANG }, 6 * 60 * 60_000);
      if (!title) title = str(kind === 'movie' ? en.title : en.name);
      if (!overview) overview = str(en.overview);
    } catch { /* behold det vi har */ }
  }
  const originalTitle = str(kind === 'movie' ? d.original_title : d.original_name);

  const runtimeMin = kind === 'movie'
    ? posInt(d.runtime)
    : posInt(Array.isArray(d.episode_run_time) ? d.episode_run_time[0] : null) ?? posInt(d.last_episode_to_air?.runtime);

  const cast = (Array.isArray(d.credits?.cast) ? d.credits.cast : [])
    .slice()
    .sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 5)
    .map((c: any) => ({ name: str(c.name), character: str(c.character), profilePath: strOrNull(c.profile_path) }))
    .filter((c: any) => c.name);

  const wp = d['watch/providers']?.results?.[REGION];
  const providers = wp
    ? {
        link: strOrNull(wp.link),
        flatrate: providerList(wp.flatrate),
        free: providerList(wp.free),
        ads: providerList(wp.ads),
        rent: providerList(wp.rent),
        buy: providerList(wp.buy),
      }
    : null;

  return {
    id: d.id as number,
    kind,
    title: title || originalTitle,
    originalTitle,
    year: yearOf(kind === 'movie' ? d.release_date : d.first_air_date),
    posterPath: strOrNull(d.poster_path),
    runtimeMin,
    seasons: kind === 'tv' ? posInt(d.number_of_seasons) : null,
    episodes: kind === 'tv' ? posInt(d.number_of_episodes) : null,
    genres: (Array.isArray(d.genres) ? d.genres : []).map((g: any) => str(g?.name)).filter(Boolean),
    overview: overview || null,
    cast,
    providers,
  };
}

// ─── handler ────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  try {
    if (req.method && req.method !== 'GET') throw new HttpError(405, 'Bare GET');
    await requireUser(req);

    const q = req.query ?? {};
    const kind: Kind | null = q.kind === 'movie' || q.kind === 'tv' ? q.kind : null;
    if (!kind) throw new HttpError(400, 'kind må være movie eller tv');

    if (q.action === 'search') {
      const text = typeof q.q === 'string' ? q.q.trim() : '';
      if (text.length < 2 || text.length > 120) throw new HttpError(400, 'Søket må være 2–120 tegn');
      const out = await search(kind, text);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).json(out);
    }

    if (q.action === 'details') {
      const id = typeof q.id === 'string' ? q.id : '';
      if (!/^\d{1,10}$/.test(id)) throw new HttpError(400, 'Ugyldig id');
      const out = await details(kind, id);
      // Kort: strømmetjenester endrer seg, og popupen skal vise ferske data.
      res.setHeader('Cache-Control', 'private, max-age=1800');
      return res.status(200).json(out);
    }

    throw new HttpError(400, 'Ukjent action (bruk search eller details)');
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status
      : err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 504 : 500;
    const msg = status === 504 ? 'TMDB svarte ikke i tide – prøv igjen' : (err?.message ?? 'Noe gikk galt');
    if (status >= 500) console.error('tmdb:', msg);
    return res.status(status).json({ error: msg });
  }
}
