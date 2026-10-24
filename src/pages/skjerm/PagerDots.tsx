import type React from 'react';

interface Props {
  count: number;
  index: number;
  /** Over dette antallet vises «2/9» i stedet for prikker. */
  maxDots?: number;
  /** key per prikk (valgfritt, ellers indeks). */
  keys?: string[];
  /** I en popup: i flyten (ikke absolutt) og lyse farger på mørk bakgrunn. */
  popup?: boolean;
}

/**
 * Posisjonsindikator for sveipbare kort (● ○ ○ / «2/9»). Ligger absolutt nederst i
 * kortets padding (kortet må ha position: relative) og gjør derfor ikke kortet høyere.
 * Med `popup` ligger den i flyten, f.eks. mellom «Forrige»/«Neste»-knappene.
 */
export function PagerDots({ count, index, maxDots = 6, keys, popup = false }: Props) {
  const on = popup ? 'rgba(207,224,239,0.85)' : 'var(--ink-3)';
  const off = popup ? 'rgba(207,224,239,0.85)' : 'var(--ink-4)';
  const size = popup ? 7 : 5;
  if (count <= maxDots) {
    const place: React.CSSProperties = popup
      ? { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 7 }
      : { position: 'absolute', left: 0, right: 0, bottom: 2, display: 'flex', justifyContent: 'center', gap: 5, pointerEvents: 'none' };
    return (
      <div aria-hidden style={place}>
        {Array.from({ length: count }, (_, i) => (
          <span key={keys?.[i] ?? i} style={{ width: size, height: size, borderRadius: '50%', background: i === index ? on : off, opacity: i === index ? 1 : 0.35 }} />
        ))}
      </div>
    );
  }
  const place: React.CSSProperties = popup
    ? { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(207,224,239,0.6)', fontVariantNumeric: 'tabular-nums' }
    : { position: 'absolute', right: 10, bottom: 2, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', pointerEvents: 'none' };
  return (
    <div aria-hidden style={place}>
      {index + 1}/{count}
    </div>
  );
}
