import { useState, useEffect, useRef, Fragment, type ReactNode } from 'react';
import { ASSET_CLASSES, type FinanceEntry } from '../data';
import type { FinanceData } from '../contexts/FinanceContext';
import { Card, Btn, fmtKr, NumericInput } from '../components';
import { calcBuyingPower, type BuyingPowerParams } from '../lib/buyingPower';
import { useHusPrognose, DEFAULT_RETURNS, DEFAULT_SAVINGS, type PrognoseParams, type ClassReturns, type ClassValues } from '../hooks/useHusPrognose';
import { useBuyingPowerParams } from '../hooks/useBuyingPowerParams';
import { useHusPrognoseHistory } from '../hooks/useHusPrognoseHistory';

// ── Prognose ──────────────────────────────────────────────────────────────────
// Forecast built from the Landsbydrømmen numbers, now broken into asset classes
// (eiendom/aksjefond/rentefond/annet) that each grow at their own expected return.
// The projection is anchored at the most recent January, so it stays stable for a
// whole year — which makes "faktisk vs. prognose" an honest comparison — and
// re-bases automatically each new January.

const MAX_PROJECT_YEARS = 40; // internal projection length so an ETA is always found
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];

function monthToMk(m: string): number {
  const [mon, yy] = m.split(' ');
  return (2000 + parseInt(yy)) * 12 + Math.max(0, MONTH_LABELS.indexOf(mon));
}
const mkYear = (mk: number) => Math.floor(mk / 12);
const mkMonLabel = (mk: number) => MONTH_LABELS[((mk % 12) + 12) % 12] + " '" + String(Math.floor(mk / 12)).slice(2);

const short = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace('.', ',') + ' M'
  : n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n));
const dec = (n: number) => String(n).replace('.', ',');  // 3.5 → "3,5"

interface Combined {
  month: string; mk: number;
  eiendom: number; aksjefond: number; rentefond: number; annet: number;
  boligLaan: number; annetLaan: number; salary: number;
}

// Asset classes for one person. Before the migration/re-plot the four classes are
// 0 — fall back to the legacy total as "annet" so the prognosis still works.
function classesOf(e: FinanceEntry | undefined) {
  if (!e) return { eiendom: 0, aksjefond: 0, rentefond: 0, annet: 0 };
  const sum = e.eiendom + e.aksjefond + e.rentefond + e.annet;
  if (sum === 0 && e.assets > 0) return { eiendom: 0, aksjefond: 0, rentefond: 0, annet: e.assets };
  return { eiendom: e.eiendom, aksjefond: e.aksjefond, rentefond: e.rentefond, annet: e.annet };
}

// Sum both people's entries for a given month into one household snapshot.
function combinedAt(finance: FinanceData, month: string): Combined | null {
  const m = finance.M.find(e => e.month === month);
  const l = finance.L.find(e => e.month === month);
  if (!m && !l) return null;
  const a = classesOf(m), b = classesOf(l);
  return {
    month, mk: monthToMk(month),
    eiendom: a.eiendom + b.eiendom, aksjefond: a.aksjefond + b.aksjefond,
    rentefond: a.rentefond + b.rentefond, annet: a.annet + b.annet,
    boligLaan: (m?.boligLaan ?? 0) + (l?.boligLaan ?? 0),
    annetLaan: (m?.annetLaan ?? 0) + (l?.annetLaan ?? 0),
    salary: (m?.salary ?? 0) + (l?.salary ?? 0),
  };
}

const bpOf = (eiendom: number, aksjefond: number, rentefond: number, annet: number, boligLaan: number, income: number, otherLoans: number, p: BuyingPowerParams) =>
  calcBuyingPower({ equity: (eiendom + aksjefond + rentefond + annet) - boligLaan, annualIncome: income, otherLoans }, p).maxPurchase;

interface MonthPoint { mk: number; bp: number; equity: number }

// Monthly projection from the anchor: each class compounds at its own return and
// then receives that class's monthly contribution (so saved money keeps earning
// its class return). Income grows with salaryGrowth.
function projectMonthly(anchor: Combined, returns: ClassReturns, savings: ClassValues, salaryGrowth: number, months: number, bp: BuyingPowerParams): MonthPoint[] {
  let eiendom = anchor.eiendom, aksjefond = anchor.aksjefond, rentefond = anchor.rentefond, annet = anchor.annet;
  let income = anchor.salary;
  const mr = (r: number) => r / 100 / 12;
  const pts: MonthPoint[] = [];
  for (let i = 0; i <= months; i++) {
    if (i > 0) {
      eiendom   = eiendom   * (1 + mr(returns.eiendom))   + savings.eiendom;
      aksjefond = aksjefond * (1 + mr(returns.aksjefond)) + savings.aksjefond;
      rentefond = rentefond * (1 + mr(returns.rentefond)) + savings.rentefond;
      annet     = annet     * (1 + mr(returns.annet))     + savings.annet;
      income *= 1 + mr(salaryGrowth);
    }
    pts.push({
      mk: anchor.mk + i,
      bp: bpOf(eiendom, aksjefond, rentefond, annet, anchor.boligLaan, income, anchor.annetLaan, bp),
      equity: (eiendom + aksjefond + rentefond + annet) - anchor.boligLaan,
    });
  }
  return pts;
}

// ── Forecast chart (yearly, with goal line) ───────────────────────────────────
function ForecastChart({ rows, goal }: { rows: { year: number; bp: number }[]; goal: number }) {
  const W = 580, H = 220, mT = 14, mB = 26, mR = 14, mL = 46;
  const pW = W - mL - mR, pH = H - mT - mB;
  const n = rows.length;
  if (!n) return null;
  const maxY = Math.max(goal, ...rows.map(r => r.bp)) * 1.08;
  const x = (i: number) => mL + (n === 1 ? pW / 2 : (i / (n - 1)) * pW);
  const y = (v: number) => mT + pH - Math.max(0, Math.min(1, v / maxY)) * pH;
  const linePts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.bp).toFixed(1)}`);
  const area = `M ${x(0)},${mT + pH} L ${linePts.join(' L ')} L ${x(n - 1)},${mT + pH} Z`;
  const crossIdx = rows.findIndex(r => r.bp >= goal);
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(t => t * maxY);
  const ticks = n <= 8 ? rows.map((_, i) => i) : [0, ...rows.map((_, i) => i).filter(i => i % 2 === 0 && i > 0)];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <defs><linearGradient id="prog-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--good)" stopOpacity="0.22" /><stop offset="100%" stopColor="var(--good)" stopOpacity="0.01" />
      </linearGradient></defs>
      {gridVals.map(v => (
        <g key={v}>
          <line x1={mL} y1={y(v)} x2={mL + pW} y2={y(v)} stroke="var(--line)" strokeWidth="0.5" />
          <text x={mL - 6} y={y(v) + 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-4)">{short(v)}</text>
        </g>
      ))}
      <line x1={mL} y1={y(goal)} x2={mL + pW} y2={y(goal)} stroke="var(--accent)" strokeWidth="1.25" strokeDasharray="5 3" />
      <text x={mL + pW} y={y(goal) - 5} textAnchor="end" fontFamily="var(--font-mono)" fontSize="8.5" fontWeight="700" fill="var(--accent)">mål · {short(goal)}</text>
      <path d={area} fill="url(#prog-grad)" />
      <polyline points={linePts.join(' ')} fill="none" stroke="var(--good)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {crossIdx > 0 && (
        <g>
          <line x1={x(crossIdx)} y1={y(rows[crossIdx].bp)} x2={x(crossIdx)} y2={mT + pH} stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
          <circle cx={x(crossIdx)} cy={y(rows[crossIdx].bp)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
        </g>
      )}
      <circle cx={x(0)} cy={y(rows[0].bp)} r="3.5" fill="var(--good)" stroke="var(--surface)" strokeWidth="1.5" />
      {ticks.map(i => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
          fontFamily="var(--font-mono)" fontSize="8" fill={i === crossIdx ? 'var(--accent)' : 'var(--ink-4)'} fontWeight={i === 0 || i === crossIdx ? 700 : 400}>{rows[i].year}</text>
      ))}
    </svg>
  );
}

// ── Faktisk vs. prognose (multi-year fan) ─────────────────────────────────────
// One continuous actual line (solid) plus a frozen, dashed prognosis segment per
// year, each anchored where the actual line was that January.
interface SegAssumptions { savings: ClassValues; salaryGrowth: number; returns: ClassReturns }
interface Seg { year: number; anchorMonth: string; points: { mk: number; bp: number }[]; assumptions?: SegAssumptions }
function FaktiskVsPrognoseChart({ actual, segments }: { actual: MonthPoint[]; segments: Seg[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 580, H = 210, mT = 14, mB = 26, mR = 14, mL = 46;
  const pW = W - mL - mR, pH = H - mT - mB;
  const all = [...actual, ...segments.flatMap(s => s.points)];
  if (!actual.length || !all.length) return null;
  const minMk = Math.min(...all.map(p => p.mk)), maxMk = Math.max(...all.map(p => p.mk));
  const maxY = (Math.max(...all.map(p => p.bp)) * 1.1) || 1;
  const x = (mk: number) => mL + (maxMk === minMk ? pW / 2 : ((mk - minMk) / (maxMk - minMk)) * pW);
  const y = (v: number) => mT + pH - Math.max(0, Math.min(1, v / maxY)) * pH;
  const line = (pts: { mk: number; bp: number }[]) => pts.slice().sort((a, b) => a.mk - b.mk).map((p, i) => `${i ? 'L' : 'M'}${x(p.mk).toFixed(1)},${y(p.bp).toFixed(1)}`).join(' ');
  const gridVals = [0, 0.5, 1].map(t => t * maxY);
  const ticks: number[] = [];
  if (maxMk - minMk <= 14) {                          // single-year view → label by month
    for (let mk = minMk; mk <= maxMk; mk += 3) ticks.push(mk);
  } else {
    for (let mk = Math.ceil(minMk / 12) * 12; mk <= maxMk; mk += 12) ticks.push(mk);
    if (ticks.length < 2) { ticks.length = 0; ticks.push(minMk, maxMk); }
  }
  const last = actual[actual.length - 1];

  // Hover: snap to the nearest actual month, read that year's prognosis at it.
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const mkF = minMk + ((e.clientX - rect.left) / rect.width * W - mL) / pW * (maxMk - minMk);
    setHover(actual.reduce((a, b) => Math.abs(b.mk - mkF) < Math.abs(a.mk - mkF) ? b : a).mk);
  };
  const hA = hover != null ? actual.find(p => p.mk === hover) : undefined;
  const hSeg = hover != null ? segments.find(s => s.year === mkYear(hover)) : undefined;
  const hP = hSeg?.points.find(p => p.mk === hover)?.bp;
  const hDiff = (hA && hP != null) ? hA.bp - hP : null;
  const tipPct = hover != null ? (x(hover) / W) * 100 : 0;

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {gridVals.map(v => (
          <g key={v}>
            <line x1={mL} y1={y(v)} x2={mL + pW} y2={y(v)} stroke="var(--line)" strokeWidth="0.5" />
            <text x={mL - 6} y={y(v) + 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-4)">{short(v)}</text>
          </g>
        ))}
        {segments.map(s => <path key={s.year} d={line(s.points)} fill="none" stroke="var(--ink-4)" strokeWidth="1.25" strokeDasharray="5 3" opacity="0.85" />)}
        <path d={line(actual)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {last && <circle cx={x(last.mk)} cy={y(last.bp)} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />}
        {hover != null && hA && (
          <g>
            <line x1={x(hover)} y1={mT} x2={x(hover)} y2={mT + pH} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 2" opacity="0.4" />
            {hP != null && <circle cx={x(hover)} cy={y(hP)} r="3" fill="var(--ink-4)" stroke="var(--surface)" strokeWidth="1.5" />}
            <circle cx={x(hover)} cy={y(hA.bp)} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
          </g>
        )}
        {ticks.map(mk => (
          <text key={mk} x={x(mk)} y={H - 6} textAnchor={mk === ticks[0] ? 'start' : mk === ticks[ticks.length - 1] ? 'end' : 'middle'}
            fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-4)">{mk % 12 === 0 ? mkYear(mk) : mkMonLabel(mk)}</text>
        ))}
      </svg>
      {hover != null && hA && (
        <div style={{ position: 'absolute', top: 4, left: `clamp(8px, ${tipPct}%, calc(100% - 140px))`, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 9px', pointerEvents: 'none', fontFamily: 'var(--font-mono)', fontSize: 10, boxShadow: '0 4px 14px rgba(11,37,69,0.14)', minWidth: 128 }}>
          <div style={{ fontWeight: 700, color: 'var(--ink-3)', marginBottom: 4 }}>{mkMonLabel(hover)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ color: 'var(--accent)' }}>Faktisk</span><span style={{ fontWeight: 600 }}>{fmtKr(hA.bp)}</span></div>
          {hP != null && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ color: 'var(--ink-4)' }}>Prognose</span><span>{fmtKr(hP)}</span></div>}
          {hDiff != null && hP ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 3, paddingTop: 3, borderTop: '1px solid var(--line)', color: hDiff >= 0 ? 'var(--good)' : 'var(--warn)' }}>
              <span>Avvik</span><span>{hDiff >= 0 ? '+' : '−'}{fmtKr(Math.abs(hDiff))} ({hDiff >= 0 ? '+' : ''}{(hDiff / hP * 100).toFixed(1).replace('.', ',')}%)</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="card-eyebrow" style={{ marginBottom: 4 }}>{label}</div>{children}</div>;
}

// Solid = actual, dashed = the (frozen) prognosis. The dashed label is contextual.
function Legend({ dashed }: { dashed: string }) {
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>
        <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--accent)" strokeWidth="2" /></svg> Faktisk
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>
        <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--ink-4)" strokeWidth="2" strokeDasharray="4 3" /></svg> {dashed}
      </span>
    </div>
  );
}

// Goal editor styled for the dark summary band (shares useHusGoal with Oversikt).
function GoalStat({ goal, saveGoal }: { goal: number; saveGoal: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal));
  return (
    <div>
      <div className="card-eyebrow" style={{ color: 'rgba(207,224,239,0.6)' }}>Drømmemålet</div>
      {editing ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <input className="input sm" value={draft} onChange={e => setDraft(e.target.value)} autoFocus
            style={{ width: 120, fontVariantNumeric: 'tabular-nums', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#E8EFF7' }}
            onKeyDown={e => { if (e.key === 'Enter') { const v = parseInt(draft.replace(/\s/g, '')); if (v > 0) saveGoal(v); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
          <Btn ghost sm onClick={() => { const v = parseInt(draft.replace(/\s/g, '')); if (v > 0) saveGoal(v); setEditing(false); }}>OK</Btn>
        </div>
      ) : (
        <button onClick={() => { setDraft(String(goal)); setEditing(true); }} style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 0, textAlign: 'left' }}>
          <div style={{ fontSize: 'clamp(28px, 6vw, 40px)', fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1, marginTop: 8, fontVariantNumeric: 'tabular-nums', color: '#E8EFF7' }}>{fmtKr(goal)}</div>
          <div className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.4)', marginTop: 6 }}>klikk for å endre</div>
        </button>
      )}
    </div>
  );
}

export default function HusPrognose({ finance, goal, saveGoal }: {
  finance: FinanceData; goal: number; saveGoal: (v: number) => void;
}) {
  const { params: stored, save: savePrognose, loading: prognoseLoading } = useHusPrognose();
  const { params: bpParams, save: saveBp, loading: bpLoading } = useBuyingPowerParams();
  const { history, save: saveHistory, loading: histLoading } = useHusPrognoseHistory();

  const params: PrognoseParams = {
    savings: stored?.savings ?? DEFAULT_SAVINGS,
    salaryGrowth: stored?.salaryGrowth ?? 3,
    returns: stored?.returns ?? DEFAULT_RETURNS,
    horizonYears: stored?.horizonYears ?? 10,
  };
  const totalSavings = params.savings.eiendom + params.savings.aksjefond + params.savings.rentefond + params.savings.annet;

  const allMonths = [...new Set([...finance.M, ...finance.L].map(e => e.month))].sort((a, b) => monthToMk(a) - monthToMk(b));
  const hasData = allMonths.length > 0;
  const now = new Date();
  const nowMk = now.getFullYear() * 12 + now.getMonth();
  const thisYear = now.getFullYear();

  // Anchor = most recent January at or before now; else the earliest logged month.
  const januarys = allMonths.filter(m => monthToMk(m) % 12 === 0 && monthToMk(m) <= nowMk);
  const anchorMonth = januarys.length ? januarys[januarys.length - 1] : allMonths[0];
  const anchor = anchorMonth ? combinedAt(finance, anchorMonth) : null;

  // The month a given year's frozen prognosis should be anchored on: that year's
  // January if logged, else — for the very first year we have any data for —
  // the earliest logged month. This way "Faktisk vs. prognose" doesn't sit empty
  // for the months/years before the household's first real January.
  const anchorForYear = (year: number): string | undefined => {
    const jan = allMonths.find(m => monthToMk(m) % 12 === 0 && mkYear(monthToMk(m)) === year);
    if (jan) return jan;
    if (allMonths.length && mkYear(monthToMk(allMonths[0])) === year) return allMonths[0];
    return undefined;
  };

  // Actual buying power per logged month
  const actualPoints: MonthPoint[] = allMonths.map(m => {
    const c = combinedAt(finance, m)!;
    return { mk: c.mk, bp: bpOf(c.eiendom, c.aksjefond, c.rentefond, c.annet, c.boligLaan, c.salary, c.annetLaan, bpParams), equity: 0 };
  });
  const nowBp = actualPoints.length ? actualPoints[actualPoints.length - 1].bp : 0;
  const pctNow = Math.min(100, goal > 0 ? (nowBp / goal) * 100 : 0);

  // Projection (monthly) from the anchor — long enough to always find the ETA.
  const proj = anchor ? projectMonthly(anchor, params.returns, params.savings, params.salaryGrowth, (nowMk - anchor.mk) + MAX_PROJECT_YEARS * 12, bpParams) : [];

  // Yearly forecast rows (sample every 12 months from the anchor), this year onward.
  const yearly = proj.filter((_, i) => i % 12 === 0).map(p => ({ year: mkYear(p.mk), bp: p.bp, equity: p.equity }));
  const forecastRows = yearly.filter(r => r.year >= thisYear).slice(0, Math.max(2, params.horizonYears) + 1);
  const goalRow = proj.find(p => p.bp >= goal);
  const goalYear = goalRow ? mkYear(goalRow.mk) : null;

  // Faktisk vs. prognose — one continuous actual line + each year's frozen segment.
  const segments = history.map(h => ({ year: h.year, anchorMonth: h.anchorMonth, points: h.points, assumptions: h.assumptions })).sort((a, b) => a.year - b.year);
  const latestSeg = segments[segments.length - 1];
  const lastActual = actualPoints[actualPoints.length - 1];
  const segAtNow = latestSeg && lastActual ? latestSeg.points.find(p => p.mk === lastActual.mk)?.bp : undefined;
  const fvpDelta = (lastActual && segAtNow != null) ? lastActual.bp - segAtNow : undefined;
  const currentFrozen = segments.some(s => s.year === thisYear);

  // Per-year deviation: where the actual ended (or stands) vs that year's prognosis.
  const yearStats = segments.flatMap(seg => {
    const startMk = seg.points[0]?.mk ?? seg.year * 12;
    const within = actualPoints.filter(p => p.mk >= startMk && p.mk <= startMk + 12);
    const lastA = within[within.length - 1];
    const segBp = lastA ? seg.points.find(p => p.mk === lastA.mk)?.bp : undefined;
    if (!lastA || segBp == null || segBp === 0) return [];
    return [{ year: seg.year, pct: (lastA.bp - segBp) / segBp * 100, complete: seg.year < thisYear || lastA.mk >= startMk + 11 }];
  });

  // Freeze any year (≤ now) not yet captured — locks in that year's prognosis,
  // anchored on its January, or on the earliest logged month for the bootstrap year.
  const freezing = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (prognoseLoading || bpLoading || histLoading || !hasData) return;
    const frozen = new Set(history.map(h => h.year));
    const candidateYears = new Set<number>();
    for (const m of allMonths) { if (monthToMk(m) % 12 === 0 && monthToMk(m) <= nowMk) candidateYears.add(mkYear(monthToMk(m))); }
    candidateYears.add(mkYear(monthToMk(allMonths[0])));
    const toFreeze = [...candidateYears].filter(yr => !frozen.has(yr) && !freezing.current.has(yr));
    if (!toFreeze.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const added = toFreeze.flatMap(yr => {
      const m = anchorForYear(yr);
      if (!m) return [];
      const c = combinedAt(finance, m)!;
      freezing.current.add(yr);
      const pts = projectMonthly(c, params.returns, params.savings, params.salaryGrowth, 13, bpParams).map(p => ({ mk: p.mk, bp: p.bp }));
      return [{ year: yr, anchorMonth: m, frozenAt: today, points: pts,
        assumptions: { savings: params.savings, salaryGrowth: params.salaryGrowth, returns: params.returns } }];
    });
    if (added.length) void saveHistory([...history, ...added].sort((a, b) => a.year - b.year));
  });

  // Re-freeze the current year with today's assumptions (escape hatch).
  const reFreezeCurrent = () => {
    const m = anchorForYear(thisYear);
    if (!m) return;
    const c = combinedAt(finance, m)!;
    const pts = projectMonthly(c, params.returns, params.savings, params.salaryGrowth, 13, bpParams).map(p => ({ mk: p.mk, bp: p.bp }));
    void saveHistory([...history.filter(h => h.year !== thisYear), { year: thisYear, anchorMonth: m, frozenAt: new Date().toISOString().slice(0, 10), points: pts,
      assumptions: { savings: params.savings, salaryGrowth: params.salaryGrowth, returns: params.returns } }].sort((a, b) => a.year - b.year));
  };

  // Which prognosis to show: the multi-year fan ('all') or a single year. Defaults
  // to the current year once we know which years have been frozen.
  const years = segments.map(s => s.year);
  const [view, setView] = useState<number | 'all'>('all');
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || !years.length) return;
    defaulted.current = true;
    setView(years.includes(thisYear) ? thisYear : years[years.length - 1]);
  }, [years.length]);
  const selSeg = typeof view === 'number' ? segments.find(s => s.year === view) : undefined;
  const selStat = typeof view === 'number' ? yearStats.find(s => s.year === view) : undefined;
  const yearActual = selSeg ? actualPoints.filter(p => p.mk >= selSeg.points[0].mk && p.mk <= selSeg.points[selSeg.points.length - 1].mk) : [];

  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState({ ...params, ...bpParams });
  const openEdit = () => { setDraft({ ...params, ...bpParams }); setEditOpen(true); };
  const saveEdit = () => {
    const { loanMultiple, equityPct, ...prog } = draft;
    void savePrognose(prog);
    void saveBp({ loanMultiple, equityPct });
    setEditOpen(false);
  };
  const setReturn = (key: keyof ClassReturns, val: number) =>
    setDraft(d => ({ ...d, returns: { ...d.returns, [key]: val } }));
  const setSaving = (key: keyof ClassValues, val: number) =>
    setDraft(d => ({ ...d, savings: { ...d.savings, [key]: val } }));

  if (!hasData || !anchor) {
    return (
      <div className="card" style={{ padding: '24px 28px', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        Logg minst én måned på <b>Oversikt</b>-fanen — prognosen bygger på de tallene.
      </div>
    );
  }

  const maxBarBp = Math.max(goal, ...forecastRows.map(r => r.bp));

  return (
    <div className="col" style={{ gap: 24 }}>
      {/* Summary band */}
      <div className="card dark" style={{ padding: '24px 28px', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20 }}>
          <div>
            <div className="card-eyebrow" style={{ color: 'rgba(207,224,239,0.6)' }}>Sammen kan dere kjøpe for i dag</div>
            <div style={{ fontSize: 'clamp(28px, 6vw, 40px)', fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{fmtKr(nowBp)}</div>
            <div className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.5)', marginTop: 6 }}>{pctNow.toFixed(1).replace('.', ',')}% av målet</div>
          </div>
          <div style={{ color: 'var(--on-ink)' }}><GoalStat goal={goal} saveGoal={saveGoal} /></div>
          <div>
            <div className="card-eyebrow" style={{ color: 'rgba(207,224,239,0.6)' }}>Når er målet nådd?</div>
            {goalYear ? (
              <>
                <div style={{ fontSize: 'clamp(28px, 6vw, 40px)', fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1, marginTop: 8, fontVariantNumeric: 'tabular-nums', color: '#9FD3B4' }}>{goalYear}</div>
                <div className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.5)', marginTop: 6 }}>om {Math.max(0, goalYear - thisYear)} år · ved {fmtKr(goalRow!.bp)}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 28, fontWeight: 400, lineHeight: 1.1, marginTop: 8, color: 'rgba(207,224,239,0.8)' }}>{'> '}{MAX_PROJECT_YEARS} år</div>
                <div className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.5)', marginTop: 6 }}>øk sparing eller avkastning</div>
              </>
            )}
          </div>
        </div>
        <div>
          <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3 }}>
            <div style={{ width: pctNow + '%', height: '100%', background: 'var(--accent-soft)', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <span className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.5)' }}>I dag · {fmtKr(nowBp)}</span>
            <span className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.5)' }}>Mål · {fmtKr(goal)}</span>
          </div>
        </div>
      </div>

      {/* Forward forecast */}
      <Card eyebrow="Prognose" title="Kjøpekraft fremover" action={<Btn sm onClick={openEdit}>Forutsetninger</Btn>}>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: -6 }}>
          Forankret i {anchor.month} · sparer {fmtKr(totalSavings)}/mnd · {params.salaryGrowth}% lønnsvekst
        </div>
        <ForecastChart rows={forecastRows} goal={goal} />
      </Card>

      {/* Edit assumptions */}
      {editOpen && (
        <Card eyebrow="Forutsetninger" title="Juster prognosen">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            <Field label="Lønnsvekst (% per år)">
              <input className="input" type="number" value={draft.salaryGrowth} onChange={e => setDraft(d => ({ ...d, salaryGrowth: parseFloat(e.target.value) || 0 }))} />
            </Field>
            <Field label="Tidshorisont (år)">
              <input className="input" type="number" value={draft.horizonYears} onChange={e => setDraft(d => ({ ...d, horizonYears: Math.max(1, Math.min(30, parseInt(e.target.value) || 1)) }))} />
            </Field>
          </div>

          <div className="card-eyebrow" style={{ marginTop: 4 }}>Sparing og avkastning per aktivaklasse</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 76px', gap: '6px 8px', alignItems: 'center' }}>
            <span />
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-4)', textAlign: 'right' }}>SPARING/MND</span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-4)', textAlign: 'right' }}>AVK. %</span>
            {ASSET_CLASSES.map(c => (
              <Fragment key={c.key}>
                <span style={{ fontSize: 13 }}>{c.label}</span>
                <NumericInput className="input sm" value={String(draft.savings[c.key])} onChange={v => setSaving(c.key, parseInt(v.replace(/\s/g, '')) || 0)} />
                <input className="input sm" type="number" step="0.1" value={draft.returns[c.key]} onChange={e => setReturn(c.key, parseFloat(e.target.value) || 0)} style={{ textAlign: 'right' }} />
              </Fragment>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-4)', marginTop: 6 }}>
            Sum sparing: {fmtKr(draft.savings.eiendom + draft.savings.aksjefond + draft.savings.rentefond + draft.savings.annet)}/mnd · spart beløp får sin klasses avkastning videre.
          </div>

          <div className="card-eyebrow" style={{ marginTop: 4 }}>Låneregler · gjelder all kjøpekraft</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            <Field label="Lånemultipel (× årslønn)">
              <input className="input" type="number" step="0.1" value={draft.loanMultiple} onChange={e => setDraft(d => ({ ...d, loanMultiple: parseFloat(e.target.value) || 0 }))} />
            </Field>
            <Field label="Egenkapitalkrav (%)">
              <input className="input" type="number" value={draft.equityPct} onChange={e => setDraft(d => ({ ...d, equityPct: parseFloat(e.target.value) || 0 }))} />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn onClick={() => setEditOpen(false)}>Avbryt</Btn>
            <Btn primary onClick={saveEdit}>Lagre</Btn>
          </div>
        </Card>
      )}

      {/* Faktisk vs. prognose — pick a year (default: current), or the full fan */}
      <Card eyebrow="Historisk" title="Faktisk vs. prognose"
        action={currentFrozen && (view === 'all' || view === thisYear) ? <Btn sm onClick={reFreezeCurrent}>Frys {thisYear} på nytt</Btn> : undefined}>
        {segments.length > 0 ? (
          <>
            {/* Year selector — "Alle prognoser" first; the current year is the default */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -4 }}>
              {(['all', ...years] as (number | 'all')[]).map(v => {
                const sel = view === v;
                return (
                  <button key={String(v)} onClick={() => setView(v)} className="mono"
                    style={{ fontSize: 11, padding: '4px 11px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
                      border: '1px solid ' + (sel ? 'var(--accent)' : 'var(--line)'),
                      background: sel ? 'var(--accent)' : 'transparent',
                      color: sel ? '#fff' : 'var(--ink-3)', fontWeight: sel ? 700 : 500 }}>
                    {v === 'all' ? 'Alle prognoser' : v === thisYear ? `${v} · i år` : v}
                  </button>
                );
              })}
            </div>

            {view === 'all' ? (
              <>
                <div className="mono" style={{ fontSize: 10.5, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ color: 'var(--ink-3)' }}>
                    {fvpDelta != null && (
                      <>I dag: <b style={{ color: fvpDelta >= 0 ? 'var(--good)' : 'var(--warn)' }}>{fvpDelta >= 0 ? '+' : '−'}{fmtKr(Math.abs(fvpDelta))} {fvpDelta >= 0 ? 'foran' : 'bak'} {latestSeg.year}-prognosen</b></>
                    )}
                  </span>
                  <span style={{ color: 'var(--ink-4)' }}>{segments.length} frosne årsprognoser · klikk et år</span>
                </div>
                {yearStats.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {yearStats.map(s => (
                      <button key={s.year} onClick={() => setView(s.year)}
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--ink-3)', cursor: 'pointer' }}>
                        {s.year} {s.complete ? 'endte' : 'hittil'} <b style={{ color: s.pct >= 0 ? 'var(--good)' : 'var(--warn)' }}>{s.pct >= 0 ? '+' : ''}{dec(+s.pct.toFixed(1))}%</b>
                      </button>
                    ))}
                  </div>
                )}
                <Legend dashed="Prognose (per år)" />
                <FaktiskVsPrognoseChart actual={actualPoints} segments={segments} />
              </>
            ) : selSeg ? (
              <>
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {selStat ? (
                    <>{selSeg.year} {selStat.complete ? 'endte' : 'ligger hittil'} <b style={{ color: selStat.pct >= 0 ? 'var(--good)' : 'var(--warn)' }}>{selStat.pct >= 0 ? '+' : ''}{dec(+selStat.pct.toFixed(1))}%</b> {selStat.pct >= 0 ? 'over' : 'under'} planen som ble frosset i {selSeg.anchorMonth}</>
                  ) : `Plan frosset ${selSeg.anchorMonth} — ingen faktiske tall logget enda`}
                </div>
                {selSeg.assumptions && (
                  <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-4)', display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
                    <span>Plan: sparte {fmtKr(selSeg.assumptions.savings.eiendom + selSeg.assumptions.savings.aksjefond + selSeg.assumptions.savings.rentefond + selSeg.assumptions.savings.annet)}/mnd · lønnsvekst {dec(selSeg.assumptions.salaryGrowth)}%</span>
                    <span>Avk: Eiendom {dec(selSeg.assumptions.returns.eiendom)}% · Aksjefond {dec(selSeg.assumptions.returns.aksjefond)}% · Rentefond {dec(selSeg.assumptions.returns.rentefond)}% · Annet {dec(selSeg.assumptions.returns.annet)}%</span>
                  </div>
                )}
                <Legend dashed={`Prognose (frosset ${selSeg.anchorMonth})`} />
                <FaktiskVsPrognoseChart actual={yearActual} segments={[selSeg]} />
              </>
            ) : null}
          </>
        ) : (
          <div className="mono" style={{ fontSize: 10.5, marginTop: -6, color: 'var(--ink-3)' }}>
            Fryser automatisk når du logger januar-tall — så bygges en årsprognose her du kan sammenligne mot.
          </div>
        )}
      </Card>

      {/* Year-by-year */}
      <Card eyebrow="År for år" title="Slik vokser kjøpekraften">
        <div className="col" style={{ gap: 10 }}>
          {forecastRows.map(r => {
            const reached = r.bp >= goal;
            const pct = Math.min(100, (r.bp / maxBarBp) * 100);
            const isNow = r.year === thisYear;
            return (
              <div key={r.year}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: isNow ? 600 : 500, color: isNow ? 'var(--ink)' : 'var(--ink-2)' }}>
                    {r.year}{isNow && <span className="mono" style={{ fontSize: 9, color: 'var(--ink-4)', marginLeft: 6 }}>I ÅR</span>}
                    {reached && !isNow && <span className="mono" style={{ fontSize: 9, color: 'var(--good)', marginLeft: 6 }}>✓ MÅL</span>}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: reached ? 'var(--good)' : 'var(--ink)' }}>{fmtKr(r.bp)}</span>
                </div>
                <div style={{ position: 'relative', height: 6, background: 'var(--chip)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', background: reached ? 'var(--good)' : 'var(--accent)', borderRadius: 3 }} />
                  <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${Math.min(100, (goal / maxBarBp) * 100)}%`, width: 1.5, background: 'var(--accent-deep)' }} />
                </div>
                <div className="mono" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3, fontSize: 9.5, color: 'var(--ink-4)' }}>
                  EK {fmtKr(r.equity)}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
