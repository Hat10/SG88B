import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { useCategories } from '../contexts/CategoryContext';
import { fmtKr } from '../components';
import type { Merchant, TxMeta } from '../lib/import';
import { isBareIntermediary } from '../lib/import';
import ImportTab from './okonomi/ImportTab';
import InvestTab from './okonomi/InvestTab';
import { useMerchants } from './okonomi/useMerchants';
import {
  CatTag, OwnerPicker, OWNERS, ownerOf,
  SOURCE_COLOR, monthLabel,
  isInvestment, isExpense, isIncome,
} from './okonomi/shared';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Tx {
  id: string;
  date: string;
  description: string;
  raw_description: string;
  amount: number;
  source: 'bank_M' | 'bank_L' | 'trumf' | 'felles';
  category: string;
  category_confirmed: boolean;
  month: string;
  note?: string | null;
  kind?: string;                              // 'purchase' | 'refund' | 'income' | …
  merchant_id?: string | null;
  meta?: (TxMeta & { aliasKey?: string }) | null;
}


function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// 'YYYY-MM' → 'YYYY-MM-DD' for the last day of that month
function monthEndOf(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
}
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'];
function shortMonth(m: string) {
  const [, mo] = m.split('-');
  return MONTH_NAMES[parseInt(mo, 10) - 1];
}
function compact(n: number) {
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n));
}
// 'YYYY-MM' → forrige måned
function prevMonthOf(m: string) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// De N siste månedene t.o.m. `m` (eldste først)
function lastMonths(m: string, n: number) {
  const out: string[] = [];
  let cur = m;
  for (let i = 0; i < n; i++) { out.unshift(cur); cur = prevMonthOf(cur); }
  return out;
}
const DAY_NAMES = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
const MONTH_LONG = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
// 'YYYY-MM-DD' → 'Tirsdag 30. juni'
function dayLabel(date: string) {
  const d = new Date(date + 'T00:00:00');
  const name = DAY_NAMES[d.getDay()];
  return `${name[0].toUpperCase()}${name.slice(1)} ${d.getDate()}. ${MONTH_LONG[d.getMonth()]}`;
}
const nf = new Intl.NumberFormat('nb-NO');
const num = (n: number) => nf.format(Math.round(n));
// Signert kronebeløp uten enhet — brukes i banner/delta-lister
const signed = (n: number) => (n > 0 ? '+' : '−') + num(Math.abs(n));

// 'YYYY-MM-DD' → '12. jul' — kompakt dato til søkelista (måneden står i gruppetittelen)
function shortDate(date: string) {
  const d = new Date(date + 'T00:00:00');
  return `${d.getDate()}. ${MONTH_NAMES[d.getMonth()].toLowerCase()}`;
}
// Deler `text` opp og markerer treff på hvert søkeord — gjør fulltekstsøket lettere å skumme
function highlightMatch(text: string, tokens: string[]): React.ReactNode {
  if (!text || tokens.length === 0) return text;
  const esc = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  if (esc.length === 0) return text;
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  const lower = tokens.map(t => t.toLowerCase());
  return text.split(re).map((part, i) =>
    lower.includes(part.toLowerCase())
      ? <mark key={i} style={{ background: 'var(--accent-soft, #e8f0fb)', color: 'var(--accent)', borderRadius: 3, padding: '0 1px' }}>{part}</mark>
      : <span key={i}>{part}</span>,
  );
}

// ─── SVG-hjelpere for linjediagram/sparklines ─────────────────────────────────
// Punktene mappes til et W×H-koordinatsystem med `pad` px luft topp/bunn, slik at
// linjer aldri klippes av viewBoxen. Serier med bare ett punkt legges på midten.

interface SvgDomain { min: number; max: number }

// Verdiområdet en serie tegnes i. Alltid med 0 som referanse, og strukket NEDOVER
// når serien har negative verdier — en kategori kan ha netto refusjon i en måned
// (gevinst > innsats på Gambling, uttak fra investering). Uten det havnet slike
// punkter utenfor viewBoxen og grafen så ødelagt ut.
function svgDomain(vals: number[], forcedMax?: number): SvgDomain {
  return {
    min: Math.min(0, ...vals),
    max: Math.max(forcedMax ?? 0, ...vals, 1),
  };
}
function svgPoints(vals: number[], W: number, H: number, d: SvgDomain, pad = 2) {
  const span = d.max - d.min || 1;
  const usable = H - pad * 2;
  const n = vals.length;
  return vals.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
    const y = H - pad - ((v - d.min) / span) * usable;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
}
const svgY = (v: number, H: number, d: SvgDomain, pad = 2) =>
  H - pad - ((v - d.min) / ((d.max - d.min) || 1)) * (H - pad * 2);

// ─── Main component ─────────────────────────────────────────────────────────────

export default function PageOkonomi() {
  const { confirm } = useConfirm();
  // Categories now live in the DB (see CategoryContext). These shadow the old
  // hardcoded maps so every existing reference keeps working, but read from Supabase.
  const {
    categories, labels: CATEGORY_LABELS, colors: CAT_COLORS, counts: catCounts,
    refreshCounts, addCategory, updateCategory: updateCategoryMeta, deleteCategory,
  } = useCategories();
  const [month, setMonth]           = useState(currentMonthStr);
  const [months, setMonths]         = useState<string[]>([]);
  const [txs, setTxs]               = useState<Tx[]>([]);
  const [loading, setLoading]       = useState(true);
  const [trumfMax, setTrumfMax]     = useState<string | null>(null);  // latest imported Trumf date (15–15 cutoff)
  const [trumfLoaded, setTrumfLoaded] = useState(false);
  const didInitMonth = useRef(false);
  // A month is incomplete if it runs past the latest imported Trumf date (Trumf still missing for the rest)
  const monthIncomplete = (m: string) => trumfMax != null && monthEndOf(m) > trumfMax;
  const [tab, setTab]               = useState<'oversikt' | 'transaksjoner' | 'trend' | 'butikker' | 'invest' | 'regler' | 'kategorier' | 'import'>('oversikt');
  // Butikkregisteret (merchants + aliaser) — delt med importfanen
  const merchantsApi = useMerchants();
  const { merchants } = merchantsApi;
  const [merchantsSearch, setMerchantsSearch]   = useState('');
  const [editingMerchantId, setEditingMerchantId] = useState<string | null>(null);
  const [expandedMerchantId, setExpandedMerchantId] = useState<string | null>(null);
  const [mergingMerchantId, setMergingMerchantId] = useState<string | null>(null);
  const [addingMerchant, setAddingMerchant]     = useState(false);
  const [newMerchantName, setNewMerchantName]   = useState('');
  const [newMerchantCategory, setNewMerchantCategory] = useState('annet');
  // Kategorier-tab management
  const [addingCat, setAddingCat]     = useState(false);
  const [newCatName, setNewCatName]   = useState('');
  const [newCatColor, setNewCatColor] = useState('#5B9BD5');
  const [editingCatKey, setEditingCatKey] = useState<string | null>(null);
  const [editingId, setEditingId]               = useState<string | null>(null);
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingOwnerId, setEditingOwnerId] = useState<string | null>(null);

  // Statistikk
  const [prevTxs, setPrevTxs] = useState<Tx[]>([]);

  // Innsikt-filtre
  const [person, setPerson] = useState<'alle' | 'bank_M' | 'bank_L' | 'felles'>('alle');
  const [withFelles, setWithFelles] = useState(false);    // person-filter: ta med ½ av felles
  const [showAllTxs, setShowAllTxs] = useState(false);    // transaksjonsliste: vis 50 vs alle
  const [txCat, setTxCat] = useState('');                 // transaksjonsliste: '' = alle kategorier

  // Butikker
  const [storeRange, setStoreRange] = useState<'month' | 'all'>('month');
  const [storeCat, setStoreCat]     = useState('');
  const [allExpenses, setAllExpenses] = useState<Tx[]>([]);
  const [storeSearch, setStoreSearch] = useState('');
  // Butikkortene lastes 20 om gangen via «Vis flere»
  const STORE_PAGE = 20;
  const [storePage, setStorePage] = useState(1);

  // Trend
  const [trendTxs, setTrendTxs]     = useState<Tx[]>([]);
  const [trendCat, setTrendCat]     = useState('');
  const [trendRange, setTrendRange] = useState<'12' | 'all' | 'month'>('12');
  const [trendLoading, setTrendLoading] = useState(false);
  const [hoverMonth, setHoverMonth]     = useState<string | null>(null);  // punktet man peker på i linjediagrammet

  // Transaksjoner — alle rader på tvers av måneder, med fulltekstsøk (lastes når fanen åpnes)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCat, setSearchCat]     = useState('');
  const [searchTxs, setSearchTxs]     = useState<Tx[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  // Viser 100 rader om gangen («vis neste 100»); søket matcher alltid mot ALLE rader,
  // og telleren viser totalt antall funnet — pagineringen er bare hvor mange som rendres.
  const SEARCH_PAGE = 100;
  const [searchPage, setSearchPage]   = useState(1);

  // Oversikt: 12-mnd forbrukskurve til månedsbanneret (kun sum per måned)
  const [spark12, setSpark12] = useState<Tx[]>([]);

  // Responsive: phones get stacked layouts (matches the app-wide 768px breakpoint)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Refresh per-category transaction counts whenever the Kategorier tab is opened,
  // so the "N transaksjoner" hints and the delete guard reflect the latest imports.
  useEffect(() => {
    if (tab === 'kategorier') refreshCounts();
  }, [tab, refreshCounts]);

  // ── Load months + current month transactions ──────────────────────────────────
  const loadMonths = useCallback(async () => {
    const { data } = await supabase.from('transactions').select('month');
    const unique = [...new Set((data ?? []).map((r: any) => r.month as string))].sort().reverse();
    setMonths(unique);
    return unique;
  }, []);

  const loadTxs = useCallback(async (m: string) => {
    setLoading(true);
    const { data } = await supabase.from('transactions').select('*').eq('month', m).order('date', { ascending: false });
    setTxs((data ?? []) as Tx[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadMonths(); }, []);
  useEffect(() => { loadTxs(month); }, [month, loadTxs]);

  // Latest imported Trumf date — drives the "incomplete month" logic (Trumf invoices lag 15–15)
  useEffect(() => {
    supabase.from('transactions').select('date').eq('source', 'trumf').order('date', { ascending: false }).limit(1)
      .then(({ data }) => { setTrumfMax(data?.[0]?.date ?? null); setTrumfLoaded(true); });
  }, []);

  // Open on the last COMPLETE month by default (skip the half-reported current month)
  useEffect(() => {
    if (didInitMonth.current || !months.length || !trumfLoaded) return;
    didInitMonth.current = true;
    const lastComplete = months.find(m => !monthIncomplete(m)) ?? months[0];  // months sorted newest→oldest
    if (lastComplete && lastComplete !== month) setMonth(lastComplete);
  }, [months, trumfLoaded]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load previous month for comparison ───────────────────────────────────────
  useEffect(() => {
    if (tab !== 'oversikt') return;
    const [y, mo] = month.split('-').map(Number);
    const d = new Date(y, mo - 2, 1);
    const pm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // Ved oppstart bytter måneden raskt (dagens → siste komplette) — ignorer
    // svar fra utdaterte spørringer så «vs forrige måned» aldri viser feil måned.
    let stale = false;
    supabase.from('transactions').select('*').eq('month', pm)
      .then(({ data }) => { if (!stale) setPrevTxs((data ?? []) as Tx[]); });
    return () => { stale = true; };
  }, [tab, month]);

  // ── Load the last 12 months for the Oversikt sparkline ───────────────────────
  // Bare feltene banneret trenger — hele raden ville vært unødvendig tung her.
  useEffect(() => {
    if (tab !== 'oversikt') return;
    const from = lastMonths(month, 12)[0];
    let stale = false;
    supabase.from('transactions').select('month,amount,kind,category,source')
      .gte('month', from).lte('month', month)
      .then(({ data }) => { if (!stale) setSpark12((data ?? []) as Tx[]); });
    return () => { stale = true; };
  }, [tab, month]);

  // Collapse the transaction list back to 50 when the month or person filter changes
  useEffect(() => { setShowAllTxs(false); }, [month, person, withFelles]);
  // Tilbake til første side når filtrene endres, så man ikke sitter dypt i en gammel liste
  useEffect(() => { setStorePage(1); }, [storeRange, storeCat, storeSearch, person, withFelles, month]);

  // ── Load all expenses for Butikker ────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'butikker') return;
    const q = storeRange === 'month'
      ? supabase.from('transactions').select('*').eq('month', month).or('amount.lt.0,kind.eq.refund')
      : supabase.from('transactions').select('*').or('amount.lt.0,kind.eq.refund');
    q.then(({ data }) => setAllExpenses((data ?? []) as Tx[]));
  }, [tab, month, storeRange]);

  // ── Load all transactions for Statistikk (expenses + income, all months) ──────
  useEffect(() => {
    if (tab !== 'trend') return;
    setTrendLoading(true);
    supabase.from('transactions').select('*')
      .then(({ data }) => { setTrendTxs((data ?? []) as Tx[]); setTrendLoading(false); });
  }, [tab]);

  // ── Load all transactions for Transaksjoner-fanen (alle måneder) ──────────────
  // Lastes på nytt hver gang fanen åpnes, så nylig importerte/endrede rader er med.
  useEffect(() => {
    if (tab !== 'transaksjoner') return;
    setSearchLoading(true);
    supabase.from('transactions').select('*').order('date', { ascending: false })
      .then(({ data }) => { setSearchTxs((data ?? []) as Tx[]); setSearchLoading(false); });
  }, [tab]);
  // Tilbake til første side når søket eller kategorifilteret endres
  useEffect(() => { setSearchPage(1); }, [searchQuery, searchCat, person, withFelles]);

  // En redigering av én transaksjon må speiles i BEGGE listene som kan holde raden:
  // Oversiktens månedsliste (`txs`) og Transaksjoner-fanens alle-måneder-liste
  // (`searchTxs`). Ellers henger den ene fanen igjen med gamle verdier når man
  // redigerer fra den andre. En id som ikke finnes i en liste lar den stå urørt.
  const patchTx = (id: string, patch: Partial<Tx>) => {
    const apply = (t: Tx) => (t.id === id ? { ...t, ...patch } : t);
    setTxs(prev => prev.map(apply));
    setSearchTxs(prev => prev.map(apply));
  };
  const removeTxFromLists = (id: string) => {
    setTxs(prev => prev.filter(t => t.id !== id));
    setSearchTxs(prev => prev.filter(t => t.id !== id));
  };

  // ── Delete a saved transaction ────────────────────────────────────────────────
  async function deleteTx(tx: Tx) {
    if (!await confirm({
      title: 'Slett transaksjon?',
      message: `«${tx.description}» · ${fmtKr(Math.abs(tx.amount))}`,
      confirmLabel: 'Slett',
    })) return;
    await supabase.from('transactions').delete().eq('id', tx.id);
    removeTxFromLists(tx.id);
  }

  // ── Update category in transaction list ───────────────────────────────────────
  // Change ONE transaction's category only — does not touch the merchant rule or other
  // transactions. (To recategorize a whole butikk, edit it on the Butikker tab.)
  async function updateCategory(tx: Tx, cat: string) {
    await supabase.from('transactions')
      .update({ category: cat, category_confirmed: true }).eq('id', tx.id);
    patchTx(tx.id, { category: cat, category_confirmed: true });
    setEditingId(null);
  }

  // ── Rename a transaction (and learn the alias for future imports) ────────────
  async function updateDescription(tx: Tx, newDesc: string) {
    const trimmed = newDesc.trim();
    if (!trimmed || trimmed === tx.description) { setEditingDescId(null); return; }
    setEditingDescId(null);

    // Finn eller opprett butikken det pekes på
    const known = merchants.find(m => m.name.toLowerCase() === trimmed.toLowerCase());
    const merchant = known ?? await merchantsApi.ensureMerchant(trimmed, tx.category);

    await supabase.from('transactions')
      .update({ description: merchant.name, merchant_id: merchant.id, category: merchant.category, category_confirmed: true })
      .eq('id', tx.id);
    patchTx(tx.id, { description: merchant.name, merchant_id: merchant.id, category: merchant.category, category_confirmed: true });

    // Læring: koble bankteksten til butikken — MEN aldri for rader betalt via en
    // formidler (Vipps/Klarna): der er hver transaksjon en egen butikk.
    const aliasKey = tx.meta?.aliasKey;
    // Formidler gjenkjennes både på registeret OG på selve teksten. Uten
    // tekstsjekken kunne omdøping av en «Klarna»-rad lære aliaset «klarna» →
    // butikken, og da arver hver senere Klarna-betaling det navnet.
    const viaIntermediary = !!tx.meta?.intermediary
      || isBareIntermediary(aliasKey ?? tx.description)
      || merchants.some(m => m.kind === 'intermediary' && (m.id === tx.merchant_id || m.name === tx.description));
    if (aliasKey && !viaIntermediary && merchant.kind === 'merchant') {
      await merchantsApi.addAlias(aliasKey, merchant.id);
    } else if (viaIntermediary && aliasKey) {
      // Marker at butikken bak formidleren ble navngitt — brukes til beløpshint senere
      await supabase.from('transactions')
        .update({ meta: { ...(tx.meta ?? {}), intermediary: tx.meta?.intermediary ?? tx.description.toLowerCase() } })
        .eq('id', tx.id);
    }
  }

  // ── Reassign whose expense a transaction is (Mikkel / Leah / Felles) ──────────
  async function updateOwner(tx: Tx, v: 'bank_M' | 'bank_L' | 'felles') {
    setEditingOwnerId(null);
    if (v === ownerOf(tx.source)) return;  // unchanged (keeps a trumf row as trumf when "Felles" is re-picked)
    await supabase.from('transactions').update({ source: v }).eq('id', tx.id);
    patchTx(tx.id, { source: v });
  }

  // ── Add/update note on a transaction ─────────────────────────────────────────
  async function updateNote(tx: Tx, note: string) {
    const val = note.trim() || null;
    await supabase.from('transactions').update({ note: val }).eq('id', tx.id);
    patchTx(tx.id, { note: val });
    setEditingNoteId(null);
  }

  // ── Merchant management (Butikker-fanen) ─────────────────────────────────────
  // Endringer kaskaderer til transaksjonene via merchant_id (se useMerchants);
  // kategorikaskade flipper kun rader som fortsatt har butikkens gamle kategori.
  async function saveMerchantEdit(m: Merchant, changes: { name?: string; category?: string }) {
    await merchantsApi.updateMerchant(m.id, changes, { oldCategory: m.category });
    setTxs(prev => prev.map(t => {
      if (t.merchant_id !== m.id) return t;
      const next = { ...t };
      if (changes.name) next.description = changes.name;
      if (changes.category && t.category === m.category) next.category = changes.category;
      return next;
    }));
    setEditingMerchantId(null);
  }

  // ── Add a new category from the Kategorier tab ────────────────────────────────
  async function saveNewCat() {
    const name = newCatName.trim();
    if (!name) return;
    const res = await addCategory(name, newCatColor);
    if (res.ok) { setAddingCat(false); setNewCatName(''); }
    else await confirm({ title: 'Kunne ikke lagre', message: res.error ?? 'Ukjent feil', confirmLabel: 'OK', danger: false });
  }

  // ── Computed stats ─────────────────────────────────────────────────────────────
  // Person filter: 'alle' = everything, 'felles' = shared (trumf + felles), else by card source.
  // Står man på én person kan «+ ½ felles» slås på: da tas fellesradene med i
  // ALLE tall på siden, men bare med halve beløpet — det er den andelen som
  // faktisk er ens egen. Uten den ser man bare eget kort, som underdriver
  // forbruket kraftig når mye går på Trumf.
  const isFelles    = (t: Tx) => t.source === 'trumf' || t.source === 'felles';
  const soloPerson  = person === 'bank_M' || person === 'bank_L';
  const halfFelles  = soloPerson && withFelles;
  const matchesPerson = (t: Tx) =>
    person === 'alle'     ? true
    : person === 'felles' ? isFelles(t)
    :                       t.source === person || (halfFelles && isFelles(t));
  /** Beløpet slik det teller for det valgte filteret — halvt på felles når
   *  «+ ½ felles» er på. Brukes overalt der beløp summeres person-filtrert. */
  const amt = (t: Tx) => halfFelles && isFelles(t) ? t.amount / 2 : t.amount;

  // Unfiltered sets drive the always-on Mikkel/Leah/Felles split; the filtered
  // "view" sets drive the KPIs, categories, weekday, comparison and the tx list.
  // Investments are excluded from the "forbruk" totals unless the toggle is on (they inflate it).
  const allExpensesTx = txs.filter(isExpense);
  const allIncomeTx   = txs.filter(isIncome);
  const viewTxsAll = txs.filter(matchesPerson);
  // Transaksjonslista kan snevres inn til én kategori — alt annet på siden
  // (KPI-er, kategorikortet, sammenligningen) ser fortsatt hele måneden.
  const viewTxs  = txCat ? viewTxsAll.filter(t => t.category === txCat) : viewTxsAll;
  const expenses = allExpensesTx.filter(matchesPerson);
  const income   = allIncomeTx.filter(matchesPerson);
  const totalOut     = expenses.reduce((s, t) => s + amt(t), 0);
  const totalIn      = income.reduce((s, t)   => s + amt(t), 0);
  const unreviewed   = expenses.filter(t => !t.category_confirmed && t.category === 'annet').length;

  const bySource: Record<string, number> = {};
  for (const t of allExpensesTx) bySource[t.source] = (bySource[t.source] ?? 0) + t.amount;

  // Per-person breakdown: own expenses + half of felles (trumf + manuelt felles).
  // Cash-flow model: "Til overs" = alt inn − alt ut. Money moved to savings/investments
  // counts as out, money pulled back out (sales) counts as in — they net by themselves.
  const fellesExp   = allExpensesTx.filter(t => t.source === 'trumf' || t.source === 'felles');
  const fellesTotal = fellesExp.reduce((s, t) => s + t.amount, 0);
  const mikkelOwn   = allExpensesTx.filter(t => t.source === 'bank_M').reduce((s, t) => s + t.amount, 0);
  const leahOwn     = allExpensesTx.filter(t => t.source === 'bank_L').reduce((s, t) => s + t.amount, 0);
  const mikkelIn    = allIncomeTx.filter(t => t.source === 'bank_M').reduce((s, t) => s + t.amount, 0);
  const leahIn      = allIncomeTx.filter(t => t.source === 'bank_L').reduce((s, t) => s + t.amount, 0);
  const mikkelTot   = mikkelOwn + fellesTotal / 2;   // negative — all money out
  const leahTot     = leahOwn   + fellesTotal / 2;   // negative
  // ── Sparing (egen bøtte — verken forbruk eller inntekt) ──────────────────────
  // Netto investert = innskudd − uttak. Felles-sparing deles 50/50 som forbruk.
  const investTxs      = txs.filter(t => isInvestment(t) && matchesPerson(t));
  const investAllTxs   = txs.filter(isInvestment);
  const investDeposits = -investTxs.filter(t => t.amount < 0).reduce((s, t) => s + amt(t), 0);
  const investWithdraw =  investTxs.filter(t => t.amount > 0).reduce((s, t) => s + amt(t), 0);
  const investedNet    = investDeposits - investWithdraw;
  const investNetOf    = (src: 'bank_M' | 'bank_L') => {
    const own    = -investAllTxs.filter(t => t.source === src).reduce((s, t) => s + t.amount, 0);
    const felles = -investAllTxs.filter(t => t.source === 'trumf' || t.source === 'felles').reduce((s, t) => s + t.amount, 0);
    return own + felles / 2;
  };
  const mikkelInvest = investNetOf('bank_M');
  const leahInvest   = investNetOf('bank_L');
  const mikkelSave  = mikkelIn + mikkelTot - mikkelInvest;   // inn − forbruk − netto sparing
  const leahSave    = leahIn   + leahTot   - leahInvest;


  const byCat: Record<string, number> = {};
  for (const t of expenses) byCat[t.category] = (byCat[t.category] ?? 0) + amt(t);

  // Previous month computed values (respect the person filter)
  const prevExpenses = prevTxs.filter(t => isExpense(t) && matchesPerson(t));
  const prevByCat: Record<string, number> = {};
  for (const t of prevExpenses) prevByCat[t.category] = (prevByCat[t.category] ?? 0) + amt(t);
  const prevTotalOut = prevExpenses.reduce((s, t) => s + amt(t), 0);
  const prevTotalIn  = prevTxs.filter(t => isIncome(t) && matchesPerson(t)).reduce((s, t) => s + amt(t), 0);
  // All categories present in either month
  const allCats = [...new Set([...Object.keys(byCat), ...Object.keys(prevByCat)])];
  const catOrder = Object.keys(CATEGORY_LABELS);
  const compCats = [
    ...catOrder.filter(c => allCats.includes(c)),
    ...allCats.filter(c => !catOrder.includes(c)),
  ].filter(c => byCat[c] || prevByCat[c]);
  const maxCompAmt = Math.max(...compCats.map(c => Math.max(Math.abs(byCat[c] ?? 0), Math.abs(prevByCat[c] ?? 0))), 1);

  // ── Månedsbanner: hva endret seg fra forrige måned, og 12-mnd kontekst ───────
  // Alt utledes rent fra måned N vs. N−1 — ingen egen state.
  const prevMonth      = prevMonthOf(month);
  const hasPrev        = prevTxs.length > 0 && prevTotalOut !== 0;
  const catDeltas      = compCats
    .map(c => ({ cat: c, cur: Math.abs(byCat[c] ?? 0), prev: Math.abs(prevByCat[c] ?? 0) }))
    .map(d => ({ ...d, delta: d.cur - d.prev }));
  // «Trakk opp/ned» — bare bevegelser store nok til å være verdt å nevne
  const moversUp   = catDeltas.filter(d => d.delta >=  150).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const moversDown = catDeltas.filter(d => d.delta <= -150).sort((a, b) => a.delta - b.delta).slice(0, 3);
  const totalDeltaKr  = Math.abs(totalOut) - Math.abs(prevTotalOut);   // positiv = brukte mer
  const totalDeltaPct = prevTotalOut !== 0 ? (totalDeltaKr / Math.abs(prevTotalOut)) * 100 : 0;
  // Under en halv prosent er forskjellen støy — da skal teksten si «omtrent likt»
  // i stedet for å påstå «X kr mer … 0 % høyere».
  const totalFlat = Math.abs(totalDeltaPct) < 0.5;
  // 12-mnd forbruk per måned (samme person-/investeringsfilter som resten av siden)
  const spark12Months = lastMonths(month, 12);
  const spark12ByMonth: Record<string, number> = {};
  for (const t of spark12) {
    if (!matchesPerson(t) || !isExpense(t)) continue;
    spark12ByMonth[t.month] = (spark12ByMonth[t.month] ?? 0) + Math.abs(amt(t));
  }
  const spark12Vals = spark12Months.map(m => spark12ByMonth[m] ?? 0);
  // Snittet skal ikke dras ned av måneder uten data eller ufullstendig Trumf
  const spark12Base = spark12Months.filter(m => (spark12ByMonth[m] ?? 0) > 0 && !monthIncomplete(m));
  const avg12 = spark12Base.length
    ? spark12Base.reduce((s, m) => s + spark12ByMonth[m], 0) / spark12Base.length
    : 0;
  const catLabel = (c: string) => CATEGORY_LABELS[c] ?? c;

  // ── Transaksjoner gruppert dag for dag ──────────────────────────────────────
  // Dagssummen er rene forbrukskroner: investeringsrader vises i lista, men
  // trekkes aldri inn i dagens sum (de er sparing, ikke forbruk).
  const TX_PAGE = 50;
  const shownTxs = showAllTxs ? viewTxs : viewTxs.slice(0, TX_PAGE);
  // Kategorivalget over lista: bare kategorier som faktisk finnes i månedens rader,
  // i samme rekkefølge som ellers på siden. Et valg som ikke lenger finnes (byttet
  // måned) beholdes i lista, slik at velgeren ikke står tom mens filteret er på.
  const txCatCounts: Record<string, number> = {};
  for (const t of viewTxsAll) txCatCounts[t.category] = (txCatCounts[t.category] ?? 0) + 1;
  const txCatOpts = [
    ...catOrder.filter(c => txCatCounts[c]),
    ...Object.keys(txCatCounts).filter(c => !catOrder.includes(c)).sort(),
    ...(txCat && !txCatCounts[txCat] ? [txCat] : []),
  ];
  const txDays: Array<{ date: string; sum: number; items: Tx[] }> = [];
  for (const t of shownTxs) {
    let g = txDays[txDays.length - 1];
    if (!g || g.date !== t.date) { g = { date: t.date, sum: 0, items: [] }; txDays.push(g); }
    g.items.push(t);
    if (isExpense(t) && t.amount < 0) g.sum += Math.abs(amt(t));
  }

  // Butikker grouping (month uses the already-filtered view; all-time filters here)
  const storeSource = storeRange === 'month' ? allExpensesTx : allExpenses;
  const storeQ = storeSearch.trim().toLowerCase();
  const byMerchant: Record<string, {
    total: number; count: number; category: string;
    months: Set<string>; byMonth: Record<string, number>;
  }> = {};
  for (const t of storeSource) {
    if (!matchesPerson(t)) continue;
    if (isInvestment(t)) continue;   // sparing er ikke butikkforbruk
    if (storeCat && t.category !== storeCat) continue;
    if (storeQ && !t.description.toLowerCase().includes(storeQ)) continue;
    // All-tid aggregates skip incomplete months (Trumf not yet fully reported),
    // matching the Statistikk tab. Month view shows exactly the chosen month.
    if (storeRange === 'all' && monthIncomplete(t.month)) continue;
    if (!byMerchant[t.description])
      byMerchant[t.description] = { total: 0, count: 0, category: t.category, months: new Set(), byMonth: {} };
    const e = byMerchant[t.description];
    e.total  += amt(t);
    e.count  += 1;
    e.months.add(t.month);
    e.byMonth[t.month] = (e.byMonth[t.month] ?? 0) + Math.abs(amt(t));
  }
  const storeEntries = Object.entries(byMerchant).sort((a, b) => a[1].total - b[1].total);
  const storeSum  = storeEntries.reduce((s, [, v]) => s + Math.abs(v.total), 0);
  // Sparkline-akse for butikkortene: de 12 månedene fram t.o.m. valgt måned
  const storeSparkMonths = lastMonths(month, 12);

  // ── Styles ─────────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: 'var(--surface)', borderRadius: 10, padding: 20,
    border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12,
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
    background: active ? 'var(--ink)' : 'transparent',
    color:      active ? 'var(--surface)' : 'var(--muted)',
  });
  const statBox: React.CSSProperties = {
    flex: 1, padding: '14px 16px', background: 'var(--bg)', borderRadius: 8,
    display: 'flex', flexDirection: 'column', gap: 2,
  };
  const ey: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--muted)',
  };
  // Mono-etikett i redesignet: samme rolle som `ey`, men i tallskriften
  const eyMono: React.CSSProperties = {
    ...ey, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
  };
  const monoNum: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
  // Kortoverskrift med hårlinje under — går igjen i alle de nye kortene
  const cardHead = (title: React.ReactNode, aside?: React.ReactNode): React.ReactNode => (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 8, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid var(--line)',
    }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
      {aside && <span style={{ ...eyMono, color: 'var(--ink-4)' }}>{aside}</span>}
    </div>
  );
  // Gull-aksent for investering — dus nok til å lese mot både lys og mørk flate
  const GOLD = '#C7A23C';
  const goldText = 'var(--warn)';
  // Månedsbanneret ligger alltid på mørk flate (--ink-fixed), også i lys modus.
  // Tokens som --ink-2/--good/--accent flipper med temaet og blir uleselige der,
  // så banneret bruker faste lyse toner i stedet.
  const ON = {
    text:  'var(--on-ink)',
    body:  'rgba(232,239,247,0.80)',
    faint: 'rgba(232,239,247,0.62)',
    good:  '#7AB394',
    warn:  '#D9A06A',
    line:  '#6BA9D6',
    rule:  'rgba(232,239,247,0.14)',
  };
  const statNum = isMobile ? 16 : 22;  // stat-box number size, smaller on phones
  // Mobile: one 3-col grid so the top row lines up with Mikkel/Leah/Felles below.
  // Totalt ut takes 1/3, Inn 2/3 (income is the bigger number); the three people 1/3 each.
  const statsWrap: React.CSSProperties = isMobile
    ? { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }
    : { display: 'flex', gap: 10, flexWrap: 'wrap' };
  const statSm   = isMobile ? { gridColumn: 'span 1', minWidth: 0, padding: '11px 10px' } : {};
  const statLg   = isMobile ? { gridColumn: 'span 2', minWidth: 0, padding: '11px 12px' } : {};

  const allMonths = months.length ? months : [currentMonthStr()];
  const monthIdx  = allMonths.indexOf(month);

  // Shared person filter, reused across Oversikt / Trend / Per butikk
  const PERSON_OPTS: Array<{ id: typeof person; label: string }> = [
    { id: 'alle',   label: 'Alle' },
    { id: 'bank_M', label: '👨 Mikkel' },
    { id: 'bank_L', label: '👩 Leah' },
    { id: 'felles', label: '🤝 Felles' },
  ];
  // Segmented pill control — content-width on desktop, full-width equal segments on mobile
  // so stacked filters share a clean edge instead of a ragged left-aligned pile.
  // Mobil bruker longhand flexGrow/flexBasis (ikke `flex: 1`) så det ikke blandes med
  // tabBtn sin longhand flexShrink — den miksen utløste en React-advarsel ved bytte
  // mellom mobil/desktop-bredde.
  const segmented = <T extends string>(opts: ReadonlyArray<{ id: T; label: string }>, active: T, onSel: (v: T) => void) => (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: 20, padding: 3, width: isMobile ? '100%' : 'fit-content' }}>
      {opts.map(o => (
        <button key={o.id} style={{ ...tabBtn(active === o.id), ...(isMobile ? { flexGrow: 1, flexBasis: 0, padding: '6px 6px' } : {}) }} onClick={() => onSel(o.id)}>{o.label}</button>
      ))}
    </div>
  );
  // Person-filteret + «+ ½ felles»-bryteren. Bryteren vises bare når én person er
  // valgt — på «Alle» er felles allerede med i sin helhet, og på «Felles» ville
  // den vært et filter mot seg selv.
  const personName = person === 'bank_M' ? 'Mikkel' : person === 'bank_L' ? 'Leah' : '';
  const personBar = (
    <div style={{
      display: 'flex', flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'center', gap: 8, minWidth: 0,
    }}>
      {segmented(PERSON_OPTS, person, setPerson)}
      {soloPerson && (
        <button
          onClick={() => setWithFelles(v => !v)}
          title={withFelles
            ? `Felles (Trumf + manuelt) er med, med halve beløpet — alt ${personName} faktisk brukte. Klikk for bare eget kort.`
            : `Nå vises bare ${personName}s eget kort. Klikk for å legge til halvparten av felles utgifter.`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '6px 13px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            border: `1px solid ${withFelles ? 'transparent' : 'var(--line-2)'}`,
            background: withFelles ? SOURCE_COLOR.trumf : 'var(--surface)',
            color: withFelles ? '#fff' : 'var(--muted)',
            width: isMobile ? '100%' : 'auto', whiteSpace: 'nowrap',
          }}
        >
          <span aria-hidden="true">{withFelles ? '✓' : '+'}</span> ½ av felles
        </button>
      )}
    </div>
  );
  // Investering er egen post som default — bryteren slår den inn i forbrukstallene
  // Consistent pill-styled dropdown so category selects match the segmented controls
  const selectStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20,
    border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--fg)', cursor: 'pointer',
    width: isMobile ? '100%' : 'auto',
  };
  // Shared filter toolbar. Desktop: person filter (primary) left, period/category refinements
  // grouped right. Mobile: everything stacks into full-width rows with a clean shared edge.
  const filterBar = (refinements: React.ReactNode) => (
    <div style={{
      display: 'flex', flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 8 : 14, flexWrap: 'wrap',
      justifyContent: isMobile ? 'flex-start' : 'space-between',
    }}>
      {personBar}
      <div style={{
        display: 'flex', flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center', gap: 8, flexWrap: 'wrap',
      }}>
        {refinements}
      </div>
    </div>
  );

  // ── Én redigerbar transaksjonsrad — delt av Oversikt og Transaksjoner ─────────
  // Begge faner viser samme rad med inline-redigering (eier, navn, kategori,
  // kommentar, slett). `showDate` slår på en datokolonne (Transaksjoner er ikke
  // gruppert dag-for-dag som Oversikt), og `tokens` markerer søketreff.
  const renderTxRow = (tx: Tx, opts: { tokens?: string[]; showDate?: boolean } = {}) => {
    const { tokens, showDate } = opts;
    const hl = (text: string): React.ReactNode => (tokens && tokens.length ? highlightMatch(text, tokens) : text);
    const categoryEl = editingId === tx.id ? (
      <select autoFocus defaultValue={tx.category}
        onBlur={() => setEditingId(null)}
        onChange={e => updateCategory(tx, e.target.value)}
        style={{ fontSize: 11, borderRadius: 4, border: '1px solid var(--accent)', padding: '2px 4px', flexShrink: 0 }}>
        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    ) : (
      <CatTag cat={tx.category} confirmed={tx.category_confirmed}
        onClick={() => { setEditingId(tx.id); setEditingDescId(null); }} />
    );
    const ownerMeta = OWNERS.find(o => o.id === ownerOf(tx.source))!;
    return (
      <div key={tx.id} style={{
        display: 'flex', flexDirection: 'column',
        background: (!tx.category_confirmed && tx.category === 'annet') ? 'rgba(255,140,0,0.10)' : undefined,
      }}>
        {/* Main row — datoen står i dagheaderen over (Oversikt) eller i egen kolonne (Transaksjoner) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          {/* Whose expense — shows the person, click to reassign Mikkel / Leah / Felles */}
          {editingOwnerId === tx.id ? (
            <OwnerPicker value={ownerOf(tx.source)} onChange={v => updateOwner(tx, v)} />
          ) : (
            <span
              onClick={() => setEditingOwnerId(tx.id)}
              title={`${ownerMeta.label} — klikk for å endre hvem utgiften tilhører`}
              style={{ width: 20, flexShrink: 0, textAlign: 'center', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
            >
              {ownerMeta.emoji}
            </span>
          )}

          {/* Dato — bare når raden ikke ligger under en dagheader */}
          {showDate && (
            <span style={{ ...monoNum, fontSize: 11, color: 'var(--ink-4)', width: 50, flexShrink: 0 }}>{shortDate(tx.date)}</span>
          )}

          {/* Editable description */}
          {editingDescId === tx.id ? (
            <input
              autoFocus
              list="tx-merchants"
              defaultValue={tx.description}
              onBlur={e => updateDescription(tx, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') updateDescription(tx, (e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setEditingDescId(null);
              }}
              style={{
                flex: 1, fontSize: 13, padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--accent)', background: 'var(--surface)', minWidth: 0,
              }}
            />
          ) : (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                onClick={() => { setEditingDescId(tx.id); setEditingId(null); }}
                title="Klikk for å endre navn"
                style={{
                  fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', cursor: 'text', flex: '0 1 auto', minWidth: 0,
                }}
              >
                {hl(tx.description)}
              </span>
              {!isMobile && tx.note && editingNoteId !== tx.id && (
                <span title={tx.note} style={{
                  flex: '1 1 0', minWidth: 0, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  💬 {hl(tx.note)}
                </span>
              )}
            </div>
          )}

          {/* Category — inline on desktop, moved to its own line on mobile */}
          {!isMobile && categoryEl}

          {/* Halve beløpet på fellesrader når «+ ½ felles» er på — da er
              lista summen av det man selv brukte, og ½-merket viser hvorfor. */}
          {halfFelles && isFelles(tx) && (
            <span title={`Felles utgift på ${fmtKr(Math.abs(tx.amount))} — halvparten regnes som din`}
              style={{
                fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 6, flexShrink: 0,
                background: 'rgba(122,179,148,0.18)', color: SOURCE_COLOR.trumf,
              }}>½</span>
          )}
          <span
            title={halfFelles && isFelles(tx) ? `Hele beløpet: ${fmtKr(Math.abs(tx.amount))}` : undefined}
            style={{
              fontSize: 13, fontWeight: 600, width: 74, textAlign: 'right', flexShrink: 0,
              color: tx.amount > 0 ? 'var(--good)' : 'var(--ink)',
              fontVariantNumeric: 'tabular-nums',
            }}>
            {tx.amount > 0 ? '+' : '−'}{fmtKr(Math.abs(amt(tx))).replace(' kr', '')} kr
          </span>

          {/* Note button */}
          <button
            onClick={() => setEditingNoteId(editingNoteId === tx.id ? null : tx.id)}
            title={tx.note ? 'Rediger kommentar' : 'Legg til kommentar'}
            style={{
              width: 20, height: 20, borderRadius: '50%', border: 'none',
              background: tx.note ? 'var(--accent-soft, #e8f0fb)' : 'transparent',
              cursor: 'pointer', color: tx.note ? 'var(--accent)' : 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, lineHeight: 1, flexShrink: 0, padding: 0,
            }}
          >
            💬
          </button>

          {/* Delete button */}
          <button
            onClick={() => deleteTx(tx)}
            title="Slett transaksjon"
            style={{
              width: 20, height: 20, borderRadius: '50%', border: 'none',
              background: 'transparent', cursor: 'pointer', color: 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, lineHeight: 1, flexShrink: 0, padding: 0,
              transition: 'color .15s, background .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e53935'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(229,57,53,0.14)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            ×
          </button>
        </div>

        {/* Category on its own line (mobile, where it won't fit inline) */}
        {isMobile && (
          <div style={{ padding: '0 0 6px 52px' }}>{categoryEl}</div>
        )}

        {/* Comment — below the row on mobile (inline next to the name on desktop) */}
        {isMobile && tx.note && editingNoteId !== tx.id && (
          <div style={{ padding: '0 0 7px 52px' }}>
            <span style={{
              display: 'inline-flex', gap: 6, alignItems: 'flex-start', maxWidth: '100%',
              padding: '3px 9px', borderRadius: 6,
              background: 'var(--accent-soft, #e8f0fb)', color: 'var(--ink)',
              fontSize: 12, lineHeight: 1.35,
            }}>
              <span style={{ flexShrink: 0 }} aria-hidden="true">💬</span>
              <span>{hl(tx.note)}</span>
            </span>
          </div>
        )}

        {/* Note editor */}
        {editingNoteId === tx.id && (
          <div style={{ display: 'flex', gap: 6, padding: '0 0 6px 44px' }}>
            <input
              autoFocus
              defaultValue={tx.note ?? ''}
              placeholder="Skriv en kommentar…"
              onKeyDown={e => {
                if (e.key === 'Enter') updateNote(tx, (e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setEditingNoteId(null);
              }}
              style={{
                flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 5,
                border: '1px solid var(--line)', background: 'var(--bg)', minWidth: 0,
              }}
            />
            <button
              onClick={e => updateNote(tx, (e.currentTarget.previousElementSibling as HTMLInputElement).value)}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: 'none', background: 'var(--ink)', color: 'var(--surface)', cursor: 'pointer' }}
            >
              Lagre
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 0 40px' }}>

      {/* Autocomplete for merchant rename — hele butikkregisteret + kjente navn.
          Ligger på toppnivå så både Oversikt og Transaksjoner kan endre navn. */}
      <datalist id="tx-merchants">
        {[...new Set([
          ...merchants.filter(m => m.kind === 'merchant').map(m => m.name),
          ...txs.map(t => t.description),
        ])].sort().map(d => (
          <option key={d} value={d} />
        ))}
      </datalist>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
      }}>
        {/* Tabs — wrap to fit on mobile instead of horizontal scroll */}
        <div style={{
          display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: isMobile ? 14 : 24, padding: 3,
          flexWrap: isMobile ? 'wrap' : 'nowrap',
          justifyContent: isMobile ? 'center' : 'flex-start',
          overflowX: isMobile ? 'visible' : 'auto', maxWidth: '100%', scrollbarWidth: 'none',
        }}>
          <button style={tabBtn(tab === 'oversikt')} onClick={() => setTab('oversikt')}>📋 Oversikt</button>
          <button style={tabBtn(tab === 'transaksjoner')} onClick={() => setTab('transaksjoner')}>🧾 Transaksjoner</button>
          <button style={tabBtn(tab === 'trend')}    onClick={() => setTab('trend')}>📊 Statistikk</button>
          <button style={tabBtn(tab === 'butikker')} onClick={() => setTab('butikker')}>🏪 Per butikk</button>
          <button style={tabBtn(tab === 'invest')}   onClick={() => setTab('invest')}>💰 Investering</button>
          <button style={tabBtn(tab === 'regler')}   onClick={() => setTab('regler')}>🏷️ Butikker</button>
          <button style={tabBtn(tab === 'kategorier')} onClick={() => setTab('kategorier')}>🎨 Kategorier</button>
          <button style={tabBtn(tab === 'import')}   onClick={() => setTab('import')}>📥 Importer</button>
        </div>

        {/* Month navigator */}
        {tab !== 'import' && tab !== 'regler' && tab !== 'kategorier' && tab !== 'invest' && tab !== 'transaksjoner'
          && (tab !== 'trend' || trendRange === 'month') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: isMobile ? 'center' : 'flex-start' }}>
            <button
              onClick={() => monthIdx < allMonths.length - 1 && setMonth(allMonths[monthIdx + 1])}
              disabled={monthIdx >= allMonths.length - 1}
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', cursor: monthIdx < allMonths.length - 1 ? 'pointer' : 'default', fontSize: 16, color: monthIdx < allMonths.length - 1 ? 'var(--fg)' : 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >‹</button>
            <select
              value={month}
              onChange={e => setMonth(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', fontSize: 14, fontWeight: 600, color: 'var(--fg)', cursor: 'pointer', appearance: 'none', textAlign: 'center', minWidth: 110 }}
            >
              {allMonths.map(m => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
            <button
              onClick={() => monthIdx > 0 && setMonth(allMonths[monthIdx - 1])}
              disabled={monthIdx <= 0}
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', cursor: monthIdx > 0 ? 'pointer' : 'default', fontSize: 16, color: monthIdx > 0 ? 'var(--fg)' : 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >›</button>
          </div>
        )}
      </div>

      {/* ══════════════════════════ IMPORT TAB ══════════════════════════════════ */}
      {tab === 'import' && (
        <ImportTab
          merchantsApi={merchantsApi}
          isMobile={isMobile}
          onImported={async (m) => {
            await loadMonths();
            setMonth(m);
            await loadTxs(m);
          }}
        />
      )}

      {/* ══════════════════════════ INVESTERING TAB ═════════════════════════════ */}
      {tab === 'invest' && (
        <InvestTab
          isMobile={isMobile}
          onOpenMonth={m => { setMonth(m); setTab('oversikt'); }}
        />
      )}

      {/* ══════════════════════════ OVERSIKT TAB ════════════════════════════════ */}
      {tab === 'oversikt' && (
        loading ? (
          <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Laster…</div>
        ) : txs.length === 0 ? (
          <div style={{ ...card, alignItems: 'center', padding: 48, gap: 8 }}>
            <span style={{ fontSize: 32 }}>📂</span>
            <span style={{ fontWeight: 600 }}>Ingen data for {monthLabel(month)}</span>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>Gå til Importer for å laste opp bankdata</span>
            <button onClick={() => setTab('import')} style={{
              marginTop: 8, padding: '8px 18px', borderRadius: 8, border: 'none',
              cursor: 'pointer', background: 'var(--ink)', color: 'var(--surface)', fontSize: 13,
            }}>Importer data →</button>
          </div>
        ) : (
          <>
            {/* Person filter */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              {personBar}
            </div>

            {/* ── Månedsbanner — hva skilte denne måneden fra forrige ── */}
            {prevTxs.length > 0 && prevTotalOut !== 0 && (
              <div style={{
                background: 'var(--ink-fixed)', color: 'var(--on-ink)', borderRadius: 'var(--radius-lg)',
                padding: isMobile ? '16px 18px' : '22px 26px',
                display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr', gap: isMobile ? 14 : 32,
              }}>
                {/* Venstre: overskrift + fortellingen om hva som dro forbruket */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                  <span style={{ ...eyMono, color: ON.faint }}>
                    Månedsrapport · {monthLabel(month).toLowerCase()} vs. {monthLabel(prevMonth).toLowerCase()}
                    {monthIncomplete(month) ? ' · foreløpig' : ''}
                  </span>
                  <span style={{ fontSize: isMobile ? 17 : 22, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.25 }}>
                    {totalFlat ? (
                      <>Dere brukte <em style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 400 }}>omtrent like mye</em> som i {monthLabel(prevMonth).toLowerCase()}.</>
                    ) : (
                      <>Dere brukte{' '}
                        <em style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 400 }}>
                          {fmtKr(Math.abs(totalDeltaKr))} {totalDeltaKr < 0 ? 'mindre' : 'mer'}
                        </em>{' '}
                        enn i {monthLabel(prevMonth).toLowerCase()}.
                      </>
                    )}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.55, color: ON.body }}>
                    {(moversDown.length > 0 || moversUp.length > 0) && (
                      <>
                        {moversDown.length > 0 && (
                          <>{moversDown.slice(0, 2).map(d => `${catLabel(d.cat)} (−${num(-d.delta)} kr)`).join(' og ')} trakk ned</>
                        )}
                        {moversDown.length > 0 && moversUp.length > 0 && ', mens '}
                        {moversUp.length > 0 && (
                          <>{moversUp.slice(0, 2).map(d => `${catLabel(d.cat)} (+${num(d.delta)} kr)`).join(' og ')} trakk opp</>
                        )}
                        {'. '}
                      </>
                    )}
                    Totalt {fmtKr(Math.abs(totalOut))} mot {fmtKr(Math.abs(prevTotalOut))} i {monthLabel(prevMonth).toLowerCase()}
                    {totalFlat ? '' : ` — ${Math.abs(totalDeltaPct).toFixed(0)} % ${totalDeltaKr < 0 ? 'lavere' : 'høyere'}`}.
                    {(investDeposits > 0 || investWithdraw > 0) && (
                      <> Investering ({fmtKr(investedNet)}) holdes utenfor.</>
                    )}
                    {monthIncomplete(month) && <> Tallene er foreløpige — Trumf mangler for resten av måneden.</>}
                  </span>
                </div>

                {/* Høyre: topp-bevegere + 12-mnd sparkline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', minWidth: 0 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {([
                      { key: 'down', label: '▼ Trakk ned', color: ON.good, items: moversDown },
                      { key: 'up',   label: '▲ Trakk opp', color: ON.warn, items: moversUp },
                    ] as const).map(g => (
                      <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                        <span style={{ ...eyMono, fontSize: 9.5, color: g.color }}>{g.label}</span>
                        {g.items.length === 0 && (
                          <span style={{ fontSize: 11.5, color: ON.faint }}>ingen store endringer</span>
                        )}
                        {g.items.map(d => (
                          <div key={d.cat} style={{
                            display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12,
                            padding: '3px 0', borderBottom: `1px solid ${ON.rule}`,
                          }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{catLabel(d.cat)}</span>
                            <span style={{ ...monoNum, color: g.color, flexShrink: 0 }}>{signed(d.delta)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {spark12Vals.some(v => v > 0) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <svg width="150" height="34" viewBox="0 0 150 34" preserveAspectRatio="none"
                        style={{ flexShrink: 0 }} aria-hidden="true">
                        <polyline points={svgPoints(spark12Vals, 150, 34, svgDomain(spark12Vals)).join(' ')}
                          fill="none" stroke={ON.line} strokeWidth="1.5" />
                        <circle cx="150" cy={svgY(spark12Vals[11], 34, svgDomain(spark12Vals))} r="2.5" fill={ON.text} />
                      </svg>
                      <span style={{ ...monoNum, fontSize: 10, color: ON.faint }}>
                        12 mnd forbruk{avg12 > 0 ? ` · snitt ${compact(avg12)} kr/mnd` : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Incomplete-month banner — Trumf hasn't reported through month-end yet */}
            {monthIncomplete(month) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', borderRadius: 8,
                background: 'var(--accent-soft)', color: 'var(--accent-deep)', fontSize: 12.5, lineHeight: 1.4,
                border: '1px dashed var(--accent)',
              }}>
                <span style={{ flexShrink: 0, fontSize: 15 }} aria-hidden="true">⏳</span>
                <span><strong>{monthLabel(month)} er ufullstendig.</strong> Trumf-fakturaen for resten av måneden er ikke importert ennå{trumfMax ? ` (Trumf dekker t.o.m. ${trumfMax.slice(8)}.${trumfMax.slice(5, 7)})` : ''} — tallene er foreløpige.</span>
              </div>
            )}

            {/* ── Statstripe — ett kort med hårlinjeskiller (kort-grid på mobil) ── */}
            <div style={isMobile ? statsWrap : {
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-lg)', display: 'flex', overflow: 'hidden',
            }}>
              {(() => {
                const investPct = totalIn > 0 ? Math.round((investedNet / totalIn) * 100) : null;
                const boxes: Array<{
                  key: string; label: React.ReactNode; value: string; sub?: string | null;
                  flex: number; color?: string; dot?: string; tone?: 'gold';
                  onClick?: () => void; active?: boolean; title?: string; span?: React.CSSProperties;
                }> = [
                  {
                    key: 'ut',
                    label: halfFelles ? `Totalt ut · ${personName} inkl. ½ felles` : 'Totalt ut',
                    value: fmtKr(Math.abs(totalOut)), flex: 1.2, span: statSm,
                    sub: prevTotalOut === 0 ? null
                      : totalFlat ? `≈ som i ${monthLabel(prevMonth).toLowerCase()}`
                      : `${totalDeltaKr < 0 ? '▼' : '▲'} ${Math.abs(totalDeltaPct).toFixed(0)} % vs. ${monthLabel(prevMonth).toLowerCase()}`,
                  },
                  {
                    key: 'inn', label: 'Inn', value: fmtKr(totalIn), flex: 1.1, color: 'var(--good)', span: statLg,
                    sub: prevTotalIn > 0 && Math.round(totalIn - prevTotalIn) !== 0
                      ? `${totalIn > prevTotalIn ? '▲' : '▼'} ${fmtKr(Math.abs(totalIn - prevTotalIn))} vs. ${monthLabel(prevMonth).toLowerCase()}`
                      : 'ekte inntekt, uten uttak',
                  },
                  ...([['bank_M', 'Mikkel'], ['bank_L', 'Leah'], ['felles', 'Felles']] as const).map(([id, label]) => ({
                    key: id, label, flex: 0.95, span: statSm,
                    value: fmtKr(Math.abs(id === 'felles' ? fellesTotal : (bySource[id] ?? 0))),
                    sub: id === 'felles' ? 'Trumf + manuelt' : 'egne utgifter',
                    dot: SOURCE_COLOR[id],
                    onClick: () => setPerson(p => p === id ? 'alle' : id),
                    active: person === id,
                    title: person === id ? 'Klikk for å vise alle' : `Filtrer på ${label}`,
                  })),
                  ...((investDeposits > 0 || investWithdraw > 0) ? [{
                    key: 'invest', label: '💰 Investert', value: fmtKr(investedNet), flex: 1,
                    tone: 'gold' as const, color: goldText, span: statSm,
                    // Når det finnes uttak må BEGGE sider være synlige — ellers er
                    // et nettotall på null umulig å skille fra «ingen bevegelse».
                    sub: investWithdraw > 0
                      ? `${num(investDeposits)} inn · ${num(investWithdraw)} ut`
                      : investPct !== null ? `${investPct} % av inntekten` : 'netto spart',
                    onClick: () => setTab('invest'),
                    title: `Innskudd ${fmtKr(investDeposits)}${investWithdraw > 0 ? ` · uttak ${fmtKr(investWithdraw)}` : ''}`
                      + (investPct !== null ? ` · ${investPct} % av inntekten` : '')
                      + ' · holdes utenfor forbruk · klikk for hele investeringsbildet',
                  }] : []),
                ];
                return boxes.map((b, i) => (
                  <div key={b.key}
                    onClick={b.onClick}
                    title={b.title}
                    style={isMobile ? {
                      ...statBox, ...b.span, gap: 3,
                      borderLeft: `3px solid ${b.dot ?? (b.tone === 'gold' ? GOLD : 'transparent')}`,
                      background: b.tone === 'gold' ? 'rgba(199,162,60,0.10)' : 'var(--bg)',
                      cursor: b.onClick ? 'pointer' : 'default',
                      outline: b.active ? `2px solid ${b.dot}` : 'none', outlineOffset: -1,
                    } : {
                      flex: b.flex, minWidth: 0, padding: '16px 20px',
                      borderRight: i < boxes.length - 1 ? '1px solid var(--line)' : 'none',
                      display: 'flex', flexDirection: 'column', gap: 4,
                      background: b.tone === 'gold' ? 'rgba(199,162,60,0.10)' : 'transparent',
                      cursor: b.onClick ? 'pointer' : 'default',
                      boxShadow: b.active ? `inset 0 -2px 0 ${b.dot}` : 'none',
                    }}>
                    <span style={{ ...eyMono, color: b.tone === 'gold' ? goldText : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {b.dot && <i style={{ width: 7, height: 7, borderRadius: '50%', background: b.dot, flexShrink: 0 }} />}
                      {b.tone === 'gold' && <i style={{ width: 7, height: 7, borderRadius: 2, background: GOLD, flexShrink: 0 }} />}
                      {b.label}
                    </span>
                    <span style={{
                      ...monoNum, fontSize: isMobile ? statNum : (b.key === 'ut' || b.key === 'inn' ? 25 : 21),
                      fontWeight: 600, letterSpacing: '-0.02em', color: b.color, whiteSpace: 'nowrap',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{b.value}</span>
                    {b.sub && (
                      <span style={{
                        ...monoNum, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        color: b.key === 'ut' && prevTotalOut !== 0 && !totalFlat
                          ? (totalDeltaKr < 0 ? 'var(--good)' : 'var(--danger)')
                          : 'var(--ink-4)',
                      }}>{b.sub}</span>
                    )}
                  </div>
                ));
              })()}
            </div>

            {/* Per-person breakdown */}
            {(mikkelIn !== 0 || leahIn !== 0 || mikkelOwn !== 0 || leahOwn !== 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                {[
                  { name: 'Mikkel', color: SOURCE_COLOR.bank_M, own: mikkelOwn, inc: mikkelIn, invest: mikkelInvest, tot: mikkelTot, save: mikkelSave },
                  { name: 'Leah',   color: SOURCE_COLOR.bank_L, own: leahOwn,   inc: leahIn,   invest: leahInvest,   tot: leahTot,   save: leahSave },
                ].map(p => {
                  const line = (label: React.ReactNode, value: string, opts?: { total?: boolean; color?: string }) => (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', gap: 10,
                      fontSize: opts?.total ? 13 : 12.5,
                      ...(opts?.total ? { borderTop: '1px solid var(--line)', paddingTop: 7, marginTop: 1 } : null),
                    }}>
                      <span style={{ color: opts?.total ? undefined : 'var(--muted)', fontWeight: opts?.total ? 600 : 400 }}>{label}</span>
                      <span style={{ ...monoNum, fontWeight: opts?.total ? 700 : 600, color: opts?.color, whiteSpace: 'nowrap' }}>{value}</span>
                    </div>
                  );
                  return (
                    <div key={p.name} style={{
                      background: 'var(--surface)', border: '1px solid var(--line)',
                      borderLeft: `3px solid ${p.color}`, borderRadius: 'var(--radius-lg)',
                      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        paddingBottom: 8, borderBottom: '1px solid var(--line)',
                      }}>
                        <span style={{ ...eyMono, color: p.color }}>{p.name}</span>
                        <span style={{ ...eyMono, color: 'var(--ink-4)', textTransform: 'none' }}>{monthLabel(month)}</span>
                      </div>
                      {line('Egne utgifter', fmtKr(Math.abs(p.own)))}
                      {line('Halvpart felles', fmtKr(Math.abs(fellesTotal / 2)))}
                      {line('Totalt ut', fmtKr(Math.abs(p.tot)), { total: true })}
                      {p.inc > 0 && (
                        <>
                          {line('Inntekt', fmtKr(p.inc), { color: 'var(--good)' })}
                          {p.invest !== 0 && line(
                            <span style={{ color: goldText }}>
                              💰 {p.invest >= 0 ? 'Investert' : 'Tatt ut fra investering'} (egen + ½ felles)
                            </span>,
                            fmtKr(Math.abs(p.invest)), { color: goldText },
                          )}
                          {line('Til overs', `${p.save >= 0 ? '+' : '−'}${fmtKr(Math.abs(p.save))}`,
                            { total: true, color: p.save >= 0 ? 'var(--good)' : 'var(--danger)' })}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '5fr 7fr', gap: 12, alignItems: 'start' }}>
              {/* ── Kategorier — denne måneden med forrige måned som markør ── */}
              <div style={{ ...card, minWidth: 0, gap: 12 }}>
                {cardHead('Kategorier', hasPrev ? `${monthLabel(month)} vs. ${monthLabel(prevMonth).toLowerCase()} · | = forrige` : monthLabel(month))}
                <span style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: -6 }}>
                  Klikk en kategori for å se bare de transaksjonene
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {compCats.map(cat => {
                    const cur   = Math.abs(byCat[cat] ?? 0);
                    const prev  = Math.abs(prevByCat[cat] ?? 0);
                    const delta = cur - prev;
                    const pct   = prev > 0 ? (delta / prev) * 100 : null;
                    const color = CAT_COLORS[cat] ?? '#9E9E9E';
                    const isNew  = prev === 0 && cur > 0;
                    const isGone = cur === 0 && prev > 0;
                    const dCol = !hasPrev ? 'var(--ink-4)'
                      : isNew ? '#7B68EE' : isGone ? 'var(--ink-4)'
                      : Math.abs(delta) < 60 ? 'var(--ink-4)'
                      : delta > 0 ? 'var(--danger)' : 'var(--good)';
                    return (
                      <div key={cat}
                        onClick={() => { setTxCat(c => c === cat ? '' : cat); setShowAllTxs(false); }}
                        title={`${hasPrev ? `${catLabel(cat)}: ${fmtKr(cur)} nå · ${fmtKr(prev)} i ${monthLabel(prevMonth).toLowerCase()}` : `${catLabel(cat)}: ${fmtKr(cur)}`}\nKlikk for å ${txCat === cat ? 'vise alle transaksjoner igjen' : 'se bare disse transaksjonene'}`}
                        style={{
                          display: 'grid', gap: 10, alignItems: 'center',
                          gridTemplateColumns: isMobile ? '96px 1fr 58px' : '118px 1fr 62px 56px',
                          cursor: 'pointer', borderRadius: 6, padding: '3px 6px', margin: '-3px -6px',
                          background: txCat === cat ? 'var(--bg)' : undefined,
                          boxShadow: txCat === cat ? `inset 2px 0 0 ${color}` : undefined,
                        }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          <i style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {catLabel(cat)}
                          </span>
                        </span>
                        {/* Fyllet er denne måneden; strekmarkøren er forrige måned */}
                        <span style={{ position: 'relative', height: 6, background: 'var(--line)', borderRadius: 3, display: 'block' }}>
                          <i style={{
                            position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, background: color,
                            width: Math.max(cur > 0 ? 2 : 0, (cur / maxCompAmt) * 100) + '%', transition: 'width .4s',
                          }} />
                          {hasPrev && prev > 0 && (
                            <i style={{
                              position: 'absolute', top: -2, bottom: -2, width: 1.5, background: 'var(--ink-3)',
                              left: Math.min(99, (prev / maxCompAmt) * 100) + '%',
                            }} />
                          )}
                        </span>
                        <span style={{ ...monoNum, fontSize: 11.5, fontWeight: 600, textAlign: 'right', color: isGone ? 'var(--ink-4)' : undefined }}>
                          {isGone ? '–' : fmtKr(cur).replace(' kr', '')}
                        </span>
                        {!isMobile && (
                          <span style={{ ...monoNum, fontSize: 10, fontWeight: 600, textAlign: 'right', color: dCol }}>
                            {!hasPrev ? '' : isNew ? 'ny' : isGone ? 'borte'
                              : Math.abs(delta) < 60 ? '≈'
                              : `${delta > 0 ? '▲' : '▼'} ${pct !== null ? Math.abs(pct).toFixed(0) + ' %' : ''}`}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {compCats.length === 0 && (
                    <span style={{ fontSize: 12.5, color: 'var(--muted)', padding: '8px 0' }}>Ingen forbruk registrert.</span>
                  )}
                </div>
                {(investDeposits > 0 || investWithdraw > 0) && (
                  <span style={{ ...monoNum, fontSize: 10, color: 'var(--ink-4)', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                    💰 Investering vises i egen stat over — aldri i forbrukstallene
                  </span>
                )}
              </div>

              {/* Transactions — gruppert dag for dag */}
              <div style={{ ...card, gap: 4 }}>
                {cardHead(
                  txCat ? `Transaksjoner · ${catLabel(txCat)}` : 'Transaksjoner · dag for dag',
                  <>
                    {txCat ? `${viewTxs.length} av ${viewTxsAll.length} stk` : `${viewTxs.length} stk`} · klikk navn eller kategori for å endre
                    {unreviewed > 0 && (
                      <span title="Ukategoriserte kjøp — de er markert i lista under"
                        style={{
                          marginLeft: 8, padding: '1px 7px', borderRadius: 8, textTransform: 'none',
                          background: 'rgba(255,140,0,0.14)', color: 'var(--warn)', fontWeight: 700,
                        }}>
                        {unreviewed} til gjennomgang
                      </span>
                    )}
                  </>,
                )}

                {/* Kategorifilter — snevrer lista inn til én kategori om gangen */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 0 2px' }}>
                  <select
                    value={txCat}
                    onChange={e => { setTxCat(e.target.value); setShowAllTxs(false); }}
                    style={{ ...selectStyle, width: isMobile ? '100%' : 'auto' }}
                  >
                    <option value="">Alle kategorier ({viewTxsAll.length})</option>
                    {txCatOpts.map(c => (
                      <option key={c} value={c}>{catLabel(c)} ({txCatCounts[c] ?? 0})</option>
                    ))}
                  </select>
                  {txCat && (
                    <button
                      onClick={() => setTxCat('')}
                      style={{
                        fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                        border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--muted)',
                        width: isMobile ? '100%' : 'auto',
                      }}
                    >
                      × Vis alle
                    </button>
                  )}
                </div>

                {/* paddingRight holder dagssummene klar av rullefeltet */}
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 620, overflowY: 'auto', paddingRight: 6 }}>
                  {txDays.map(g => (
                    <div key={g.date} style={{ display: 'flex', flexDirection: 'column' }}>
                      {/* Dagheader — dagssummen holder investering utenfor */}
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        gap: 8, padding: '9px 0 3px',
                      }}>
                        <span style={{ ...eyMono, color: 'var(--ink-3)' }}>{dayLabel(g.date)}</span>
                        <span style={{ ...monoNum, fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)' }}>
                          {g.sum > 0 ? `−${num(g.sum)} kr` : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 12, borderLeft: '2px solid var(--line)' }}>
                  {g.items.map(tx => renderTxRow(tx))}
                      </div>
                    </div>
                  ))}
                  {viewTxs.length === 0 && (
                    <span style={{ fontSize: 12.5, color: 'var(--muted)', padding: '16px 0', textAlign: 'center' }}>
                      {txCat
                        ? `Ingen transaksjoner i ${catLabel(txCat)} denne måneden.`
                        : 'Ingen transaksjoner for dette filteret.'}
                    </span>
                  )}
                  {viewTxs.length > TX_PAGE && (
                    <button
                      onClick={() => setShowAllTxs(v => !v)}
                      style={{
                        margin: '12px auto 2px', padding: '6px 16px', borderRadius: 'var(--radius)', cursor: 'pointer',
                        border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)',
                        fontSize: 12, fontWeight: 600,
                      }}
                    >
                      {showAllTxs ? 'Vis færre' : `Vis alle (${viewTxs.length})`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )
      )}

      {/* ══════════════════════════ TRANSAKSJONER TAB ═══════════════════════════ */}
      {tab === 'transaksjoner' && (() => {
        const q = searchQuery.trim().toLowerCase();
        const tokens = q.split(/\s+/).filter(Boolean);
        // Alle transaksjoner (filtrert på person/kategori) vises som standard; et søk
        // snevrer inn på navn, rå banktekst, kommentar, kategori eller beløp (alle ord må matche).
        const matches = searchTxs.filter(t => {
          if (!matchesPerson(t)) return false;
          if (searchCat && t.category !== searchCat) return false;
          if (tokens.length === 0) return true;
          const hay = [
            t.description, t.raw_description, t.note ?? '',
            catLabel(t.category), String(Math.round(Math.abs(t.amount))),
          ].join(' ').toLowerCase();
          return tokens.every(tok => hay.includes(tok));
        });
        const totalSpend = matches.filter(isExpense).reduce((s, t) => s + Math.abs(t.amount), 0);
        const shown = matches.slice(0, searchPage * SEARCH_PAGE);
        const left  = matches.length - shown.length;
        // Grupper treffene per måned — søket er sortert dato synkende, så månedene kommer sammenhengende
        const groups: Array<{ month: string; items: Tx[] }> = [];
        for (const t of shown) {
          let g = groups[groups.length - 1];
          if (!g || g.month !== t.month) { g = { month: t.month, items: [] }; groups.push(g); }
          g.items.push(t);
        }

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filterBar(
            <select value={searchCat} onChange={e => setSearchCat(e.target.value)} style={selectStyle}>
              <option value="">Alle kategorier</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}

          {/* Søkefelt — filtrerer transaksjonslista under */}
          <div style={{
            display: 'flex', flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center', gap: 10,
          }}>
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔎 Søk i transaksjoner — navn, banktekst, kommentar, beløp…"
              style={{
                flex: 1, minWidth: 0, padding: '9px 14px',
                borderRadius: 'var(--radius)', border: '1px solid var(--line-2)',
                background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
              }}
            />
            <span style={{ ...monoNum, fontSize: 11, color: 'var(--ink-4)', marginLeft: isMobile ? 0 : 'auto', whiteSpace: 'nowrap' }}>
              {matches.length} {q ? 'treff' : 'transaksjoner'}{totalSpend > 0 ? ` · ${fmtKr(totalSpend)}` : ''}
            </span>
          </div>

          {searchLoading ? (
            <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 32 }}>Laster…</div>
          ) : matches.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 32 }}>
              {q ? `Ingen treff på «${searchQuery.trim()}».`
                 : searchCat || person !== 'alle' ? 'Ingen transaksjoner for dette filteret.'
                 : 'Ingen transaksjoner ennå — importer bankdata for å komme i gang.'}
            </div>
          ) : (
            <div style={{ ...card, gap: 4 }}>
              {groups.map(g => {
                const gSpend = g.items.filter(isExpense).reduce((s, t) => s + Math.abs(t.amount), 0);
                return (
                <div key={g.month} style={{ display: 'flex', flexDirection: 'column' }}>
                  {/* Månedsoverskrift — klikk åpner måneden i Oversikt */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '9px 0 3px' }}>
                    <button
                      onClick={() => { setMonth(g.month); setTab('oversikt'); }}
                      title="Åpne måneden i Oversikt"
                      style={{ ...eyMono, color: 'var(--ink-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      {monthLabel(g.month)} ›
                    </button>
                    <span style={{ ...monoNum, fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)' }}>
                      {g.items.length} stk{gSpend > 0 ? ` · ${num(gSpend)} kr` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 12, borderLeft: '2px solid var(--line)' }}>
                    {g.items.map(tx => renderTxRow(tx, { tokens, showDate: true }))}
                  </div>
                </div>
                );
              })}
              {left > 0 && (
                <button
                  onClick={() => setSearchPage(p => p + 1)}
                  style={{
                    margin: '12px auto 2px', padding: '6px 16px', borderRadius: 'var(--radius)', cursor: 'pointer',
                    border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12, fontWeight: 600,
                  }}
                >
                  Vis neste {Math.min(SEARCH_PAGE, left)} ({left} igjen)
                </button>
              )}
              {shown.length > SEARCH_PAGE && (
                <button
                  onClick={() => setSearchPage(1)}
                  style={{
                    margin: '4px auto 2px', padding: '6px 16px', borderRadius: 'var(--radius)', cursor: 'pointer',
                    border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--muted)', fontSize: 12, fontWeight: 600,
                  }}
                >
                  Vis færre
                </button>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {/* ══════════════════════════ TREND TAB ═══════════════════════════════════ */}
      {tab === 'trend' && (
        trendLoading ? (
          <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Laster…</div>
        ) : (() => {
          // Aggregate spending per month (expenses only — income is handled separately below)
          const monthMap = new Map<string, { total: number; byCat: Record<string, number> }>();
          for (const t of trendTxs) {
            if (!t.month) continue;
            if (!isExpense(t)) continue;            // skip income — this chart is spending
            if (!matchesPerson(t)) continue;
            if (!monthMap.has(t.month)) monthMap.set(t.month, { total: 0, byCat: {} });
            const e = monthMap.get(t.month)!;
            const v = -amt(t);                   // refusjoner (positive) trekker fra
            e.total += v;
            e.byCat[t.category] = (e.byCat[t.category] ?? 0) + v;
          }
          const allSorted = [...monthMap.keys()].sort();
          // Ufullstendige måneder (Trumf-fakturaen mangler) holdes helt utenfor
          // Statistikk — ikke vist, ikke i snitt, ikke i noen avledning. De ville
          // uansett bare vært et halvt tall som drar kurven ned.
          const complete = allSorted.filter(m => !monthIncomplete(m));
          // Filtrer FØR slice: «siste 12 mnd» skal gi 12 måneder med data,
          // ikke 12 kalendermåneder der noen er tomme.
          const shown = trendRange === 'month' ? complete.filter(m => m === month)
            : trendRange === '12' ? complete.slice(-12)
            : complete;
          // Enkeltmåned der brukeren har valgt en ufullstendig måned — egen beskjed
          const pickedIncomplete = trendRange === 'month' && monthIncomplete(month);

          // Kategorivalget skal ha alle kategorier som finnes, ikke bare de i perioden,
          // slik at lista ikke hopper når man bytter periode.
          const selectCats = (() => {
            const tot: Record<string, number> = {};
            for (const m of complete)
              for (const [c, v] of Object.entries(monthMap.get(m)!.byCat)) tot[c] = (tot[c] ?? 0) + v;
            return Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
          })();

          // ── Periodefilter: 12 mnd / all tid / enkeltmåned + kategori ──
          const periodBar = filterBar(
            <>
              {segmented<'12' | 'all' | 'month'>(
                [{ id: '12', label: 'Siste 12 mnd' }, { id: 'all', label: 'All tid' }, { id: 'month', label: 'Enkeltmåned' }],
                trendRange, setTrendRange,
              )}
              <select value={trendCat} onChange={e => setTrendCat(e.target.value)} style={selectStyle}>
                <option value="">Alle kategorier</option>
                {selectCats.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
              </select>
            </>
          );

          if (shown.length === 0) {
            if (trendRange === 'month') {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {periodBar}
                  <div style={{ ...card, alignItems: 'center', padding: 48, gap: 8 }}>
                    <span style={{ fontSize: 32 }}>{pickedIncomplete ? '⏳' : '📂'}</span>
                    <span style={{ fontWeight: 600 }}>
                      {pickedIncomplete
                        ? `${monthLabel(month)} er ikke ferdig ennå`
                        : `Ingen forbruk i ${monthLabel(month)}`}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', maxWidth: 420, lineHeight: 1.5 }}>
                      {pickedIncomplete
                        ? `Trumf-fakturaen for resten av måneden er ikke importert${trumfMax ? ` (Trumf dekker t.o.m. ${trumfMax.slice(8)}.${trumfMax.slice(5, 7)})` : ''}. Ufullstendige måneder holdes utenfor statistikken — se dem på Oversikt i stedet.`
                        : 'Velg en annen måned i månedsvelgeren over'}
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div style={{ ...card, alignItems: 'center', padding: 48, gap: 8 }}>
                <span style={{ fontSize: 32 }}>📈</span>
                <span style={{ fontWeight: 600 }}>Ingen data å vise trend for ennå</span>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>Importer noen måneder med bankdata først</span>
              </div>
            );
          }

          // `shown` er allerede filtrert til komplette måneder, så alt herfra
          // regner på samme grunnlag — ingen egen «blek måned»-håndtering trengs.
          const avgBase = shown;

          // Categories present across COMPLETE months, sorted by total desc
          const catTotals: Record<string, number> = {};
          for (const m of avgBase)
            for (const [c, v] of Object.entries(monthMap.get(m)!.byCat))
              catTotals[c] = (catTotals[c] ?? 0) + v;
          const cats = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
          // En kategori kan nette NEGATIVT når refusjoner overstiger kjøpene i
          // perioden (skatteoppgjør under «Finans & Skatt», gevinst > innsats på
          // «Gambling»). Det er ikke forbruk, så den skal ikke ha andel, søyle
          // eller «vs snitt» — og den skal ikke telle i nevneren for andelene,
          // ellers summerer ikke prosentene til 100.
          const isNetRefund = (c: string) => catTotals[c] < 0;
          const spendCats   = cats.filter(c => !isNetRefund(c));
          const catTotalSum = spendCats.reduce((s, c) => s + catTotals[c], 0);
          const catTopTotal = spendCats.length ? catTotals[spendCats[0]] : 1;

          const single  = trendCat && cats.includes(trendCat) ? trendCat : '';
          const monthVal = (m: string) => single ? (monthMap.get(m)!.byCat[single] ?? 0) : monthMap.get(m)!.total;
          const vals   = shown.map(monthVal);
          const avgVal  = avgBase.reduce((s, m) => s + monthVal(m), 0) / avgBase.length;
          const lastVal   = monthVal(shown[shown.length - 1]);
          const lastVsAvg = avgVal > 0 ? ((lastVal - avgVal) / avgVal) * 100 : null;  // siste måned mot periodesnittet

          // ── Periodestatistikk — person-filtrert og enkeltkategori-bevisst.
          //    Ufullstendige måneder er allerede luket ut av `shown`. ──
          const statMonths = avgBase;
          const statSet    = new Set(statMonths);
          const periodAll  = trendTxs.filter(t => matchesPerson(t) && statSet.has(t.month));
          // Forbruk: investering er egen post og holdes utenfor (som i grafen og kategoriene)
          const periodExp  = periodAll.filter(t => isExpense(t) && (!single || t.category === single));
          const periodInc  = periodAll.filter(isIncome);
          const totalSpent = statMonths.reduce((s, m) => s + monthVal(m), 0);   // complete months, toggle-aware
          const txCount    = periodExp.length;
          const avgTx      = txCount ? totalSpent / txCount : 0;
          const calDays    = statMonths.reduce((s, m) => { const [y, mo] = m.split('-').map(Number); return s + new Date(y, mo, 0).getDate(); }, 0);
          const perDay     = calDays ? totalSpent / calDays : 0;
          const buysPerDay = calDays ? txCount / calDays : 0;

          // income / savings (complete months; investing always counted in its own section regardless of toggle)
          const allSpent    = periodAll.filter(isExpense).reduce((s, t) => s + amt(t), 0) * -1;
          const totalIncome = periodInc.reduce((s, t) => s + amt(t), 0);
          const investOut   = -periodAll.filter(t => isInvestment(t) && t.amount < 0).reduce((s, t) => s + amt(t), 0);
          const investIn    =  periodAll.filter(t => isInvestment(t) && t.amount > 0).reduce((s, t) => s + amt(t), 0);
          const netInvest   = investOut - investIn;
          // Sparerate = netto investert av inntekten; Til overs = det som ble stående på konto
          const saveRate    = totalIncome > 0 ? (netInvest / totalIncome) * 100 : null;

          // records & superlatives (complete months only)
          const purchases   = periodExp.filter(t => t.amount < 0);   // refusjoner er ikke kjøp
          const biggestBuy  = purchases.reduce((mx: Tx | null, t) => (!mx || Math.abs(amt(t)) > Math.abs(amt(mx))) ? t : mx, null as Tx | null);
          const monthTotals = statMonths.map(m => ({ m, v: monthVal(m) }));
          const maxMonth    = monthTotals.reduce((a, b) => b.v > a.v ? b : a, monthTotals[0]);
          const minMonth    = monthTotals.reduce((a, b) => b.v < a.v ? b : a, monthTotals[0]);

          // merchants (single-aware)
          const merch: Record<string, { total: number; count: number; cat: string }> = {};
          for (const t of periodExp) { const k = t.description; (merch[k] ??= { total: 0, count: 0, cat: t.category }); merch[k].total += -amt(t); merch[k].count += 1; }
          const merchByTotal = Object.entries(merch).sort((a, b) => b[1].total - a[1].total);
          const topMerchant  = merchByTotal[0];
          const mostVisited  = [...merchByTotal].sort((a, b) => b[1].count - a[1].count)[0];

          // busiest weekday (fun fact)
          const dow = [0, 0, 0, 0, 0, 0, 0];
          for (const t of periodExp) dow[(new Date(t.date + 'T00:00:00').getDay() + 6) % 7] += -amt(t);
          const dowNames  = ['mandager', 'tirsdager', 'onsdager', 'torsdager', 'fredager', 'lørdager', 'søndager'];
          const topDowIdx = dow.indexOf(Math.max(...dow));

          // person split (expenses)
          const byPerson: Record<string, number> = { bank_M: 0, bank_L: 0, felles: 0 };
          for (const t of periodExp) { const s = isFelles(t) ? 'felles' : t.source; if (byPerson[s] != null) byPerson[s] += -amt(t); }
          const personMax = Math.max(byPerson.bank_M, byPerson.bank_L, byPerson.felles, 1);

          // ── Extra stats (all complete-months + toggle aware, derived from periodExp) ──
          const absAmts   = purchases.map(t => Math.abs(amt(t))).sort((a, b) => a - b);
          const median    = absAmts.length ? (absAmts.length % 2 ? absAmts[(absAmts.length - 1) / 2] : (absAmts[absAmts.length / 2 - 1] + absAmts[absAmts.length / 2]) / 2) : 0;
          const smallBuys = purchases.filter(t => Math.abs(amt(t)) < 100).length;
          const smallSum  = purchases.filter(t => Math.abs(amt(t)) < 100).reduce((s, t) => s + Math.abs(amt(t)), 0);
          const smallPct  = totalSpent > 0 ? (smallSum / totalSpent) * 100 : 0;   // share of KR spent on sub-100 purchases
          const minBuy    = purchases.reduce((mn: Tx | null, t) => (!mn || Math.abs(amt(t)) < Math.abs(amt(mn))) ? t : mn, null as Tx | null);
          const uniqStores = merchByTotal.length;
          const top3Share = totalSpent > 0 ? (merchByTotal.slice(0, 3).reduce((s, [, v]) => s + v.total, 0) / totalSpent) * 100 : 0;
          const tilOvers  = totalIncome - allSpent - netInvest;
          // busiest single calendar day + days without any spending
          const byDay: Record<string, number> = {};
          for (const t of periodExp) byDay[t.date] = (byDay[t.date] ?? 0) + -amt(t);
          const dayEntries = Object.entries(byDay);
          const topDay   = dayEntries.length ? dayEntries.reduce((a, b) => b[1] > a[1] ? b : a) : null;
          const freeDays = Math.max(0, calDays - dayEntries.length);
          // weekday by COUNT (most purchases) + category by count
          const dowCount = [0, 0, 0, 0, 0, 0, 0];
          for (const t of periodExp) dowCount[(new Date(t.date + 'T00:00:00').getDay() + 6) % 7] += 1;
          const busyDowIdx = dowCount.indexOf(Math.max(...dowCount));
          const dowShort   = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
          const catCount: Record<string, number> = {};
          for (const t of periodExp) catCount[t.category] = (catCount[t.category] ?? 0) + 1;
          const topCatByCount = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
          // weekend (lør+søn) vs weekday share of spending — dow is kr-by-weekday from above
          const dowSum     = dow.reduce((s, v) => s + v, 0);
          const weekendPct = dowSum > 0 ? ((dow[5] + dow[6]) / dowSum) * 100 : 0;

          // ── Render helpers ──
          const kpi = (label: string, value: string, sub?: string, color?: string) => (
            <div style={{ ...statBox }}>
              <span style={ey}>{label}</span>
              <span style={{ fontSize: isMobile ? 16 : 19, fontWeight: 700, whiteSpace: 'nowrap', color }}>{value}</span>
              {sub && <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
            </div>
          );
          const fact = (emoji: string, label: string, value: string, sub?: string) => (
            <div style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, minWidth: 0 }}>
              <span style={{ fontSize: 21, flexShrink: 0 }} aria-hidden="true">{emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
                {sub && <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
              </div>
            </div>
          );

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Controls */}
              {periodBar}
              <span style={{ ...monoNum, fontSize: 11, color: 'var(--ink-4)' }}>
                {shown.length === 1
                  ? monthLabel(shown[0])
                  : `${monthLabel(shown[0])} – ${monthLabel(shown[shown.length - 1])}`}
                {' · '}{statMonths.length} {statMonths.length === 1 ? 'komplett' : 'komplette'} mnd
                {single ? ` · ${catLabel(single)}` : ''}
              </span>

              {/* ── Hero — forbruksutvikling som linjediagram ──
                  Utelatt i enkeltmåned-modus: én søyle sier ingenting om utvikling. */}
              {trendRange !== 'month' && (
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                    {single ? `${catLabel(single)} · per måned` : 'Forbruksutvikling · totalt per måned'}
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Snitt <strong style={{ ...monoNum, color: 'var(--ink)' }}>{fmtKr(Math.round(avgVal))}</strong>/mnd
                    {' · '}siste <strong style={{ ...monoNum, color: 'var(--ink)' }}>{fmtKr(Math.round(lastVal))}</strong>
                    {lastVsAvg !== null && Math.abs(lastVsAvg) >= 1 && (
                      <span style={{ ...monoNum, fontWeight: 700, marginLeft: 5, color: lastVsAvg > 0 ? 'var(--danger)' : 'var(--good)' }}>
                        {lastVsAvg > 0 ? '▲' : '▼'} {Math.abs(lastVsAvg).toFixed(0)} % mot snitt
                      </span>
                    )}
                  </span>
                </div>

                {(() => {
                  // Linjen tegnes i et fast koordinatsystem og strekkes med preserveAspectRatio="none";
                  // punkter og klikkflater legges oppå som absolutt posisjonerte elementer i prosent,
                  // slik at de treffer riktig uansett hvor bred kortet er.
                  const LW = 1040, LH = isMobile ? 150 : 200, PAD = 8;
                  const dom  = svgDomain(vals);
                  const pts  = svgPoints(vals, LW, LH, dom, PAD);
                  const avgY = svgY(avgVal, LH, dom, PAD);
                  // Arealet fylles ned til nullinja — ikke til bunnen av viewBoxen,
                  // ellers ser en negativ måned ut som om den fylte hele grafen.
                  const zeroY = svgY(0, LH, dom, PAD);
                  const areaD = `M0,${zeroY} L${pts.join(' L')} L${LW},${zeroY} Z`;
                  const lineColor = single ? (CAT_COLORS[single] ?? 'var(--accent)') : 'var(--accent)';
                  const xPct = (i: number) => vals.length === 1 ? 50 : (i / (vals.length - 1)) * 100;
                  const yPct = (i: number) => (parseFloat(pts[i].split(',')[1]) / LH) * 100;
                  const labelStep = isMobile ? (shown.length > 11 ? 3 : shown.length > 7 ? 2 : 1) : (shown.length > 18 ? 2 : 1);
                  const hoverIdx = hoverMonth ? shown.indexOf(hoverMonth) : -1;
                  return (
                    <>
                      <div style={{ position: 'relative', width: '100%', height: LH }}>
                        <svg width="100%" height={LH} viewBox={`0 0 ${LW} ${LH}`} preserveAspectRatio="none"
                          style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
                          {/* Nullinje — bare når serien faktisk går under null */}
                          {dom.min < 0 && (
                            <line x1="0" y1={zeroY} x2={LW} y2={zeroY} stroke="var(--line-2)" strokeWidth="1" />
                          )}
                          <line x1="0" y1={avgY} x2={LW} y2={avgY} stroke="var(--ink-4)" strokeWidth="1" strokeDasharray="5 5" />
                          {vals.length > 1 && <path d={areaD} fill={lineColor} opacity={0.10} />}
                          {vals.length > 1 && <polyline points={pts.join(' ')} fill="none" stroke={lineColor} strokeWidth="2" />}
                        </svg>
                        {dom.min < 0 && (
                          <span style={{
                            position: 'absolute', left: 0, top: `${(zeroY / LH) * 100}%`, transform: 'translateY(-100%)',
                            ...monoNum, fontSize: 9, color: 'var(--muted)', background: 'var(--surface)', padding: '0 3px',
                          }}>0</span>
                        )}
                        {/* Snitt-etikett */}
                        <span style={{
                          position: 'absolute', right: 0, top: `${(avgY / LH) * 100}%`, transform: 'translateY(-100%)',
                          ...monoNum, fontSize: 9, color: 'var(--muted)', background: 'var(--surface)', padding: '0 3px',
                        }}>snitt</span>
                        {/* Loddrett peker for måneden man holder over */}
                        {hoverIdx !== -1 && (
                          <span style={{
                            position: 'absolute', left: `${xPct(hoverIdx)}%`, top: 0, bottom: 0, width: 1,
                            background: 'var(--line-2)', pointerEvents: 'none',
                          }} />
                        )}
                        {/* Klikkbare månedspunkter */}
                        {shown.map((m, i) => {
                          const isSel   = m === month;
                          const isHover = i === hoverIdx;
                          return (
                            <button key={m}
                              onClick={() => { setMonth(m); setTab('oversikt'); }}
                              onMouseEnter={() => setHoverMonth(m)}
                              onMouseLeave={() => setHoverMonth(h => h === m ? null : h)}
                              onFocus={() => setHoverMonth(m)}
                              onBlur={() => setHoverMonth(h => h === m ? null : h)}
                              aria-label={`${monthLabel(m)}: ${fmtKr(Math.round(vals[i]))} — åpne i Oversikt`}
                              style={{
                                position: 'absolute', left: `${xPct(i)}%`, top: 0, bottom: 0, width: 26,
                                transform: 'translateX(-50%)', border: 'none', background: 'transparent',
                                cursor: 'pointer', padding: 0,
                              }}>
                              <span style={{
                                position: 'absolute', left: '50%', top: `${yPct(i)}%`, transform: 'translate(-50%,-50%)',
                                width: isHover ? 11 : isSel ? 9 : 7, height: isHover ? 11 : isSel ? 9 : 7,
                                borderRadius: '50%',
                                background: isHover || isSel ? 'var(--ink)' : 'var(--surface)',
                                border: `1.5px solid ${isHover || isSel ? 'var(--ink)' : lineColor}`,
                                display: 'block', transition: 'width .1s, height .1s',
                              }} />
                            </button>
                          );
                        })}
                        {/* Tooltip — måned, beløp og avstand til snittet */}
                        {hoverIdx !== -1 && (() => {
                          const v    = vals[hoverIdx];
                          const diff = v - avgVal;
                          const vs   = avgVal > 0 ? (diff / avgVal) * 100 : null;
                          const flat = vs === null || Math.abs(vs) < 1;
                          const x    = xPct(hoverIdx);
                          // Hold boblen innenfor diagrammet i begge ender: sentrert normalt,
                          // men venstre-/høyrestilt mot ytterpunktene.
                          const shiftX = x < 14 ? '0px' : x > 86 ? '-100%' : '-50%';
                          return (
                            <div style={{
                              position: 'absolute', left: `${x}%`, top: `${yPct(hoverIdx)}%`,
                              transform: `translate(${shiftX}, calc(-100% - 14px))`,
                              background: 'var(--ink-fixed)', color: 'var(--on-ink)',
                              borderRadius: 'var(--radius)', padding: '9px 11px', zIndex: 5,
                              pointerEvents: 'none', whiteSpace: 'nowrap',
                              boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
                              display: 'flex', flexDirection: 'column', gap: 3,
                            }}>
                              <span style={{ ...eyMono, fontSize: 9.5, color: ON.faint }}>
                                {monthLabel(shown[hoverIdx])}{single ? ` · ${catLabel(single)}` : ''}
                              </span>
                              <span style={{ ...monoNum, fontSize: 16, fontWeight: 700 }}>
                                {fmtKr(Math.round(v))}
                              </span>
                              <span style={{ ...monoNum, fontSize: 10.5, color: flat ? ON.faint : diff > 0 ? ON.warn : ON.good }}>
                                {flat
                                  ? '≈ som snitt'
                                  : `${diff > 0 ? '▲' : '▼'} ${Math.abs(vs!).toFixed(0)} % ${diff > 0 ? 'over' : 'under'} snitt (${signed(Math.round(diff))} kr)`}
                              </span>
                              <span style={{ ...monoNum, fontSize: 10, color: ON.faint }}>
                                snitt {fmtKr(Math.round(avgVal))}/mnd
                              </span>
                              <span style={{ fontSize: 10, color: ON.faint, borderTop: `1px solid ${ON.rule}`, paddingTop: 4, marginTop: 1 }}>
                                Klikk for å åpne i Oversikt
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                      {/* Månedsetiketter + beløp */}
                      <div style={{ display: 'flex' }}>
                        {shown.map((m, i) => {
                          const show = i % labelStep === 0 || m === month || i === hoverIdx || shown.length === 1;
                          const active = m === month || i === hoverIdx;
                          return (
                            <span key={m} style={{
                              flex: 1, minWidth: 0, textAlign: 'center', ...monoNum, fontSize: 9.5,
                              color: active ? 'var(--ink)' : 'var(--ink-4)',
                              fontWeight: active ? 700 : 400,
                              whiteSpace: 'nowrap',
                            }}>
                              {show ? `${shortMonth(m)}${(m.slice(5) === '01' || i === 0) ? ` '${m.slice(2, 4)}` : ''}` : ''}
                              {show && <><br />{compact(vals[i])}</>}
                            </span>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}

                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Hold over en måned for detaljer · klikk for å åpne den i Oversikt · stiplet linje = snitt</span>
              </div>
              )}

              {/* ── Utvikling per kategori — small multiples ── */}
              {!single && shown.length > 1 && spendCats.length > 0 && (
                <div style={card}>
                  {cardHead(`Utvikling per kategori · ${shown.length} mnd`,
                    'stiplet = eget snitt · % = siste vs. snitt · klikk for kun denne')}
                  <div style={{
                    display: 'grid', gap: 12,
                    gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(auto-fill, minmax(190px, 1fr))',
                  }}>
                    {(() => {
                      // Én graf per forbrukskategori — ingen samlepost, alle er klikkbare.
                      // Netto-refusjonskategorier utelates: et negativt snitt gir
                      // «vs snitt»-prosenter med omvendt fortegn.
                      const series = spendCats.map(c => ({
                        key: c, label: catLabel(c), color: CAT_COLORS[c] ?? '#9E9E9E',
                        vals: shown.map(m => monthMap.get(m)!.byCat[c] ?? 0),
                      }));
                      const SW = 228, SH = 56;
                      return series.map(s => {
                        // Snitt og «siste» regnes på komplette måneder, som ellers på siden
                        const avg  = s.vals.reduce((a, v) => a + v, 0) / s.vals.length;
                        const last = s.vals[s.vals.length - 1];
                        const vs   = avg > 0 ? ((last - avg) / avg) * 100 : null;
                        const dom  = svgDomain(s.vals);
                        const vsCol = vs === null || Math.abs(vs) < 8 ? 'var(--ink-4)' : vs > 0 ? 'var(--danger)' : 'var(--good)';
                        return (
                          <div key={s.key}
                            onClick={() => setTrendCat(s.key)}
                            title={`Klikk for å se kun ${s.label}`}
                            style={{
                              border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px',
                              display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, cursor: 'pointer',
                            }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                <i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                                <span style={{ fontSize: 11.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {s.label}
                                </span>
                              </span>
                              <span style={{ ...monoNum, fontSize: 10, fontWeight: 700, color: vsCol, flexShrink: 0 }}>
                                {vs === null ? '–' : Math.abs(vs) < 8 ? '≈ snitt' : `${vs > 0 ? '▲' : '▼'} ${Math.abs(vs).toFixed(0)} %`}
                              </span>
                            </div>
                            <svg width="100%" height={SH} viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none"
                              style={{ display: 'block' }} aria-hidden="true">
                              <line x1="0" y1={svgY(avg, SH, dom)} x2={SW} y2={svgY(avg, SH, dom)}
                                stroke="var(--line-2)" strokeWidth="1" strokeDasharray="3 3" />
                              <polyline points={svgPoints(s.vals, SW, SH, dom).join(' ')}
                                fill="none" stroke={s.color} strokeWidth="1.5" />
                            </svg>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, ...monoNum, fontSize: 10, color: 'var(--ink-4)' }}>
                              <span>siste {compact(last)}</span>
                              <span>snitt {compact(avg)}</span>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {/* Per-category breakdown — comparable share bars, clearly labelled */}
              {!single && (
                <div style={card}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span style={ey}>Per kategori</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>søylelengde = andel av totalt forbruk · {statMonths.length} mnd</span>
                  </div>

                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 86px 58px' : '156px 1fr 100px 72px 74px', gap: 10, padding: '2px 6px 0', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                    <span>Kategori</span>
                    {!isMobile && <span>Andel</span>}
                    <span style={{ textAlign: 'right' }}>Totalt</span>
                    {!isMobile && <span style={{ textAlign: 'right' }}>Snitt/mnd</span>}
                    <span style={{ textAlign: 'right' }} title="Siste måned sammenlignet med kategoriens egen månedssnitt">Siste vs snitt</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {cats.map(c => {
                      const cvals  = statMonths.map(m => monthMap.get(m)!.byCat[c] ?? 0);
                      const ctot   = cvals.reduce((s, v) => s + v, 0);
                      const cavg   = ctot / statMonths.length;
                      // Netto refusjon (mer inn enn ut): ikke forbruk — ingen andel,
                      // søyle eller snitt-sammenligning, bare det faktiske beløpet.
                      const netRefund = ctot < 0;
                      const share  = !netRefund && catTotalSum > 0 ? (ctot / catTotalSum) * 100 : 0;
                      const barPct = !netRefund && catTopTotal > 0 ? (ctot / catTopTotal) * 100 : 0;
                      const cLast  = cvals[cvals.length - 1];
                      const vsAvg  = !netRefund && cavg > 0 ? ((cLast - cavg) / cavg) * 100 : null;
                      const color  = CAT_COLORS[c] ?? '#9E9E9E';
                      return (
                        <div key={c}
                          onClick={() => setTrendCat(c)}
                          title="Klikk for å se månedsutviklingen for kun denne kategorien"
                          style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 86px 58px' : '156px 1fr 100px 72px 74px', gap: 10, alignItems: 'center', cursor: 'pointer', padding: '7px 6px', borderRadius: 8 }}
                          onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)'}
                          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                          {/* Name */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
                            <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{CATEGORY_LABELS[c] ?? c}</span>
                          </div>
                          {/* Comparable share bar (desktop) */}
                          {!isMobile && (
                            <div style={{ height: 9, background: 'var(--line)', borderRadius: 5, overflow: 'hidden' }}>
                              {!netRefund && (
                                <div style={{ width: Math.max(2, barPct) + '%', height: '100%', borderRadius: 5, background: color, transition: 'width .4s' }} />
                              )}
                            </div>
                          )}
                          {/* Total + share % */}
                          <div style={{ textAlign: 'right', minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: netRefund ? 'var(--good)' : undefined }}>
                              {netRefund ? '+' : ''}{fmtKr(Math.round(Math.abs(ctot))).replace(' kr', '')}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                              {netRefund ? 'netto tilbake' : `${share.toFixed(0)}% av forbruk`}
                            </div>
                          </div>
                          {/* Avg / month (desktop) */}
                          {!isMobile && (
                            <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                              {netRefund ? '–' : fmtKr(Math.round(cavg)).replace(' kr', '')}
                            </span>
                          )}
                          {/* Latest month vs the category's own average — muted for trivial categories (<1.5%) to avoid noisy huge %s */}
                          <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 700,
                            color: vsAvg === null || share < 1.5 || Math.abs(vsAvg) < 8 ? 'var(--muted)' : vsAvg > 0 ? '#e53935' : 'var(--good)' }}>
                            {vsAvg === null || share < 1.5 ? '–' : Math.abs(vsAvg) < 8 ? '≈ snitt' : `${vsAvg > 0 ? '▲' : '▼'} ${Math.abs(vsAvg).toFixed(0)}%`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Klikk en kategori for å se månedsutviklingen alene</span>
                </div>
              )}

              {/* Nøkkeltall */}
              <div style={card}>
                <span style={ey}>📊 Nøkkeltall{single ? ` · ${CATEGORY_LABELS[single] ?? single}` : ''} · {statMonths.length} mnd</span>
                <div style={{
                  display: 'grid', gap: 8,
                  gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(auto-fit, minmax(150px, 1fr))',
                }}>
                  {kpi('Totalt forbruk', fmtKr(Math.round(totalSpent)))}
                  {kpi('Snitt / mnd', fmtKr(Math.round(avgVal)))}
                  {kpi('Snitt / dag', fmtKr(Math.round(perDay)))}
                  {kpi('Snitt / kjøp', fmtKr(Math.round(avgTx)))}
                  {kpi('Median / kjøp', fmtKr(Math.round(median)), 'midt-kjøpet')}
                  {kpi('Antall kjøp', String(txCount), `~${buysPerDay.toFixed(1)} / dag`)}
                  {kpi('Unike butikker', String(uniqStores))}
                  {!single && (investOut > 0 || investIn > 0) && kpi(
                    'Investert',
                    `${netInvest >= 0 ? '+' : '−'}${fmtKr(Math.abs(netInvest))}`,
                    // Vis begge sider når det finnes uttak, ikke bare nettoen
                    investIn > 0 ? `${num(investOut)} inn · ${num(investIn)} ut` : `~${fmtKr(Math.round(netInvest / statMonths.length))}/mnd netto`,
                    netInvest >= 0 ? 'var(--good)' : '#e53935',
                  )}
                  {!single && totalIncome > 0 && kpi('Inntekt', fmtKr(Math.round(totalIncome)), `${statMonths.length} mnd`, 'var(--good)')}
                  {!single && totalIncome > 0 && kpi('Til overs', fmtKr(Math.round(tilOvers)), 'inn − forbruk − sparing', tilOvers >= 0 ? 'var(--good)' : '#e53935')}
                  {!single && saveRate !== null && (investOut > 0 || investIn > 0) && kpi('Sparerate', `${Math.round(saveRate)}%`, 'av inntekten investert', saveRate >= 0 ? 'var(--good)' : '#e53935')}
                </div>
              </div>

              {/* Mer statistikk */}
              <div style={card}>
                <span style={ey}>📊 Mer statistikk</span>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 8 }}>
                  {biggestBuy && fact('💸', 'Dyreste kjøp', fmtKr(Math.abs(amt(biggestBuy))), `${biggestBuy.description} · ${monthLabel(biggestBuy.month)}${halfFelles && isFelles(biggestBuy) ? ' · ½ felles' : ''}`)}
                  {minBuy && fact('🪙', 'Minste kjøp', fmtKr(Math.abs(amt(minBuy))), `${minBuy.description}${halfFelles && isFelles(minBuy) ? ' · ½ felles' : ''}`)}
                  {topDay && fact('📆', 'Dyreste dag', fmtKr(Math.round(topDay[1])), `${topDay[0].slice(8)}.${topDay[0].slice(5, 7)}.${topDay[0].slice(2, 4)}`)}
                  {fact('📈', 'Dyreste måned', fmtKr(Math.round(maxMonth.v)), monthLabel(maxMonth.m))}
                  {fact('📉', 'Roligste måned', fmtKr(Math.round(minMonth.v)), monthLabel(minMonth.m))}
                  {topMerchant && fact('💰', 'Dyreste butikk', fmtKr(Math.round(topMerchant[1].total)), `${topMerchant[0]} · ${topMerchant[1].count} kjøp`)}
                  {mostVisited && fact('🔁', 'Mest besøkt', `${mostVisited[1].count} kjøp`, mostVisited[0])}
                  {merchByTotal.length >= 3 && fact('🥇', 'Topp 3 butikker', `${Math.round(top3Share)}%`, 'av forbruket')}
                  {cats.length > 0 && fact('🛒', 'Største kategori', CATEGORY_LABELS[cats[0]] ?? cats[0], `${fmtKr(Math.round(catTotals[cats[0]]))} · ${Math.round((catTotals[cats[0]] / catTotalSum) * 100)}%`)}
                  {topCatByCount && fact('🧺', 'Flest kjøp', CATEGORY_LABELS[topCatByCount[0]] ?? topCatByCount[0], `${topCatByCount[1]} kjøp`)}
                  {dow[topDowIdx] > 0 && fact('📅', 'Dyreste ukedag', dowNames[topDowIdx], `${fmtKr(Math.round(dow[topDowIdx]))} totalt`)}
                  {dowCount[busyDowIdx] > 0 && fact('🗓️', 'Travleste ukedag', dowShort[busyDowIdx], `${dowCount[busyDowIdx]} kjøp`)}
                  {dowSum > 0 && fact('🎉', 'Helg vs ukedag', `${Math.round(weekendPct)}% helg`, `${Math.round(100 - weekendPct)}% hverdag`)}
                  {smallBuys > 0 && fact('🔎', 'Småkjøp', `${Math.round(smallPct)}%`, `av kr · ${smallBuys} kjøp under 100 kr`)}
                  {calDays > 0 && fact('💤', 'Kjøpefrie dager', `${freeDays}`, `av ${calDays} dager`)}
                  {fact('🧾', 'Kjøp totalt', `${txCount} kjøp`, `på ${statMonths.length} mnd`)}
                </div>
              </div>

              {/* Topp butikker */}
              {merchByTotal.length > 0 && (
                <div style={card}>
                  <span style={ey}>🏪 Topp butikker{single ? ` · ${CATEGORY_LABELS[single] ?? single}` : ''}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {merchByTotal.slice(0, 8).map(([name, info]) => {
                      const pct = (info.total / merchByTotal[0][1].total) * 100;
                      const color = CAT_COLORS[info.cat] ?? '#9E9E9E';
                      return (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: isMobile ? 104 : 150, flexShrink: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                          <div style={{ flex: 1, height: 9, background: 'var(--line)', borderRadius: 5, overflow: 'hidden' }}>
                            <div style={{ width: Math.max(2, pct) + '%', height: '100%', borderRadius: 5, background: color, transition: 'width .4s' }} />
                          </div>
                          <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtKr(Math.round(info.total))}</span>
                          <span style={{ width: 32, textAlign: 'right', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{info.count}×</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Fordeling person */}
              {person === 'alle' && (byPerson.bank_M > 0 || byPerson.bank_L > 0 || byPerson.felles > 0) && (
                <div style={card}>
                  <span style={ey}>👥 Fordeling person{single ? ` · ${CATEGORY_LABELS[single] ?? single}` : ''}</span>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 8 }}>
                    {([['bank_M', '👨 Mikkel'], ['bank_L', '👩 Leah'], ['felles', '🤝 Felles']] as const).map(([id, label]) => {
                      const val = byPerson[id];
                      const sum = byPerson.bank_M + byPerson.bank_L + byPerson.felles;
                      const share = sum > 0 ? (val / sum) * 100 : 0;
                      return (
                        <div key={id} style={{ ...statBox, borderLeft: `3px solid ${SOURCE_COLOR[id]}` }}>
                          <span style={ey}>{label}</span>
                          <span style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtKr(Math.round(val))}</span>
                          <div style={{ height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
                            <div style={{ width: (val / personMax) * 100 + '%', height: '100%', background: SOURCE_COLOR[id], borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{share.toFixed(0)}% av forbruk</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()
      )}

      {/* ══════════════════════════ BUTIKKER TAB ════════════════════════════════ */}
      {tab === 'butikker' && (() => {
        const ranked  = storeEntries.map(([name, info], i) => ({ name, info, rank: i + 1 }));
        const visible = ranked.slice(0, storePage * STORE_PAGE);
        const left    = ranked.length - visible.length;
        // Sparkline og aktivitetsprikker gir bare mening over flere måneder
        const showSpark = storeRange === 'all';

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filterBar(
            <>
              {segmented<'month' | 'all'>([{ id: 'month', label: 'Måned' }, { id: 'all', label: 'All tid' }], storeRange, setStoreRange)}
              <select value={storeCat} onChange={e => setStoreCat(e.target.value)} style={selectStyle}>
                <option value="">Alle kategorier</option>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </>
          )}

          <div style={{
            display: 'flex', flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center', gap: 10,
          }}>
            <input
              type="search"
              value={storeSearch}
              onChange={e => setStoreSearch(e.target.value)}
              placeholder="🔎 Søk i butikker…"
              style={{
                flex: 1, maxWidth: isMobile ? undefined : 300, minWidth: 0, padding: '7px 12px',
                borderRadius: 'var(--radius)', border: '1px solid var(--line-2)',
                background: 'var(--surface)', color: 'var(--fg)', fontSize: 12.5,
              }}
            />
            <span style={{ ...monoNum, fontSize: 11, color: 'var(--ink-4)', marginLeft: isMobile ? 0 : 'auto' }}>
              {storeEntries.length} {storeEntries.length === 1 ? 'butikk' : 'butikker'} · {fmtKr(storeSum)}
              {storeRange === 'month' ? ` · ${monthLabel(month)}` : ' · all tid'}
            </span>
          </div>

          {storeEntries.length === 0 && (
            <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 32 }}>
              Ingen butikker for dette filteret.
            </div>
          )}

          {/* Alle butikker som kort, sortert etter forbruk */}
          <div style={{
            display: 'grid', gap: 12, alignItems: 'start',
            gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))',
          }}>
            {visible.map(({ name, info, rank }) => {
              const color = CAT_COLORS[info.category] ?? '#9E9E9E';
              const tot   = Math.abs(info.total);
              const sparkVals = storeSparkMonths.map(m => info.byMonth[m] ?? 0);
              return (
                <div key={name} style={{
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  borderTop: `3px solid ${color}`, borderRadius: 'var(--radius-lg)',
                  padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span title={name} style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    <span style={{ ...monoNum, fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>#{rank}</span>
                  </div>
                  <span style={{
                    ...monoNum, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                    background: color + '22', color, textTransform: 'uppercase', alignSelf: 'flex-start',
                    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{catLabel(info.category)}</span>
                  <span style={{ ...monoNum, fontSize: 18, fontWeight: 700, letterSpacing: '-0.015em' }}>
                    {fmtKr(tot)}
                  </span>
                  {showSpark && (
                    <svg width="100%" height="26" viewBox="0 0 120 26" preserveAspectRatio="none"
                      style={{ display: 'block' }} aria-hidden="true">
                      <polyline points={svgPoints(sparkVals, 120, 26, svgDomain(sparkVals)).join(' ')}
                        fill="none" stroke={color} strokeWidth="1.4" />
                    </svg>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                    {([
                      ['Kjøp', String(info.count)],
                      ['Snitt/besøk', fmtKr(Math.round(tot / info.count))],
                      ['Snitt/mnd', info.months.size > 1 ? fmtKr(Math.round(tot / info.months.size)) : '—'],
                    ] as const).map(([l, v]) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 10.5, color: 'var(--muted)' }}>
                        <span>{l}</span>
                        <span style={{ ...monoNum, fontWeight: 700, color: 'var(--ink)' }}>{v}</span>
                      </div>
                    ))}
                    {showSpark && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Aktiv</span>
                        <span style={{ display: 'flex', gap: 2 }}
                          title={`${info.months.size} av 12 måneder med kjøp`}>
                          {storeSparkMonths.map(m => (
                            <i key={m} style={{
                              width: 6, height: 6, borderRadius: 1, display: 'inline-block',
                              background: (info.byMonth[m] ?? 0) > 0 ? color : 'var(--line)',
                            }} />
                          ))}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {left > 0 && (
            <button
              onClick={() => setStorePage(p => p + 1)}
              style={{
                margin: '0 auto', padding: '7px 18px', borderRadius: 'var(--radius)', cursor: 'pointer',
                border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)',
                fontSize: 12, fontWeight: 600,
              }}
            >
              Vis {Math.min(STORE_PAGE, left)} til ({left} igjen)
            </button>
          )}
          {left === 0 && ranked.length > STORE_PAGE && (
            <button
              onClick={() => setStorePage(1)}
              style={{
                margin: '0 auto', padding: '7px 18px', borderRadius: 'var(--radius)', cursor: 'pointer',
                border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--muted)',
                fontSize: 12, fontWeight: 600,
              }}
            >
              Vis færre
            </button>
          )}
        </div>
        );
      })()}
      {/* ══════════════════════════ BUTIKKER (REGLER) TAB ══════════════════════ */}
      {tab === 'regler' && (() => {
        const q = merchantsSearch.toLowerCase();
        const aliasesByMerchant = new Map<string, string[]>();
        for (const al of merchantsApi.aliases) {
          const list = aliasesByMerchant.get(al.merchant_id) ?? [];
          list.push(al.alias);
          aliasesByMerchant.set(al.merchant_id, list);
        }
        const filtered = merchants.filter(m =>
          !q || m.name.toLowerCase().includes(q) ||
          (CATEGORY_LABELS[m.category] ?? m.category).toLowerCase().includes(q) ||
          (aliasesByMerchant.get(m.id) ?? []).some(al => al.includes(q))
        );
        const KIND_BADGE: Record<string, { label: string; title: string } | undefined> = {
          person:       { label: '👤 person',     title: 'Privatperson — overføringer hit er P2P, ikke forbruk' },
          internal:     { label: '↔ intern',      title: 'Egen konto/kort — utelates automatisk ved import' },
          settlement:   { label: '💳 kortoppgjør', title: 'Kredittkortregning — dekkes av kortets egen import' },
          intermediary: { label: '🔀 formidler',   title: 'Betalingsformidler — butikken bak navngis per transaksjon' },
        };
        const byCat = filtered.reduce<Record<string, Merchant[]>>((acc, m) => {
          (acc[m.category] = acc[m.category] ?? []).push(m);
          return acc;
        }, {});
        const catOrder = Object.keys(CATEGORY_LABELS);
        const sortedCats = [
          ...catOrder.filter(c => byCat[c]),
          ...Object.keys(byCat).filter(c => !catOrder.includes(c)),
        ];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="search"
                placeholder="Søk butikk, alias eller kategori…"
                value={merchantsSearch}
                onChange={e => setMerchantsSearch(e.target.value)}
                style={{ flex: 1, minWidth: 180, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 14, background: 'var(--card)' }}
              />
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{filtered.length} butikker</span>
              <button
                onClick={() => { setAddingMerchant(true); setNewMerchantName(''); setNewMerchantCategory('annet'); }}
                style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >+ Ny butikk</button>
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Klikk en butikk for å se aliasene den har lært (banktekstene som mappes hit automatisk).
            </div>

            {/* Add new merchant inline form */}
            {addingMerchant && (
              <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  autoFocus
                  placeholder="Butikknavn"
                  value={newMerchantName}
                  onChange={e => setNewMerchantName(e.target.value)}
                  style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--card)', fontSize: 14 }}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && newMerchantName.trim()) { await merchantsApi.ensureMerchant(newMerchantName, newMerchantCategory); setAddingMerchant(false); }
                    if (e.key === 'Escape') setAddingMerchant(false);
                  }}
                />
                <select
                  value={newMerchantCategory}
                  onChange={e => setNewMerchantCategory(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', fontSize: 14 }}
                >
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button
                  onClick={async () => { if (newMerchantName.trim()) { await merchantsApi.ensureMerchant(newMerchantName, newMerchantCategory); setAddingMerchant(false); } }}
                  style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--good)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}
                >Lagre</button>
                <button
                  onClick={() => setAddingMerchant(false)}
                  style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--line)', border: 'none', cursor: 'pointer', fontSize: 13 }}
                >Avbryt</button>
              </div>
            )}

            {sortedCats.length === 0 && (
              <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 32 }}>
                {merchants.length === 0 ? 'Ingen butikker ennå. Legg til eller importer transaksjoner.' : 'Ingen treff'}
              </div>
            )}

            {/* Regler gruppert per kategori — ett kort per kategori i et grid */}
            {/* Masonry via CSS-kolonner: kort med svært ulik høyde (Dagligvarer 22 vs
                Kiosk 5) pakkes vertikalt og kolonnene balanseres, i stedet for et grid
                der hver rad ble like høy som det høyeste kortet og etterlot tomrom. */}
            <div style={{
              columnWidth: isMobile ? undefined : 340,
              columnCount: isMobile ? 1 : undefined,
              columnGap: 12,
            }}>
            {sortedCats.map(cat => (
              <div key={cat} style={{
                breakInside: 'avoid', marginBottom: 12,
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', minWidth: 0,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '12px 16px', borderBottom: '1px solid var(--line)',
                  background: 'var(--surface-2)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <i style={{ width: 9, height: 9, borderRadius: 2, background: CAT_COLORS[cat] ?? '#9E9E9E', flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {CATEGORY_LABELS[cat] ?? cat}
                    </span>
                  </span>
                  <span style={{ ...monoNum, fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>
                    {byCat[cat].length} butikker
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 14px 12px' }}>
                  {byCat[cat].map(m => {
                    const als = aliasesByMerchant.get(m.id) ?? [];
                    const badge = KIND_BADGE[m.kind];
                    const expanded = expandedMerchantId === m.id;
                    return (
                    <div key={m.id} style={{ display: 'flex', flexDirection: 'column' }}>
                      {/* Kompakt rad: navn (utvid/lukk) + merkelapper til venstre, handlinger til høyre.
                          Kategori-nedtrekket er borte fra hver rad — butikken ligger allerede i sin
                          kategorikolonne, så det gjentok bare overskriften og laget dødt tomrom. Bytt
                          kategori i panelet som åpnes under. */}
                      <div
                        className={expanded ? 'merchant-row expanded' : 'merchant-row'}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 7, padding: '3px 4px' }}
                      >
                        {editingMerchantId === m.id ? (
                          <input
                            autoFocus
                            defaultValue={m.name}
                            style={{ flex: 1, minWidth: 0, fontSize: 14, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--card)' }}
                            onBlur={e => { const v = e.target.value.trim(); v && v !== m.name ? saveMerchantEdit(m, { name: v }) : setEditingMerchantId(null); }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingMerchantId(null);
                            }}
                          />
                        ) : (
                          <>
                            <button
                              onClick={() => setExpandedMerchantId(expanded ? null : m.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 5, flex: '0 1 auto', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 2px 2px 2px', fontSize: 14, color: 'var(--fg)' }}
                              title={als.length ? `${als.length} lærte aliaser — klikk for å vise/endre` : 'Klikk for å vise/endre'}
                            >
                              <span style={{ color: 'var(--muted)', fontSize: 10, flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                            </button>
                            {badge && <span title={badge.title} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{badge.label}</span>}
                            {als.length > 0 && <span title={`${als.length} lærte aliaser`} style={{ fontSize: 10.5, color: 'var(--ink-4)', flexShrink: 0 }}>{als.length} alias</span>}
                            <span style={{ flex: 1 }} />
                            <button onClick={() => setEditingMerchantId(m.id)} title="Endre navn"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', padding: '2px 3px', borderRadius: 5, flexShrink: 0 }}>✏</button>
                            <button
                              className="merchant-del"
                              onClick={async () => { if (await confirm({ title: 'Slett butikk?', message: `«${m.name}» — aliasene slettes også; transaksjoner beholdes.`, confirmLabel: 'Slett' })) merchantsApi.deleteMerchant(m.id); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px', borderRadius: 5, flexShrink: 0 }}
                              title="Slett"
                            >×</button>
                          </>
                        )}
                      </div>

                      {/* Aliaser + slå sammen */}
                      {expanded && (
                        <div style={{ margin: '2px 0 8px 18px', padding: '10px 12px', borderRadius: 8, background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {/* Kategori — flyttet hit fra hver rad; ligger sammen med aliaser og «slå sammen» */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Kategori</span>
                            <select
                              value={m.category}
                              onChange={e => saveMerchantEdit(m, { category: e.target.value })}
                              style={{ fontSize: 12.5, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--fg)', cursor: 'pointer' }}
                            >
                              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          {als.length === 0 ? (
                            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Ingen lærte aliaser ennå — de kommer når du mapper banktekster hit ved import.</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {als.sort().map(al => (
                                <span key={al} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line)' }}>
                                  {al}
                                  <button onClick={() => merchantsApi.removeAlias(al)} title="Glem dette aliaset"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {mergingMerchantId === m.id ? (
                              <>
                                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Flytt alt (aliaser + transaksjoner) inn i:</span>
                                <select
                                  autoFocus
                                  defaultValue=""
                                  onChange={async e => {
                                    const toId = e.target.value;
                                    if (!toId) return;
                                    const to = merchants.find(x => x.id === toId)!;
                                    if (await confirm({ title: 'Slå sammen?', message: `«${m.name}» flyttes inn i «${to.name}» og slettes.`, confirmLabel: 'Slå sammen' })) {
                                      await merchantsApi.mergeMerchants(m.id, toId);
                                      await loadTxs(month);
                                    }
                                    setMergingMerchantId(null);
                                  }}
                                  style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--card)' }}
                                >
                                  <option value="">Velg butikk…</option>
                                  {merchants.filter(x => x.id !== m.id && x.kind === m.kind).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                </select>
                                <button onClick={() => setMergingMerchantId(null)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', color: 'var(--muted)' }}>Avbryt</button>
                              </>
                            ) : (
                              <button onClick={() => setMergingMerchantId(m.id)}
                                style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', color: 'var(--muted)' }}>
                                ⇄ Slå sammen med annen butikk…
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })}
                  {/* Legg til rett i denne kategorien — åpner skjemaet forhåndsutfylt */}
                  <button
                    onClick={() => { setAddingMerchant(true); setNewMerchantName(''); setNewMerchantCategory(cat); }}
                    style={{
                      textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                      padding: '8px 0 0', fontSize: 11.5, color: 'var(--muted)',
                    }}>
                    + legg til i {CATEGORY_LABELS[cat] ?? cat} …
                  </button>
                </div>
              </div>
            ))}
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════ KATEGORIER TAB ══════════════════════════════ */}
      {tab === 'kategorier' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1, minWidth: 160 }}>
              {categories.length} kategorier · endre navn og farge, eller legg til egne
            </span>
            <button
              onClick={() => { setAddingCat(true); setNewCatName(''); setNewCatColor('#5B9BD5'); }}
              style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >+ Ny kategori</button>
          </div>

          {/* Add new category inline form */}
          {addingCat && (
            <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="color"
                value={newCatColor}
                onChange={e => setNewCatColor(e.target.value)}
                title="Farge"
                style={{ width: 34, height: 34, padding: 0, border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', flexShrink: 0 }}
              />
              <input
                autoFocus
                placeholder="Kategorinavn"
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveNewCat(); if (e.key === 'Escape') setAddingCat(false); }}
                style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--card)', fontSize: 14 }}
              />
              <button
                onClick={saveNewCat}
                style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--good)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}
              >Lagre</button>
              <button
                onClick={() => setAddingCat(false)}
                style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--line)', border: 'none', cursor: 'pointer', fontSize: 13 }}
              >Avbryt</button>
            </div>
          )}

          <div style={card}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {categories.map(c => {
                const n = catCounts[c.key] ?? 0;
                return (
                  <div key={c.key} style={{ display: 'grid', gridTemplateColumns: isMobile ? '30px minmax(0,1fr) auto 32px' : '30px 1fr 150px 36px', gap: 8, alignItems: 'center' }}>
                    {/* Colour swatch = live colour picker */}
                    <input
                      type="color"
                      value={c.color}
                      onChange={e => updateCategoryMeta(c.key, { color: e.target.value })}
                      title="Endre farge"
                      style={{ width: 26, height: 26, padding: 0, border: '1px solid var(--line)', borderRadius: 7, background: 'none', cursor: 'pointer' }}
                    />
                    {/* Name (editable) */}
                    {editingCatKey === c.key ? (
                      <input
                        autoFocus
                        defaultValue={c.label}
                        style={{ fontSize: 14, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--card)' }}
                        onBlur={e => { const v = e.target.value.trim(); if (v && v !== c.label) updateCategoryMeta(c.key, { label: v }); setEditingCatKey(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCatKey(null); }}
                      />
                    ) : (
                      <button
                        onClick={() => setEditingCatKey(c.key)}
                        style={{ textAlign: 'left', background: 'none', border: 'none', cursor: 'text', padding: '3px 6px', borderRadius: 6, fontSize: 14, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={`Nøkkel: ${c.key}${c.is_system ? ' · innebygd' : ''}`}
                      >
                        {c.label}
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>✏</span>
                      </button>
                    )}
                    {/* Transaction count */}
                    <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: isMobile ? 'right' : 'left', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {n} {n === 1 ? 'transaksjon' : 'transaksjoner'}
                    </span>
                    {/* Delete — only when the category is empty */}
                    <button
                      disabled={n > 0}
                      onClick={async () => {
                        if (!(await confirm({ title: 'Slett kategori?', message: `«${c.label}»`, confirmLabel: 'Slett' }))) return;
                        const res = await deleteCategory(c.key);
                        if (!res.ok) await confirm({ title: 'Kan ikke slette', message: `«${c.label}» har ${res.count} transaksjon${res.count === 1 ? '' : 'er'}. Flytt dem til en annen kategori først.`, confirmLabel: 'OK', danger: false });
                      }}
                      title={n > 0 ? 'Kan ikke slette – kategorien har transaksjoner' : 'Slett'}
                      style={{ background: 'none', border: 'none', cursor: n > 0 ? 'not-allowed' : 'pointer', fontSize: 16, color: n > 0 ? 'var(--line)' : '#e57373', padding: '3px 4px', borderRadius: 6 }}
                    >×</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
