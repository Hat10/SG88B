import { useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { m, type ScreenSize, type WeatherData } from './shared';
import { WeatherIcon } from './WeatherIcon';
import { PagerArrows } from './PagerArrows';
import { PagerDots } from './PagerDots';
import { dressAdvice } from '../../lib/dressAdvice';
import { dateLabel } from '../../lib/dayLabel';
import { useSwipePager } from '../../lib/useSwipePager';

interface Props {
  weather: WeatherData | null;
  /** Fra useIdleReset: endres → kortet glir tilbake til i dag. */
  resetSignal: number;
  /** Klikk på kortet. 0 = i dag (time for time fra nå), 1–2 = den dagens timer. */
  onToggle: (offset: number) => void;
  isMobile: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Vær · Bodø — offset 0: nå-verdier fra Yr (met.no) med dagens min/maks, KLE PÅ SEG og sol
// (som alltid). Offset 1–2: i morgen / overmorgen fra `weather.daily`. Sveip (eller ‹ ›) blar.
export function WeatherCard({ weather, resetSignal, onToggle, isMobile, screenSize, cell, eyebrow }: Props) {
  const daily = weather?.daily ?? [];
  const multi = !!weather && daily.length >= 2;
  const pager = useSwipePager({ max: Math.max(0, daily.length - 1), resetSignal, disabled: !multi });
  const offset = multi ? Math.min(pager.offset, daily.length - 1) : 0;
  const day = offset > 0 ? daily[offset] : null;
  const gap = isMobile ? 8 : screenSize === 'tablet' ? 7 : 16;

  // STABIL HØYDE: høyden på offset 0 er fasit. Den måles der (ResizeObserver, kun mens offset er 0),
  // og på de andre dagene låses kortet til nøyaktig den høyden — dagene tilpasses offset 0, ikke omvendt,
  // så resten av siden (rad 2/3 på iPad) aldri flytter seg når man blar.
  const rootRef = useRef<HTMLDivElement>(null);
  const lockedH = useRef<number | null>(null);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => { if (offsetRef.current === 0) lockedH.current = el.getBoundingClientRect().height; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lockStyle: React.CSSProperties = day && lockedH.current ? { height: lockedH.current } : {};
  // Blir en dag høyere enn fasiten, tar den øvre raden (ikon/temperatur/KLE PÅ SEG) støyten, ikke
  // bunnraden med min/maks/sol. Små marger rundt hindrer at store tall klippes i overflaten.
  const topRowRef = useRef<HTMLDivElement>(null);
  const [topClipped, setTopClipped] = useState(false);
  // Er øvre rad faktisk klippet, tones nederste kant ut i stedet for å kutte en tekstlinje på midten.
  useLayoutEffect(() => {
    const el = topRowRef.current;
    const clipped = !!day && !!el && el.scrollHeight > el.clientHeight + 1;
    setTopClipped(prev => (prev === clipped ? prev : clipped));
  });
  const fade = 'linear-gradient(to bottom, #000 calc(100% - 24px), transparent calc(100% - 6px))';
  const topRowFit: React.CSSProperties = day
    ? {
      flex: '0 1 auto', minHeight: 0, overflow: 'hidden', paddingBlock: 4, marginBlock: -4,
      ...(topClipped ? { WebkitMaskImage: fade, maskImage: fade } : {}),
    }
    : {};

  // Verdiene kortet viser: i dag = nå-verdiene (uendret), ellers dagsoppsummeringen.
  const v = !weather ? null : day ? {
    category: day.category as string,
    big: day.max,
    description: day.description,
    line: <>min {day.min}° · vind {day.windMax} m/s{day.precip > 0 ? <> · {day.precip} mm</> : null}</>,
    min: day.min, max: day.max, precip: day.precip,
    categoryForAdvice: day.category as string,
    sunrise: day.sunrise, sunset: day.sunset,
  } : {
    category: weather.category as string,
    big: weather.temp,
    description: weather.description,
    line: <>føles {weather.feelsLike}° · vind {weather.wind} m/s</>,
    min: weather.todayMin, max: weather.todayMax, precip: weather.todayPrecip,
    categoryForAdvice: weather.todayCategory,
    sunrise: weather.sunrise, sunset: weather.sunset,
  };

  return (
    <div
      ref={rootRef}
      {...(multi ? pager.containerProps : {})}
      onClick={() => onToggle(offset)}
      style={{
        ...cell, ...(isMobile ? { minWidth: 0 } : {}), padding: isMobile ? m.pad : screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '28px 32px' : '20px 24px',
        display: 'flex', flexDirection: 'column', cursor: 'default',
        // Prikkene ligger absolutt nederst i kortets padding og gjør det ikke høyere.
        ...(multi ? { position: 'relative' } : {}),
        // Svak aksent på rammen når en annen dag enn i dag vises (som de andre sveipbare kortene).
        ...(day ? { border: '1px solid color-mix(in srgb, var(--accent) 55%, var(--line))' } : {}),
        ...lockStyle,
        ...(multi ? pager.containerProps.style : {}),
      }}
    >
      {/* Det som glir. Ellers nøytral: bærer gap'en kortet tidligere hadde selv. */}
      <div ref={pager.contentRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={day ? { ...eyebrow, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : eyebrow}>
            Vær · {day ? (offset === 1 ? 'I morgen' : dateLabel(day.date)) : 'Bodø'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {/* Som de andre sveipbare kortene: ingen piler på mobil — der sveipes det. */}
            {multi && !isMobile && (
              <PagerArrows canPrev={pager.canPrev} canNext={pager.canNext} onPrev={pager.prev} onNext={pager.next} isMobile={isMobile} />
            )}
            {/* «YR»-markøren gjelder nå-verdiene, så den vises bare på i dag. */}
            {weather && !day && <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--good)', letterSpacing: '0.06em' }}>● YR</div>}
          </div>
        </div>

        {!weather || !v ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, color: 'var(--ink-4)' }}>…</div>
        ) : (
          <>
            {/* Top row: icon + temp/description  |  KLE PÅ SEG */}
            <div ref={topRowRef} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', ...(isMobile ? { flexWrap: 'wrap', gap: 8 } : {}), ...topRowFit }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : screenSize === 'desktop' ? 20 : screenSize === 'tablet' ? 6 : 12, ...(isMobile ? { minWidth: 0 } : {}) }}>
                <WeatherIcon category={v.category} size={isMobile ? 36 : screenSize === 'desktop' ? 64 : screenSize === 'tablet' ? 28 : 48} />
                <div style={isMobile ? { minWidth: 0 } : undefined}>
                  <div style={{ fontSize: isMobile ? 32 : screenSize === 'desktop' ? 64 : screenSize === 'tablet' ? 28 : 48, fontWeight: isMobile ? 400 : 300, letterSpacing: '-0.04em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                    {v.big}<span style={{ fontSize: isMobile ? 16 : screenSize === 'desktop' ? 28 : screenSize === 'tablet' ? 12 : 20, opacity: 0.4 }}>°</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, fontWeight: 600, color: 'var(--ink-2)', marginTop: isMobile ? 4 : 8 }}>{v.description}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 14, color: 'var(--ink-4)', marginTop: 3 }}>
                    {v.line}
                  </div>
                </div>
              </div>

              {/* KLE PÅ SEG — moved above the divider */}
              <div style={isMobile ? { textAlign: 'left', width: '100%' } : { textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em', marginBottom: isMobile ? 3 : 5 }}>KLE PÅ SEG</div>
                <div style={isMobile ? { textAlign: 'left' } : { maxWidth: 220, textAlign: 'right' }}>
                  {(() => {
                    const { text, spreadWarning } = dressAdvice(v.max, v.min, v.categoryForAdvice, v.precip);

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: isMobile ? 'flex-start' : 'flex-end' }}>
                        <span style={{ fontSize: isMobile ? m.body : 15, fontWeight: 600, color: 'var(--ink-2)', lineHeight: 1.35, textWrap: 'balance' } as React.CSSProperties}>{text}</span>
                        {spreadWarning && (
                          <span style={{ fontSize: isMobile ? m.mono : 13, fontWeight: 500, color: 'var(--ink-4)', lineHeight: 1.35, textWrap: 'balance' } as React.CSSProperties}>
                            🌡️ Vurder å ta med noe varmere til morgen og kveld
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Bottom row: MIN/MAKS/NEDBØR  |  Soloppgang/nedgang */}
            <div style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(isMobile ? { flexWrap: 'wrap', gap: 8 } : {}) }}>
                <div style={{ display: 'flex', gap: isMobile ? 12 : 16, alignItems: 'baseline' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>MIN</span>
                    <span style={{ fontSize: isMobile ? m.statNum : 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{v.min}°</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>MAKS</span>
                    <span style={{ fontSize: isMobile ? m.statNum : 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{v.max}°</span>
                  </div>
                  {v.precip > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>NEDBØR</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                        <span style={{ fontSize: isMobile ? m.statNum : 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: 'var(--accent)' }}>{v.precip}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.micro : 15, fontWeight: 600, color: 'var(--accent)', opacity: 0.7 }}>mm</span>
                      </span>
                    </div>
                  )}
                </div>
                {(v.sunrise || v.sunset) && (
                  <div style={{ display: 'flex', gap: isMobile ? 10 : 12 }}>
                    {v.sunrise && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>↑ SOL</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.body : 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v.sunrise}</span>
                      </div>
                    )}
                    {v.sunset && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>↓ SOL</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.body : 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v.sunset}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

      </div>

      {multi && <PagerDots count={daily.length} index={offset} />}
    </div>
  );
}
