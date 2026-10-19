import { Fragment, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTodo, type Priority } from '../contexts/TodoContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useWish } from '../contexts/WishContext';
import { useCountdowns, type Countdown } from '../hooks/useCountdown';
import { osloToday, upcomingCountdowns } from '../lib/countdowns';
import { useMatplan } from '../contexts/MatplanContext';
import { useTrening } from '../contexts/TreningContext';
import { groupByNameUnit } from './middag/HandlelisteCard';
import { snapshotGroceryRows, pushToast, startLeaving, removeToast, UNDO_TOAST_MS, type UndoToast } from '../lib/groceryUndo';
import UndoToastStack from './skjerm/UndoToastStack';
import { consecutiveDays, formatIngredientAmount, mealRangeLabel } from '../lib/dagensMiddag';
import { dateLabel } from '../lib/dayLabel';
import { fireworkRain } from '../confetti';
import { kpLevel, type KpLevel } from '../lib/kpLevel';
import { TreningQuickRegister } from '../TreningQuickRegister';
import { QuickTodoForm } from '../QuickAdd';
import { useIdleReset } from '../lib/useIdleReset';
import { useSkjermViewport } from './skjerm/useSkjermViewport';
import { layoutGap, glowBleed } from './skjerm/swipeGlow';
import { ScreenPopup } from './skjerm/ScreenPopup';
import { KalenderCard } from './skjerm/KalenderCard';
import { MiddagCard } from './skjerm/MiddagCard';
import { NedtellingCard } from './skjerm/NedtellingCard';
import { NordlysCard } from './skjerm/NordlysCard';
import { WeatherCard } from './skjerm/WeatherCard';
import { WeatherIcon } from './skjerm/WeatherIcon';
import { todoTiming, BUCKET_ORDER, BUCKET_LABEL, BUCKET_COLOR, type TodoBucket, type TodoTiming } from './skjerm/todoTiming';
import { m, EMPTY_COUNTDOWN_DRAFT, AURORA_COLOR, AURORA_LABEL, type AuroraData, type HourlyEntry, type WeatherData } from './skjerm/shared';
import type { CalEvent } from '../../api/kalender';
import type { AuroraChance, AuroraHourlyEntry } from '../../api/nordlys';

// ─── Helpers ───────────────────────────────────────────────────────────────

interface WasteType { name: string; category: 'plast' | 'mat' | 'papir' | 'rest' | 'glass' | 'hage' | 'annet'; }
interface Pickup { date: string; weekday: string; dateLabel: string; types: WasteType[]; }
interface TommeplanData { address: string; pickups: Pickup[]; updatedAt: string; }

// Small inline weather icon for use inside the SVG chart (scaled from 56×56 design)
function MiniIcon({ category, cx, cy }: { category: string; cx: number; cy: number }) {
  // Scale 56×56 icon to 16×16, center on (cx,cy)
  const t = `translate(${cx - 8},${cy - 8}) scale(0.286)`;
  const cloud = 'rgba(207,224,239,0.55)';
  const sun   = '#F59E0B';
  const rain  = '#7DD3FC';

  if (category === 'clear') return (
    <g transform={t} opacity="0.9">
      <circle cx="28" cy="28" r="10" fill={sun} />
      {[0,45,90,135,180,225,270,315].map(a => (
        <line key={a}
          x1={28+13*Math.cos(a*Math.PI/180)} y1={28+13*Math.sin(a*Math.PI/180)}
          x2={28+18*Math.cos(a*Math.PI/180)} y2={28+18*Math.sin(a*Math.PI/180)}
          stroke={sun} strokeWidth="3" strokeLinecap="round" />
      ))}
    </g>
  );
  if (category === 'fair') return (
    <g transform={t} opacity="0.9">
      <circle cx="20" cy="18" r="8" fill={sun} opacity="0.85" />
      {[0,60,120,180,240,300].map(a => (
        <line key={a}
          x1={20+10*Math.cos(a*Math.PI/180)} y1={18+10*Math.sin(a*Math.PI/180)}
          x2={20+14*Math.cos(a*Math.PI/180)} y2={18+14*Math.sin(a*Math.PI/180)}
          stroke={sun} strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      ))}
      <path d="M16 42 Q12 42 12 36 Q12 30 20 30 Q22 22 32 22 Q42 22 44 32 Q52 32 52 39 Q52 44 46 44 L20 44 Q16 44 16 42Z" fill={cloud} />
    </g>
  );
  if (category === 'rain') return (
    <g transform={t} opacity="0.9">
      <path d="M12 34 Q8 34 8 27 Q8 20 17 20 Q19 12 29 12 Q39 12 41 22 Q50 22 50 30 Q50 36 44 36 L16 36 Q12 36 12 34Z" fill={cloud} />
      {[[17,44],[25,40],[33,44],[21,50],[29,48]].map(([x,y],i) => (
        <line key={i} x1={x} y1={y-6} x2={x-2} y2={y} stroke={rain} strokeWidth="2.5" strokeLinecap="round" />
      ))}
    </g>
  );
  if (category === 'snow') return (
    <g transform={t} opacity="0.9">
      <path d="M12 34 Q8 34 8 27 Q8 20 17 20 Q19 12 29 12 Q39 12 41 22 Q50 22 50 30 Q50 36 44 36 L16 36 Q12 36 12 34Z" fill={cloud} />
      {[[17,44],[25,40],[33,44],[21,50],[29,48]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="#BAE6FD" />
      ))}
    </g>
  );
  if (category === 'thunder') return (
    <g transform={t} opacity="0.9">
      <path d="M12 34 Q8 34 8 27 Q8 20 17 20 Q19 12 29 12 Q39 12 41 22 Q50 22 50 30 Q50 36 44 36 L16 36 Q12 36 12 34Z" fill={cloud} />
      <polyline points="30,38 24,47 29,47 23,56" fill="none" stroke={sun} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
  // cloudy / fog / default
  return (
    <g transform={t} opacity="0.8">
      <path d="M8 38 Q4 38 4 31 Q4 24 13 24 Q15 16 25 16 Q35 16 37 26 Q46 26 46 34 Q46 40 40 40 L12 40 Q8 40 8 38Z" fill={cloud} />
      {category === 'fog' && [0,1,2].map(i => (
        <line key={i} x1="6" y1={34+i*5} x2="44" y2={34+i*5} stroke="rgba(207,224,239,0.4)" strokeWidth="2" strokeLinecap="round" />
      ))}
    </g>
  );
}

function HourlyChart({ hourly, now, sunrise, sunset, showNow = true }: {
  hourly: HourlyEntry[]; now: Date; sunrise?: string; sunset?: string;
  /** false for andre dager enn i dag: ingen «nå»-markør. */
  showNow?: boolean;
}) {
  const n = hourly.length;
  if (n < 2) return null;

  const W = 760, H = 238;
  const padL = 36, padR = 22, padT = 26;
  const rainH = 32, rainGap = 6, precipLabelH = 14, iconH = 16, iconGap = 4, labelH = 20;
  const pW = W - padL - padR;
  const tempBot       = H - rainH - rainGap - precipLabelH - iconH - iconGap - labelH;
  const tempH         = tempBot - padT;
  const rainTop       = tempBot + rainGap;
  const rainBot       = rainTop + rainH;
  const precipLabelY  = rainBot + 10;   // fixed baseline for all mm labels
  const iconCy        = rainBot + precipLabelH + iconGap + iconH / 2;

  const temps  = hourly.map(h => h.temp);
  const rawMin = Math.min(...temps), rawMax = Math.max(...temps);
  const span   = Math.max(4, rawMax - rawMin);
  const minT   = rawMin - span * 0.12, maxT = rawMax + span * 0.18;
  const maxP   = Math.max(0.5, ...hourly.map(h => h.precip));

  const xi = (i: number) => padL + (i / (n - 1)) * pW;
  const yt = (t: number) => padT + tempH * (1 - (t - minT) / (maxT - minT));

  const lineD = hourly.map((h, i) => `${i === 0 ? 'M' : 'L'}${xi(i).toFixed(1)} ${yt(h.temp).toFixed(1)}`).join(' ');
  const areaD = `${lineD} L${xi(n - 1).toFixed(1)} ${tempBot} L${padL} ${tempBot} Z`;

  let curIdx = 0;
  const curHour = now.getHours();
  for (let k = 0; k < n; k++) { if (hourly[k].hour <= curHour) curIdx = k; }
  if (!showNow) curIdx = -1;

  // Adaptive label interval: every 1h if there's room, 2h or 3h when crowded
  const spacing = n > 1 ? pW / (n - 1) : pW;
  const labelEvery = spacing >= 50 ? 1 : spacing >= 25 ? 2 : 3;
  // Grove 6-timers punkter (andre dager enn i dag, der Yr ikke gir timesdata) merkes alltid.
  const labeled = (h: HourlyEntry) => h.hour % labelEvery === 0 || h.step === 6;

  // Y-axis ticks
  const tickSpan = maxT - minT;
  const tickStep = tickSpan > 20 ? 10 : tickSpan > 8 ? 5 : 2;
  const firstTick = Math.ceil(minT / tickStep) * tickStep;
  const tempTicks: number[] = [];
  for (let t = firstTick; t <= maxT; t += tickStep) tempTicks.push(t);

  // 0°C split point — clamp to chart area so clip paths are always valid
  const y0raw = yt(0);
  const y0    = Math.max(padT, Math.min(tempBot, y0raw));

  // Warm = orange (#F97316), cold = icy blue (#7DD3FC)
  const WARM = '#F97316';
  const COLD = '#7DD3FC';

  const parseHrMin = (s?: string) => {
    if (!s) return null;
    const p = s.split(/[:.]/);
    return parseInt(p[0], 10) + (parseInt(p[1] ?? '0', 10)) / 60;
  };
  const hrToX = (hr: number) => {
    let i0 = 0;
    for (let k = 0; k < n; k++) { if (hourly[k].hour <= hr) i0 = k; }
    const i1 = Math.min(n - 1, i0 + 1);
    if (i0 === i1) return xi(i0);
    const frac = (hr - hourly[i0].hour) / (hourly[i1].hour - hourly[i0].hour);
    return xi(i0) + frac * (xi(i1) - xi(i0));
  };

  const sunriseHr = parseHrMin(sunrise), sunsetHr = parseHrMin(sunset);
  const sunriseX  = sunriseHr !== null ? hrToX(sunriseHr) : null;
  const sunsetX   = sunsetHr  !== null ? hrToX(sunsetHr)  : null;
  const barW = Math.max(4, pW / n * 0.55);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <defs>
        {/* Warm fill: orange gradient */}
        <linearGradient id="hwg-warm" x1="0" y1={padT} x2="0" y2={tempBot} gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="rgba(249,115,22,0.32)" />
          <stop offset="100%" stopColor="rgba(249,115,22,0.03)" />
        </linearGradient>
        {/* Cold fill: blue gradient */}
        <linearGradient id="hwg-cold" x1="0" y1={padT} x2="0" y2={tempBot} gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="rgba(125,211,252,0.22)" />
          <stop offset="100%" stopColor="rgba(125,211,252,0.03)" />
        </linearGradient>
        {/* Clip: above 0°C (warm zone) */}
        <clipPath id="hwg-clip-warm">
          <rect x={padL - 2} y={0} width={pW + 4} height={y0} />
        </clipPath>
        {/* Clip: below 0°C (cold zone) */}
        <clipPath id="hwg-clip-cold">
          <rect x={padL - 2} y={y0} width={pW + 4} height={H - y0} />
        </clipPath>
      </defs>

      {/* ── Y-axis: temperature gridlines + labels ── */}
      {tempTicks.map(t => {
        const y = yt(t);
        if (y < padT - 2 || y > tempBot + 2) return null;
        const isZero = t === 0;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y}
              stroke={isZero ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)'}
              strokeWidth={isZero ? 1.5 : 1}
              strokeDasharray={isZero ? undefined : '3,5'} />
            <text x={padL - 5} y={y + 4} textAnchor="end"
              fontSize="10" fontFamily="var(--font-mono)"
              fill={isZero ? 'rgba(207,224,239,0.65)' : 'rgba(207,224,239,0.38)'}>
              {t > 0 ? '+' : ''}{t}°
            </text>
          </g>
        );
      })}

      {/* ── Sunrise / sunset markers ── */}
      {sunriseX !== null && sunriseX >= padL && sunriseX <= W - padR && (
        <line x1={sunriseX} y1={padT - 4} x2={sunriseX} y2={iconCy + iconH / 2} stroke="rgba(251,191,36,0.35)" strokeWidth="1" strokeDasharray="3,3" />
      )}
      {sunsetX !== null && sunsetX >= padL && sunsetX <= W - padR && (
        <line x1={sunsetX} y1={padT - 4} x2={sunsetX} y2={iconCy + iconH / 2} stroke="rgba(251,140,36,0.3)" strokeWidth="1" strokeDasharray="3,3" />
      )}

      {/* ── Temperature area fills ── */}
      <path d={areaD} fill="url(#hwg-warm)" clipPath="url(#hwg-clip-warm)" />
      <path d={areaD} fill="url(#hwg-cold)" clipPath="url(#hwg-clip-cold)" />

      {/* ── Temperature lines ── */}
      <path d={lineD} fill="none" stroke={WARM} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" clipPath="url(#hwg-clip-warm)" />
      <path d={lineD} fill="none" stroke={COLD} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" clipPath="url(#hwg-clip-cold)" />

      {/* ── Current time marker ── */}
      {showNow && (
        <line x1={xi(curIdx)} y1={padT - 6} x2={xi(curIdx)} y2={iconCy + iconH / 2} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="4,3" />
      )}

      {/* ── Dots + labels every labelEvery h + current ── */}
      {hourly.map((h, i) => {
        if (!labeled(h) && i !== curIdx) return null;
        const isCur    = i === curIdx;
        const isWarm   = h.temp > 0;
        const dotColor = isCur ? '#fff' : (isWarm ? WARM : COLD);
        const lblColor = isCur ? '#fff' : (isWarm ? 'rgba(249,140,80,0.95)' : 'rgba(147,210,252,0.95)');
        const anchor   = 'middle';
        return (
          <g key={i}>
            <circle cx={xi(i)} cy={yt(h.temp)} r={isCur ? 4.5 : 3}
              fill={dotColor}
              stroke={isCur ? (isWarm ? WARM : COLD) : 'none'} strokeWidth="1.5" />
            <text x={xi(i)} y={yt(h.temp) - 8} textAnchor={anchor}
              fontSize="11" fontFamily="var(--font-mono)" fill={lblColor}>
              {h.temp > 0 ? '+' : ''}{h.temp}°
            </text>
          </g>
        );
      })}

      {/* ── Rain bars + mm labels (always in fixed row below bars) ── */}
      {hourly.map((h, i) => {
        if (h.precip <= 0) return null;
        const barH   = (h.precip / maxP) * rainH;
        const barTop = rainBot - barH;
        return (
          <g key={i}>
            <rect x={xi(i) - barW / 2} y={barTop} width={barW} height={barH}
              fill="#6BA9D6" opacity="0.75" rx="1.5" />
            <text x={xi(i)} y={precipLabelY} textAnchor="middle"
              fontSize="9" fontFamily="var(--font-mono)"
              fill="rgba(147,210,252,0.85)">
              {h.precip} mm
            </text>
          </g>
        );
      })}

      {/* ── Weather icons every labelEvery h ── */}
      {hourly.filter(labeled).map(h => {
        const i = hourly.findIndex(hh => hh.hour === h.hour);
        if (i < 0) return null;
        return <MiniIcon key={h.hour} category={h.category} cx={xi(i)} cy={iconCy} />;
      })}

      {/* ── X-axis: hour labels ── */}
      {hourly.filter(labeled).map(h => {
        const i = hourly.findIndex(hh => hh.hour === h.hour);
        if (i < 0) return null;
        return (
          <text key={h.hour} x={xi(i)} y={H - 2} textAnchor="middle"
            fontSize="10" fontFamily="var(--font-mono)" fill="rgba(207,224,239,0.4)">
            {String(h.hour).padStart(2, '0')}:00
          </text>
        );
      })}
    </svg>
  );
}

const AURORA_CHANCE_COLOR: Record<AuroraChance, string> = {
  lav: 'rgba(147,197,253,0.45)', middels: 'var(--warn)', høy: 'var(--good)',
};
// Dagslys — nordlys uansett ikke synlig, uansett hvor bra Kp/skydekke ellers
// er den timen. Søylen beholder sin egentlige høyde (så man ser at forholdene
// faktisk var gode), men dempes tydelig i farge/opasitet i stedet for å
// fjernes — det holder timeaksen sammenhengende og viser HVORFOR ingenting
// skjer akkurat da, i stedet for å etterlate et uforklart hull.
const AURORA_DAYLIGHT_BAR = 'rgba(255,255,255,0.12)';

// Kp-visning: samme tre farger, men nivået kommer fra Kp alene (ikke skydekke).
const KP_LEVEL_COLOR: Record<KpLevel, string> = {
  lav: AURORA_CHANCE_COLOR.lav, middels: AURORA_CHANCE_COLOR.middels, hoy: AURORA_CHANCE_COLOR.høy,
};
const KP_LEVEL_LABEL: Record<KpLevel, string> = {
  lav: 'Lav Kp (under 2)', middels: 'Middels Kp (2 til under 4)', hoy: 'Høy Kp (4 og over)',
};

type AuroraView = 'sannsynlighet' | 'kp';
const KP_MAX = 9;
const KP_TICKS = [0, 3, 6, 9];
// Sannsynlighet-aksen: score/4 i 25 %-steg (poeng 0-4).
const PROB_TICKS = [0, 1, 2, 3, 4];

/**
 * Nordlys-prognose time for time, neste ~20 timer. Egen komponent (ikke
 * HourlyChart, som er bygget rundt temperatur+nedbør) — men samme visuelle
 * språk: samme viewBox-oppsett, adaptivt intervall på timetallene, samme
 * mørke fargepalett. `hourly[0]` er alltid inneværende time (API-et bygger
 * lista fra «nå»), så x-aksen er kronologisk indeks, ikke klokketime — en
 * ren time-of-day-akse ville krøllet seg ved midnatt når vinduet strekker
 * seg over et døgnskifte.
 */
function AuroraHourlyChart({ hourly, view, nowLabel = true }: { hourly: AuroraHourlyEntry[]; view: AuroraView; nowLabel?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Trykk utenfor grafen skjuler etiketten (touch + mus).
  useEffect(() => {
    if (selected === null) return;
    const onDown = (e: PointerEvent) => {
      if (!svgRef.current?.contains(e.target as Node)) setSelected(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [selected]);
  // Bytte visning skjuler etiketten (innholdet i den er visningsavhengig).
  useEffect(() => { setSelected(null); }, [view]);

  const n = hourly.length;
  if (n < 2) return null;

  const isKp = view === 'kp';
  const W = 760, H = 190;
  const padL = 38, padR = 10, padT = 28, labelH = 22;
  const barAreaTop = padT;
  const barAreaBot = H - labelH;
  const barAreaH   = barAreaBot - barAreaTop;
  const pW = W - padL - padR;

  const slot = pW / n;
  const barW = Math.max(4, slot * 0.6);
  const xc = (i: number) => padL + slot * i + slot / 2;

  // Rå 0-4-score (ikke bare de 3 sjanse-bøttene) gir søylene ekte høydevariasjon
  // time for time — skydekket har reell timeoppløsning selv om Kp er flatt
  // gjennom sin 3-timersbolk.
  // I Kp-visning er høyden selve Kp-verdien (0-9); fargen følger fortsatt
  // sjanse-nivået, så skydekke påvirker farge men ikke høyde.
  const barH = (h: AuroraHourlyEntry) => Math.max(3,
    isKp ? (Math.min(h.kp, KP_MAX) / KP_MAX) * barAreaH : (h.score / 4) * barAreaH);
  const chancePct = (h: AuroraHourlyEntry) => Math.round((h.score / 4) * 100);
  const labelText = (h: AuroraHourlyEntry) => {
    const kp = `Kp ${Math.round(h.kp * 10) / 10}`;
    return view === 'sannsynlighet' && h.dark ? `${kp} · ${chancePct(h)} %` : kp;
  };

  const labelEvery = slot >= 50 ? 1 : slot >= 25 ? 2 : 3;
  const osloHour = (iso: string) => parseInt(
    new Date(iso).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', hour: 'numeric', hour12: false }), 10);

  // Sammenhengende dagslys-strekk, som bakgrunnsbånd.
  const daylightBands: { from: number; to: number }[] = [];
  let bandStart: number | null = null;
  for (let i = 0; i < n; i++) {
    if (!hourly[i].dark) { if (bandStart === null) bandStart = i; }
    else if (bandStart !== null) { daylightBands.push({ from: bandStart, to: i - 1 }); bandStart = null; }
  }
  if (bandStart !== null) daylightBands.push({ from: bandStart, to: n - 1 });

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', touchAction: 'manipulation' }}>
      {(isKp
        ? KP_TICKS.map(t => ({ frac: t / KP_MAX, label: String(t) }))
        : PROB_TICKS.map(t => ({ frac: t / 4, label: `${t * 25} %` }))
      ).map(({ frac, label }, ti) => {
        const y = barAreaBot - frac * barAreaH;
        return (
          <g key={ti}>
            <line x1={padL} y1={y} x2={W - padR} y2={y}
              stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray={frac === 0 ? undefined : '3 4'} />
            <text x={padL - 6} y={y + 3.5} textAnchor="end"
              fontSize="10" fontFamily="var(--font-mono)" fill="rgba(207,224,239,0.5)">{label}</text>
          </g>
        );
      })}
      {daylightBands.map((b, i) => (
        <rect key={i}
          x={padL + slot * b.from} y={barAreaTop} width={slot * (b.to - b.from + 1)} height={barAreaH}
          fill="rgba(251,191,36,0.06)" />
      ))}

      <line x1={padL} y1={barAreaBot} x2={W - padR} y2={barAreaBot} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />

      {hourly.map((h, i) => {
        const bh = barH(h);
        return (
          <rect key={i}
            x={xc(i) - barW / 2} y={barAreaBot - bh} width={barW} height={bh}
            fill={!h.dark ? AURORA_DAYLIGHT_BAR : isKp ? KP_LEVEL_COLOR[kpLevel(h.kp)] : AURORA_CHANCE_COLOR[h.chance]}
            opacity={h.dark ? 1 : 0.6} rx="2" />
        );
      })}

      {selected !== null && (() => {
        const h = hourly[selected];
        const text = labelText(h);
        const w = text.length * 6.6 + 14;
        const cx = Math.min(W - padR - w / 2, Math.max(padL + w / 2, xc(selected)));
        const y = Math.max(2, barAreaBot - barH(h) - 6 - 18);
        return (
          <g pointerEvents="none">
            <rect x={cx - w / 2} y={y} width={w} height={18} rx="4"
              fill="rgba(15,23,32,0.95)" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
            <text x={cx} y={y + 12.5} textAnchor="middle"
              fontSize="11" fontFamily="var(--font-mono)" fill="#E8EFF7">{text}</text>
          </g>
        );
      })()}

      {/* Trykkflater: hele slot-høyden, ikke bare den fargede søylen */}
      {hourly.map((_, i) => (
        <rect key={i}
          x={padL + slot * i} y={barAreaTop} width={slot} height={barAreaH}
          fill="transparent" style={{ cursor: 'pointer' }}
          onClick={() => setSelected(sel => (sel === i ? null : i))} />
      ))}

      {hourly.map((h, i) => {
        if (i !== 0 && i % labelEvery !== 0) return null;
        return (
          <text key={i} x={xc(i)} y={H - 4} textAnchor="middle"
            fontSize="10" fontFamily="var(--font-mono)" fill={i === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(207,224,239,0.4)'}>
            {i === 0 && nowLabel ? 'nå' : `${String(osloHour(h.time)).padStart(2, '0')}`}
          </text>
        );
      })}
    </svg>
  );
}

const SOURCE_COLOR: Record<string, string> = {
  andreas: '#4A80C4', taran: '#C97A8B', felles: '#7AB394', todo: '#C9963A',
};
const PRIORITY_COLOR: Record<string, string> = {
  høy: '#C0392B', middels: '#C9963A', lav: 'var(--ink-4)',
};
// Per-person label color for the Gjøremål-boksen — deliberately separate from
// PRIORITY_COLOR (the stripe keeps showing priority; the "Felles"/"Andreas"/
// "Taran" text should show who instead). Felles stays a neutral grey rather
// than a third saturated color, so the two named people still stand out.
const WHO_TEXT_COLOR: Record<string, string> = {
  f: 'var(--ink-4)', M: SOURCE_COLOR.andreas, L: SOURCE_COLOR.taran,
};
const PRIORITY_ORDER: Record<Priority, number> = { høy: 0, middels: 1, lav: 2 };

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr()    { return localIso(new Date()); }

function TodoQuickAddModal({ isMobile, onClose }: { isMobile: boolean; onClose: () => void }) {
  return (
    <ScreenPopup eyebrowText="Gjøremål" title="Nytt gjøremål" onClose={onClose} width={460} isMobile={isMobile}>
      <QuickTodoForm isMobile={isMobile} onClose={onClose} onDirtyChange={() => {}} />
    </ScreenPopup>
  );
}

// Kun navn, bevisst — ingen antall/enhet i denne raske varianten (kan legges
// til på Handleliste-siden etterpå om det trengs).
function GroceryQuickAddModal({ isMobile = false, onClose }: { isMobile?: boolean; onClose: () => void }) {
  const { addGroceryItem } = useMatplan();
  const { notify } = useSnackbar();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await addGroceryItem({ name: trimmed, amount: 1 });
      notify(`«${trimmed}» lagt til på handlelisten`);
      onClose();
    } catch {
      // Feilen er allerede varslet av addGroceryItem (MatplanContext.tsx) —
      // la navnet stå igjen i feltet slik at forsøket ikke går tapt.
    } finally { setSaving(false); }
  };

  return (
    <ScreenPopup eyebrowText="Handleliste" title="Legg til vare" onClose={onClose} width={420} isMobile={isMobile}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 20 }}>
        <input className="input" placeholder="Navn på vare…" value={name} autoFocus
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
          style={{ fontSize: 16, padding: '12px 14px' }} />
        <button onClick={() => void submit()} className="btn primary" disabled={!name.trim() || saving}
          style={{ justifyContent: 'center', opacity: (!name.trim() || saving) ? 0.5 : 1 }}>
          {saving ? 'Lagrer…' : 'Legg til'}
        </button>
      </div>
    </ScreenPopup>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

interface Props { onBack: () => void }

// Agenda checkbox for the Gangskjerm — clearly visible on the dark display in both
// themes (ink-3 border, transparent fill) with a satisfying green fill + checkmark
// during the brief "completing" moment.
function ScreenCheck({ checked, onClick, label }: {
  checked: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; label: string;
}) {
  return (
    <button onClick={onClick} aria-label={label} style={{
      width: 22, height: 22, flexShrink: 0, cursor: 'pointer', padding: 0,
      borderRadius: 6, display: 'grid', placeItems: 'center',
      border: `1.5px solid ${checked ? 'var(--good)' : 'var(--ink-3)'}`,
      background: checked ? 'var(--good)' : 'transparent',
      transition: 'background .15s ease, border-color .15s ease',
    }}>
      {checked && (
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="#0B2545"
          strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.3 L4.9 8.7 L9.5 3.4" />
        </svg>
      )}
    </button>
  );
}

// Gruppeoverskrift i Gjøremål-boksen: «FORFALT · 1» i gruppens farge, med en
// tynn linje ut mot høyre (samme fargekode som pillene under).
function TodoGroupHeader({ bucket, count, first, isMobile }: {
  bucket: TodoBucket; count: number; first: boolean; isMobile: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: first ? '0 2px 5px' : '10px 2px 5px',
      fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 11, fontWeight: 600,
      letterSpacing: '0.12em', textTransform: 'uppercase', color: BUCKET_COLOR[bucket],
    }}>
      <span style={{ whiteSpace: 'nowrap' }}>{BUCKET_LABEL[bucket]} · {count}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  );
}

// Fargekodet frist-pille («I morgen», «Om 3 dager») med faktisk dato under.
function DuePill({ timing, isMobile }: { timing: TodoTiming; isMobile: boolean }) {
  const color = BUCKET_COLOR[timing.bucket];
  const none = timing.bucket === 'ingen';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, fontWeight: none ? 400 : 600,
        padding: isMobile ? '3px 8px' : '4px 10px', borderRadius: 999, whiteSpace: 'nowrap', color,
        background: none ? 'transparent' : `color-mix(in oklab, ${color} 20%, transparent)`,
        border: none ? '1px dashed var(--line-2)' : '1px solid transparent',
      }}>
        {timing.label}
      </span>
      {timing.sub && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 11, color: 'var(--ink-4)', paddingRight: 4, whiteSpace: 'nowrap' }}>
          {timing.sub}
        </span>
      )}
    </div>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} style={{
      width: 24, height: 24, flexShrink: 0, cursor: 'pointer', padding: 0,
      borderRadius: 6, display: 'grid', placeItems: 'center', lineHeight: 1,
      border: '1px solid var(--line-2)', background: 'transparent',
      color: 'var(--ink-3)', fontSize: 15, fontWeight: 700,
    }}>+</button>
  );
}

export default function PageSkjerm({ onBack }: Props) {
  const { items: todos, toggleItem, updateItem } = useTodo();
  const { notify } = useSnackbar();
  // Todos completed on the screen: briefly show the check + confetti before the
  // row drops out of the agenda (same satisfying feedback as the Gjøremål page),
  // then offer an undo — just like deleting things elsewhere.
  const [completingTodos, setCompletingTodos] = useState<Set<string>>(new Set());
  const completeTodo = (todoId: string, title: string, el: HTMLElement) => {
    // Gangskjerm er ment å sees på tvers av rommet — raketter fra
    // avkrysningsboksen som eksploderer og regner ned, ikke en liten smell
    // på stedet.
    const r = el.getBoundingClientRect();
    fireworkRain(r.left + r.width / 2, r.top + r.height / 2);
    setCompletingTodos(s => new Set(s).add(todoId));
    window.setTimeout(async () => {
      await toggleItem(todoId, false); // shown todos are always not-done
      setCompletingTodos(s => { const n = new Set(s); n.delete(todoId); return n; });
      notify(`«${title}» fullført`, { actionLabel: 'Angre', onAction: () => void toggleItem(todoId, true) });
    }, 450);
  };
  // Inline-edit a todo's title + deadline straight from the agenda: tap the date or
  // name to open the editor, then save (persists via updateItem) or discard.
  const [editingTodo, setEditingTodo] = useState<string | null>(null);
  const [todoDraft, setTodoDraft]     = useState<{ title: string; deadline: string }>({ title: '', deadline: '' });
  const startEditTodo = (todoId: string) => {
    const t = todos.find(x => x.id === todoId);
    if (!t) return;
    setTodoDraft({ title: t.title, deadline: t.deadline ?? todayStr() });
    setEditingTodo(todoId);
  };
  const saveEditTodo = async () => {
    if (!editingTodo) return;
    const title = todoDraft.title.trim();
    if (!title || !todoDraft.deadline) return;
    await updateItem(editingTodo, { title, deadline: todoDraft.deadline });
    setEditingTodo(null);
  };
  const { items: wishItems } = useWish();
  const { mealPlan, recipes, groceryItems, stapleItems, toggleGroceryItem, restoreGroceryItems } = useMatplan();
  // Én angre-melding per avhaket vare (nyest nederst, maks MAX_UNDO_TOASTS). Se UndoToastStack.
  const [undoToasts, setUndoToasts] = useState<UndoToast[]>([]);
  const undoSeq = useRef(0);
  const checkOffGrocery = async (label: string, ids: string[]) => {
    const snapshots = snapshotGroceryRows(ids, groceryItems, stapleItems);
    if (snapshots.length === 0) return;
    await Promise.all(ids.map(id => toggleGroceryItem(id)));
    const toast: UndoToast = { id: `u${++undoSeq.current}`, label, snapshots, expiresAt: Date.now() + UNDO_TOAST_MS };
    setUndoToasts(st => pushToast(st, toast));
  };
  const expireUndoToast = useCallback((id: string) => setUndoToasts(st => startLeaving(st, id)), []);
  const dropUndoToast = useCallback((id: string) => setUndoToasts(st => removeToast(st, id)), []);
  const undoGrocery = (toast: UndoToast) => {
    setUndoToasts(st => startLeaving(st, toast.id));
    void restoreGroceryItems(toast.snapshots);
  };
  const [now, setNow]  = useState(new Date());
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [weather, setWeather]    = useState<WeatherData | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  // Hvilken dag vær-popupen viser: 0 = i dag (hourly fra nå), 1–2 = daily[n].
  const [weatherDay, setWeatherDay] = useState(0);
  // Datoen oppskrift-modalen er åpnet for (kortet kan vise en annen dag enn i dag); null = lukket.
  const [recipeModalDate, setRecipeModalDate] = useState<string | null>(null);
  const [treningRegisterOpen, setTreningRegisterOpen] = useState(false);
  const [todoQuickAddOpen, setTodoQuickAddOpen] = useState(false);
  const [groceryQuickAddOpen, setGroceryQuickAddOpen] = useState(false);
  const { categories: trCategories } = useTrening();
  const [tommeplan, setTommeplan]           = useState<TommeplanData | null>(null);
  const [tommeplanError, setTommeplanError] = useState(false);
  const [aurora, setAurora]           = useState<AuroraData | null>(null);
  const [auroraError, setAuroraError] = useState(false);
  const [auroraOpen, setAuroraOpen]   = useState(false);
  // Hvilken natt popupen viser: 0 = «nå» (hourly, neste 20 timer), 1–2 = daily[n].hours.
  const [auroraNight, setAuroraNight] = useState(0);
  const [auroraView, setAuroraView]   = useState<AuroraView>('sannsynlighet');
  const { items: countdowns, add: addCd, update: updateCd, remove: removeCd, restore: restoreCd, loading: cdLoading } = useCountdowns();
  // Kun kommende nedtellinger (dato >= dagens Oslo-dato), nærmest først. useCountdowns() filtrerer
  // ikke (Dashboard bruker den til CRUD), så det gjøres her.
  const todayOslo = osloToday(now);
  const upcomingCds = useMemo(() => upcomingCountdowns(countdowns, todayOslo), [countdowns, todayOslo]);
  const [cdEditing, setCdEditing] = useState(false);
  // Nedtellingen som redigeres (null = ny). Redigering gjelder alltid den som VISES, ikke den første.
  const [cdEditTarget, setCdEditTarget] = useState<Countdown | null>(null);
  const [cdDraft, setCdDraft]     = useState(EMPTY_COUNTDOWN_DRAFT);
  // Etter lagring: kortet følger nedtellingen til dens nye plass i lista.
  const [cdFollow, setCdFollow]   = useState<{ id: string; date: string } | null>(null);
  // 10 s uten berøring/scroll noe sted på siden → alle sveipbare kort (useSwipePager)
  // glir tilbake til i dag. Står stille mens en popup/modal/inline-redigering er åpen,
  // så ingenting skjer bak den og ingen halvferdig redigering mister konteksten.
  const idleTick = useIdleReset({
    paused: weatherOpen || auroraOpen || recipeModalDate !== null || treningRegisterOpen
      || todoQuickAddOpen || groceryQuickAddOpen || editingTodo !== null || cdEditing,
  });
  // Bredde/høyde/skjermstørrelse. Høyden fryses mens en hurtig-popup er åpen (tastaturet kommer opp),
  // men rotasjon tas fortsatt imot — se useSkjermViewport.
  const { winW, viewportH, screenSize } = useSkjermViewport(todoQuickAddOpen || groceryQuickAddOpen);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const doFetch = () => {
      fetch('/api/vaer')
        .then(r => r.json())
        .then((d: WeatherData & { error?: string }) => { if (!d.error) setWeather(d); })
        .catch(() => {});
    };
    doFetch();
    const id = setInterval(doFetch, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const doFetch = () => {
      fetch('/api/kalender')
        .then(r => r.json())
        .then((data: CalEvent[] | { error: string }) => {
          if (Array.isArray(data)) setCalEvents(data);
        })
        .catch(() => {});
    };
    doFetch();
    const id = setInterval(doFetch, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Tømmedatoene endrer seg sjelden — en gang i timen er mer enn nok, og
  // holder Iris-siden vi skraper for belastning.
  useEffect(() => {
    const doFetch = () => {
      fetch('/api/tommeplan')
        .then(r => r.json())
        .then((d: TommeplanData & { error?: string }) => {
          if (d.error) { setTommeplanError(true); return; }
          setTommeplanError(false);
          setTommeplan(d);
        })
        .catch(() => setTommeplanError(true));
    };
    doFetch();
    const id = setInterval(doFetch, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Kp oppdateres hos NOAA hver 3. time, skydekket fra Yr oftere — 15 min
  // poll er en grei balanse uten å overspørre noen av dem.
  useEffect(() => {
    const doFetch = () => {
      fetch('/api/nordlys')
        .then(r => r.json())
        .then((d: AuroraData & { error?: string }) => {
          if (d.error) { setAuroraError(true); return; }
          setAuroraError(false);
          setAurora(d);
        })
        .catch(() => setAuroraError(true));
    };
    doFetch();
    const id = setInterval(doFetch, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const handleToggleEditCd = (target: Countdown) => {
    if (cdEditing) { setCdEditing(false); return; }
    setCdDraft({ label: target.label, date: target.date });
    setCdEditTarget(target);
    setCdEditing(true);
  };

  const handleAddCd = () => {
    setCdDraft(EMPTY_COUNTDOWN_DRAFT);
    setCdEditTarget(null);
    setCdEditing(true);
  };

  const handleSaveCd = () => {
    if (!cdDraft.label.trim() || !cdDraft.date) return;
    const patch = { label: cdDraft.label.trim(), date: cdDraft.date };
    if (cdEditTarget) {
      void updateCd(cdEditTarget.id, patch);
      setCdFollow({ id: cdEditTarget.id, date: patch.date });
    } else void addCd(patch);
    setCdEditing(false);
  };

  const handleRemoveCd = (target: Countdown) => {
    void removeCd(target.id);
    notify('Nedtelling fjernet', { actionLabel: 'Angre', onAction: () => void restoreCd(target) });
  };

  const today = todayStr();
  const WHO: Record<string, string> = { f: 'Felles', M: 'Andreas', L: 'Taran' };

  // Gjøremål-boksen viser derimot ALLE aktive gjøremål, ikke bare dagens —
  // fjernet datofilteret fra forrige økt. Inkluderer også gjøremål uten
  // deadline (todoEvents/AnyEvent var kalender-hendelse-formet og krevde en
  // dato, så dette er en egen, enklere liste bygget direkte fra todos).
  interface TodoRow {
    todoId: string; title: string; color: string; whoColor: string; who: string;
    priority: Priority; deadline?: string; time?: string; timing: TodoTiming;
  }
  const activeTodoRows: TodoRow[] = todos
    .filter(t => !t.done)
    .map(t => {
      // Samme «forfalt»-logikk som før — bare uten kravet om at deadline er i dag.
      const overdue = !!t.deadline && (
        t.overdue_days > 0
        || t.deadline < today
        || (!!t.time && new Date(`${t.deadline}T${t.time}:00`) < now)
      );
      // Rollover flytter deadline til i dag og teller opp overdue_days, så den
      // opprinnelige fristen er deadline − overdue_days.
      const overdueSince = !overdue ? undefined : (() => {
        const d = new Date(t.deadline! + 'T00:00:00');
        d.setDate(d.getDate() - t.overdue_days);
        return localIso(d);
      })();
      return {
        todoId: t.id, title: t.title,
        color: PRIORITY_COLOR[t.priority] ?? SOURCE_COLOR.todo,
        whoColor: WHO_TEXT_COLOR[t.who] ?? WHO_TEXT_COLOR.f,
        who: WHO[t.who] ?? WHO.f,
        priority: t.priority, deadline: t.deadline, time: t.time,
        timing: todoTiming({ deadline: t.deadline, time: t.time, overdueSince }, now),
      };
    })
    // Gruppert etter frist (Forfalt → I dag → Denne uken → Senere → Uten frist).
    // Innenfor gruppen: tidligste frist først (for Forfalt = lengst forfalt),
    // så prioritet, så navn. Prioritet vises fortsatt i fargestripen.
    .sort((a, b) => {
      const g = BUCKET_ORDER.indexOf(a.timing.bucket) - BUCKET_ORDER.indexOf(b.timing.bucket);
      if (g !== 0) return g;
      if (a.timing.bucket === 'forfalt') {
        const d = (a.timing.sortKey ?? '').localeCompare(b.timing.sortKey ?? '');
        if (d !== 0) return d;
      } else if (a.deadline && b.deadline) {
        const d = a.deadline.localeCompare(b.deadline) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99');
        if (d !== 0) return d;
      }
      return (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) || a.title.localeCompare(b.title, 'nb');
    });
  const bucketCounts = activeTodoRows.reduce<Record<TodoBucket, number>>(
    (acc, r) => { acc[r.timing.bucket] += 1; return acc; },
    { forfalt: 0, idag: 0, uke: 0, senere: 0, ingen: 0 },
  );

  // Oppskrift-modalen: for datoen kortet viste da det ble trykket på (Dagens middag / MiddagCard).
  const modalPlan   = recipeModalDate ? mealPlan.find(mp => mp.date === recipeModalDate) : undefined;
  const modalRecipe = modalPlan ? recipes.find(r => r.id === modalPlan.recipeId) : undefined;
  // Samme oppskrift flere dager på rad fra den viste datoen → ingredienser vises for hele serien.
  const modalDays   = modalRecipe && recipeModalDate ? consecutiveDays(mealPlan, recipeModalDate) : 0;
  const modalRange  = recipeModalDate ? mealRangeLabel(recipeModalDate, modalDays, recipeModalDate === today) : '';
  // Oppskriften forsvant mens modalen var åpen (realtime-oppdatering) → lukk, så inaktivitetstelleren ikke blir stående på pause.
  useEffect(() => { if (recipeModalDate && !modalRecipe) setRecipeModalDate(null); }, [recipeModalDate, modalRecipe]);

  // Handleliste-forhåndsvisning — samme grupperingslogikk som HandlelisteCard
  // (src/pages/middag/HandlelisteCard.tsx) bruker, gjenbrukt her via
  // groupByNameUnit så middag-ingredienser fra flere planlagte middager denne
  // uken vises som én rad, ikke duplisert. Kun ukjøpte varer, ingen +/- eller
  // legg-til her — dette er et utdrag, full redigering skjer på Handleliste-siden.
  const previewFreeform = groceryItems.filter(g => !g.mealPlanId && !g.stapleItemId && !g.done);
  const previewMeals    = groupByNameUnit(groceryItems.filter(g => g.mealPlanId && !g.done));
  const previewStaples  = groceryItems.filter(g => g.stapleItemId && !g.done);
  const previewRows: { key: string; name: string; amount: number | null; unit: string | null; approx?: boolean; toggle: () => void }[] = [
    ...previewFreeform.map(g => ({ key: g.id, name: g.name, amount: g.amount, unit: g.unit, toggle: () => void checkOffGrocery(g.name, [g.id]) })),
    ...previewMeals.map(group => ({ key: group.key, name: group.name, amount: group.amount, unit: group.unit, approx: group.approx, toggle: () => void checkOffGrocery(group.name, group.ids) })),
    ...previewStaples.map(g => ({ key: g.id, name: g.name, amount: g.amount, unit: g.unit, toggle: () => void checkOffGrocery(g.name, [g.id]) })),
  ];

  const timeStr = now.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  const secStr  = now.toLocaleTimeString('nb-NO', { second: '2-digit' }).replace(/.*:/, '');
  const dateRaw = now.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateStr = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);

  const yearStart   = new Date(now.getFullYear(), 0, 1).getTime();
  const yearEnd     = new Date(now.getFullYear() + 1, 0, 1).getTime();
  const yearPct     = ((now.getTime() - yearStart) / (yearEnd - yearStart)) * 100;
  const daysElapsed = Math.floor((now.getTime() - yearStart) / 86400000) + 1;
  const daysInYear  = Math.round((yearEnd - yearStart) / 86400000);
  const daysLeft    = daysInYear - daysElapsed;

  // The weekly "ting vi vil gjøre" reminder is shared across all devices and
  // rolls over the night into Monday — see useWeeklyBucket / api/cron/rollover.

  const cell: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
    overflow: 'hidden',
  };

  // Shared style for section eyebrow labels
  const eyebrow: React.CSSProperties = screenSize === 'mobile' ? m.eyebrow : {
    fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-4)',
  };
  const eyebrowDark: React.CSSProperties = {
    ...eyebrow, color: screenSize === 'mobile' ? m.eyebrowDarkColor : 'rgba(207,224,239,0.5)',
  };

  const isMobile = screenSize === 'mobile';
  const isTablet = screenSize === 'tablet';
  // iPad Pro 12.9": landscape = 1366px (wide), portrait = 1024px (narrow).
  // Narrow tablet reflows to fewer columns so nothing is cut off horizontally.
  const isNarrowTablet = isTablet && winW < 1200;
  const tabletPadding = screenSize === 'tablet' ? '8px 14px' : screenSize === 'desktop' ? '28px 36px' : '16px 20px';
  const tabletGap = layoutGap(screenSize);

  // ─── Wishlist deals: items the cron flagged as "cheapest in 30 days" ───
  // ?dealdemo in the URL injects a sample deal so the notice can be previewed
  // before 30 days of price history has accumulated.
  // dealKr = kroner below the 30-day average (avg30 − current price). The cron
  // flags a deal when it's ≥10 % OR ≥500 kr under, so both numbers matter.
  type Deal = { t: string; dealPct: number; dealKr: number };
  const realDeals: Deal[] = [...wishItems.felles, ...wishItems.andreas, ...wishItems.taran]
    .filter(w => !w.on && typeof w.dealPct === 'number')
    .map(w => ({
      t: w.t,
      dealPct: w.dealPct!,
      dealKr: typeof w.dealAvg30 === 'number' && typeof w.price === 'number' ? w.dealAvg30 - w.price : 0,
    }))
    // Same threshold as the cron, applied on display too: hides stale deals
    // flagged under the old 1 % rule until the next cron run re-evaluates them.
    .filter(d => d.dealPct >= 5 || d.dealKr >= 500)
    .sort((a, b) => b.dealKr - a.dealKr);
  const demoDeal = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dealdemo');
  const deals: Deal[] = realDeals.length ? realDeals : demoDeal ? [{ t: 'Sony WH-1000XM5', dealPct: 23, dealKr: 920 }] : [];
  // Rotate through multiple deals every 8s (now ticks every second)
  const activeDeal = deals.length ? deals[Math.floor(now.getTime() / 8000) % deals.length] : null;

  // "Ta ut plast" clock-box state. All date comparisons are plain yyyy-mm-dd
  // string equality — no Date-object arithmetic on "today" — so there's no
  // timezone/DST off-by-one to get wrong. today/pickupDate/dayBeforeDate are
  // all produced the same way the cron produces them (Europe/Oslo calendar
  // date, or UTC-component date math for "one day back"), so a string match
  // here is exactly the day match the server means.
  //   dayBeforeDate < today < pickupDate  → normal (too early)
  //   today === dayBeforeDate             → "dagen før" state
  //   today === pickupDate                → "hentedag" state
  //   today > pickupDate                  → normal (this cycle's pickup is
  //                                          in the past; tommeplan already
  //                                          only lists pickups >= today, so
  //                                          this case can't actually occur)
  const plastAlert = (() => {
    if (tommeplanError || !tommeplan) return null;
    const nextPlast = tommeplan.pickups.find(p => p.types.some(t => t.category === 'plast'));
    if (!nextPlast) return null;

    const pickupDate = nextPlast.date; // yyyy-mm-dd
    const [py, pm, pd] = pickupDate.split('-').map(Number);
    const dayBeforeDate = new Date(Date.UTC(py, pm - 1, pd - 1)).toISOString().slice(0, 10);
    const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });

    const isDayBefore = today === dayBeforeDate;
    const isPickupDay = today === pickupDate;
    if (!isDayBefore && !isPickupDay) return null;

    // Same (title, deadline) pair the cron writes — deadline is always the
    // day-before date, on both the "dagen før" and "hentedag" days.
    const done = todos.some(t => t.title === 'Ta ut plast' && t.deadline === dayBeforeDate && t.done);
    return { urgent: !done, label: isPickupDay ? 'Plast hentes i dag ⚠️' : 'Plast hentes i morgen ⚠️' };
  })();

  // Vær-popupen: i dag (weather.hourly) eller en bestemt dag (weather.daily[n]).
  const wDay = weatherDay > 0 ? weather?.daily?.[weatherDay] ?? null : null;
  const wHours = wDay ? wDay.hours : weather?.hourly;
  const wSunrise = wDay ? wDay.sunrise : weather?.sunrise;
  const wSunset  = wDay ? wDay.sunset  : weather?.sunset;

  // Nordlys-popupen: «nå» (hourly, neste 20 timer) eller en bestemt natt (daily[n].hours).
  const popupNight = auroraNight > 0 ? aurora?.daily?.[auroraNight] ?? null : null;
  const popupHours = popupNight ? popupNight.hours : aurora?.hourly;
  const popupBest  = popupNight?.best ?? null;
  const popupUncertain = !!popupNight && (popupNight.status !== 'ok' || !popupBest);

  return (
    <div style={{
      boxSizing: 'border-box', background: 'var(--bg)',
      ...(isTablet ? { height: `${viewportH}px`, overflow: 'hidden' } : { minHeight: '100vh' }),
      display: 'flex', flexDirection: 'column', padding: tabletPadding, gap: tabletGap,
      overflowX: 'hidden',
    }}>

      {/* ── Topbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', ...(isTablet ? { flex: '0 0 auto' } : {}) }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 4,
          color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: isMobile ? 12 : 13,
          padding: '5px 12px', cursor: 'default', letterSpacing: '0.04em',
        }}>← Hjem</button>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? 12 : 14, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '0.1em', textTransform: 'uppercase', flex: 1, textAlign: 'center' }}>
          {isMobile ? 'Skjerm' : 'Hjem · Oversikt'}
        </div>
        {isMobile ? <div /> : (
          <button onClick={() => setTreningRegisterOpen(true)} style={{
            background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 4,
            color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 13,
            padding: '5px 12px', cursor: 'pointer', letterSpacing: '0.04em',
          }}>🏋️ Registrer trening</button>
        )}
      </div>

      {/* ── Row 1: Clock (m. tømmeplan) · Weather ── (compact — natural height, no stretch) */}
      <div style={{ display: 'grid', gridTemplateColumns: (isMobile || isNarrowTablet) ? '1fr 1fr' : '1.3fr 1.4fr', gap: tabletGap, ...(isTablet ? { flex: '0 0 auto' } : {}) }}>

        {/* Clock */}
        <div style={{
          // Fixed red (not the theme-flipping var(--danger), whose dark-mode
          // value is too light to keep the box's white text readable) —
          // "ta ut plast i kveld/nå" is un-done and due tonight or today.
          background: plastAlert?.urgent ? '#C0392B' : 'var(--ink-fixed)',
          borderRadius: 8, padding: isMobile ? m.pad : screenSize === 'tablet' ? '10px 14px' : screenSize === 'desktop' ? '28px 32px' : '20px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: isMobile ? 4 : screenSize === 'tablet' ? 3 : 8, position: 'relative', overflow: 'hidden', ...(isMobile ? { minWidth: 0 } : {}),
        }}>
          <div style={eyebrowDark}>Tid nå</div>
          <div style={{ display: 'flex', alignItems: 'baseline', lineHeight: 1 }}>
            <span style={{ fontSize: isMobile ? m.clockNum : screenSize === 'desktop' ? 80 : screenSize === 'tablet' ? 36 : 56, fontWeight: isMobile ? 400 : 300, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', color: '#E8EFF7' }}>{timeStr}</span>
            <span style={{ fontSize: isMobile ? m.clockSec : screenSize === 'desktop' ? 32 : screenSize === 'tablet' ? 15 : 24, fontWeight: 300, color: 'rgba(207,224,239,0.4)', marginLeft: 6, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{secStr}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : screenSize === 'tablet' ? 10 : 16, color: 'rgba(207,224,239,0.5)', letterSpacing: '0.03em', ...(isMobile ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}) }}>{dateStr}</div>

          {/* Tømmeplan — slått sammen inn i klokke-boksen, én diskret linje.
              Ingen feilmelding/placeholder her hvis dataene mangler — den
              tar bare ikke plass når det ikke er noe å vise. */}
          {!tommeplanError && tommeplan && (() => {
            const nextPlast = tommeplan.pickups.find(p => p.types.some(t => t.category === 'plast'));
            if (!nextPlast) return null;
            return (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : screenSize === 'tablet' ? 11 : 15, color: 'rgba(207,224,239,0.4)', letterSpacing: '0.02em', marginTop: isMobile ? 4 : screenSize === 'tablet' ? 6 : 10 }}>
                {isMobile ? <>♻️ Plast: {nextPlast.weekday.slice(0, 3).toLowerCase()} {nextPlast.dateLabel}</> : <>♻️ Neste plast: {nextPlast.weekday} {nextPlast.dateLabel}</>}
              </div>
            );
          })()}

          {/* "Ta ut plast" er avhuket, men henting er i morgen/i dag — hold
              det synlig litt til med en rød påminnelse selv om boksen ikke
              lenger trenger å rope med hele bakgrunnen. */}
          {plastAlert && !plastAlert.urgent && (
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: isMobile ? m.mono : screenSize === 'tablet' ? 11 : 15, color: '#F87171', letterSpacing: '0.02em', marginTop: isMobile ? 4 : screenSize === 'tablet' ? 6 : 10 }}>
              {plastAlert.label}
            </div>
          )}

          {/* Deal notice — Hallgeir peeks up when a wishlist item hits a 30-day low */}
          {activeDeal && !isMobile && (
            <div style={{
              position: 'absolute', top: 0, right: 0, bottom: 0,
              width: isTablet ? 220 : 330, display: 'flex', alignItems: 'center',
              justifyContent: 'flex-end', gap: 4, paddingRight: 10, pointerEvents: 'none',
            }}>
              <div style={{ animation: 'deal-pop 0.45s ease both', textAlign: 'right', maxWidth: isTablet ? 124 : 188 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: isTablet ? 10 : 12, fontWeight: 700, color: '#7AB394', letterSpacing: '0.08em' }}>💸 PÅ DEALS</div>
                <div style={{ fontSize: isTablet ? 14 : 18, fontWeight: 700, color: '#E8EFF7', lineHeight: 1.15, marginTop: 2 }}>{activeDeal.t} er på deals!</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: isTablet ? 10 : 12, color: 'rgba(207,224,239,0.55)', marginTop: 3, lineHeight: 1.3 }}>
                  Ned <span style={{ color: '#7AB394', fontWeight: 700 }}>{activeDeal.dealPct}%</span>
                  {activeDeal.dealKr > 0 && <> · <span style={{ color: '#7AB394', fontWeight: 700 }}>{activeDeal.dealKr.toLocaleString('nb-NO')} kr</span></>} mot snittet siste 30 dager
                </div>
              </div>
              <div style={{
                alignSelf: 'flex-end', flexShrink: 0,
                width: isTablet ? 82 : 120, height: isTablet ? 66 : 97,
                overflow: 'hidden', animation: 'hallgeir-bob 3.2s ease-in-out 0.7s infinite',
              }}>
                {/* Clip window shows only the top of the photo, so he peeks up over the box's edge */}
                <img src="/hallgeir.png" alt="Hallgeir Kvadsheim" style={{
                  width: '100%', display: 'block', transformOrigin: 'bottom',
                  animation: 'hallgeir-peek 0.65s cubic-bezier(0.18,0.9,0.32,1.2) both',
                }} />
              </div>
            </div>
          )}
        </div>

        {/* Weather */}
        <WeatherCard
          weather={weather} resetSignal={idleTick}
          onToggle={off => {
            if (off === 0) {
              setWeatherDay(0);
              if (weather) setWeatherOpen(v => !v);
            } else if ((weather?.daily?.[off]?.hours.length ?? 0) >= 2) {
              // Offset 1–2: timegrafen for den dagen (daily[off].hours, 6-timers steg der Yr mangler timesdata).
              setWeatherDay(off);
              setWeatherOpen(true);
            }
          }}
          isMobile={isMobile} screenSize={screenSize} cell={cell} eyebrow={eyebrow}
        />
      </div>

      {/* ── Row 2: Dagens middag + Nedtelling + Nordlysvarsel ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: tabletGap, ...(isTablet ? { flex: '0 0 auto' } : {}) }}>

        {/* Dagens middag — fra ukeplanen (Middag → Ukeplan). Kompakt, kun navn —
            trykk åpner en modal med full oppskrift (ingredienser/fremgangsmåte/koketid). */}
        <MiddagCard
          mealPlan={mealPlan} recipes={recipes} today={today} resetSignal={idleTick}
          onOpenRecipe={setRecipeModalDate}
          isMobile={isMobile} screenSize={screenSize} cell={cell} eyebrow={eyebrow}
        />

        {/* Countdown */}
        <NedtellingCard
          countdowns={upcomingCds} today={todayOslo} resetSignal={idleTick} loading={cdLoading}
          editing={cdEditing} draft={cdDraft} setDraft={setCdDraft}
          onToggleEdit={handleToggleEditCd} onAdd={handleAddCd} onSave={handleSaveCd}
          onCancel={() => setCdEditing(false)} onRemove={handleRemoveCd}
          follow={cdFollow} onFollowed={() => setCdFollow(null)}
          isMobile={isMobile} screenSize={screenSize} cell={cell} eyebrow={eyebrow}
        />

        {/* Nordlys — Kp-indeks fra NOAA (observert, ikke flerdags-prognose)
            kombinert med skydekke fra Yr/met.no for Bodø. Ren heuristikk, ikke
            et offisielt varsel — se api/nordlys.ts for poengmodellen. Klikk
            åpner en 20-timers prognosegraf, samme mønster som Vær-boksen. */}
        <NordlysCard
          aurora={aurora} auroraError={auroraError} resetSignal={idleTick}
          onToggle={off => {
            if (off === 0) {
              setAuroraNight(0);
              if ((aurora?.hourly?.length ?? 0) >= 2) setAuroraOpen(v => !v);
            } else if ((aurora?.daily?.[off]?.hours.length ?? 0) >= 2) {
              // Offset 1–2: timegrafen for den natten (daily[off].hours); ingen graf uten nok timer.
              setAuroraNight(off);
              setAuroraOpen(true);
            }
          }}
          isMobile={isMobile} screenSize={screenSize} cell={cell} eyebrow={eyebrow}
        />
      </div>

      {/* ── Row 3: Kalender (i dag) + Gjøremål (i dag) + Handleliste — grows to fill ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: tabletGap, ...(isTablet ? {
        flex: 1, minHeight: 0, gridTemplateRows: 'minmax(0, 1fr)', overflow: 'hidden',
        // overflow:hidden her ville klippe gløden rundt Kalender-kortet (swipeGlow). Padding = glødens
        // utstrekning og lik negativ margin gir nøyaktig samme størrelse og plassering på alle kortene,
        // men flytter klippekanten utenfor gløden.
        padding: glowBleed(screenSize), margin: -glowBleed(screenSize),
      } : {}) }}>

        {/* Kalender — i dag som standard, sveipbar fremover (useSwipePager) */}
        <KalenderCard
          calEvents={calEvents} today={today} resetSignal={idleTick} isMobile={isMobile} isTablet={isTablet} screenSize={screenSize}
          cell={cell} eyebrow={eyebrow}
        />

        {/* Gjøremål — alle aktive, gruppert etter frist (Forfalt / I dag / Denne uken / Senere / Uten frist), med avkrysning + skjermbredt konfetti */}
        <div style={{ ...cell, minWidth: 0, ...(isTablet ? { minHeight: 0 } : {}), padding: isMobile ? m.pad : screenSize === 'tablet' ? '8px 10px' : screenSize === 'desktop' ? '20px 24px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: isMobile ? 10 : screenSize === 'tablet' ? 6 : 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={eyebrow}>✅ Gjøremål</div>
              <AddButton onClick={() => setTodoQuickAddOpen(true)} label="Nytt gjøremål" />
            </div>
            {activeTodoRows.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.micro : 13, color: 'var(--ink-4)' }}>{activeTodoRows.length}</span>
            )}
          </div>

          {activeTodoRows.length === 0 ? (
            <div style={{ padding: isMobile ? '16px 0' : '20px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 15, color: 'var(--ink-4)' }}>
              Ingen aktive gjøremål
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column',
              overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
              ...(isTablet
                ? { flex: 1, minHeight: 0 }
                : isMobile ? {} : { maxHeight: screenSize === 'desktop' ? 320 : 260 }),
            }}>
              {activeTodoRows.map((row, i) => {
                const firstInGroup = i === 0 || activeTodoRows[i - 1].timing.bucket !== row.timing.bucket;
                const overdue = row.timing.bucket === 'forfalt';
                return (
                  <Fragment key={row.todoId}>
                    {firstInGroup && (
                      <TodoGroupHeader bucket={row.timing.bucket} count={bucketCounts[row.timing.bucket]} first={i === 0} isMobile={isMobile} />
                    )}
                    {editingTodo === row.todoId ? (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                        padding: '9px 10px', marginBottom: 2, borderRadius: 4,
                        borderLeft: `3px solid ${row.color}`,
                        background: 'var(--surface-2)',
                      }}>
                        <input className="input" value={todoDraft.title} autoFocus
                          placeholder="Navn på gjøremål"
                          onChange={ev => setTodoDraft(d => ({ ...d, title: ev.target.value }))}
                          onKeyDown={ev => { if (ev.key === 'Enter') saveEditTodo(); if (ev.key === 'Escape') setEditingTodo(null); }}
                          style={{ flex: '1 1 160px', minWidth: 0 }} />
                        <input className="input" type="date" value={todoDraft.deadline}
                          onChange={ev => setTodoDraft(d => ({ ...d, deadline: ev.target.value }))}
                          onKeyDown={ev => { if (ev.key === 'Enter') saveEditTodo(); if (ev.key === 'Escape') setEditingTodo(null); }}
                          style={{ flex: '0 0 auto', width: 'auto' }} />
                        <button className="btn primary sm" onClick={saveEditTodo}>Lagre</button>
                        <button className="btn ghost sm" onClick={() => setEditingTodo(null)}>Avbryt</button>
                      </div>
                    ) : (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: isMobile ? m.rowGap : 14,
                        padding: isMobile ? m.rowPad : '9px 10px', marginBottom: 2, borderRadius: 4,
                        borderLeft: `3px solid ${row.color}`,
                        background: overdue ? 'color-mix(in oklab, var(--due-over) 14%, transparent)' : 'rgba(120,120,120,0.08)',
                      }}>
                        <ScreenCheck
                          checked={completingTodos.has(row.todoId)}
                          onClick={(ev) => completeTodo(row.todoId, row.title, ev.currentTarget)}
                          label={`Fullfør «${row.title}»`}
                        />
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            onClick={() => startEditTodo(row.todoId)}
                            title="Trykk for å endre navn/frist"
                            style={{
                              fontSize: isMobile ? m.title : 18, fontWeight: 600, cursor: 'pointer',
                              ...(isMobile ? { overflowWrap: 'anywhere' } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                            }}>
                            {row.title}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.tiny : 12, fontWeight: 600, color: row.whoColor }}>
                            {row.who}
                          </span>
                        </div>
                        <DuePill timing={row.timing} isMobile={isMobile} />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Handleliste — utdrag, med touch-scroll (vertikal). Full redigering på Handleliste-siden. */}
        <div style={{ ...cell, minWidth: 0, ...(isTablet ? { minHeight: 0 } : {}), padding: isMobile ? m.pad : screenSize === 'tablet' ? '8px 10px' : screenSize === 'desktop' ? '20px 22px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: isMobile ? 10 : screenSize === 'tablet' ? 6 : 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={eyebrow}>🛒 Handleliste</div>
              <AddButton onClick={() => setGroceryQuickAddOpen(true)} label="Legg til vare" />
            </div>
            {previewRows.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.micro : 12, color: 'var(--ink-4)' }}>{previewRows.length} varer</span>
            )}
          </div>
          {previewRows.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.mono : 13, color: 'var(--ink-4)' }}>Ingenting på handlelisten</div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
              ...(isTablet
                ? { flex: 1, minHeight: 0 }
                : isMobile ? {} : { maxHeight: screenSize === 'desktop' ? 320 : 260 }),
            }}>
              {previewRows.map(r => (
                <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ScreenCheck checked={false} onClick={r.toggle} label={`Merk «${r.name}» som kjøpt`} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: isMobile ? m.body : 15, ...(isMobile ? { overflowWrap: 'anywhere' } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>{r.name}</span>
                  {(r.amount != null || r.unit) && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: isMobile ? m.micro : 12, color: 'var(--ink-4)', flexShrink: 0 }}>
                      {r.amount ?? ''}{r.approx ? '+' : ''} {r.unit ?? ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Year ticker ── */}
      <div style={{ paddingTop: 4, ...(isTablet ? { flex: '0 0 auto' } : {}) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, ...(isMobile ? { flexWrap: 'wrap', gap: 4 } : {}) }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:isMobile ? m.micro : 14, fontWeight: 700, color:'var(--ink-4)', letterSpacing:'0.1em', textTransform:'uppercase' }}>{now.getFullYear()}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:isMobile ? m.micro : 14, color:'var(--ink-3)', letterSpacing:'0.06em' }}>Dag {daysElapsed} av {daysInYear} · {yearPct.toFixed(1).replace('.',',')}%</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:isMobile ? m.micro : 14, fontWeight: 700, color:'var(--ink-4)', letterSpacing:'0.1em', textTransform:'uppercase' }}>{daysLeft} dager igjen</span>
        </div>
        <div style={{ position: 'relative', height: 3, background: 'var(--line)', borderRadius: 2 }}>
          <div style={{ width: yearPct+'%', height: '100%', background: 'var(--ink-3)', borderRadius: 2, transition: 'width 1s linear' }} />
        </div>
      </div>

      {/* ── Hourly weather popup ── */}
      {weatherOpen && weather && (
        <div
          onClick={() => setWeatherOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', ...(isMobile ? { padding: 12, overflowY: 'auto' } : {}) }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--ink-fixed)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: isMobile ? '18px 16px' : '28px 32px', width: 860, maxWidth: isMobile ? '100%' : 'calc(100vw - 48px)', display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20, ...(isMobile ? { maxHeight: viewportH - 24, overflowY: 'auto' } : {}) }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Vær · Bodø · Time for time</div>
                <div style={{ fontSize: 22, fontWeight: 300, marginTop: 6, color: '#E8EFF7', letterSpacing: '-0.01em' }}>
                  {(wDay ? new Date(wDay.date + 'T12:00:00') : now).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
              </div>
              <button
                onClick={() => setWeatherOpen(false)}
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'default', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
              >✕</button>
            </div>

            {/* Summary */}
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 20, paddingBottom: isMobile ? 14 : 20, borderBottom: '1px solid rgba(255,255,255,0.08)', ...(isMobile ? { flexWrap: 'wrap' } : {}) }}>
              <WeatherIcon category={wDay ? wDay.category : weather.category} size={44} cloud="rgba(207,224,239,0.92)" cloudLine="rgba(207,224,239,0.5)" />
              <div>
                <div style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.03em', color: '#E8EFF7', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {wDay ? wDay.max : weather.temp}<span style={{ fontSize: 20, opacity: 0.4 }}>°</span>
                  {!wDay && <span style={{ fontSize: 18, color: 'rgba(207,224,239,0.4)', marginLeft: 14 }}>føles {weather.feelsLike}°</span>}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)', marginTop: 6 }}>
                  {wDay ? `${wDay.description} · vind ${wDay.windMax} m/s` : `${weather.description} · vind ${weather.wind} m/s`}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: isMobile ? 16 : 28, ...(isMobile ? { flexWrap: 'wrap', marginLeft: 0 } : {}) }}>
                {[
                  { label: 'Min / Maks', val: wDay ? `${wDay.min}° / ${wDay.max}°` : `${weather.todayMin}° / ${weather.todayMax}°`, color: '#E8EFF7' },
                  ...((wDay ? wDay.precip : weather.todayPrecip) > 0 ? [{ label: 'Nedbør', val: `${wDay ? wDay.precip : weather.todayPrecip} mm`, color: 'var(--accent)' }] : []),
                  ...(wSunrise ? [{ label: '↑ Sol', val: wSunrise, color: '#E8EFF7' }] : []),
                  ...(wSunset  ? [{ label: '↓ Sol', val: wSunset,  color: '#E8EFF7' }] : []),
                ].map(r => (
                  <div key={r.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{r.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: r.color }}>{r.val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Chart */}
            {wHours && wHours.length >= 2 && (
              isMobile ? (
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <div style={{ minWidth: 560 }}>
                    <HourlyChart hourly={wHours} now={now} sunrise={wSunrise} sunset={wSunset} showNow={!wDay} />
                  </div>
                </div>
              ) : (
                <HourlyChart hourly={wHours} now={now} sunrise={wSunrise} sunset={wSunset} showNow={!wDay} />
              )
            )}

            {/* Legend */}
            <div style={{ display: 'flex', gap: isMobile ? 12 : 24, ...(isMobile ? { flexWrap: 'wrap' } : {}), fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.35)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 22, height: 2, background: '#F97316', borderRadius: 1 }} />
                Temperatur
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#6BA9D6', borderRadius: 2, opacity: 0.65 }} />
                Nedbør
              </span>
              {!wDay && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 0, height: 14, borderLeft: '1.5px dashed rgba(255,255,255,0.4)' }} />
                  Nå
                </span>
              )}
              {(wSunrise || wSunset) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 0, height: 14, borderLeft: '1px dashed rgba(251,191,36,0.5)' }} />
                  Soloppgang / nedgang
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 20-timers nordlysprognose ── */}
      {auroraOpen && aurora && popupHours && popupHours.length >= 2 && (
        <div
          onClick={() => setAuroraOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', ...(isMobile ? { padding: 12, overflowY: 'auto' } : {}) }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--ink-fixed)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: isMobile ? '18px 16px' : '28px 32px', width: 860, maxWidth: isMobile ? '100%' : 'calc(100vw - 48px)', display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20, ...(isMobile ? { maxHeight: viewportH - 24, overflowY: 'auto' } : {}) }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', ...(isMobile ? { flexWrap: 'wrap', gap: 10 } : {}) }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {popupNight ? `Nordlys · Bodø · Natt fra ${dateLabel(popupNight.date)}` : 'Nordlys · Bodø · Neste 20 timer'}
                </div>
                {popupNight ? (
                  <div style={{ fontSize: 22, fontWeight: 300, marginTop: 6, color: popupUncertain || !popupBest ? 'var(--ink-4)' : AURORA_COLOR[popupBest.chance], letterSpacing: '-0.01em' }}>
                    {popupUncertain || !popupBest ? 'Usikkert varsel' : `${AURORA_LABEL[popupBest.chance]} · best ca. ${new Date(popupBest.time).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                ) : (
                  <div style={{ fontSize: 22, fontWeight: 300, marginTop: 6, color: AURORA_COLOR[aurora.probability], letterSpacing: '-0.01em' }}>
                    {AURORA_LABEL[aurora.probability]} akkurat nå
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div role="tablist" style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, overflow: 'hidden' }}>
                  {([['sannsynlighet', 'Sannsynlighet'], ['kp', 'Kp-indeks']] as [AuroraView, string][]).map(([v, label]) => (
                    <button key={v} role="tab" aria-selected={auroraView === v}
                      onClick={() => setAuroraView(v)}
                      style={{ border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '6px 12px',
                        background: auroraView === v ? 'rgba(255,255,255,0.16)' : 'transparent',
                        color: auroraView === v ? '#E8EFF7' : 'rgba(207,224,239,0.5)' }}
                    >{label}</button>
                  ))}
                </div>
              <button
                onClick={() => setAuroraOpen(false)}
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'default', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
              >✕</button>
              </div>
            </div>

            {/* Summary */}
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 16 : 28, paddingBottom: isMobile ? 14 : 20, borderBottom: '1px solid rgba(255,255,255,0.08)', ...(isMobile ? { flexWrap: 'wrap' } : {}) }}>
              {[
                { label: 'Kp', val: popupNight ? (popupBest ? String(Math.round(popupBest.kp * 10) / 10) : '–') : String(aurora.kp), color: '#E8EFF7' },
                { label: 'Skydekke', val: popupNight ? (popupBest ? `${popupBest.cloudCover}%` : '–') : `${aurora.cloudCover}%`, color: '#E8EFF7' },
              ].map(r => (
                <div key={r.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{r.label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: r.color }}>{r.val}</div>
                </div>
              ))}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(207,224,239,0.4)', maxWidth: 340, lineHeight: 1.5 }}>
                  Kp: NOAA 3-døgnsprognose · 3-timers intervaller
                  <br />
                  Skydekke: Yr · time for time
              </div>
            </div>

            {/* Chart */}
            {isMobile ? (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <div style={{ minWidth: 560 }}>
                  <AuroraHourlyChart hourly={popupHours} view={auroraView} nowLabel={!popupNight} />
                </div>
              </div>
            ) : (
              <AuroraHourlyChart hourly={popupHours} view={auroraView} nowLabel={!popupNight} />
            )}

            {/* Legend */}
            <div style={{ display: 'flex', gap: isMobile ? 12 : 24, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.35)' }}>
              {auroraView === 'kp'
                ? (['hoy', 'middels', 'lav'] as KpLevel[]).map(l => (
                    <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, background: KP_LEVEL_COLOR[l], borderRadius: 2 }} />
                      {KP_LEVEL_LABEL[l]}
                    </span>
                  ))
                : (['høy', 'middels', 'lav'] as AuroraChance[]).map(c => (
                    <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, background: AURORA_CHANCE_COLOR[c], borderRadius: 2 }} />
                      {AURORA_LABEL[c]}
                    </span>
                  ))}
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: AURORA_DAYLIGHT_BAR, borderRadius: 2 }} />
                Dagslys — ikke synlig
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Dagens middag: full oppskrift ── */}
      {recipeModalDate && modalRecipe && (
        <div
          onClick={() => setRecipeModalDate(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 12 : 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--ink-fixed)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: isMobile ? '18px 16px' : '28px 32px', width: 640, maxWidth: isMobile ? '100%' : 'calc(100vw - 48px)', maxHeight: isMobile ? viewportH - 24 : 'calc(100vh - 48px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{recipeModalDate === today ? 'Dagens middag' : `Middag · ${dateLabel(recipeModalDate)}`}</div>
                <div style={{ fontSize: 26, fontWeight: 300, marginTop: 6, color: '#E8EFF7', letterSpacing: '-0.01em' }}>{modalRecipe.name}</div>
                {modalRecipe.cookTimeMinutes != null && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)', marginTop: 6 }}>⏱ {modalRecipe.cookTimeMinutes} min</div>
                )}
              </div>
              <button
                onClick={() => setRecipeModalDate(null)}
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'default', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
              >✕</button>
            </div>

            {modalRecipe.ingredients.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Ingredienser</div>
                {modalDays > 1 && (
                  <div style={{ fontSize: 13, color: '#C9963A', marginBottom: 10 }}>
                    Mengder for {modalDays} dager ({modalRange})
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {modalRecipe.ingredients.map((ing, i) => {
                    const qty = formatIngredientAmount(ing, modalDays);
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, ...(isMobile ? { flexWrap: 'wrap' } : {}), fontSize: 15, color: '#E8EFF7', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <span>{ing.name}</span>
                        {qty && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)', flexShrink: 0 }}>
                            {qty}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {modalRecipe.instructions && (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Fremgangsmåte</div>
                <div style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(207,224,239,0.85)', whiteSpace: 'pre-wrap' }}>{modalRecipe.instructions}</div>
              </div>
            )}

            {modalRecipe.ingredients.length === 0 && !modalRecipe.instructions && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.4)' }}>Ingen detaljer lagt til for denne oppskriften ennå.</div>
            )}
          </div>
        </div>
      )}

      {/* ── Registrer trening (rask, fra headeren) ── */}
      {treningRegisterOpen && (
        <TreningQuickRegister categories={trCategories} onClose={() => setTreningRegisterOpen(false)} />
      )}

      {/* ── Nytt gjøremål (rask, fra Gjøremål-boksen) ── */}
      {todoQuickAddOpen && (
        <TodoQuickAddModal isMobile={isMobile} onClose={() => setTodoQuickAddOpen(false)} />
      )}

      <UndoToastStack
        toasts={undoToasts}
        onExpire={expireUndoToast}
        onRemoved={dropUndoToast}
        onUndo={undoGrocery}
      />

      {/* ── Legg til vare (rask, fra Handleliste-boksen) ── */}
      {groceryQuickAddOpen && (
        <GroceryQuickAddModal isMobile={isMobile} onClose={() => setGroceryQuickAddOpen(false)} />
      )}
    </div>
  );
}
