interface Props {
  count: number;
  index: number;
  /** Over dette antallet vises «2/9» i stedet for prikker. */
  maxDots?: number;
  /** key per prikk (valgfritt, ellers indeks). */
  keys?: string[];
}

/**
 * Posisjonsindikator for sveipbare kort (● ○ ○ / «2/9»). Ligger absolutt nederst i
 * kortets padding (kortet må ha position: relative) og gjør derfor ikke kortet høyere.
 */
export function PagerDots({ count, index, maxDots = 6, keys }: Props) {
  if (count <= maxDots) {
    return (
      <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 2, display: 'flex', justifyContent: 'center', gap: 5, pointerEvents: 'none' }}>
        {Array.from({ length: count }, (_, i) => (
          <span key={keys?.[i] ?? i} style={{ width: 5, height: 5, borderRadius: '50%', background: i === index ? 'var(--ink-3)' : 'var(--ink-4)', opacity: i === index ? 1 : 0.35 }} />
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden style={{ position: 'absolute', right: 10, bottom: 2, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', pointerEvents: 'none' }}>
      {index + 1}/{count}
    </div>
  );
}
