// Investering-fanen: alt om sparingen samlet ett sted.
//
// Fanen måler bare pengestrømmen — innskudd og uttak fra transaksjonene
// (kind = 'investment'). Markedsverdi og avkastning er bevisst utelatt: det
// ville krevd at man førte inn verdien manuelt hver måned.
//
// Den ENE tingen som ikke kan utledes er hva som allerede sto der da sporingen
// startet. Det registreres én gang som et startbeløp og legges til i alle
// totaler og i kurven fra første måned. Det lagres som én rad i
// investment_values (account = 'start', måned = BASELINE_MONTH) — samme tabell
// som scripts/investment-values-migration.sql oppretter.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtKr } from '../../components';
import { useConfirm } from '../../contexts/ConfirmContext';
import { monthLabel, ownerOf, OWNERS, SOURCE_COLOR, isInvestment, isIncome } from './shared';

// ─── Typer ────────────────────────────────────────────────────────────────────

interface Tx {
  id: string;
  date: string;
  description: string;
  amount: number;                 // negativ = innskudd (ut av konto), positiv = uttak
  source: 'bank_M' | 'bank_L' | 'trumf' | 'felles';
  category: string;
  kind?: string;
  month: string;
  note?: string | null;
}

interface BaselineRow {
  id: string;
  month: string;
  account: string;
  value: number;
  note?: string | null;
}

// Startbeløpet hører ikke til noen ekte måned — det er alt som ble satt inn FØR
// den første sporede transaksjonen. Fast sentinel-måned gjør at raden alltid er
// den samme (unique-nøkkelen er (month, account)) og at den aldri kan snike seg
// inn i månedslistene.
const BASELINE_MONTH   = '0000-00';
const BASELINE_ACCOUNT = 'start';

// ─── Småhjelpere ──────────────────────────────────────────────────────────────

const nf  = new Intl.NumberFormat('nb-NO');
const num = (n: number) => nf.format(Math.round(n));

/** Alle måneder fra og med `from` til og med `to`, også de uten data — ellers
 *  ville kurven hoppet over stille måneder og sett brattere ut enn den er. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let guard = 0;
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// Punktene mappes til et W×H-koordinatsystem med luft topp/bunn (samme grep som
// linjediagrammet på Statistikk), så linjer aldri klippes av viewBoxen.
const yOf = (v: number, H: number, min: number, max: number, pad = 8) =>
  H - pad - ((v - min) / ((max - min) || 1)) * (H - pad * 2);

// ─── Komponent ────────────────────────────────────────────────────────────────

export default function InvestTab({ isMobile, onOpenMonth }: {
  isMobile: boolean;
  onOpenMonth: (month: string) => void;
}) {
  const { confirm } = useConfirm();

  const [txs, setTxs]         = useState<Tx[]>([]);
  const [baseline, setBaseline] = useState<BaselineRow | null>(null);
  const [incomeByMonth, setIncomeByMonth] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  // Tabellen finnes ikke før migrasjonen er kjørt — da skal fanen si fra,
  // ikke bare la startbeløpet forsvinne stille når man lagrer.
  const [tableMissing, setTableMissing] = useState(false);

  const [showAllTxs, setShowAllTxs] = useState(false);
  const [txAccount, setTxAccount]   = useState('');       // '' = alle kontoer
  const [hoverMonth, setHoverMonth] = useState<string | null>(null);

  // Skjema for startbeløpet
  const [formValue, setFormValue] = useState('');
  const [editingStart, setEditingStart] = useState(false);
  const [saving, setSaving]       = useState(false);

  // ── Last data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let stale = false;
    (async () => {
      setLoading(true);
      const [txRes, valRes, incRes] = await Promise.all([
        supabase.from('transactions').select('*').or('kind.eq.investment,category.eq.investering'),
        supabase.from('investment_values').select('*').eq('account', BASELINE_ACCOUNT).limit(1),
        // Bare feltene sparerate-regnestykket trenger — hele tabellen ville vært tung.
        supabase.from('transactions').select('month,amount,kind,category'),
      ]);
      if (stale) return;

      const rows = ((txRes.data ?? []) as Tx[])
        .filter(isInvestment)                                   // trygghet mot .or()-treff vi ikke vil ha
        .sort((a, b) => b.date.localeCompare(a.date));
      setTxs(rows);

      if (valRes.error) {
        setTableMissing(true);
        setBaseline(null);
      } else {
        setTableMissing(false);
        const row = (valRes.data ?? [])[0] as BaselineRow | undefined;
        setBaseline(row ? { ...row, value: Number(row.value) || 0 } : null);
      }

      const inc: Record<string, number> = {};
      for (const r of (incRes.data ?? []) as Tx[]) {
        if (!r.month || !isIncome(r)) continue;
        inc[r.month] = (inc[r.month] ?? 0) + Number(r.amount);
      }
      setIncomeByMonth(inc);
      setLoading(false);
    })();
    return () => { stale = true; };
  }, []);

  // ── Avledede tall ───────────────────────────────────────────────────────────
  const d = useMemo(() => {
    const deposits   = txs.filter(t => t.amount < 0);
    const withdrawls = txs.filter(t => t.amount > 0);
    const totalIn    = -deposits.reduce((s, t) => s + t.amount, 0);
    const totalOut   =  withdrawls.reduce((s, t) => s + t.amount, 0);
    const net        = totalIn - totalOut;

    // Startbeløpet er det som allerede sto der før første sporede transaksjon.
    // Det ligger som et fast påslag under hele kurven — ikke i noen enkeltmåned.
    const start = baseline?.value ?? 0;
    const saved = start + net;

    // Netto per måned (positivt = spart), og hele tidslinja med tomme måneder fylt inn
    const netByMonth: Record<string, number> = {};
    for (const t of txs) netByMonth[t.month] = (netByMonth[t.month] ?? 0) - t.amount;

    const stamps = Object.keys(netByMonth).filter(Boolean).sort();
    const timeline = stamps.length ? monthsBetween(stamps[0], stamps[stamps.length - 1]) : [];

    // Kumulativt innskutt, startbeløpet inkludert fra første måned
    let run = start;
    const cum: Record<string, number> = {};
    for (const m of timeline) { run += netByMonth[m] ?? 0; cum[m] = run; }

    // Per konto (butikk-/plattformnavnet på transaksjonen)
    const byAccount: Record<string, { in: number; out: number; net: number; count: number; last: string }> = {};
    for (const t of txs) {
      const a = byAccount[t.description] ??= { in: 0, out: 0, net: 0, count: 0, last: t.date };
      if (t.amount < 0) a.in += -t.amount; else a.out += t.amount;
      a.net += -t.amount;
      a.count += 1;
      if (t.date > a.last) a.last = t.date;
    }
    const accounts = Object.entries(byAccount).sort((x, y) => y[1].net - x[1].net);

    // Per person — felles deles 50/50, som ellers på siden
    const ownNet = (who: 'bank_M' | 'bank_L') => {
      const own    = -txs.filter(t => t.source === who).reduce((s, t) => s + t.amount, 0);
      const felles = -txs.filter(t => t.source === 'trumf' || t.source === 'felles').reduce((s, t) => s + t.amount, 0);
      return own + felles / 2;
    };
    const perPerson = [
      { id: 'bank_M' as const, name: 'Mikkel', net: ownNet('bank_M') },
      { id: 'bank_L' as const, name: 'Leah',   net: ownNet('bank_L') },
    ];

    // Sparerate: netto spart mot inntekt i de månedene det faktisk kom inn penger
    const incomeMonths = timeline.filter(m => (incomeByMonth[m] ?? 0) > 0);
    const incomeSum    = incomeMonths.reduce((s, m) => s + incomeByMonth[m], 0);
    const netInIncomeMonths = incomeMonths.reduce((s, m) => s + (netByMonth[m] ?? 0), 0);
    const savingsRate  = incomeSum > 0 ? (netInIncomeMonths / incomeSum) * 100 : null;

    // Måneder med faktisk bevegelse — snittet skal ikke dras ned av stille måneder
    const activeMonths = timeline.filter(m => (netByMonth[m] ?? 0) !== 0);
    const avgPerActive = activeMonths.length ? net / activeMonths.length : 0;
    const best = activeMonths.reduce<{ m: string; v: number } | null>(
      (b, m) => (!b || netByMonth[m] > b.v ? { m, v: netByMonth[m] } : b), null);
    const last12 = timeline.slice(-12);
    const net12  = last12.reduce((s, m) => s + (netByMonth[m] ?? 0), 0);

    // Startbeløpet merkes med måneden sporingen faktisk starter i, ikke et vagt
    // «før sporing» — «Før apr 2026» sier med én gang hva som ikke er med.
    const firstMonth = timeline[0] ?? null;
    const startLabel = firstMonth ? `Før ${monthLabel(firstMonth).toLowerCase()}` : 'Før sporing';
    // Kort variant til de trange KPI-boksene: «apr '26» i stedet for «apr 2026»,
    // som ellers blir klippet midt i årstallet.
    const startLabelShort = firstMonth
      ? `før ${monthLabel(firstMonth).replace(/ \d{2}(\d{2})$/, " '$1").toLowerCase()}`
      : 'før sporing';

    return {
      totalIn, totalOut, net, start, saved, netByMonth, timeline, cum,
      firstMonth, startLabel, startLabelShort,
      accounts, perPerson, savingsRate, activeMonths, avgPerActive, best, net12, last12,
    };
  }, [txs, baseline, incomeByMonth]);

  // ── Lagre / nullstille startbeløpet ─────────────────────────────────────────
  async function saveBaseline() {
    const parsed = Number(formValue.replace(/\s/g, '').replace(/ /g, '').replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setSaving(true);
    const { data, error } = await supabase.from('investment_values').upsert({
      month: BASELINE_MONTH, account: BASELINE_ACCOUNT,
      value: parsed, note: 'Innskutt før sporingen startet',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'month,account' }).select().single();
    setSaving(false);
    if (error) {
      await confirm({ title: 'Kunne ikke lagre', message: error.message, confirmLabel: 'OK', danger: false });
      return;
    }
    setBaseline({ ...(data as BaselineRow), value: Number((data as BaselineRow).value) || 0 });
    setEditingStart(false);
  }

  async function clearBaseline() {
    if (!baseline) return;
    if (!await confirm({
      title: 'Fjern startbeløp?',
      message: `${fmtKr(baseline.value)} tas ut av alle totaler og kurven.`,
      confirmLabel: 'Fjern',
    })) return;
    await supabase.from('investment_values').delete().eq('id', baseline.id);
    setBaseline(null);
    setEditingStart(false);
    setFormValue('');
  }

  // ── Stiler (samme språk som resten av Økonomi-siden) ────────────────────────
  const card: React.CSSProperties = {
    background: 'var(--surface)', borderRadius: 10, padding: 20,
    border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12,
  };
  const monoNum: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
  const ey: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)',
  };
  const cardHead = (title: React.ReactNode, aside?: React.ReactNode) => (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 8, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid var(--line)',
    }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
      {aside && <span style={{ ...ey, ...monoNum, color: 'var(--ink-4)', fontSize: 10 }}>{aside}</span>}
    </div>
  );
  const inputStyle: React.CSSProperties = {
    fontSize: 13, padding: '6px 10px', borderRadius: 8,
    border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--fg)', minWidth: 0,
  };
  const GOLD  = 'var(--warn)';     // innskutt
  const GREEN = 'var(--good)';     // penger inn

  if (loading) return <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Laster…</div>;

  if (txs.length === 0) {
    return (
      <div style={{ ...card, alignItems: 'center', padding: 48, gap: 8 }}>
        <span style={{ fontSize: 32 }}>💰</span>
        <span style={{ fontWeight: 600 }}>Ingen investeringstransaksjoner ennå</span>
        <span style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', maxWidth: 460, lineHeight: 1.5 }}>
          Rader merket som sparing (Kron, Nordnet, BSU …) dukker opp her. Merk en transaksjon
          som «Investering» på Oversikt, så havner den i denne fanen.
        </span>
      </div>
    );
  }

  const listTxs = txAccount ? txs.filter(t => t.description === txAccount) : txs;
  const shownTxs = showAllTxs ? listTxs : listTxs.slice(0, 40);

  // KPI-boksene på toppen
  const kpi = (label: string, value: string, sub?: string, color?: string, title?: string) => (
    <div key={label} title={title} style={{
      // basis 150px (ikke 0) — ellers bryter boksene aldri til ny rad, de bare
      // klipper tallet når vinduet er smalt
      flex: '1 1 150px', minWidth: isMobile ? 0 : 150, padding: '14px 16px',
      background: 'var(--bg)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ ...ey, fontSize: 10 }}>{label}</span>
      <span style={{
        ...monoNum, fontSize: isMobile ? 16 : 21, fontWeight: 600, letterSpacing: '-0.02em',
        color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</span>
      {sub && <span style={{ ...monoNum, fontSize: 10, color: 'var(--ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Nøkkeltall ─────────────────────────────────────────────────────── */}
      <div style={{ display: isMobile ? 'grid' : 'flex', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, flexWrap: 'wrap' }}>
        {kpi('💰 Spart totalt', fmtKr(d.saved),
          d.start > 0 ? `${num(d.start)} ${d.startLabelShort} · ${num(d.net)} etter` : 'netto inn − ut',
          GOLD,
          d.start > 0
            ? `Startbeløp ${fmtKr(d.start)} (${d.startLabel.toLowerCase()}) + netto ${fmtKr(d.net)} etter det`
            : `Innskudd ${fmtKr(d.totalIn)} minus uttak ${fmtKr(d.totalOut)}`)}
        {kpi('↓ Satt inn', fmtKr(d.totalIn), 'sporede innskudd', GREEN)}
        {kpi('↑ Tatt ut', fmtKr(d.totalOut), d.totalOut > 0 ? 'sporede uttak' : 'ingen uttak',
          d.totalOut > 0 ? 'var(--danger)' : 'var(--ink-4)')}
        {kpi('📅 Snitt per aktiv mnd', fmtKr(Math.round(d.avgPerActive)),
          `${d.activeMonths.length} mnd med bevegelse`)}
        {kpi('🗓️ Siste 12 mnd', fmtKr(Math.round(d.net12)),
          d.savingsRate !== null ? `sparerate ${d.savingsRate.toFixed(0)} % av inntekt` : 'netto spart')}
      </div>

      {/* ── Hero: spart over tid ───────────────────────────────────────────── */}
      <div style={card}>
        {cardHead(
          'Sparing over tid · kumulativt',
          d.timeline.length > 1 ? `${monthLabel(d.timeline[0])} – ${monthLabel(d.timeline[d.timeline.length - 1])}` : undefined,
        )}
        {d.start > 0 && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            Stiplet linje = {fmtKr(d.start)} som allerede sto der {d.startLabel.toLowerCase()}. Alt over den er spart siden.
          </span>
        )}

        {(() => {
          const T = d.timeline;
          if (T.length === 0) return null;
          const LW = 1040, LH = isMobile ? 160 : 220, PAD = 10;
          const cumVals = T.map(m => d.cum[m]);
          const min = Math.min(0, ...cumVals);
          const max = Math.max(1, ...cumVals);
          const x = (i: number) => T.length === 1 ? LW / 2 : (i / (T.length - 1)) * LW;
          const xPct = (i: number) => T.length === 1 ? 50 : (i / (T.length - 1)) * 100;
          const y = (v: number) => yOf(v, LH, min, max, PAD);
          const cumPts = T.map((m, i) => `${x(i).toFixed(1)},${y(d.cum[m]).toFixed(1)}`);
          const zeroY  = y(0);
          const areaD  = `M0,${zeroY} L${cumPts.join(' L')} L${LW},${zeroY} Z`;
          const labelStep = isMobile ? Math.ceil(T.length / 5) : Math.ceil(T.length / 12);
          const hoverIdx = hoverMonth ? T.indexOf(hoverMonth) : -1;

          return (
            <>
              <div style={{ position: 'relative', width: '100%', height: LH }}>
                <svg width="100%" height={LH} viewBox={`0 0 ${LW} ${LH}`} preserveAspectRatio="none"
                  style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
                  {min < 0 && <line x1="0" y1={zeroY} x2={LW} y2={zeroY} stroke="var(--line-2)" strokeWidth="1" />}
                  {T.length > 1 && <path d={areaD} fill={GOLD} opacity={0.12} />}
                  {/* Startnivået — alt under linja lå der før første sporede måned */}
                  {d.start > 0 && (
                    <line x1="0" y1={y(d.start)} x2={LW} y2={y(d.start)}
                      stroke="var(--ink-4)" strokeWidth="1" strokeDasharray="5 5" />
                  )}
                  {T.length > 1 && <polyline points={cumPts.join(' ')} fill="none" stroke={GOLD} strokeWidth="2" />}
                </svg>

                {/* Etikett på startlinja */}
                {d.start > 0 && (
                  <span style={{
                    position: 'absolute', left: 0, top: `${(y(d.start) / LH) * 100}%`,
                    transform: 'translateY(-100%)', ...monoNum, fontSize: 9, color: 'var(--muted)',
                    background: 'var(--surface)', padding: '0 3px', pointerEvents: 'none',
                  }}>{d.startLabel.toLowerCase()}</span>
                )}

                {/* Klikkbare måneder — hopper til Oversikt for den måneden */}
                {T.map((m, i) => (
                  <button key={m}
                    onClick={() => onOpenMonth(m)}
                    onMouseEnter={() => setHoverMonth(m)}
                    onMouseLeave={() => setHoverMonth(h => h === m ? null : h)}
                    onFocus={() => setHoverMonth(m)}
                    onBlur={() => setHoverMonth(h => h === m ? null : h)}
                    aria-label={`${monthLabel(m)}: spart ${fmtKr(d.cum[m])} totalt — åpne i Oversikt`}
                    style={{
                      position: 'absolute', left: `${xPct(i)}%`, top: 0, bottom: 0, width: 24,
                      transform: 'translateX(-50%)', border: 'none', background: 'transparent',
                      cursor: 'pointer', padding: 0,
                    }}>
                    <span style={{
                      position: 'absolute', left: '50%', top: `${(y(d.cum[m]) / LH) * 100}%`,
                      transform: 'translate(-50%,-50%)',
                      width: i === hoverIdx ? 10 : 6, height: i === hoverIdx ? 10 : 6, borderRadius: '50%',
                      background: i === hoverIdx ? 'var(--ink)' : 'var(--surface)',
                      border: `1.5px solid ${i === hoverIdx ? 'var(--ink)' : GOLD}`, display: 'block',
                    }} />
                  </button>
                ))}

                {/* Tooltip for måneden man peker på */}
                {hoverIdx !== -1 && (() => {
                  const m = T[hoverIdx];
                  const flow = d.netByMonth[m] ?? 0;
                  return (
                    <div style={{
                      position: 'absolute', left: `${xPct(hoverIdx)}%`, top: -6,
                      transform: `translate(${hoverIdx > T.length * 0.7 ? '-100%' : hoverIdx < T.length * 0.3 ? '0' : '-50%'}, -100%)`,
                      background: 'var(--ink)', color: 'var(--surface)', borderRadius: 8, padding: '6px 10px',
                      fontSize: 11, lineHeight: 1.5, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 2,
                    }}>
                      <strong>{monthLabel(m)}</strong><br />
                      Spart totalt {num(d.cum[m])} kr
                      {flow !== 0 && <><br />{flow > 0 ? 'Satt inn' : 'Tatt ut'} denne mnd {num(Math.abs(flow))} kr</>}
                    </div>
                  );
                })()}
              </div>

              {/* Månedsetiketter */}
              <div style={{ position: 'relative', height: 14 }}>
                {T.map((m, i) => (i % Math.max(1, labelStep) === 0 || i === T.length - 1) && (
                  <span key={m} style={{
                    position: 'absolute', left: `${xPct(i)}%`, transform: 'translateX(-50%)',
                    ...monoNum, fontSize: 9, color: 'var(--ink-4)', whiteSpace: 'nowrap',
                  }}>{monthLabel(m)}</span>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      {/* ── Per konto + per person ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : '7fr 5fr', gap: 12, alignItems: 'start' }}>
        <div style={{ ...card, minWidth: 0 }}>
          {cardHead('Per konto', d.start > 0 ? `${d.accounts.length} stk + start` : `${d.accounts.length} stk`)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.accounts.map(([name, a]) => {
              const share = d.net > 0 ? (a.net / d.net) * 100 : 0;
              return (
                <div key={name} style={{ display: 'grid', gap: 10, alignItems: 'center', gridTemplateColumns: isMobile ? '1fr 78px' : '150px 1fr 92px 62px' }}>
                  <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  {!isMobile && (
                    <span style={{ position: 'relative', height: 6, background: 'var(--line)', borderRadius: 3, display: 'block' }}>
                      <i style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, background: GOLD,
                        width: Math.max(a.net > 0 ? 2 : 0, Math.min(100, share)) + '%',
                      }} />
                    </span>
                  )}
                  <span style={{ ...monoNum, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtKr(a.net)}</span>
                  {!isMobile && (
                    <span style={{ ...monoNum, fontSize: 10, color: 'var(--ink-4)', textAlign: 'right' }}
                      title={`${a.count} transaksjoner · ${num(a.in)} inn · ${num(a.out)} ut`}>
                      {a.count} stk
                    </span>
                  )}
                </div>
              );
            })}
            {/* Startbeløpet hører ikke til noen konto — men uten det summerer
                ikke lista til «Spart totalt», og da ser tallene feil ut. */}
            {d.start > 0 && (
              <div style={{
                display: 'grid', gap: 10, alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 10,
                gridTemplateColumns: isMobile ? '1fr 78px' : '150px 1fr 92px 62px',
              }}>
                <span style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.startLabel}
                </span>
                {!isMobile && (
                  <span style={{ position: 'relative', height: 6, background: 'var(--line)', borderRadius: 3, display: 'block' }}>
                    <i style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, background: 'var(--ink-4)',
                      width: Math.min(100, d.net > 0 ? (d.start / d.net) * 100 : 100) + '%',
                    }} />
                  </span>
                )}
                <span style={{ ...monoNum, fontSize: 12, fontWeight: 600, textAlign: 'right', color: 'var(--muted)' }}>{fmtKr(d.start)}</span>
                {!isMobile && (
                  <span style={{ ...monoNum, fontSize: 10, color: 'var(--ink-4)', textAlign: 'right' }}>start</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ ...card, minWidth: 0 }}>
          {cardHead('Per person', d.start > 0 ? 'felles 50/50 · uten start' : 'felles delt 50/50')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.perPerson.map(p => {
              const tot = d.perPerson.reduce((s, q) => s + Math.max(0, q.net), 0);
              const share = tot > 0 ? (Math.max(0, p.net) / tot) * 100 : 0;
              return (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600, color: SOURCE_COLOR[p.id] }}>
                      {OWNERS.find(o => o.id === p.id)?.emoji} {p.name}
                    </span>
                    <span style={{ ...monoNum, fontWeight: 700 }}>{fmtKr(p.net)}</span>
                  </div>
                  <span style={{ position: 'relative', height: 6, background: 'var(--line)', borderRadius: 3, display: 'block' }}>
                    <i style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, background: SOURCE_COLOR[p.id], width: `${share}%` }} />
                  </span>
                </div>
              );
            })}
            {d.best && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ ...ey, fontSize: 10 }}>🏆 Beste måned</span>
                <span style={{ fontSize: 12.5 }}>
                  {monthLabel(d.best.m)} · <strong style={monoNum}>{fmtKr(d.best.v)}</strong>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Måned for måned ────────────────────────────────────────────────── */}
      <div style={card}>
        {cardHead('Måned for måned', 'inn/ut · spart totalt')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
          {[...d.timeline].reverse().map(m => {
            const flow = d.netByMonth[m] ?? 0;
            const maxFlow = Math.max(...d.timeline.map(x => Math.abs(d.netByMonth[x] ?? 0)), 1);
            return (
              <div key={m} style={{
                display: 'grid', alignItems: 'center', gap: 8, padding: '6px 0',
                gridTemplateColumns: isMobile ? '68px 1fr 84px' : '84px 1fr 96px 104px',
                borderBottom: '1px solid var(--line)',
              }}>
                <button onClick={() => onOpenMonth(m)} title={`Åpne ${monthLabel(m)} i Oversikt`} style={{
                  ...monoNum, fontSize: 11, textAlign: 'left', border: 'none', background: 'transparent',
                  color: 'var(--muted)', cursor: 'pointer', padding: 0,
                }}>{monthLabel(m)}</button>
                <span style={{ position: 'relative', height: 6, background: 'var(--line)', borderRadius: 3, display: 'block' }}>
                  <i style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3,
                    background: flow >= 0 ? GOLD : 'var(--danger)',
                    width: Math.min(100, (Math.abs(flow) / maxFlow) * 100) + '%',
                  }} />
                </span>
                <span style={{ ...monoNum, fontSize: 11.5, fontWeight: 600, textAlign: 'right', color: flow === 0 ? 'var(--ink-4)' : flow > 0 ? undefined : 'var(--danger)' }}>
                  {flow === 0 ? '–' : `${flow > 0 ? '+' : '−'}${num(Math.abs(flow))}`}
                </span>
                {!isMobile && (
                  <span style={{ ...monoNum, fontSize: 10.5, textAlign: 'right', color: 'var(--ink-4)' }}>
                    {num(d.cum[m])} totalt
                  </span>
                )}
              </div>
            );
          })}
          {/* Nederste rad = utgangspunktet lista bygger videre på */}
          {d.start > 0 && (
            <div style={{
              display: 'grid', alignItems: 'center', gap: 8, padding: '6px 0',
              gridTemplateColumns: isMobile ? '68px 1fr 84px' : '84px 1fr 96px 104px',
            }}>
              <span style={{ ...monoNum, fontSize: 11, color: 'var(--ink-4)' }}>{d.startLabel}</span>
              <span />
              <span style={{ ...monoNum, fontSize: 11.5, fontWeight: 600, textAlign: 'right', color: 'var(--muted)' }}>
                {num(d.start)}
              </span>
              {!isMobile && (
                <span style={{ ...monoNum, fontSize: 10.5, textAlign: 'right', color: 'var(--ink-4)' }}>start</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Startbeløp ─────────────────────────────────────────────────────── */}
      <div style={card}>
        {cardHead('Startbeløp', tableMissing ? 'tabellen mangler' : (d.start > 0 ? d.startLabel.toLowerCase() : 'ikke satt'))}
        {tableMissing ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            Tabellen <code>investment_values</code> finnes ikke ennå. Kjør{' '}
            <code>scripts/investment-values-migration.sql</code> i Supabase SQL-editoren én gang,
            så kan du registrere hva som allerede sto der da sporingen startet.
            Alt annet her fungerer uten.
          </div>
        ) : (
          <>
            <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
              Registreres én gang: hva du hadde satt inn til sammen
              {d.firstMonth
                ? <> før <strong>{monthLabel(d.firstMonth).toLowerCase()}</strong>, som er den første måneden med importerte transaksjoner.</>
                : <> før den første importerte transaksjonen.</>}
              {' '}Beløpet vises som «{d.startLabel}» i totalene og løfter kurven fra første måned.
              Det er ingen markedsverdi — fanen måler bare hva som er satt inn og tatt ut.
            </span>
            {d.start > 0 && !editingStart ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ ...monoNum, fontSize: 21, fontWeight: 600, color: GOLD }}>{fmtKr(d.start)}</span>
                <span style={{ ...ey, fontSize: 10 }}>{d.startLabel}</span>
                <button onClick={() => { setFormValue(String(d.start)); setEditingStart(true); }} style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)',
                }}>Endre</button>
                <button onClick={clearBaseline} style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: 'none', background: 'transparent', color: 'var(--muted)',
                }}>Fjern</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={formValue} onChange={e => setFormValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveBaseline(); if (e.key === 'Escape') setEditingStart(false); }}
                  inputMode="numeric"
                  placeholder={d.firstMonth ? `Satt inn før ${monthLabel(d.firstMonth).toLowerCase()}` : 'Totalt satt inn før sporingen'}
                  autoFocus={editingStart}
                  style={{ ...inputStyle, width: isMobile ? '100%' : 230, ...monoNum }} />
                <button onClick={saveBaseline} disabled={saving || !formValue.trim()} style={{
                  padding: '7px 16px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 600,
                  background: 'var(--ink)', color: 'var(--surface)',
                  cursor: saving || !formValue.trim() ? 'default' : 'pointer',
                  opacity: saving || !formValue.trim() ? 0.5 : 1,
                }}>{saving ? 'Lagrer…' : 'Lagre'}</button>
                {editingStart && (
                  <button onClick={() => setEditingStart(false)} style={{
                    padding: '7px 12px', borderRadius: 8, border: 'none', fontSize: 12,
                    background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                  }}>Avbryt</button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Alle investeringstransaksjoner ─────────────────────────────────── */}
      <div style={card}>
        {cardHead('Alle investeringstransaksjoner', `${listTxs.length} stk`)}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={txAccount} onChange={e => { setTxAccount(e.target.value); setShowAllTxs(false); }}
            style={{ ...inputStyle, cursor: 'pointer', borderRadius: 20, fontWeight: 600, fontSize: 12 }}>
            <option value="">Alle kontoer ({txs.length})</option>
            {d.accounts.map(([name, a]) => <option key={name} value={name}>{name} ({a.count})</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
          {shownTxs.map(t => {
            const owner = OWNERS.find(o => o.id === ownerOf(t.source))!;
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                borderBottom: '1px solid var(--line)',
              }}>
                <span title={owner.label} style={{ width: 20, textAlign: 'center', fontSize: 14, flexShrink: 0 }}>{owner.emoji}</span>
                <span style={{ ...monoNum, fontSize: 11, color: 'var(--muted)', width: 74, flexShrink: 0 }}>{t.date}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.description}
                  {t.note && <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 12 }}> · 💬 {t.note}</span>}
                </span>
                <span style={{
                  ...monoNum, fontSize: 13, fontWeight: 600, textAlign: 'right', flexShrink: 0,
                  color: t.amount > 0 ? 'var(--danger)' : GOLD,
                }} title={t.amount > 0 ? 'Uttak fra investering' : 'Innskudd til investering'}>
                  {t.amount > 0 ? '−' : '+'}{num(Math.abs(t.amount))} kr
                </span>
              </div>
            );
          })}
          {listTxs.length > 40 && (
            <button onClick={() => setShowAllTxs(v => !v)} style={{
              margin: '12px auto 2px', padding: '6px 16px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)',
              fontSize: 12, fontWeight: 600,
            }}>
              {showAllTxs ? 'Vis færre' : `Vis alle (${listTxs.length})`}
            </button>
          )}
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
          Fortegnet er sett fra sparingen: + er penger inn i investeringen, − er uttak.
        </span>
      </div>
    </div>
  );
}
