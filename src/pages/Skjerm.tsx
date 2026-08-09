import { useState, useEffect } from 'react';
import { useTodo, type Priority } from '../contexts/TodoContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useWish } from '../contexts/WishContext';
import { useCountdowns } from '../hooks/useCountdown';
import { useMatplan } from '../contexts/MatplanContext';
import { useTrening, type Trainer, type WorkoutCategory } from '../contexts/TreningContext';
import { WHO_LABEL, TRAINERS } from '../lib/treningPulse';
import { groupByNameUnit } from './middag/HandlelisteCard';
import { fireworkRain, burst } from '../confetti';
import type { CalEvent } from '../../api/kalender';

// ─── Helpers ───────────────────────────────────────────────────────────────

const EMPTY_COUNTDOWN_DRAFT = { label: '', date: '' };

interface HourlyEntry { hour: number; temp: number; precip: number; category: string; }

interface WasteType { name: string; category: 'plast' | 'mat' | 'papir' | 'rest' | 'glass' | 'hage' | 'annet'; }
interface Pickup { date: string; weekday: string; dateLabel: string; types: WasteType[]; }
interface TommeplanData { address: string; pickups: Pickup[]; updatedAt: string; }

type AuroraChance = 'lav' | 'middels' | 'høy';
interface AuroraData { kp: number; kpTime: string; cloudCover: number; probability: AuroraChance; updatedAt: string; }

const AURORA_COLOR: Record<AuroraChance, string> = { lav: 'var(--ink-4)', middels: 'var(--warn)', høy: 'var(--good)' };
const AURORA_LABEL: Record<AuroraChance, string> = { lav: 'Lav sjanse', middels: 'Middels sjanse', høy: 'Høy sjanse' };

interface WeatherData {
  temp: number;
  feelsLike: number;
  wind: number;
  category: 'clear' | 'fair' | 'cloudy' | 'rain' | 'snow' | 'thunder' | 'fog';
  description: string;
  todayMin: number;
  todayMax: number;
  todayPrecip: number;
  todayCategory: string;
  sunrise: string;
  sunset: string;
  hourly?: HourlyEntry[];
}

function WeatherIcon({ category, size = 56, cloud = 'var(--wx-cloud)', cloudLine = 'var(--wx-cloud-line)' }: { category: string; size?: number; cloud?: string; cloudLine?: string }) {
  const s = size;
  if (category === 'clear') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="10" fill="var(--warn)" opacity="0.85" />
      {[0,45,90,135,180,225,270,315].map(a => (
        <line key={a} x1={28+15*Math.cos(a*Math.PI/180)} y1={28+15*Math.sin(a*Math.PI/180)}
          x2={28+20*Math.cos(a*Math.PI/180)} y2={28+20*Math.sin(a*Math.PI/180)}
          stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      ))}
    </svg>
  );
  if (category === 'fair') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <circle cx="22" cy="20" r="7" fill="var(--warn)" opacity="0.75" />
      {[0,60,120,180,240,300].map(a => (
        <line key={a} x1={22+10*Math.cos(a*Math.PI/180)} y1={20+10*Math.sin(a*Math.PI/180)}
          x2={22+14*Math.cos(a*Math.PI/180)} y2={20+14*Math.sin(a*Math.PI/180)}
          stroke="var(--warn)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      ))}
      <path d="M 16 42 Q 12 42 12 36 Q 12 30 20 30 Q 22 22 32 22 Q 42 22 44 32 Q 52 32 52 39 Q 52 44 46 44 L 20 44 Q 16 44 16 42 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
    </svg>
  );
  if (category === 'rain') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <path d="M 12 34 Q 8 34 8 27 Q 8 20 17 20 Q 19 12 29 12 Q 39 12 41 22 Q 50 22 50 30 Q 50 36 44 36 L 16 36 Q 12 36 12 34 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
      {[[16,44],[24,40],[32,44],[20,50],[28,48]].map(([x,y],i) => (
        <line key={i} x1={x} y1={y-5} x2={x-2} y2={y} stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      ))}
    </svg>
  );
  if (category === 'snow') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <path d="M 12 34 Q 8 34 8 27 Q 8 20 17 20 Q 19 12 29 12 Q 39 12 41 22 Q 50 22 50 30 Q 50 36 44 36 L 16 36 Q 12 36 12 34 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
      {[[16,44],[24,40],[32,44],[20,50],[28,48]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="2" fill="var(--accent)" opacity="0.6" />
      ))}
    </svg>
  );
  if (category === 'thunder') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <path d="M 12 34 Q 8 34 8 27 Q 8 20 17 20 Q 19 12 29 12 Q 39 12 41 22 Q 50 22 50 30 Q 50 36 44 36 L 16 36 Q 12 36 12 34 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
      <polyline points="30,38 24,47 29,47 23,56" fill="none" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  // cloudy / fog / default
  return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <path d="M 8 38 Q 4 38 4 31 Q 4 24 13 24 Q 15 16 25 16 Q 35 16 37 26 Q 46 26 46 34 Q 46 40 40 40 L 12 40 Q 8 40 8 38 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
      {category === 'fog' && [28,34,40].map(y => (
        <line key={y} x1="8" y1={y+6} x2="46" y2={y+6} stroke={cloudLine} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      ))}
    </svg>
  );
}

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

function HourlyChart({ hourly, now, sunrise, sunset }: {
  hourly: HourlyEntry[]; now: Date; sunrise?: string; sunset?: string;
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

  // Adaptive label interval: every 1h if there's room, 2h or 3h when crowded
  const spacing = n > 1 ? pW / (n - 1) : pW;
  const labelEvery = spacing >= 50 ? 1 : spacing >= 25 ? 2 : 3;

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
      <line x1={xi(curIdx)} y1={padT - 6} x2={xi(curIdx)} y2={iconCy + iconH / 2} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="4,3" />

      {/* ── Dots + labels every labelEvery h + current ── */}
      {hourly.map((h, i) => {
        if (h.hour % labelEvery !== 0 && i !== curIdx) return null;
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
      {hourly.filter(h => h.hour % labelEvery === 0).map(h => {
        const i = hourly.findIndex(hh => hh.hour === h.hour);
        if (i < 0) return null;
        return <MiniIcon key={h.hour} category={h.category} cx={xi(i)} cy={iconCy} />;
      })}

      {/* ── X-axis: hour labels ── */}
      {hourly.filter(h => h.hour % labelEvery === 0).map(h => {
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

const SOURCE_COLOR: Record<string, string> = {
  andreas: '#4A80C4', taran: '#6B2FA0', felles: '#7AB394', todo: '#C9963A',
};
const PRIORITY_COLOR: Record<string, string> = {
  høy: '#C0392B', middels: '#C9963A', lav: 'var(--ink-4)',
};
const PRIORITY_ORDER: Record<Priority, number> = { høy: 0, middels: 1, lav: 2 };
const SOURCE_LABEL: Record<string, string> = {
  andreas: 'Andreas', taran: 'Taran', felles: 'Felles', todo: 'Gjøremål',
};

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr()    { return localIso(new Date()); }

function daysUntil(iso: string): number {
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(iso); d.setHours(0,0,0,0);
  return Math.ceil((d.getTime()-t.getTime())/86400000);
}

// Relative "forfalt" wording for overdue todos (overdueSince is today or in the past)
function fmtOverdue(iso: string): string {
  const n = daysUntil(iso);
  if (n === 0) return 'i dag';
  const days = Math.abs(n);
  return `${days} dag${days === 1 ? '' : 'er'} siden`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}


// ─── Combined event type ───────────────────────────────────────────────────

interface AnyEvent {
  id: string; title: string; start: string; end?: string;
  allDay: boolean; source: string; color: string; who?: string;
  overdueSince?: string;
  todoId?: string; // present only for todo events — lets us check them off in place
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

// Rask registrering rett fra Gangskjerm — gjenbruker TreningContext sin
// registerSession() (samme logikk som Trening → Registrer), men bare
// kategori + hvem. Ingen dato/klokkeslett-felt: performedAt settes til nå,
// bevisst forenklet for et raskt trykk-og-ferdig-flow her, ikke fordi
// Trening.tsx sin fulle registreringsmodal er endret (den ventende
// «fjern klokkeslett»-endringen der er en egen, senere oppgave).
function TreningQuickRegister({ categories, onClose }: { categories: WorkoutCategory[]; onClose: () => void }) {
  const { registerSession } = useTrening();
  const { notify } = useSnackbar();
  const active = categories.filter(c => !c.archived);
  const [category, setCategory] = useState(active[0]?.name ?? '');
  const [who, setWho] = useState<Trainer>('M');
  const [saving, setSaving] = useState(false);

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
      if (el) { const r = el.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2); }
      notify(`Registrert · ${category} · ${WHO_LABEL[who]} 💪`);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--ink-fixed)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '28px 32px', width: 440, maxWidth: 'calc(100vw - 48px)', display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Huk av en økt</div>
            <div style={{ fontSize: 22, fontWeight: 300, marginTop: 6, color: '#E8EFF7', letterSpacing: '-0.01em' }}>Registrer trening</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'default', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
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
  const { mealPlan, recipes, groceryItems, toggleGroceryItem } = useMatplan();
  const [now, setNow]  = useState(new Date());
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [weather, setWeather]    = useState<WeatherData | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [treningRegisterOpen, setTreningRegisterOpen] = useState(false);
  const { categories: trCategories } = useTrening();
  const [tommeplan, setTommeplan]           = useState<TommeplanData | null>(null);
  const [tommeplanError, setTommeplanError] = useState(false);
  const [aurora, setAurora]           = useState<AuroraData | null>(null);
  const [auroraError, setAuroraError] = useState(false);
  const { items: countdowns, add: addCd, update: updateCd, remove: removeCd, restore: restoreCd, loading: cdLoading } = useCountdowns();
  const cd = countdowns[0] ?? null;
  const [cdEditing, setCdEditing] = useState(false);
  const [cdDraft, setCdDraft]     = useState(cd ? { label: cd.label, date: cd.date } : EMPTY_COUNTDOWN_DRAFT);
  const [winW, setWinW] = useState(() => window.innerWidth);
  // iOS Safari's window.innerHeight/100vh includes space hidden behind the
  // address bar. visualViewport.height tracks what's actually visible right
  // now, so it survives the toolbar showing/hiding without a layout jump —
  // more reliable across iPadOS versions than the 100dvh unit alone.
  const [viewportH, setViewportH] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const [screenSize, setScreenSize] = useState<'mobile' | 'tablet' | 'desktop'>(() => {
    const w = window.innerWidth;
    if (w < 700) return 'mobile';
    if (w < 1400) return 'tablet';  // iPad Pro 12.9" (portrait 1024 / landscape 1366) → tablet mode
    return 'desktop';  // Only true desktops at 1400px+
  });

  useEffect(() => { if (!cdEditing) setCdDraft(cd ? { label: cd.label, date: cd.date } : EMPTY_COUNTDOWN_DRAFT); }, [cd, cdEditing]);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      setWinW(w);
      setViewportH(window.visualViewport?.height ?? window.innerHeight);
      if (w < 700) setScreenSize('mobile');
      else if (w < 1400) setScreenSize('tablet');  // iPad Pro 12.9" stays tablet
      else setScreenSize('desktop');  // True desktops only
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, []);

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

  const handleSaveCd = () => {
    if (!cdDraft.label.trim() || !cdDraft.date) return;
    if (cd) void updateCd(cd.id, { label: cdDraft.label.trim(), date: cdDraft.date });
    else void addCd({ label: cdDraft.label.trim(), date: cdDraft.date });
    setCdEditing(false);
  };

  const handleRemoveCd = () => {
    if (!cd) return;
    const prev = cd;
    void removeCd(cd.id);
    notify('Nedtelling fjernet', { actionLabel: 'Angre', onAction: () => void restoreCd(prev) });
  };

  const today = todayStr();
  const WHO: Record<string, string> = { f: 'Felles', M: 'Andreas', L: 'Taran' };

  // Gangskjerm viser nå kun i dag for kalenderhendelser — ikke kommende dager.
  const todayCalEvents: AnyEvent[] = calEvents
    .map(e => ({ ...e, source: e.source as string, overdueSince: undefined as string | undefined }))
    .filter(e => e.start.slice(0, 10) === today)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  // Gjøremål-boksen viser derimot ALLE aktive gjøremål, ikke bare dagens —
  // fjernet datofilteret fra forrige økt. Inkluderer også gjøremål uten
  // deadline (todoEvents/AnyEvent var kalender-hendelse-formet og krevde en
  // dato, så dette er en egen, enklere liste bygget direkte fra todos).
  interface TodoRow {
    todoId: string; title: string; color: string; who?: string;
    time?: string; overdueSince?: string; priority: Priority; deadline?: string;
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
      const overdueSince = !overdue ? undefined : (() => {
        const d = new Date(t.deadline! + 'T00:00:00');
        d.setDate(d.getDate() - t.overdue_days);
        return localIso(d);
      })();
      return {
        todoId: t.id, title: t.title,
        color: PRIORITY_COLOR[t.priority] ?? SOURCE_COLOR.todo,
        who: t.who !== 'f' ? WHO[t.who] : undefined,
        time: (!overdue && t.time) ? t.time : undefined,
        overdueSince, priority: t.priority, deadline: t.deadline,
      };
    })
    .sort((a, b) => {
      const aOvd = a.overdueSince ? 1 : 0;
      const bOvd = b.overdueSince ? 1 : 0;
      if (aOvd !== bOvd) return bOvd - aOvd;
      // Among overdue todos: longest overdue (earliest original deadline) first
      if (aOvd && bOvd) return a.overdueSince!.localeCompare(b.overdueSince!);
      // Otherwise: priority first, then soonest deadline, undated last
      const pOrder = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pOrder !== 0) return pOrder;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline) || (a.time ?? '').localeCompare(b.time ?? '');
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return a.title.localeCompare(b.title);
    });

  // Dagens middag — fra Middagsplanleggerens ukeplan (MatplanContext).
  const todayMealPlan = mealPlan.find(mp => mp.date === today);
  const todayRecipe   = todayMealPlan ? recipes.find(r => r.id === todayMealPlan.recipeId) : undefined;

  // Handleliste-forhåndsvisning — samme grupperingslogikk som HandlelisteCard
  // (src/pages/middag/HandlelisteCard.tsx) bruker, gjenbrukt her via
  // groupByNameUnit så middag-ingredienser fra flere planlagte middager denne
  // uken vises som én rad, ikke duplisert. Kun ukjøpte varer, ingen +/- eller
  // legg-til her — dette er et utdrag, full redigering skjer på Handleliste-siden.
  const previewFreeform = groceryItems.filter(g => !g.mealPlanId && !g.stapleItemId && !g.done);
  const previewMeals    = groupByNameUnit(groceryItems.filter(g => g.mealPlanId && !g.done));
  const previewStaples  = groceryItems.filter(g => g.stapleItemId && !g.done);
  const previewRows: { key: string; name: string; amount: number | null; unit: string | null; approx?: boolean; toggle: () => void }[] = [
    ...previewFreeform.map(g => ({ key: g.id, name: g.name, amount: g.amount, unit: g.unit, toggle: () => void toggleGroceryItem(g.id) })),
    ...previewMeals.map(group => ({ key: group.key, name: group.name, amount: group.amount, unit: group.unit, approx: group.approx, toggle: () => group.ids.forEach(id => void toggleGroceryItem(id)) })),
    ...previewStaples.map(g => ({ key: g.id, name: g.name, amount: g.amount, unit: g.unit, toggle: () => void toggleGroceryItem(g.id) })),
  ];

  const timeStr = now.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  const secStr  = now.toLocaleTimeString('nb-NO', { second: '2-digit' }).replace(/.*:/, '');
  const dateStr = now.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });

  const yearStart   = new Date(now.getFullYear(), 0, 1).getTime();
  const yearEnd     = new Date(now.getFullYear() + 1, 0, 1).getTime();
  const yearPct     = ((now.getTime() - yearStart) / (yearEnd - yearStart)) * 100;
  const daysElapsed = Math.floor((now.getTime() - yearStart) / 86400000) + 1;
  const daysInYear  = Math.round((yearEnd - yearStart) / 86400000);
  const daysLeft    = daysInYear - daysElapsed;

  const cdDays = cd ? daysUntil(cd.date) : 0;

  // The weekly "ting vi vil gjøre" reminder is shared across all devices and
  // rolls over the night into Monday — see useWeeklyBucket / api/cron/rollover.

  const cell: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
    overflow: 'hidden',
  };

  // Shared style for section eyebrow labels
  const eyebrow: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-4)',
  };
  const eyebrowDark: React.CSSProperties = {
    ...eyebrow, color: 'rgba(207,224,239,0.5)',
  };

  const isMobile = screenSize === 'mobile';
  const isTablet = screenSize === 'tablet';
  // iPad Pro 12.9": landscape = 1366px (wide), portrait = 1024px (narrow).
  // Narrow tablet reflows to fewer columns so nothing is cut off horizontally.
  const isNarrowTablet = isTablet && winW < 1200;
  const tabletPadding = screenSize === 'tablet' ? '8px 14px' : screenSize === 'desktop' ? '28px 36px' : '16px 20px';
  const tabletGap = screenSize === 'tablet' ? 8 : 24;

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
        <div style={{ background: 'var(--ink-fixed)', borderRadius: 8, padding: screenSize === 'tablet' ? '10px 14px' : screenSize === 'desktop' ? '28px 32px' : '20px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: screenSize === 'tablet' ? 3 : 8, position: 'relative', overflow: 'hidden' }}>
          <div style={eyebrowDark}>Tid nå</div>
          <div style={{ display: 'flex', alignItems: 'baseline', lineHeight: 1 }}>
            <span style={{ fontSize: screenSize === 'desktop' ? 80 : screenSize === 'tablet' ? 36 : 56, fontWeight: 300, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', color: '#E8EFF7' }}>{timeStr}</span>
            <span style={{ fontSize: screenSize === 'desktop' ? 32 : screenSize === 'tablet' ? 15 : 24, fontWeight: 300, color: 'rgba(207,224,239,0.4)', marginLeft: 6, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{secStr}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: screenSize === 'tablet' ? 10 : 16, color: 'rgba(207,224,239,0.5)', textTransform: 'capitalize', letterSpacing: '0.03em' }}>{dateStr}</div>

          {/* Tømmeplan — slått sammen inn i klokke-boksen, én diskret linje.
              Ingen feilmelding/placeholder her hvis dataene mangler — den
              tar bare ikke plass når det ikke er noe å vise. */}
          {!tommeplanError && tommeplan && (() => {
            const nextPlast = tommeplan.pickups.find(p => p.types.some(t => t.category === 'plast'));
            if (!nextPlast) return null;
            return (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: screenSize === 'tablet' ? 11 : 15, color: 'rgba(207,224,239,0.4)', letterSpacing: '0.02em', marginTop: screenSize === 'tablet' ? 6 : 10 }}>
                ♻️ Neste plast: {nextPlast.weekday} {nextPlast.dateLabel}
              </div>
            );
          })()}

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
        <div
          onClick={() => weather && setWeatherOpen(v => !v)}
          style={{ ...cell, padding: screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '28px 32px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: screenSize === 'tablet' ? 7 : 16, cursor: 'default' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={eyebrow}>Vær · Bodø</div>
            {weather && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--good)', letterSpacing: '0.06em' }}>● YR</div>}
          </div>

          {!weather ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--ink-4)' }}>…</div>
          ) : (
            <>
              {/* Top row: icon + temp/description  |  KLE PÅ SEG */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: screenSize === 'desktop' ? 20 : screenSize === 'tablet' ? 6 : 12 }}>
                  <WeatherIcon category={weather.category} size={screenSize === 'desktop' ? 64 : screenSize === 'tablet' ? 28 : 48} />
                  <div>
                    <div style={{ fontSize: screenSize === 'desktop' ? 64 : screenSize === 'tablet' ? 28 : 48, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                      {weather.temp}<span style={{ fontSize: screenSize === 'desktop' ? 28 : screenSize === 'tablet' ? 12 : 20, opacity: 0.4 }}>°</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color: 'var(--ink-2)', marginTop: 8 }}>{weather.description}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--ink-4)', marginTop: 3 }}>
                      føles {weather.feelsLike}° · vind {weather.wind} m/s
                    </div>
                  </div>
                </div>

                {/* KLE PÅ SEG — moved above the divider */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em', marginBottom: 5 }}>KLE PÅ SEG</div>
                  <div style={{ maxWidth: 220, textAlign: 'right' }}>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-2)', lineHeight: 1.35, textWrap: 'balance' } as React.CSSProperties}>{text}</span>
                          {spreadWarning && (
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-4)', lineHeight: 1.35, textWrap: 'balance' } as React.CSSProperties}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>MIN</span>
                      <span style={{ fontSize: 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{weather.todayMin}°</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>MAKS</span>
                      <span style={{ fontSize: 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{weather.todayMax}°</span>
                    </div>
                    {weather.todayPrecip > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>NEDBØR</span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                          <span style={{ fontSize: 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: 'var(--accent)' }}>{weather.todayPrecip}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color: 'var(--accent)', opacity: 0.7 }}>mm</span>
                        </span>
                      </div>
                    )}
                  </div>
                  {(weather.sunrise || weather.sunset) && (
                    <div style={{ display: 'flex', gap: 12 }}>
                      {weather.sunrise && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>↑ SOL</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{weather.sunrise}</span>
                        </div>
                      )}
                      {weather.sunset && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>↓ SOL</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{weather.sunset}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Row 2: Dagens middag + Nedtelling + Nordlysvarsel ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: tabletGap, ...(isTablet ? { flex: '0 0 auto' } : {}) }}>

        {/* Dagens middag — fra ukeplanen (Middag → Ukeplan). Kompakt, kun navn —
            trykk åpner en modal med full oppskrift (ingredienser/fremgangsmåte/koketid). */}
        <button
          onClick={() => { if (todayRecipe) setRecipeModalOpen(true); }}
          style={{
            ...cell, width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit',
            cursor: todayRecipe ? 'pointer' : 'default',
            padding: screenSize === 'tablet' ? '8px 12px' : screenSize === 'desktop' ? '14px 20px' : '12px 16px',
            display: 'flex', flexDirection: 'column', gap: screenSize === 'tablet' ? 3 : 4,
          }}
        >
          <div style={eyebrow}>🍽️ Dagens middag</div>
          {todayRecipe ? (
            <div style={{ fontSize: screenSize === 'desktop' ? 20 : screenSize === 'tablet' ? 13 : 17, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {todayRecipe.name}
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-4)' }}>Ingen middag planlagt i dag</div>
          )}
        </button>

        {/* Countdown */}
        <div style={{ ...cell, padding: screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '20px 22px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: screenSize === 'tablet' ? 6 : 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={eyebrow}>Nedtelling</div>
            {cd && (
              <div style={{ display: 'flex', gap: 2 }}>
                <button onClick={() => { setCdDraft({ label: cd.label, date: cd.date }); setCdEditing(e => !e); }}
                  aria-label="Rediger nedtelling"
                  style={{ background:'transparent', border:0, cursor:'pointer', color:'var(--ink-4)', fontSize: 16, padding:'2px 4px', lineHeight:1 }}>✎</button>
                <button onClick={handleRemoveCd}
                  aria-label="Fjern nedtelling"
                  style={{ background:'transparent', border:0, cursor:'pointer', color:'var(--ink-4)', fontSize: 16, padding:'2px 4px', lineHeight:1 }}>×</button>
              </div>
            )}
          </div>

          {cdLoading ? (
            <div style={{ height: screenSize === 'tablet' ? 60 : 80 }} />
          ) : !cdEditing ? (
            cd ? (
              <>
                <div style={{ fontSize: screenSize === 'tablet' ? 16 : 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink-2)' }}>{cd.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: screenSize === 'tablet' ? 6 : 8 }}>
                  <span style={{ fontSize: screenSize === 'desktop' ? 80 : screenSize === 'tablet' ? 28 : 56, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                    {Math.max(0, cdDays)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: 'var(--ink-3)' }}>
                    {cdDays <= 0 ? '🎉' : 'dager'}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--ink-3)' }}>
                  {new Date(cd.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </>
            ) : (
              <button
                onClick={() => { setCdDraft(EMPTY_COUNTDOWN_DRAFT); setCdEditing(true); }}
                style={{
                  background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  border: '1px dashed var(--ink-4)', borderRadius: 6, padding: '10px 12px',
                  color: 'var(--ink-4)', fontSize: 13,
                }}
              >+ Legg til nedtelling</button>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input className="input" placeholder="Hva teller vi ned til?" value={cdDraft.label}
                onChange={e => setCdDraft(d => ({ ...d, label: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveCd(); }} autoFocus />
              <input className="input" type="date" value={cdDraft.date}
                onChange={e => setCdDraft(d => ({ ...d, date: e.target.value }))} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={handleSaveCd} className="btn primary" style={{ flex: 1 }}>Lagre</button>
                <button onClick={() => setCdEditing(false)} className="btn ghost" style={{ flex: 1 }}>Avbryt</button>
              </div>
            </div>
          )}
        </div>

        {/* Nordlys — Kp-indeks fra NOAA (observert, ikke flerdags-prognose)
            kombinert med skydekke fra Yr/met.no for Bodø. Ren heuristikk, ikke
            et offisielt varsel — se api/nordlys.ts for poengmodellen. */}
        <div style={{
          ...cell, padding: screenSize === 'tablet' ? '10px 12px' : screenSize === 'desktop' ? '20px 22px' : '16px 18px',
          display: 'flex', flexDirection: 'column', gap: screenSize === 'tablet' ? 6 : 12,
        }}>
          <div style={eyebrow}>🌌 Nordlys · Bodø</div>

          {auroraError && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-4)' }}>Utilgjengelig akkurat nå</div>
          )}
          {!auroraError && !aurora && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--ink-4)' }}>…</div>
          )}
          {!auroraError && aurora && (
            <>
              <div style={{ fontSize: screenSize === 'desktop' ? 22 : screenSize === 'tablet' ? 14 : 18, fontWeight: 600, letterSpacing: '-0.01em', color: AURORA_COLOR[aurora.probability] }}>
                {AURORA_LABEL[aurora.probability]}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>
                Kp {aurora.kp} · {aurora.cloudCover}% skydekke
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', opacity: 0.7 }}>
                Kun synlig når det er mørkt
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Row 3: Kalender (i dag) + Gjøremål (i dag) + Handleliste — grows to fill ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: tabletGap, ...(isTablet ? { flex: 1, minHeight: 0, gridTemplateRows: 'minmax(0, 1fr)', overflow: 'hidden' } : {}) }}>

        {/* Kalender — kun i dag, ikke kommende dager */}
        <div style={{ ...cell, minWidth: 0, ...(isTablet ? { minHeight: 0 } : {}), padding: screenSize === 'tablet' ? '8px 10px' : screenSize === 'desktop' ? '20px 24px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: screenSize === 'tablet' ? 6 : 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={eyebrow}>Kalender · i dag</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--good)', letterSpacing: '0.06em' }}>● LIVE</div>
          </div>

          {todayCalEvents.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--ink-4)' }}>
              Ingen hendelser i dag
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', ...(isTablet ? { flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } : {}) }}>
              {todayCalEvents.map((e, i) => (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '11px 10px',
                  borderBottom: i < todayCalEvents.length - 1 ? '1px solid var(--line)' : '0',
                  borderLeft: `3px solid ${e.color}`,
                  background: 'rgba(120,120,120,0.08)',
                  borderRadius: 4, marginBottom: 1,
                }}>
                  {!e.allDay && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, flexShrink: 0, color: 'var(--ink-3)' }}>
                      {fmtTime(e.start)}
                    </span>
                  )}
                  <span style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.title}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: e.color, flexShrink: 1, minWidth: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.who ?? SOURCE_LABEL[e.source] ?? e.source}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Gjøremål — alle aktive (ikke bare dagens), med avkrysning + skjermbredt konfetti */}
        <div style={{ ...cell, minWidth: 0, ...(isTablet ? { minHeight: 0 } : {}), padding: screenSize === 'tablet' ? '8px 10px' : screenSize === 'desktop' ? '20px 24px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: screenSize === 'tablet' ? 6 : 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={eyebrow}>✅ Gjøremål</div>
            {activeTodoRows.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-4)' }}>{activeTodoRows.length}</span>
            )}
          </div>

          {activeTodoRows.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--ink-4)' }}>
              Ingen aktive gjøremål
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column',
              overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
              ...(isTablet
                ? { flex: 1, minHeight: 0 }
                : { maxHeight: screenSize === 'desktop' ? 320 : 260 }),
            }}>
              {activeTodoRows.map((row, i) => {
                if (editingTodo === row.todoId) {
                  return (
                    <div key={row.todoId} style={{
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      padding: '9px 10px', marginBottom: 1, borderRadius: 4,
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
                  );
                }

                return (
                  <div key={row.todoId} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '11px 10px',
                    borderBottom: i < activeTodoRows.length - 1 ? '1px solid var(--line)' : '0',
                    borderLeft: `3px solid ${row.color}`,
                    background: row.overdueSince ? 'rgba(192,57,43,0.45)' : 'rgba(120,120,120,0.08)',
                    borderRadius: 4, marginBottom: 1,
                  }}>
                    <ScreenCheck
                      checked={completingTodos.has(row.todoId)}
                      onClick={(ev) => completeTodo(row.todoId, row.title, ev.currentTarget)}
                      label={`Fullfør «${row.title}»`}
                    />
                    <span
                      onClick={() => startEditTodo(row.todoId)}
                      title="Trykk for å endre navn/frist"
                      style={{
                        flex: 1, minWidth: 0, fontSize: 18, fontWeight: 600, cursor: 'pointer',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                      {row.title}
                    </span>
                    {(row.time || row.deadline) && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                        {row.time && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color: 'var(--ink-3)' }}>
                            {row.time}
                          </span>
                        )}
                        {row.deadline && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
                            {new Date(row.deadline + 'T00:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </div>
                    )}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: row.color, flexShrink: 1, minWidth: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.overdueSince ? `${row.who ?? 'Felles'} · forfalt ${fmtOverdue(row.overdueSince)}` : (row.who ?? 'Felles')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Handleliste — utdrag, med touch-scroll (vertikal). Full redigering på Handleliste-siden. */}
        <div style={{ ...cell, minWidth: 0, ...(isTablet ? { minHeight: 0 } : {}), padding: screenSize === 'tablet' ? '8px 10px' : screenSize === 'desktop' ? '20px 22px' : '16px 18px', display: 'flex', flexDirection: 'column', gap: screenSize === 'tablet' ? 6 : 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={eyebrow}>🛒 Handleliste</div>
            {previewRows.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)' }}>{previewRows.length} varer</span>
            )}
          </div>
          {previewRows.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-4)' }}>Ingenting på handlelisten</div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
              ...(isTablet
                ? { flex: 1, minHeight: 0 }
                : { maxHeight: screenSize === 'desktop' ? 320 : 260 }),
            }}>
              {previewRows.map(r => (
                <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ScreenCheck checked={false} onClick={r.toggle} label={`Merk «${r.name}» som kjøpt`} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  {(r.amount != null || r.unit) && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-4)', flexShrink: 0 }}>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight: 700, color:'var(--ink-4)', letterSpacing:'0.1em', textTransform:'uppercase' }}>{now.getFullYear()}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:14, color:'var(--ink-3)', letterSpacing:'0.06em' }}>Dag {daysElapsed} av {daysInYear} · {yearPct.toFixed(1).replace('.',',')}%</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight: 700, color:'var(--ink-4)', letterSpacing:'0.1em', textTransform:'uppercase' }}>{daysLeft} dager igjen</span>
        </div>
        <div style={{ position: 'relative', height: 3, background: 'var(--line)', borderRadius: 2 }}>
          <div style={{ width: yearPct+'%', height: '100%', background: 'var(--ink-3)', borderRadius: 2, transition: 'width 1s linear' }} />
        </div>
      </div>

      {/* ── Hourly weather popup ── */}
      {weatherOpen && weather && (
        <div
          onClick={() => setWeatherOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--ink-fixed)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '28px 32px', width: 860, maxWidth: 'calc(100vw - 48px)', display: 'flex', flexDirection: 'column', gap: 20 }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Vær · Bodø · Time for time</div>
                <div style={{ fontSize: 22, fontWeight: 300, marginTop: 6, color: '#E8EFF7', letterSpacing: '-0.01em' }}>
                  {now.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
              </div>
              <button
                onClick={() => setWeatherOpen(false)}
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'default', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
              >✕</button>
            </div>

            {/* Summary */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, paddingBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <WeatherIcon category={weather.category} size={44} cloud="rgba(207,224,239,0.92)" cloudLine="rgba(207,224,239,0.5)" />
              <div>
                <div style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.03em', color: '#E8EFF7', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {weather.temp}<span style={{ fontSize: 20, opacity: 0.4 }}>°</span>
                  <span style={{ fontSize: 18, color: 'rgba(207,224,239,0.4)', marginLeft: 14 }}>føles {weather.feelsLike}°</span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)', marginTop: 6 }}>
                  {weather.description} · vind {weather.wind} m/s
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 28 }}>
                {[
                  { label: 'Min / Maks', val: `${weather.todayMin}° / ${weather.todayMax}°`, color: '#E8EFF7' },
                  ...(weather.todayPrecip > 0 ? [{ label: 'Nedbør', val: `${weather.todayPrecip} mm`, color: 'var(--accent)' }] : []),
                  ...(weather.sunrise ? [{ label: '↑ Sol', val: weather.sunrise, color: '#E8EFF7' }] : []),
                  ...(weather.sunset  ? [{ label: '↓ Sol', val: weather.sunset,  color: '#E8EFF7' }] : []),
                ].map(r => (
                  <div key={r.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{r.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: r.color }}>{r.val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Chart */}
            {weather.hourly && weather.hourly.length >= 2 && (
              <HourlyChart hourly={weather.hourly} now={now} sunrise={weather.sunrise} sunset={weather.sunset} />
            )}

            {/* Legend */}
            <div style={{ display: 'flex', gap: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.35)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 22, height: 2, background: '#F97316', borderRadius: 1 }} />
                Temperatur
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#6BA9D6', borderRadius: 2, opacity: 0.65 }} />
                Nedbør
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 0, height: 14, borderLeft: '1.5px dashed rgba(255,255,255,0.4)' }} />
                Nå
              </span>
              {(weather.sunrise || weather.sunset) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 0, height: 14, borderLeft: '1px dashed rgba(251,191,36,0.5)' }} />
                  Soloppgang / nedgang
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Dagens middag: full oppskrift ── */}
      {recipeModalOpen && todayRecipe && (
        <div
          onClick={() => setRecipeModalOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--ink-fixed)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '28px 32px', width: 640, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Dagens middag</div>
                <div style={{ fontSize: 26, fontWeight: 300, marginTop: 6, color: '#E8EFF7', letterSpacing: '-0.01em' }}>{todayRecipe.name}</div>
                {todayRecipe.cookTimeMinutes != null && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)', marginTop: 6 }}>⏱ {todayRecipe.cookTimeMinutes} min</div>
                )}
              </div>
              <button
                onClick={() => setRecipeModalOpen(false)}
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'default', color: 'rgba(207,224,239,0.5)', fontSize: 18, padding: '4px 12px', lineHeight: 1.4 }}
              >✕</button>
            </div>

            {todayRecipe.ingredients.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Ingredienser</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {todayRecipe.ingredients.map((ing, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 15, color: '#E8EFF7', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <span>{ing.name}</span>
                      {(ing.amount != null || ing.unit) && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.5)', flexShrink: 0 }}>
                          {ing.amount ?? ''} {ing.unit ?? ''}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {todayRecipe.instructions && (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Fremgangsmåte</div>
                <div style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(207,224,239,0.85)', whiteSpace: 'pre-wrap' }}>{todayRecipe.instructions}</div>
              </div>
            )}

            {todayRecipe.ingredients.length === 0 && !todayRecipe.instructions && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(207,224,239,0.4)' }}>Ingen detaljer lagt til for denne oppskriften ennå.</div>
            )}
          </div>
        </div>
      )}

      {/* ── Registrer trening (rask, fra headeren) ── */}
      {treningRegisterOpen && (
        <TreningQuickRegister categories={trCategories} onClose={() => setTreningRegisterOpen(false)} />
      )}
    </div>
  );
}
