import { useState, useEffect } from 'react';
import { useTrening, trainerFromEmail, type Trainer, type WorkoutCategory } from './contexts/TreningContext';
import { useAuth } from './contexts/AuthContext';
import { useSnackbar } from './contexts/SnackbarContext';
import { WHO_LABEL, TRAINERS } from './lib/treningPulse';
import { fireworkRain } from './confetti';
import { useScrollLock } from './lib/useScrollLock';

// Rask registrering — gjenbruker TreningContext sin registerSession() (samme
// logikk som Trening → Registrer), men bare kategori + hvem. Ingen
// dato/klokkeslett-felt: performedAt settes til nå, bevisst forenklet for et
// raskt trykk-og-ferdig-flow, ikke fordi Trening.tsx sin fulle
// registreringsmodal er endret (den ventende «fjern klokkeslett»-endringen
// der er en egen, senere oppgave).
//
// Eget, delt fil (samme mønster som QuickAdd.tsx) — brukt både på Gangskjerm
// og som hurtigknapp på Hjem-siden. Lå opprinnelig inne i Skjerm.tsx, men en
// statisk import derfra dro med hele Gangskjerm-modulen (~49 kB) inn i
// Hjem-sidens chunk — hver side lastes ellers som sin egen chunk nettopp for
// å unngå det. Egen scroll-lock siden Hjem-siden faktisk kan scrolle
// (Gangskjermens egen visning gjør det typisk ikke, så det gikk aldri utover
// der).
export function TreningQuickRegister({ categories, onClose }: { categories: WorkoutCategory[]; onClose: () => void }) {
  useScrollLock();
  const { registerSession } = useTrening();
  const { session } = useAuth();
  const { notify } = useSnackbar();
  const active = categories.filter(c => !c.archived);
  const [category, setCategory] = useState(active[0]?.name ?? '');
  // Forhåndsvalg ut fra innlogget bruker — kun et utgangspunkt, ikke en låsing.
  const [who, setWho] = useState<Trainer>(() => trainerFromEmail(session?.user?.email));
  const [saving, setSaving] = useState(false);

  // iOS Safari's window.innerHeight/100vh includes the space hidden behind
  // the collapsible address bar. A centered position:fixed;inset:0 overlay
  // then gets sized against that taller, partly-invisible viewport — the
  // card ends up vertically centered in a box bigger than what's actually on
  // screen, so its lower half renders below the real fold with no scroll
  // path back to it (body scroll is locked). visualViewport.height tracks
  // what's actually visible right now — same fix as the Gangskjerm
  // viewport-height tracking (Skjerm.tsx).
  const [viewportH, setViewportH] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  useEffect(() => {
    const update = () => setViewportH(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  const optionStyle = (on: boolean): React.CSSProperties => ({
    padding: '10px 16px', borderRadius: 20, cursor: 'pointer',
    fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
    border: `1.5px solid ${on ? 'var(--good)' : 'rgba(255,255,255,0.15)'}`,
    background: on ? 'rgba(122,179,148,0.18)' : 'transparent',
    color: on ? 'var(--good)' : 'rgba(207,224,239,0.7)',
  });

  const save = async (el: HTMLElement | null) => {
    if (!category || saving) return;
    setSaving(true);
    try {
      await registerSession({ category, who, performedAt: new Date().toISOString(), note: null });
      if (el) { const r = el.getBoundingClientRect(); fireworkRain(r.left + r.width / 2, r.top + r.height / 2); }
      notify(`Registrert · ${category} · ${WHO_LABEL[who]} 💪`);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: viewportH, zIndex: 200,
        background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--ink-fixed)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
          padding: '28px 32px', width: 440, maxWidth: 'calc(100vw - 48px)',
          maxHeight: viewportH - 40, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Huk av en økt</div>
            <div style={{ fontSize: 22, fontWeight: 300, marginTop: 6, color: '#E8EFF7', letterSpacing: '-0.01em' }}>Registrer trening</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'pointer', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
          >✕</button>
        </div>

        {active.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)' }}>Ingen kategorier funnet — lag en på Trening-siden først.</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Kategori</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {active.map(c => (
                  <button key={c.id} onClick={() => setCategory(c.name)} style={optionStyle(category === c.name)}>{c.name}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Hvem gjennomførte?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {TRAINERS.map(w => (
                  <button key={w} onClick={() => setWho(w)} style={{ ...optionStyle(who === w), flex: 1, textAlign: 'center' }}>{WHO_LABEL[w]}</button>
                ))}
              </div>
            </div>

            <button
              onClick={e => void save(e.currentTarget)}
              disabled={!category || saving}
              style={{
                padding: '13px', borderRadius: 8, border: 0, cursor: 'pointer',
                fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
                background: 'var(--good)', color: '#0B2545',
                opacity: (!category || saving) ? 0.5 : 1,
              }}
            >{saving ? 'Lagrer…' : 'Registrer'}</button>
          </>
        )}
      </div>
    </div>
  );
}
