import type React from 'react';
import { m, type ScreenSize, type WeatherData } from './shared';
import { WeatherIcon } from './WeatherIcon';

interface Props {
  weather: WeatherData | null;
  /** Klikk på kortet (åpner/lukker timegrafen). */
  onToggle: () => void;
  isMobile: boolean;
  screenSize: ScreenSize;
  cell: React.CSSProperties;
  eyebrow: React.CSSProperties;
}

// Vær · Bodø — nå-verdier fra Yr (met.no) med dagens min/maks, KLE PÅ SEG og sol.
export function WeatherCard({ weather, onToggle, isMobile, screenSize, cell, eyebrow }: Props) {
  return (
    <div
      onClick={onToggle}
      style={{ ...cell, ...(isMobile ? { minWidth: 0 } : {}), padding: isMobile ? m.pad : screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '28px 32px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : screenSize === 'tablet' ? 7 : 16, cursor: 'default' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={eyebrow}>Vær · Bodø</div>
        {weather && <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--good)', letterSpacing: '0.06em' }}>● YR</div>}
      </div>

      {!weather ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, color: 'var(--ink-4)' }}>…</div>
      ) : (
        <>
          {/* Top row: icon + temp/description  |  KLE PÅ SEG */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', ...(isMobile ? { flexWrap: 'wrap', gap: 8 } : {}) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : screenSize === 'desktop' ? 20 : screenSize === 'tablet' ? 6 : 12, ...(isMobile ? { minWidth: 0 } : {}) }}>
              <WeatherIcon category={weather.category} size={isMobile ? 36 : screenSize === 'desktop' ? 64 : screenSize === 'tablet' ? 28 : 48} />
              <div style={isMobile ? { minWidth: 0 } : undefined}>
                <div style={{ fontSize: isMobile ? 32 : screenSize === 'desktop' ? 64 : screenSize === 'tablet' ? 28 : 48, fontWeight: isMobile ? 400 : 300, letterSpacing: '-0.04em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                  {weather.temp}<span style={{ fontSize: isMobile ? 16 : screenSize === 'desktop' ? 28 : screenSize === 'tablet' ? 12 : 20, opacity: 0.4 }}>°</span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, fontWeight: 600, color: 'var(--ink-2)', marginTop: isMobile ? 4 : 8 }}>{weather.description}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 14, color: 'var(--ink-4)', marginTop: 3 }}>
                  føles {weather.feelsLike}° · vind {weather.wind} m/s
                </div>
              </div>
            </div>

            {/* KLE PÅ SEG — moved above the divider */}
            <div style={isMobile ? { textAlign: 'left', width: '100%' } : { textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em', marginBottom: isMobile ? 3 : 5 }}>KLE PÅ SEG</div>
              <div style={isMobile ? { textAlign: 'left' } : { maxWidth: 220, textAlign: 'right' }}>
                {(() => {
                  const max = weather.todayMax;
                  const min = weather.todayMin;
                  const rain = weather.todayCategory === 'rain' || weather.todayCategory === 'thunder' || weather.todayPrecip > 1;
                  const snow = weather.todayCategory === 'snow';
                  let text: string;
                  if (snow || max < 0) text = '❄️ Vinterklær! Husk lue og jakke';
                  else if (max < 8)    text = '🥶 Vurder å ta på vinterjakke';
                  else if (max < 15)   text = rain ? '🌧️ Husk regnjakke! Lurt å ha noe under også' : '🍂 Burde ha med genser eller en tynn jakke';
                  else if (max < 20)   text = rain ? '☔ Regnjakke! Og kan være lurt å ha på noe under' : '🌤️ Kan være lurt å ta med genser eller tynn jakke';
                  else                 text = rain ? '🌦️ Regnjakke hvis du vil holde deg tørr' : '🏖️ SOMMERKLÆR!! Kjempefint vær';

                  const spreadWarning = min < 15 && (max - min) >= 5 && max >= 8;

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
                  <span style={{ fontSize: isMobile ? m.statNum : 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{weather.todayMin}°</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>MAKS</span>
                  <span style={{ fontSize: isMobile ? m.statNum : 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{weather.todayMax}°</span>
                </div>
                {weather.todayPrecip > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>NEDBØR</span>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                      <span style={{ fontSize: isMobile ? m.statNum : 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: 'var(--accent)' }}>{weather.todayPrecip}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.micro : 15, fontWeight: 600, color: 'var(--accent)', opacity: 0.7 }}>mm</span>
                    </span>
                  </div>
                )}
              </div>
              {(weather.sunrise || weather.sunset) && (
                <div style={{ display: 'flex', gap: isMobile ? 10 : 12 }}>
                  {weather.sunrise && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>↑ SOL</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.body : 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{weather.sunrise}</span>
                    </div>
                  )}
                  {weather.sunset && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>↓ SOL</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.body : 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{weather.sunset}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
