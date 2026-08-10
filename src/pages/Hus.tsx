import { useState, Fragment } from 'react';
import type { FinanceEntry } from '../data';
import { Card, Btn, fmtKr, Ico, NumericInput, Tabs } from '../components';
import { useFinance } from '../contexts/FinanceContext';
import { useHusGoal } from '../hooks/useHusGoal';
import { bpFromEntry, bpFromCombined, type BuyingPowerParams } from '../lib/buyingPower';
import { useBuyingPowerParams } from '../hooks/useBuyingPowerParams';
import { useConfirm } from '../contexts/ConfirmContext';
import HusPrognose from './HusPrognose';

// ── Constants ─────────────────────────────────────────────────────────────────

const M_COL = '#3B82B8';
const L_COL = '#C97A8B';
const C_COL = '#7AB394';

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'];

function monthKey(s: string) {
  const [m, y] = s.split(' ');
  return parseInt('20' + y) * 100 + MONTH_LABELS.indexOf(m);
}

function monthFromKey(k: number) {
  const year = Math.floor(k / 100);
  const idx = k % 100;
  return MONTH_LABELS[idx] + ' ' + String(year).slice(2);
}

function addMonths(s: string, delta: number) {
  const [m, y] = s.split(' ');
  const total = parseInt('20' + y) * 12 + MONTH_LABELS.indexOf(m) + delta;
  return monthFromKey(Math.floor(total / 12) * 100 + (total % 12));
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function fmtAxis(v: number) {
  if (v === 0) return '0';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return sign + (a / 1_000_000).toFixed(a % 1_000_000 === 0 ? 0 : 1).replace('.', ',') + ' M';
  return sign + Math.round(a / 1000) + 'k';
}

/**
 * Verdiområdet grafen tegnes i — utledet fra TALLENE, ikke forankret i null.
 *
 * Med nullforankring ble utviklingen usynlig: Andreas sin egenkapital beveger seg
 * ~3 000 kr på en akse til 380 000, altså under to piksler — en rett strek.
 * Negative serier (Taran har negativ egenkapital) var direkte ødelagt, fordi
 * skalaen ble negativ og punktene ble klemt mot kanten.
 *
 * Målstreken tas bare med i skalaen når den er innen rekkevidde. Ligger målet
 * langt over — typisk når man filtrerer på én person — ville den ellers presset
 * hele kurven flat, og da er det bedre å vise målet som en peker i toppen.
 */
function domainOf(values: number[], goal?: number): { min: number; max: number; goalAbove: boolean } {
  const vals = values.filter(v => Number.isFinite(v));
  if (!vals.length) return { min: 0, max: goal ?? 1_000_000, goalAbove: false };
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const goalAbove = goal !== undefined && goal > max + (max - min) * 0.5;
  if (goal !== undefined && !goalAbove) { min = Math.min(min, goal); max = Math.max(max, goal); }
  if (min === max) { const p = Math.abs(min) * 0.1 || 1_000; min -= p; max += p; }
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad, goalAbove };
}

interface Series { values: number[]; color: string; label: string; dashed?: boolean }

type PersonFilter = 'felles' | 'M' | 'L';

// Build the chart series for the current person filter — combined + both (dashed) when "felles", else just that person's line.
function filteredSeries(filter: PersonFilter, combined: number[], m: number[], l: number[]): Series[] {
  if (filter === 'M') return [{ values: m, color: M_COL, label: 'Andreas' }];
  if (filter === 'L') return [{ values: l, color: L_COL, label: 'Taran' }];
  return [
    { values: combined, color: C_COL, label: 'Samlet' },
    { values: m, color: M_COL, label: 'Andreas', dashed: true },
    { values: l, color: L_COL, label: 'Taran', dashed: true },
  ];
}

function LineChart({ series, months, domain, goalY }: {
  series: Series[]; months: string[]; domain: { min: number; max: number; goalAbove: boolean }; goalY?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 560; const H = 200;
  const mT = 10; const mB = 24; const mR = 52;
  const pW = W - mR; const pH = H - mT - mB;
  const n = months.length;
  const step = n > 1 ? pW / (n - 1) : pW;
  const cx = (i: number) => n === 1 ? pW / 2 : i * step;
  const span = domain.max - domain.min || 1;
  const cy = (v: number) => mT + pH - ((v - domain.min) / span) * pH;
  const gridVals = Array.from({ length: 5 }, (_, i) => domain.min + (i * span) / 4);
  // Nullinje bare når serien faktisk krysser null (negativ egenkapital)
  const showZero = domain.min < 0 && domain.max > 0;
  // Med få målinger må første OG siste måned være merket — ellers står det bare
  // ett årstall i venstre kant og man ser ikke hvilken periode kurven dekker.
  const ticks = n === 1 ? [0]
    : n <= 6 ? Array.from({ length: n }, (_, i) => i)
    : [...new Set([0, 6, 12, 18, 24, 28].filter(i => i < n).concat(n - 1))];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) / rect.width * W;
    setHoverIdx(n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(svgX / step))));
  };

  // Tooltip layout
  const hi = hoverIdx;
  const tipLines = hi !== null ? series.map(s => ({ color: s.color, label: s.label, val: fmtKr(s.values[hi]) })) : [];
  const tipW = 110; const tipLineH = 13; const tipPad = 7;
  const tipH = tipPad * 2 + tipLineH + tipLines.length * tipLineH;
  const tipX = hi !== null ? (cx(hi) + tipW + 8 > pW ? cx(hi) - tipW - 6 : cx(hi) + 8) : 0;
  const tipY = mT + 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
      {gridVals.map(v => (
        <g key={v}>
          <line x1={0} y1={cy(v)} x2={pW} y2={cy(v)} stroke="var(--line)" strokeWidth="0.5" />
          <text x={pW + 5} y={cy(v) + 3.5} fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-4)">{fmtAxis(v)}</text>
        </g>
      ))}
      {showZero && (
        <line x1={0} y1={cy(0)} x2={pW} y2={cy(0)} stroke="var(--ink-4)" strokeWidth="1" opacity="0.5" />
      )}
      {goalY !== undefined && !domain.goalAbove && (
        <>
          <line x1={0} y1={cy(goalY)} x2={pW} y2={cy(goalY)} stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
          <text x={pW + 5} y={cy(goalY) + 3.5} fontFamily="var(--font-mono)" fontSize="8" fill="var(--accent)">mål</text>
        </>
      )}
      {/* Målet er utenfor skalaen — vis det som en peker i stedet for å presse
          kurven flat for å få plass til det */}
      {goalY !== undefined && domain.goalAbove && (
        <text x={pW} y={mT + 7} textAnchor="end" fontFamily="var(--font-mono)" fontSize="8" fill="var(--accent)" opacity="0.85">
          ↑ mål {fmtAxis(goalY)}
        </text>
      )}
      {series.map((s, si) => {
        const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${cy(v).toFixed(1)}`).join(' ');
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={s.color} strokeWidth="1.5" strokeDasharray={s.dashed ? '5 3' : undefined} opacity={s.dashed ? 0.55 : 1} />
            <circle cx={cx(s.values.length - 1)} cy={cy(s.values[s.values.length - 1])} r="2.5" fill={s.color} />
          </g>
        );
      })}
      {ticks.map(i => (
        <text key={i} x={cx(i)} y={H - 5} fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-4)"
          textAnchor={i === 0 ? 'start' : i >= n - 2 ? 'end' : 'middle'}>{months[i]}</text>
      ))}
      {/* Hover overlay */}
      {hi !== null && (
        <g>
          <line x1={cx(hi)} y1={mT} x2={cx(hi)} y2={mT + pH} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 2" opacity="0.4" />
          {series.map((s, si) => (
            <circle key={si} cx={cx(hi)} cy={cy(s.values[hi])} r="3.5" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
          ))}
          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="3" fill="var(--surface)" stroke="var(--line)" strokeWidth="0.75" />
          <text x={tipX + tipPad} y={tipY + tipPad + 9} fontFamily="var(--font-mono)" fontSize="9" fontWeight="600" fill="var(--ink-3)">{months[hi]}</text>
          {tipLines.map((t, ti) => (
            <g key={ti}>
              <circle cx={tipX + tipPad + 4} cy={tipY + tipPad + tipLineH + ti * tipLineH + 4} r="3" fill={t.color} />
              <text x={tipX + tipPad + 12} y={tipY + tipPad + tipLineH + (ti + 1) * tipLineH - 1}
                fontFamily="var(--font-mono)" fontSize="9" fill="var(--ink-2)">{t.val}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
      {items.map(it => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="20" height="10" viewBox="0 0 20 10">
            <line x1={0} y1={5} x2={20} y2={5} stroke={it.color} strokeWidth="2" strokeDasharray={it.dashed ? '4 3' : undefined} />
            {!it.dashed && <circle cx={16} cy={5} r="2.5" fill={it.color} />}
          </svg>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// Small "Felles / Andreas / Taran" segmented control, used per-graph. Always starts at "Felles".
function FilterToggle({ value, onChange }: { value: PersonFilter; onChange: (f: PersonFilter) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {(['felles', 'M', 'L'] as PersonFilter[]).map(f => (
        <button key={f} onClick={() => onChange(f)} style={{
          padding: '3px 9px', border: '1px solid',
          borderColor: value === f ? (f === 'M' ? M_COL : f === 'L' ? L_COL : 'var(--accent)') : 'var(--line-2)',
          background: value === f ? (f === 'M' ? M_COL : f === 'L' ? L_COL : 'var(--accent)') : 'transparent',
          color: value === f ? '#fff' : 'var(--ink-3)',
          borderRadius: 4, fontSize: 10, cursor: 'pointer',
        }}>{f === 'felles' ? 'Felles' : f === 'M' ? 'Andreas' : 'Taran'}</button>
      ))}
    </div>
  );
}

// A line chart card with its own person filter — independent per graph, always defaults to "felles".
function FilterableChart({ title, combined, m, l, monthsM, monthsL, goal }: {
  title: string; combined: number[]; m: number[]; l: number[]; monthsM: string[]; monthsL: string[]; goal?: number;
}) {
  const [filter, setFilter] = useState<PersonFilter>('felles');
  const series = filteredSeries(filter, combined, m, l);
  const months = filter === 'L' ? monthsL : monthsM;
  // Skalaen må dekke ALLE kurvene som tegnes — på «Felles» ligger begge de
  // stiplede personlinjene der også, og de kan gå både over og under den samlede.
  const domain = domainOf(series.flatMap(s => s.values), goal);
  // Endringen i perioden, som tall — kurven viser retningen, dette viser størrelsen
  const main = series[0].values;
  const delta = main.length > 1 ? main[main.length - 1] - main[0] : 0;
  return (
    <Card eyebrow="Utvikling" title={title} action={<FilterToggle value={filter} onChange={setFilter} />}>
      <Legend items={series} />
      {main.length > 1 && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 8,
          color: delta === 0 ? 'var(--ink-4)' : delta > 0 ? 'var(--good)' : 'var(--danger)',
        }}>
          {delta === 0 ? 'uendret' : `${delta > 0 ? '▲' : '▼'} ${fmtKr(Math.abs(delta))}`}
          <span style={{ color: 'var(--ink-4)' }}> siden {months[0]}</span>
        </div>
      )}
      <LineChart series={series} months={months} domain={domain} goalY={goal} />
    </Card>
  );
}

// ── Person summary card ───────────────────────────────────────────────────────

function PersonCard({ who, entry, params }: { who: 'M' | 'L'; entry: FinanceEntry; params: BuyingPowerParams }) {
  const color = who === 'M' ? M_COL : L_COL;
  const { equity, maxLoan, maxPurchase } = bpFromEntry(entry, params);
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
          <div className="card-eyebrow">{who === 'M' ? 'Andreas' : 'Taran'}</div>
        </div>
        <span className="mono muted" style={{ fontSize: 10 }}>{entry.month}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
        {[
          ['Formue', fmtKr(entry.assets), undefined],
          ['Boliglån', fmtKr(entry.boligLaan), undefined],
          ['Egenkapital', fmtKr(equity), color],
          ['Annet lån', fmtKr(entry.annetLaan), undefined],
        ].map(([label, val, c]) => (
          <div key={label}>
            <div className="card-eyebrow">{label}</div>
            <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 3, fontVariantNumeric: 'tabular-nums', color: c as string | undefined }}>{val}</div>
          </div>
        ))}
      </div>
      <hr className="hairline" />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)' }}>
        Maks lån:{' '}
        <span style={{ color: 'var(--good)', fontWeight: 600 }}>{fmtKr(maxLoan)}</span>
        <span style={{ opacity: 0.6 }}>{' · '}{params.loanMultiple} × inntekt − annet lån</span>
      </div>
      <div style={{ marginTop: 8 }}>
        <div className="card-eyebrow" style={{ marginBottom: 4 }}>Individuell kjøpekraft</div>
        <div style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color }}>{fmtKr(maxPurchase)}</div>
      </div>
    </Card>
  );
}

// ── Add / edit form ───────────────────────────────────────────────────────────

interface Preset { who: 'M' | 'L'; entry: FinanceEntry }

const currentMonth = () => MONTH_LABELS[new Date().getMonth()] + ' ' + String(new Date().getFullYear()).slice(2);

function AddForm({ onSave, preset, onClearPreset, lastEntries, entriesByMonth, params }: {
  onSave: (who: 'M' | 'L', e: FinanceEntry) => void;
  preset: Preset | null;
  onClearPreset: () => void;
  lastEntries: Record<'M' | 'L', FinanceEntry>;
  entriesByMonth: Record<'M' | 'L', Map<string, FinanceEntry>>;
  params: BuyingPowerParams;
}) {
  const { confirm } = useConfirm();
  const [who, setWho] = useState<'M' | 'L'>(preset?.who ?? 'M');
  const [month, setMonth] = useState(preset?.entry.month ?? currentMonth());
  const seed = preset?.entry ?? lastEntries[who];
  const [eiendom,   setEiendom]   = useState(String(seed.eiendom));
  const [aksjefond, setAksjefond] = useState(String(seed.aksjefond));
  const [rentefond, setRentefond] = useState(String(seed.rentefond));
  const [annet,     setAnnet]     = useState(String(seed.annet));
  const [boligLaan, setBoligLaan] = useState(String(seed.boligLaan));
  const [annetLaan, setAnnetLaan] = useState(String(seed.annetLaan));
  const [salary,    setSalary]    = useState(String(seed.salary));

  // When preset changes from outside (log edit click), sync form
  const [lastPreset, setLastPreset] = useState(preset);
  if (preset !== lastPreset) {
    setLastPreset(preset);
    if (preset) {
      setWho(preset.who);
      setMonth(preset.entry.month);
      setEiendom(String(preset.entry.eiendom));
      setAksjefond(String(preset.entry.aksjefond));
      setRentefond(String(preset.entry.rentefond));
      setAnnet(String(preset.entry.annet));
      setBoligLaan(String(preset.entry.boligLaan));
      setAnnetLaan(String(preset.entry.annetLaan));
      setSalary(String(preset.entry.salary));
    } else {
      setMonth(currentMonth());
    }
  }

  // Fill the inputs with whatever was logged for this person+month, falling back to their latest entry.
  const fillFields = (w: 'M' | 'L', m: string) => {
    const e = entriesByMonth[w].get(m) ?? lastEntries[w];
    setEiendom(String(e.eiendom)); setAksjefond(String(e.aksjefond)); setRentefond(String(e.rentefond)); setAnnet(String(e.annet));
    setBoligLaan(String(e.boligLaan)); setAnnetLaan(String(e.annetLaan)); setSalary(String(e.salary));
  };

  const switchWho = (w: 'M' | 'L') => {
    setWho(w);
    fillFields(w, month);
    onClearPreset();
  };

  const goToMonth = (m: string) => {
    setMonth(m);
    fillFields(who, m);
  };

  const N = (s: string) => parseInt(s.replace(/\s/g, '')) || 0;
  const eiendomN = N(eiendom), aksjefondN = N(aksjefond), rentefondN = N(rentefond), annetN = N(annet);
  const assetsN    = eiendomN + aksjefondN + rentefondN + annetN;
  const boligLaanN = N(boligLaan);
  const annetLaanN = N(annetLaan);
  const salaryN    = N(salary);
  const preview = bpFromEntry({ assets: assetsN, boligLaan: boligLaanN, annetLaan: annetLaanN, salary: salaryN }, params);

  const save = async () => {
    if (!assetsN) return;
    if (!preset && entriesByMonth[who].has(month)) {
      const ok = await confirm({
        title: 'Overskrive logget måned?',
        message: `${who === 'M' ? 'Andreas' : 'Taran'} har allerede tall logget for ${month}. Lagrer du nå, overskrives de.`,
        confirmLabel: 'Overskriv',
      });
      if (!ok) return;
    }
    onSave(who, { month, eiendom: eiendomN, aksjefond: aksjefondN, rentefond: rentefondN, annet: annetN, assets: assetsN, boligLaan: boligLaanN, annetLaan: annetLaanN, salary: salaryN });
    onClearPreset();
  };

  const isEdit = !!preset;
  const atCurrentMonth = month === currentMonth();

  return (
    <Card eyebrow="Logg tall" title={isEdit ? month : undefined}>
      {isEdit && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg)', borderRadius: 4, border: '1px solid var(--line)', marginBottom: 4 }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--accent)' }}>Redigerer {preset.who === 'M' ? 'Andreas' : 'Taran'} · {preset.entry.month}</span>
          <button onClick={onClearPreset} style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--ink-4)', fontSize: 12 }}>×</button>
        </div>
      )}
      {!isEdit && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '4px 0' }}>
          <button onClick={() => goToMonth(addMonths(month, -1))}
            style={{ background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 4, width: 28, height: 28, cursor: 'pointer', color: 'var(--ink-3)', fontSize: 14 }}
            aria-label="Forrige måned">‹</button>
          <span className="mono" style={{ fontSize: 15, fontWeight: 600, minWidth: 64, textAlign: 'center' }}>{month}</span>
          <button onClick={() => goToMonth(addMonths(month, 1))} disabled={atCurrentMonth}
            style={{ background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 4, width: 28, height: 28, cursor: atCurrentMonth ? 'default' : 'pointer', color: atCurrentMonth ? 'var(--ink-4)' : 'var(--ink-3)', fontSize: 14, opacity: atCurrentMonth ? 0.4 : 1 }}
            aria-label="Neste måned">›</button>
        </div>
      )}
      {!isEdit && (
        <div style={{ display: 'flex', gap: 6 }}>
          {(['M', 'L'] as const).map(w => (
            <button key={w} onClick={() => switchWho(w)} style={{
              flex: 1, padding: '6px 0', border: '1px solid',
              borderColor: who === w ? (w === 'M' ? M_COL : L_COL) : 'var(--line-2)',
              background: who === w ? (w === 'M' ? M_COL : L_COL) : 'transparent',
              color: who === w ? '#fff' : 'var(--ink-3)',
              borderRadius: 4, fontSize: 12, cursor: 'pointer',
            }}>{w === 'M' ? 'Andreas' : 'Taran'}</button>
          ))}
        </div>
      )}
      <div className="col" style={{ gap: 8 }}>
        {([
          ['🏠 Eiendom (kr)', eiendom, setEiendom],
          ['📈 Aksjefond (kr)', aksjefond, setAksjefond],
          ['📊 Rentefond (kr)', rentefond, setRentefond],
          ['💼 Annet (kr)', annet, setAnnet],
          ['🏦 Boliglån (kr)', boligLaan, setBoligLaan],
          ['💳 Annet lån (kr)', annetLaan, setAnnetLaan],
          ['💰 Årslønn (kr)', salary, setSalary],
        ] as [string, string, (v: string) => void][]).map(([label, val, set]) => (
          <div key={label}>
            <div className="card-eyebrow" style={{ marginBottom: 3 }}>{label}</div>
            <NumericInput className="input" value={val} onChange={set}
              style={{ fontVariantNumeric: 'tabular-nums' }} placeholder="0" />
          </div>
        ))}
      </div>
      {assetsN > 0 && (
        <div style={{ padding: '8px 10px', background: 'var(--bg)', borderRadius: 4, border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[
              ['Sum aktiva', fmtKr(assetsN), 'var(--ink-3)'],
              ['Formue (EK)', fmtKr(preview.equity), 'var(--ink)'],
              [`Maks lån (${params.loanMultiple} × inntekt − gjeld)`, fmtKr(preview.maxLoan), 'var(--good)'],
              ['Kjøpekraft', fmtKr(preview.maxPurchase), who === 'M' ? M_COL : L_COL],
            ].map(([l, v, c]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>
                <span>{l}</span><span style={{ color: c, fontWeight: l === 'Kjøpekraft' ? 600 : 400 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <Btn primary icon={Ico.plus} onClick={save}
        style={{ opacity: !assetsN ? 0.4 : 1 }}>
        {isEdit ? 'Lagre endring' : `Logg for ${who === 'M' ? 'Andreas' : 'Taran'}`}
      </Btn>
    </Card>
  );
}

// ── Log table ─────────────────────────────────────────────────────────────────

function EntryCell({ who, entry, onEdit }: {
  who: 'M' | 'L';
  entry?: FinanceEntry;
  onEdit: (who: 'M' | 'L', entry?: FinanceEntry) => void;
}) {
  const color = who === 'M' ? M_COL : L_COL;
  if (!entry) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(201,122,59,0.06)', borderRadius: 4, border: '1px solid rgba(201,122,59,0.2)' }}>
        <span style={{ fontSize: 11, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>⚠ Mangler</span>
        <button onClick={() => onEdit(who)} style={{ background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 3, padding: '3px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', cursor: 'pointer', marginLeft: 'auto' }}>
          Legg til
        </button>
      </div>
    );
  }
  const eq = entry.assets - entry.boligLaan;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', padding: '10px 12px', background: 'var(--bg)', borderRadius: 4, border: '1px solid var(--line)', position: 'relative' }}>
      {[['Formue', fmtKr(entry.assets)], ['Boliglån', fmtKr(entry.boligLaan)], ['Annet lån', fmtKr(entry.annetLaan)], ['EK', fmtKr(eq)]].map(([l, v]) => (
        <div key={l}>
          <span className="mono" style={{ fontSize: 9, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l} </span>
          <span className="mono" style={{ fontSize: 10, color: l === 'EK' ? color : 'var(--ink-2)', fontWeight: l === 'EK' ? 600 : 400 }}>{v}</span>
        </div>
      ))}
      <button onClick={() => onEdit(who, entry)} style={{
        position: 'absolute', top: 8, right: 8, background: 'transparent', border: 0,
        padding: '2px 5px', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11, lineHeight: 1, borderRadius: 3,
      }} title="Rediger">✎</button>
    </div>
  );
}

function LogTable({ allM, allL, onEdit }: {
  allM: FinanceEntry[]; allL: FinanceEntry[];
  onEdit: (who: 'M' | 'L', entry?: FinanceEntry, month?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const mMap = new Map(allM.map(e => [e.month, e]));
  const lMap = new Map(allL.map(e => [e.month, e]));
  const loggedKeys = [...mMap.keys(), ...lMap.keys()].map(monthKey);
  const minKey = loggedKeys.length ? Math.min(...loggedKeys) : monthKey(currentMonth());
  // Fill every month from the first ever logged one through now, so gaps show up as missing.
  const months: string[] = [];
  for (let m = currentMonth(); monthKey(m) >= minKey; m = addMonths(m, -1)) months.push(m); // newest first

  const VISIBLE = 3;
  const visible = expanded ? months : months.slice(0, VISIBLE);
  const hidden = months.length - VISIBLE;

  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' };

  return (
    <Card eyebrow="Historikk" title="Alle loggede måneder">
      <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr', gap: 8, alignItems: 'start' }}>
        {/* Header */}
        <div />
        {(['M', 'L'] as const).map(w => (
          <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6, borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: w === 'M' ? M_COL : L_COL }} />
            <span className="card-eyebrow">{w === 'M' ? 'Andreas' : 'Taran'}</span>
          </div>
        ))}
        {/* Rows */}
        {visible.map(month => (
          <Fragment key={month}>
            <div style={{ ...mono, paddingTop: 12, fontWeight: 500 }}>{month}</div>
            <EntryCell who="M" entry={mMap.get(month)} onEdit={(who, entry) => onEdit(who, entry, month)} />
            <EntryCell who="L" entry={lMap.get(month)} onEdit={(who, entry) => onEdit(who, entry, month)} />
          </Fragment>
        ))}
      </div>
      {/* Show more / less */}
      {(expanded || hidden > 0) && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 16, width: '100%', padding: '8px 0',
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            borderRadius: 6, cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)',
          }}>
          {expanded ? '↑ Vis mindre' : `↓ Vis ${hidden} eldre måneder`}
        </button>
      )}
    </Card>
  );
}

// ── Equity delta card ─────────────────────────────────────────────────────────

function fmtDelta(v: number | undefined) {
  if (v === undefined) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  const s = fmtKr(Math.abs(v));
  if (v > 0) return <span style={{ color: 'var(--good)' }}>+{s}</span>;
  if (v < 0) return <span style={{ color: 'var(--warn)' }}>−{s}</span>;
  return <span style={{ color: 'var(--ink-4)' }}>0</span>;
}

// Value n months back, by position in the logged history (not by calendar month) — undefined if not enough months logged yet.
function deltaBack(arr: FinanceEntry[], n: number, calc: (e: FinanceEntry) => number): number | undefined {
  if (arr.length < n + 1) return undefined;
  return calc(arr[arr.length - 1]) - calc(arr[arr.length - 1 - n]);
}

const DELTA_SPANS: { n: number; label: string }[] = [{ n: 1, label: '1mnd' }, { n: 3, label: '3mnd' }, { n: 6, label: '6mnd' }, { n: 12, label: '12mnd' }];

function DeltaRow({ deltas }: { deltas: (number | undefined)[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 4 }}>
      {DELTA_SPANS.map((s, i) => (
        <div key={s.label} style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--ink-4)' }}>{s.label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{fmtDelta(deltas[i])}</div>
        </div>
      ))}
    </div>
  );
}

function WealthDelta({ allM, allL, eyebrow, calc }: {
  allM: FinanceEntry[]; allL: FinanceEntry[]; eyebrow: string; calc: (e: FinanceEntry) => number;
}) {
  const [filter, setFilter] = useState<PersonFilter>('felles');
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, fontVariantNumeric: 'tabular-nums' };

  const allRows = [
    { id: 'M' as const, label: 'Andreas', color: M_COL, arr: allM },
    { id: 'L' as const, label: 'Taran',   color: L_COL, arr: allL },
  ];
  const rows = (filter === 'felles' ? allRows : allRows.filter(r => r.id === filter)).map(r => ({
    ...r,
    val: calc(r.arr[r.arr.length - 1]),
    deltas: DELTA_SPANS.map(s => deltaBack(r.arr, s.n, calc)),
  }));

  const combinedVal = allM.length && allL.length ? calc(allM[allM.length - 1]) + calc(allL[allL.length - 1]) : 0;
  const combinedDeltas = DELTA_SPANS.map(s => {
    const dM = deltaBack(allM, s.n, calc);
    const dL = deltaBack(allL, s.n, calc);
    return (dM === undefined || dL === undefined) ? undefined : dM + dL;
  });

  return (
    <Card eyebrow={eyebrow} title="Siden sist måned" action={<FilterToggle value={filter} onChange={setFilter} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map(r => (
          <div key={r.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                <span style={{ ...mono, color: 'var(--ink-3)' }}>{r.label}</span>
              </div>
              <div style={{ ...mono, color: r.color, fontWeight: 600 }}>{fmtKr(r.val)}</div>
            </div>
            <DeltaRow deltas={r.deltas} />
          </div>
        ))}
        {filter === 'felles' && <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ ...mono, color: 'var(--ink-3)', fontWeight: 600 }}>Samlet</span>
            <div style={{ ...mono, color: 'var(--ink)', fontWeight: 600 }}>{fmtKr(combinedVal)}</div>
          </div>
          <DeltaRow deltas={combinedDeltas} />
        </div>}
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const EMPTY_ENTRY: FinanceEntry = { month: currentMonth(), eiendom: 0, aksjefond: 0, rentefond: 0, annet: 0, assets: 0, boligLaan: 0, annetLaan: 0, salary: 0 };

export default function PageHus() {
  const { finance, loading, save } = useFinance();
  const { goal, save: saveGoal } = useHusGoal();
  const [view, setView] = useState<'oversikt' | 'prognose'>('oversikt');
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [preset, setPreset] = useState<Preset | null>(null);

  const allM = finance.M;
  const allL = finance.L;
  const entriesByMonth = { M: new Map(allM.map(e => [e.month, e])), L: new Map(allL.map(e => [e.month, e])) };
  const hasData = allM.length >= 1 && allL.length >= 1;
  const latestM = allM[allM.length - 1] ?? EMPTY_ENTRY;
  const latestL = allL[allL.length - 1] ?? EMPTY_ENTRY;
  const { params: bpParams } = useBuyingPowerParams();
  const combined = bpFromCombined(latestM, latestL, bpParams);
  const goalPct = Math.min(100, combined.maxPurchase > 0 ? (combined.maxPurchase / goal) * 100 : 0);

  const monthsM = allM.map(e => e.month);
  const monthsL = allL.map(e => e.month);
  const equityM        = allM.map(e => e.assets - e.boligLaan);
  const equityL        = allL.map(e => e.assets - e.boligLaan);
  const equityCombined = allM.map((em, i) => { const el = allL.length > 0 ? allL[Math.min(i, allL.length - 1)] : EMPTY_ENTRY; return (em.assets - em.boligLaan) + (el.assets - el.boligLaan); });
  const netWorthM        = allM.map(e => e.assets - e.boligLaan - e.annetLaan);
  const netWorthL        = allL.map(e => e.assets - e.boligLaan - e.annetLaan);
  const netWorthCombined = allM.map((em, i) => { const el = allL.length > 0 ? allL[Math.min(i, allL.length - 1)] : EMPTY_ENTRY; return (em.assets - em.boligLaan - em.annetLaan) + (el.assets - el.boligLaan - el.annetLaan); });
  const bpM            = allM.map(e => bpFromEntry(e, bpParams).maxPurchase);
  const bpL            = allL.map(e => bpFromEntry(e, bpParams).maxPurchase);
  const bpCombined     = allM.map((em, i) => bpFromCombined(em, allL.length > 0 ? allL[Math.min(i, allL.length - 1)] : EMPTY_ENTRY, bpParams).maxPurchase);

  const handleLogEdit = (who: 'M' | 'L', entry?: FinanceEntry, month?: string) => {
    const fallback = who === 'M' ? latestM : latestL;
    setPreset({ who, entry: entry ?? { ...fallback, month: month ?? fallback.month } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Tabs
          items={[{ id: 'oversikt', label: 'Oversikt' }, { id: 'prognose', label: '🔭 Prognose' }]}
          value={view}
          onChange={v => setView(v as 'oversikt' | 'prognose')}
        />
      </div>

      {view === 'prognose' && <HusPrognose finance={finance} goal={goal} saveGoal={saveGoal} />}

      {view === 'oversikt' && <>
      {/* ── Hero ── */}
      {!hasData && !loading && (
        <div className="card" style={{ padding: '24px 28px', marginBottom: 24, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Ingen data ennå. Logg den første måneden nedenfor — du trenger minst én måned for Andreas og én for Taran før grafer og kjøpekraft vises.
        </div>
      )}
      {loading && (
        <div style={{ padding: '32px 0', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Laster...</div>
      )}
      {hasData && <div className="card dark" style={{ padding: '28px 32px', gap: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="card-eyebrow">Samlet kjøpekraft · {latestM.month}</div>
            <div style={{ fontSize: 'clamp(32px, 8.5vw, 56px)', fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginTop: 10 }}>
              {fmtKr(combined.maxPurchase)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="card-eyebrow" style={{ color: 'rgba(207,224,239,0.6)', marginBottom: 6 }}>Mål</div>
            {editingGoal ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="input sm" value={goalInput} onChange={e => setGoalInput(e.target.value)}
                  autoFocus
                  style={{ width: 130, textAlign: 'right', fontVariantNumeric: 'tabular-nums', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#E8EFF7' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { const v = parseInt(goalInput.replace(/\s/g, '')); if (v > 0) saveGoal(v); setEditingGoal(false); }
                    if (e.key === 'Escape') setEditingGoal(false);
                  }} />
                <Btn ghost sm onClick={() => { const v = parseInt(goalInput.replace(/\s/g, '')); if (v > 0) saveGoal(v); setEditingGoal(false); }}>OK</Btn>
              </div>
            ) : (
              <button onClick={() => { setGoalInput(String(goal)); setEditingGoal(true); }}
                style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 0, textAlign: 'right' }}>
                <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: '#E8EFF7' }}>{fmtKr(goal)}</div>
                <div className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.4)', marginTop: 3 }}>klikk for å endre</div>
              </button>
            )}
          </div>
        </div>
        <div>
          <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3 }}>
            <div style={{ width: goalPct + '%', height: '100%', background: goalPct >= 100 ? C_COL : 'var(--accent-soft)', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: '2px 12px' }}>
            <span className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.5)' }}>{goalPct.toFixed(1).replace('.', ',')}% av målet</span>
            <span className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.5)' }}>Formue {fmtKr(combined.equity)} · Maks lån {fmtKr(combined.maxLoan)}</span>
            <span className="mono" style={{ fontSize: 10, color: 'rgba(207,224,239,0.5)' }}>Annet lån {fmtKr(combined.otherLoans)}</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'Samlet formue (EK)', val: combined.equity },
            { label: `Maks lån (${bpParams.loanMultiple} × inntekt − gjeld)`, val: combined.maxLoan },
          ].map(r => (
            <div key={r.label} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="mono" style={{ fontSize: 9, color: 'rgba(207,224,239,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{r.label}</div>
              <div style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.02em', marginTop: 4, fontVariantNumeric: 'tabular-nums', color: 'rgba(207,224,239,0.7)' }}>{fmtKr(r.val)}</div>
            </div>
          ))}
        </div>
        {/* Cap / blocker analysis */}
        {(() => {
          const equityCap   = combined.maxFromEquity;
          const incomeCap   = combined.maxFromLoan;
          const equityBlocks = combined.limitedBy === 'equity';
          return (
            <div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0 16px' }} />
              <div className="mono" style={{ fontSize: 9, color: 'rgba(207,224,239,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Hva begrenser oss fra å kjøpe for mer?</div>
              <div style={{ display: 'grid', gap: 12 }}>
                {([
                  { label: `Maks vi kan kjøpe for med egenkapitalen vår (EK × ${Math.round(100 / bpParams.equityPct)})`, val: equityCap,  blocker: equityBlocks },
                  { label: `Maks vi kan kjøpe med maks boliglån + oppspart EK (EK + (${bpParams.loanMultiple} × inntekt − gjeld))`, val: incomeCap, blocker: !equityBlocks },
                ] as { label: string; val: number; blocker: boolean }[]).map(r => (
                  <div key={r.label} style={{
                    padding: '10px 14px',
                    background: r.blocker ? 'rgba(202,138,4,0.12)' : 'rgba(255,255,255,0.05)',
                    borderRadius: 4,
                    border: r.blocker ? '1px solid rgba(202,138,4,0.35)' : '1px solid rgba(255,255,255,0.08)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div className="mono" style={{ fontSize: 11, color: r.blocker ? 'rgba(251,191,36,0.8)' : 'rgba(207,224,239,0.55)', lineHeight: 1.4 }}>{r.label}</div>
                      {r.blocker && <div className="mono" style={{ fontSize: 8, color: 'rgba(251,191,36,0.85)', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'rgba(202,138,4,0.2)', padding: '1px 5px', borderRadius: 2, flexShrink: 0, whiteSpace: 'nowrap', marginTop: 2 }}>begrenser</div>}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.02em', marginTop: 4, fontVariantNumeric: 'tabular-nums', color: r.blocker ? '#FBD06A' : 'rgba(207,224,239,0.7)' }}>{fmtKr(r.val)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>}

      {/* ── Person cards + equity/formue delta ── */}
      {hasData && (
        <div className="grid grid-12" style={{ alignItems: 'start' }}>
          <div className="col-3"><PersonCard who="M" entry={latestM} params={bpParams} /></div>
          <div className="col-3"><PersonCard who="L" entry={latestL} params={bpParams} /></div>
          <div className="col-3"><WealthDelta allM={allM} allL={allL} eyebrow="Egenkapital" calc={e => e.assets - e.boligLaan} /></div>
          <div className="col-3"><WealthDelta allM={allM} allL={allL} eyebrow="Positiv formue" calc={e => e.assets - e.boligLaan - e.annetLaan} /></div>
        </div>
      )}

      {/* ── Charts + form ── */}
      <div className="grid grid-12" style={{ alignItems: 'start' }}>
        {hasData && (
          <div className="col-8 col" style={{ gap: 16 }}>
            <FilterableChart title="Kjøpekraft over tid" combined={bpCombined} m={bpM} l={bpL} monthsM={monthsM} monthsL={monthsL} goal={goal} />
            <FilterableChart title="Egenkapital over tid" combined={equityCombined} m={equityM} l={equityL} monthsM={monthsM} monthsL={monthsL} />
            <FilterableChart title="Positiv formue over tid" combined={netWorthCombined} m={netWorthM} l={netWorthL} monthsM={monthsM} monthsL={monthsL} />
          </div>
        )}
        <div className={hasData ? 'col-4' : 'col-12'}>
          <AddForm
            onSave={(who, entry) => { void save(who, entry); }}
            preset={preset}
            onClearPreset={() => setPreset(null)}
            lastEntries={{ M: latestM, L: latestL }}
            entriesByMonth={entriesByMonth}
            params={bpParams}
          />
        </div>
      </div>

      {/* ── Log ── */}
      <LogTable allM={allM} allL={allL} onEdit={handleLogEdit} />
      </>}
    </>
  );
}
