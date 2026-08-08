import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useScrollLock } from './lib/useScrollLock';
import { Couple } from './components';
import { ErrorBoundary } from './ErrorBoundary';
import { useSnackbar } from './contexts/SnackbarContext';
import { FinanceProvider } from './contexts/FinanceContext';
import { CategoryProvider } from './contexts/CategoryContext';
import { WishProvider } from './contexts/WishContext';
import { BucketProvider } from './contexts/BucketContext';
import { TodoProvider } from './contexts/TodoContext';
import { MapProvider } from './contexts/MapContext';
import { BoligflippingProvider } from './contexts/BoligflippingContext';
import { TreningProvider } from './contexts/TreningContext';
import { MatplanProvider } from './contexts/MatplanContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import PageLogin from './pages/Login';
import { SnackbarProvider } from './contexts/SnackbarContext';
import { ConfirmProvider } from './contexts/ConfirmContext';

// Hver side lastes som sin egen chunk (React.lazy) slik at startbunten kun
// inneholder skallet. Tunge biblioteker følger med siden som bruker dem —
// leaflet med Kart, pdfjs med Forbruk — i stedet for å ligge i hovedbunten.
const PageDashboard = lazy(() => import('./pages/Dashboard'));
const PageHus = lazy(() => import('./pages/Hus'));
const PageOnskeliste = lazy(() => import('./pages/Onskeliste'));
const PageBucket = lazy(() => import('./pages/Bucket'));
const PageOkonomi = lazy(() => import('./pages/Okonomi'));
const PageKalender = lazy(() => import('./pages/Kalender'));
const PageSkjerm = lazy(() => import('./pages/Skjerm'));
const PageGjoremal = lazy(() => import('./pages/Gjoremal'));
const PageKart = lazy(() => import('./pages/Kart'));
const PageBoligflipping = lazy(() => import('./pages/Boligflipping'));
const PageTrening = lazy(() => import('./pages/Trening'));
const PageMiddag = lazy(() => import('./pages/Middag'));
const PageHandleliste = lazy(() => import('./pages/Handleliste'));

type Route = 'home' | 'hus' | 'onskelister' | 'ting-vi-vil-gjore' | 'gjoremal' | 'okonomi' | 'kalender' | 'skjerm' | 'kart' | 'boligflipping' | 'trening' | 'middag' | 'handleliste';

// ─── Theme ───────────────────────────────────────────────────────────────────
type ThemeMode = 'auto' | 'light' | 'dark';

// 'auto' = dark from 20:00 to 08:00 (local time), light otherwise.
const DARK_FROM = 20;   // 20:00 → dark
const DARK_UNTIL = 8;   // 08:00 → light
function isNightNow(d = new Date()): boolean {
  const h = d.getHours();
  return h >= DARK_FROM || h < DARK_UNTIL;
}

// A saved choice wins; otherwise default to automatic (time-based).
function readInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem('felles_theme');
    if (saved === 'auto' || saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return 'auto';
}

const SIDEBAR_HIDDEN = 248; // matches --side-w (232) + 16px buffer

function useSidebarSwipe(open: boolean, setOpen: (v: boolean) => void, enabled: boolean) {
  const [dragX, setDragX] = useState<number | null>(null);
  const st = useRef({
    armed: false,      // touch is in the right zone, waiting to see direction
    dragging: false,   // confirmed horizontal drag in progress
    startX: 0,
    startY: 0,
    startOpen: false,
  });

  useEffect(() => {
    if (!enabled) return;
    const EDGE = 28;
    const DRAG_THRESHOLD = 6; // px of horizontal movement before we commit

    const onStart = (e: TouchEvent) => {
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      if (!open && x > EDGE) return;
      if (open && x > SIDEBAR_HIDDEN + 20) return;
      st.current = { armed: true, dragging: false, startX: x, startY: y, startOpen: open };
    };

    const onMove = (e: TouchEvent) => {
      if (!st.current.armed) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dx = Math.abs(x - st.current.startX);
      const dy = Math.abs(y - st.current.startY);

      if (!st.current.dragging) {
        // Not yet committed — check direction
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return; // too small to decide
        if (dy > dx) { st.current.armed = false; return; } // vertical scroll wins
        st.current.dragging = true; // horizontal drag confirmed
      }

      e.preventDefault();
      const translate = st.current.startOpen
        ? Math.min(0, Math.max(-SIDEBAR_HIDDEN, x - st.current.startX))
        : Math.min(0, Math.max(-SIDEBAR_HIDDEN, x - SIDEBAR_HIDDEN));
      setDragX(translate);
    };

    const onEnd = (e: TouchEvent) => {
      if (!st.current.armed) return;
      const wasDragging = st.current.dragging;
      st.current.armed = false;
      st.current.dragging = false;

      if (!wasDragging) return; // was a tap, let click fire normally

      e.preventDefault(); // Prevent browser back-swipe
      const x = e.changedTouches[0].clientX;
      const translate = st.current.startOpen
        ? Math.min(0, Math.max(-SIDEBAR_HIDDEN, x - st.current.startX))
        : Math.min(0, Math.max(-SIDEBAR_HIDDEN, x - SIDEBAR_HIDDEN));
      setOpen(SIDEBAR_HIDDEN + translate > SIDEBAR_HIDDEN * 0.4);
      setDragX(null);
    };

    document.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [open, setOpen, enabled]);

  return dragX;
}

interface NavItem { id: Route; label: string; group: string; badge?: string }

const NAV: NavItem[] = [
  { id: 'home',         label: 'Hjem',         group: 'Oversikt' },
  { id: 'skjerm',       label: 'Gangskjerm',   group: 'Oversikt' },
  { id: 'hus',          label: '🏡 Landsbydrømmen', group: 'Økonomi' },
  { id: 'okonomi',      label: '💸 Forbruk',      group: 'Økonomi' },
  { id: 'onskelister',  label: '💝 Ønskelister',  group: 'Hverdag' },
  { id: 'kalender',     label: '📅 Kalender',     group: 'Hverdag' },
  { id: 'ting-vi-vil-gjore', label: '🎯 Ting vi vil gjøre', group: 'Hverdag' },
  { id: 'gjoremal',          label: '✅ Gjøremål',          group: 'Hverdag' },
  { id: 'trening',      label: '🏋️ Trening',      group: 'Hverdag' },
  { id: 'middag',       label: '🍽️ Middag',       group: 'Hverdag' },
  { id: 'handleliste',  label: '🛒 Handleliste',   group: 'Hverdag' },
  { id: 'kart',         label: '🗺️ Kart',         group: 'Hverdag' },
  { id: 'boligflipping', label: '🏗️ Boligflipping', group: 'Prosjekter' },
];

const PAGE_TITLES: Record<Route, { eyebrow: string; title: React.ReactNode; sub: string }> = {
  home: { eyebrow: 'Oversikt', title: <>God morgen, <em>Andreas</em>.</>, sub: 'Torsdag 7. mai 2026' },
  hus: { eyebrow: 'Prosjekt', title: <><em>Landsbydrømmen</em> 🏡</>, sub: '' },
  onskelister: { eyebrow: '', title: 'Ønskelister', sub: 'Felles · Andreas · Taran' },
  'ting-vi-vil-gjore': { eyebrow: '', title: <>Ting vi vil <em>gjøre</em></>, sub: '' },
  gjoremal: { eyebrow: '', title: 'Gjøremål', sub: '' },
  trening: { eyebrow: 'Hverdag', title: 'Trening', sub: '' }, // siden lager sitt eget hode (se HEADLESS_ROUTES)
  middag: { eyebrow: 'Hverdag', title: 'Middag', sub: 'Oppskrifter · Ukeplan · Dagligvarer' },
  handleliste: { eyebrow: 'Hverdag', title: 'Handleliste', sub: 'Dagligvarer' },
  okonomi: { eyebrow: '', title: 'Forbruk', sub: '' },
  kalender: { eyebrow: 'Hverdag', title: 'Kalender', sub: '' }, // sub is computed live in Page (current month)
  kart:  { eyebrow: 'Utforskning', title: <>Vårt <em>kart</em></>, sub: 'Vil besøke' },
  boligflipping: { eyebrow: 'Investeringer', title: <>Bolig<em>flipping</em></>, sub: 'Kjøp · Oppussing · Salg' },
  skjerm: { eyebrow: 'Display', title: 'Gangskjerm', sub: 'Vær · Sparing · Kalender' },
};

function homeGreeting(): React.ReactNode {
  const h = new Date().getHours();
  if (h >= 5  && h < 11) return <>God <em>morgen</em>.</>;
  if (h >= 11 && h < 17) return <>God <em>ettermiddag</em>.</>;
  if (h >= 17 && h < 23) return <>God <em>kveld</em>.</>;
  return <>God <em>natt</em>.</>;
}

// Registers the service worker and hooks its update flow up to a snackbar
// instead of the default silent reload — a build we deploy shouldn't yank the
// page out from under someone mid-interaction (worst case on the always-open
// Gangskjerm). registration.update() is polled periodically + on tab-focus so
// a long-lived tab doesn't have to wait for the browser's own ~24h check.
function ServiceWorkerUpdater() {
  const { notify } = useSnackbar();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    registerSW({
      immediate: true,
      onNeedReload() {
        notify('Ny versjon tilgjengelig', { actionLabel: 'Oppdater nå', onAction: () => window.location.reload() });
      },
      onRegisteredSW(_url, reg) { if (reg) setRegistration(reg); },
      onRegisterError() { /* SW utilgjengelig (f.eks. dev-modus) — ingenting å gjøre */ },
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!registration) return;
    const check = () => { void registration.update(); };
    const id = window.setInterval(check, 15 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [registration]);

  return null;
}

function ThemeSwitcher({ mode, setMode }: { mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const opts: { v: ThemeMode; label: string }[] = [
    { v: 'auto',  label: 'Auto' },
    { v: 'light', label: 'Lys' },
    { v: 'dark',  label: 'Mørk' },
  ];
  return (
    <div role="radiogroup" aria-label="Tema" style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--chip)', borderRadius: 8 }}>
      {opts.map(o => {
        const active = mode === o.v;
        return (
          <button key={o.v} role="radio" aria-checked={active} onClick={() => setMode(o.v)}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 6, border: 0,
              fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: active ? 700 : 500,
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-4)',
              boxShadow: active ? '0 1px 2px rgba(11,37,69,0.12)' : 'none',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Sidebar({ route, setRoute, open, dragX, themeMode, setThemeMode }: { route: Route; setRoute: (r: Route) => void; open: boolean; dragX: number | null; themeMode: ThemeMode; setThemeMode: (m: ThemeMode) => void }) {
  const dragStyle: React.CSSProperties | undefined = dragX !== null
    ? { transform: `translateX(${dragX}px)`, transition: 'none' }
    : undefined;
  const groups = NAV.reduce<Record<string, NavItem[]>>((acc, n) => {
    (acc[n.group] = acc[n.group] || []).push(n);
    return acc;
  }, {});
  return (
    <aside className={`sidebar${open ? ' open' : ''}`} style={dragStyle}>
      <div className="brand">
        <div className="brand-mark">F</div>
        <div className="col" style={{ gap: 1 }}>
          <span className="brand-name">Felles</span>
          <span className="brand-sub">A & T · 2026</span>
        </div>
      </div>

      <nav className="col" style={{ gap: 18 }}>
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div className="nav-section-label">{group}</div>
            <div className="nav-list">
              {items.map(n => (
                <button key={n.id} className={'nav-item' + (route === n.id ? ' active' : '')} onClick={() => setRoute(n.id)}>
                  <span className="nav-label">{n.label}</span>
                  {n.badge && <span className="nav-badge">{n.badge}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        <div>
          <div className="nav-section-label" style={{ marginBottom: 6 }}>Tema</div>
          <ThemeSwitcher mode={themeMode} setMode={setThemeMode} />
        </div>
        <div className="sidebar-footer" style={{ marginTop: 0 }}>
          <Couple />
          <div className="couple-meta">
            <b>Andreas & Taran</b>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ route, setRoute, onMenuToggle }: { route: Route; setRoute: (r: Route) => void; onMenuToggle: () => void }) {
  return (
    <div className="topbar">
      <button className="menu-btn" onClick={onMenuToggle} aria-label="Meny">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      <div className="crumbs">
        <span onClick={() => setRoute('home')} style={{ cursor: 'pointer' }}>felles</span>
        <span className="sep">/</span>
        <span className="here">{route === 'home' ? 'hjem' : route}</span>
      </div>
    </div>
  );
}

const PAGE_COMPONENTS: Record<Exclude<Route, 'skjerm'>, React.ComponentType> = {
  home: PageDashboard,
  hus: PageHus,
  onskelister: PageOnskeliste,
  'ting-vi-vil-gjore': PageBucket,
  gjoremal: PageGjoremal,
  okonomi: PageOkonomi,
  kalender: PageKalender,
  kart: PageKart,
  boligflipping: PageBoligflipping,
  trening: PageTrening,
  middag: PageMiddag,
  handleliste: PageHandleliste,
};

const FULLSCREEN_ROUTES: Route[] = ['kart'];

// Sider som rendrer sin egen .page-head fordi tittelen avhenger av innholdet
// (Trening bytter mellom «Klar for Pull A?» og statistikk-visningen).
const HEADLESS_ROUTES: Route[] = ['trening'];

// Vises mens en side-chunk lastes. Sidehodet rendres allerede synkront, så
// dette er kun en tynn plassholder for innholdsområdet (chunkene er små og
// caches av service-workeren, så den vises sjelden mer enn et blink).
function PageFallback() {
  return <div role="status" aria-label="Laster…" style={{ height: 2, borderRadius: 2, background: 'var(--chip)', animation: 'skeleton-pulse 1.2s ease-in-out infinite' }} />;
}

function Page({ route }: { route: Exclude<Route, 'skjerm'> }) {
  const head  = PAGE_TITLES[route];
  const Body  = PAGE_COMPONENTS[route];
  const isHome = route === 'home';
  const isFullscreen = FULLSCREEN_ROUTES.includes(route);
  const title = isHome ? homeGreeting() : head.title;
  const sub   = isHome
    ? new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : route === 'kalender'
      ? `${new Date().toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })} · våre uker`
      : head.sub;

  if (isFullscreen) {
    return (
      <div className="page" key={route} style={{ display: 'flex', flexDirection: 'column', padding: 0, flex: 1, overflow: 'hidden', gap: 0, maxWidth: 'none' }}>
        <div className="page-head" style={{ padding: '20px 24px 14px', flexShrink: 0 }}>
          <div>
            <div className="page-sub">{head.eyebrow}</div>
            <h1 className="page-title">{title}</h1>
            {sub && <div className="page-sub" style={{ marginTop: 6 }}>{sub}</div>}
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <Suspense fallback={<PageFallback />}><ErrorBoundary label={route}><Body /></ErrorBoundary></Suspense>
        </div>
      </div>
    );
  }

  if (HEADLESS_ROUTES.includes(route)) {
    return <div className="page" key={route}><Suspense fallback={<PageFallback />}><ErrorBoundary label={route}><Body /></ErrorBoundary></Suspense></div>;
  }

  return (
    <div className="page" key={route}>
      <div className="page-head">
        <div>
          <div className="page-sub">{head.eyebrow}</div>
          <h1 className="page-title">{title}</h1>
          <div className="page-sub" style={{ marginTop: 8 }}>{sub}</div>
        </div>
      </div>
      <Suspense fallback={<PageFallback />}><ErrorBoundary label={route}><Body /></ErrorBoundary></Suspense>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────

function AppInner() {
  const { session, loading: authLoading } = useAuth();
  const [route, setRoute] = useState<Route>(() => {
    const p = window.location.pathname.replace(/^\//, '') as Route;
    return NAV.find(n => n.id === p) ? p : 'home';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readInitialMode);
  const [autoDark, setAutoDark] = useState(isNightNow);
  // The Gangskjerm always follows the time-based auto theme, regardless of the
  // device's chosen mode.
  const dark = (route === 'skjerm' || themeMode === 'auto') ? autoDark : themeMode === 'dark';
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const dragX = useSidebarSwipe(sidebarOpen, setSidebarOpen, isMobile);
  useScrollLock(isMobile && sidebarOpen);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Apply the resolved theme to <html> — this also themes the Gangskjerm,
  // which renders inside AppInner.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Persist the chosen mode.
  useEffect(() => {
    try { localStorage.setItem('felles_theme', themeMode); } catch { /* ignore */ }
  }, [themeMode]);

  // Keep the time-based value current at all times (cheap — it only re-renders at a
  // 20:00 / 08:00 boundary) so both Auto mode and the always-auto Gangskjerm flip
  // live while the page sits open, with no refresh.
  useEffect(() => {
    const tick = () => setAutoDark(isNightNow());
    tick();
    const id = window.setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    const path = route === 'home' ? '/' : `/${route}`;
    if (window.location.pathname !== path) history.pushState(null, '', path);
  }, [route]);

  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname.replace(/^\//, '') as Route;
      setRoute(NAV.find(n => n.id === p) ? p : 'home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (authLoading) return null;
  if (!session) return <PageLogin />;

  const inner = route === 'skjerm'
    ? <Suspense fallback={null}><ErrorBoundary label="skjerm"><PageSkjerm onBack={() => setRoute('home')} /></ErrorBoundary></Suspense>
    : (
      <div className="app">
        {(sidebarOpen || dragX !== null) && (
          <div
            style={{
              position: 'fixed', inset: 0, background: 'rgba(11,37,69,0.4)', zIndex: 199,
              opacity: dragX !== null ? (SIDEBAR_HIDDEN + dragX) / SIDEBAR_HIDDEN : 1,
              transition: dragX !== null ? 'none' : 'opacity 220ms',
            }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <Sidebar route={route} setRoute={r => { setRoute(r); setSidebarOpen(false); }} open={sidebarOpen} dragX={dragX} themeMode={themeMode} setThemeMode={setThemeMode} />
        <main
          className="main"
          style={FULLSCREEN_ROUTES.includes(route) ? { height: '100dvh', overflow: 'hidden' } : undefined}
        >
          <Topbar route={route} setRoute={setRoute} onMenuToggle={() => setSidebarOpen(o => !o)} />
          <Page route={route as Exclude<Route, 'skjerm'>} />
        </main>
      </div>
    );

  return <SnackbarProvider><ServiceWorkerUpdater /><ConfirmProvider><FinanceProvider><CategoryProvider><WishProvider><BucketProvider><TodoProvider><MapProvider><BoligflippingProvider><TreningProvider><MatplanProvider>{inner}</MatplanProvider></TreningProvider></BoligflippingProvider></MapProvider></TodoProvider></BucketProvider></WishProvider></CategoryProvider></FinanceProvider></ConfirmProvider></SnackbarProvider>;
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
