import type React from 'react';

export type ScreenSize = 'mobile' | 'tablet' | 'desktop';

// ─── Combined event type ───────────────────────────────────────────────────

export interface AnyEvent {
  id: string; title: string; start: string; end?: string;
  allDay: boolean; source: string; color: string; who?: string;
  overdueSince?: string;
  todoId?: string; // present only for todo events — lets us check them off in place
}

// Mobilverdier hentet fra Hjem-sidens mobilvisning (Dashboard.tsx). Brukes
// kun bak screenSize === 'mobile' — tablet/desktop har egne verdier under.
export const m = {
  gap: 10,                       // Dashboard: grid gap 10
  pad: '16px',                   // Dashboard: kort-padding 16
  radius: 8,                     // Dashboard: border-radius 8
  cardBg: 'var(--surface)',      // Dashboard: kort-bakgrunn
  cardBorder: '1px solid var(--line)',
  eyebrow: {                     // Dashboard: små etiketter (f.eks. NEDTELLING)
    fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 400,
  } as React.CSSProperties,
  eyebrowDarkColor: 'rgba(207,224,239,0.4)',
  title: 14,                     // Dashboard: dagens/viktigste rad (14, 600)
  body: 13,                      // Dashboard: brødtekst (13)
  mono: 11,                      // Dashboard: mono-sekundærtekst (11)
  micro: 10,                     // Dashboard: mono-små (10)
  tiny: 9,                       // Dashboard: mono-minst (9)
  bigNum: 64,                    // Dashboard: nedtellingstall (64, vekt 400)
  clockNum: 40,                  // Dashboard-hero bruker 32 på mobil; klokka er hovedelementet her
  clockSec: 16,
  statNum: 18,                   // Dashboard: MobileSavingsMini-tall (14–22)
  rowGap: 8,                     // Dashboard: rad-gap i lister (8)
  rowPad: '9px 8px',             // Dashboard: dagens rad
};
