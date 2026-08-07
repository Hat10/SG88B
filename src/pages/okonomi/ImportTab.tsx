// Importfanen (v2): flere filer per sone, full radregnskap (ingenting forsvinner
// stille), gruppert løsning av ukjente butikker, forslag som må bekreftes,
// automatisk duplikat-utelatelse — og alias-læring ved import.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtKr } from '../../components';
import { useCategories } from '../../contexts/CategoryContext';
import {
  decodeText, parseDnb, parseRevolut, looksLikeDnb, looksLikeRevolut,
  prepareReview, hashFile, detectMonth, classifyTx, round2,
  type Merchant, type ParseResult, type PendingFile, type ReviewFile, type ReviewTx, type SourceKind, type TxMeta,
} from '../../lib/import';
import { CatTag, CategoryPicker, MerchantCombobox, OwnerPicker, SOURCE_COLOR, SOURCE_LABEL, CURRENCY_SYMBOL } from './shared';
import type { MerchantsApi } from './useMerchants';

// ─── Soner ────────────────────────────────────────────────────────────────────

type ZoneId = 'bank_M' | 'bank_L' | 'revolut_M' | 'revolut_L' | 'trumf';
interface ZoneDef { id: ZoneId; kind: SourceKind; label: string; accept: string }

const ZONES: Record<ZoneId, ZoneDef> = {
  bank_M:    { id: 'bank_M',    kind: 'dnb',     label: '👨 DNB Andreas',      accept: '.txt,.csv' },
  bank_L:    { id: 'bank_L',    kind: 'dnb',     label: '👩 DNB Taran',        accept: '.txt,.csv' },
  revolut_M: { id: 'revolut_M', kind: 'revolut', label: '👨 Revolut Andreas',  accept: '.csv' },
  revolut_L: { id: 'revolut_L', kind: 'revolut', label: '👩 Revolut Taran',    accept: '.csv' },
  trumf:     { id: 'trumf',     kind: 'trumf',   label: '💳 Trumf kontoutskrift (PDF)', accept: '.pdf' },
};

// Sone → source-verdien som lagres på transaksjonene (Revolut foldes inn i bank)
const STORED_SOURCE: Record<ZoneId, 'bank_M' | 'bank_L' | 'trumf'> = {
  bank_M: 'bank_M', bank_L: 'bank_L', revolut_M: 'bank_M', revolut_L: 'bank_L', trumf: 'trumf',
};

type Owner = 'bank_M' | 'bank_L' | 'felles';

interface Resolution { merchant?: Merchant; name: string; category: string }

// Hvordan raden ble klassifisert VED IMPORT — uavhengig av hva brukeren har
// huket av etterpå. Styrer hvilken seksjon raden ligger i, så ingenting hopper
// når du tar den med eller utelater den.
const includedByDefault = (t: ReviewTx) => !t.isDuplicate && t.cls.includedByDefault;

const EXCLUDE_ICON: Record<string, string> = {
  'intern overføring': '↔', 'kortoppgjør — dekkes av kortets egen import': '💳',
  'privat overføring': '👤', 'overføring til person/konto': '👤',
  'tilbakeført / ikke gjennomført': '⛔', duplikat: '🔁',
};

// ─── Multi-fil dropzone ───────────────────────────────────────────────────────

function MultiFileZone({ label, hint, accept, chips, onAdd, onRemove }: {
  label: string; hint?: string; accept: string;
  chips: { id: string; filename: string; summary: string; error?: string; warn?: string }[];
  onAdd: (files: FileList) => void; onRemove: (id: string) => void;
}) {
  const [drag, setDrag] = useState(false);
  const inputId = useMemo(() => 'zone-' + Math.random().toString(36).slice(2), []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <label
        htmlFor={inputId}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) onAdd(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${drag ? 'var(--accent)' : chips.length ? 'var(--good)' : 'var(--line)'}`,
          borderRadius: 8, padding: '14px 12px', cursor: 'pointer',
          background: drag ? 'var(--accent-soft)' : 'var(--surface)',
          transition: 'all .15s', textAlign: 'center', minHeight: 64,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}
      >
        <input id={inputId} type="file" accept={accept} multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) onAdd(e.target.files); e.target.value = ''; }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{hint ?? 'Slipp filer her — flere er lov'}</span>
      </label>
      {chips.map(c => (
        <div key={c.id} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
          background: c.error ? 'rgba(217,95,95,0.10)' : 'color-mix(in oklab, var(--good) 10%, var(--surface))',
          border: `1px solid ${c.error ? '#D9534F55' : 'color-mix(in oklab, var(--good) 40%, var(--line))'}`,
          fontSize: 12, minWidth: 0,
        }}>
          <span style={{ flexShrink: 0 }}>{c.error ? '⚠️' : '📄'}</span>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.filename}</span>
          <span style={{ color: c.error ? '#D9534F' : 'var(--muted)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
            {c.error ?? c.summary}
          </span>
          {c.warn && !c.error && <span title={c.warn} style={{ flexShrink: 0 }}>⚠️</span>}
          <button onClick={() => onRemove(c.id)} title="Fjern fila"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Hovedkomponent ───────────────────────────────────────────────────────────

export default function ImportTab({ merchantsApi, isMobile, onImported }: {
  merchantsApi: MerchantsApi;
  isMobile: boolean;
  onImported: (month: string) => void;
}) {
  const { categories } = useCategories();
  const { ctx } = merchantsApi;

  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dbFps, setDbFps] = useState<Map<string, number>>(new Map());
  const [prevHashes, setPrevHashes] = useState<Map<string, string>>(new Map());   // file_hash → 'filnavn · dato'

  // Brukerens valg i review — nøklet så de overlever re-annotering
  const [includeOverride, setIncludeOverride] = useState<Map<string, boolean>>(new Map());   // rowKey → include
  const [ownerOverride, setOwnerOverride]     = useState<Map<string, Owner>>(new Map());     // rowKey → eier
  const [resolutions, setResolutions]         = useState<Map<string, Resolution>>(new Map()); // aliasKey → butikk
  const [accepted, setAccepted]               = useState<Set<string>>(new Set());             // aliasKey → forslag godtatt
  const [perTx, setPerTx]                     = useState<Map<string, Resolution>>(new Map()); // rowKey → butikk (Vipps o.l.)
  const [catOverride, setCatOverride]         = useState<Map<string, string>>(new Map());     // rowKey → kategori (kun denne raden)
  const [noteText, setNoteText]               = useState<Map<string, string>>(new Map());     // rowKey → kommentar
  const [editingPerTx, setEditingPerTx]       = useState<string | null>(null);
  const [editingNote, setEditingNote]         = useState<string | null>(null);
  const [showExcluded, setShowExcluded]       = useState<Set<string>>(new Set());             // file.id
  // Filer der utelatt-lista har vært åpnet minst én gang. Vokser bare — å lukke
  // igjen betyr ikke at du ikke har sett den.
  const [seenExcluded, setSeenExcluded]       = useState<Set<string>>(new Set());
  const [showUnparsed, setShowUnparsed]       = useState<Set<string>>(new Set());

  const [fxText, setFxText] = useState<Record<string, string>>({});
  const fxRates = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [cur, txt] of Object.entries(fxText)) {
      const n = parseFloat(txt.replace(',', '.'));
      if (n > 0) out[cur] = n;
    }
    return out;
  }, [fxText]);

  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState('');

  // ── Fil inn ────────────────────────────────────────────────────────────────
  async function addFiles(zone: ZoneDef, list: FileList) {
    setMsg('');
    for (const file of Array.from(list)) {
      const buf = await file.arrayBuffer();
      let parse: ParseResult;
      if (zone.kind === 'trumf') {
        try {
          // pdfjs-dist (~1,2 MB) lastes først når en PDF faktisk tolkes,
          // ikke ved åpning av Forbruk-siden.
          const { parseTrumfPdf } = await import('../../lib/import/trumfPdf');
          parse = await parseTrumfPdf(file);
        } catch (err: any) {
          parse = { rows: [], unparsed: [], fileError: 'Klarte ikke lese PDF-en: ' + (err?.message ?? err) };
        }
      } else {
        const text = decodeText(buf);
        if (zone.kind === 'dnb' && looksLikeRevolut(text)) {
          parse = { rows: [], unparsed: [], fileError: 'Dette ser ut som en Revolut-eksport — slipp den i Revolut-sonen.' };
        } else if (zone.kind === 'revolut' && looksLikeDnb(text)) {
          parse = { rows: [], unparsed: [], fileError: 'Dette ser ut som en DNB-eksport — slipp den i DNB-sonen.' };
        } else {
          parse = zone.kind === 'dnb' ? parseDnb(text) : parseRevolut(text);
        }
      }
      const fileHash = await hashFile(buf);
      const id = `${zone.id}:${file.name}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
      setFiles(prev => [...prev, {
        id, zone: zone.id, sourceKind: zone.kind, filename: file.name, fileHash, parse,
        dedupeScope: STORED_SOURCE[zone.id],
      }]);
    }
  }

  function removeFile(id: string) {
    setFiles(prev => prev.filter(f => f.id !== id));
    const dropKeys = <V,>(m: Map<string, V>) => new Map([...m].filter(([k]) => !k.startsWith(id + ':')));
    setIncludeOverride(prev => dropKeys(prev));
    setOwnerOverride(prev => dropKeys(prev));
    setPerTx(prev => dropKeys(prev));
    setCatOverride(prev => dropKeys(prev));
    setNoteText(prev => dropKeys(prev));
  }

  // ── Eksisterende fingerprints + fil-hasher fra DB ──────────────────────────
  // Nøkles `${source}|${fingerprint}` — duplikater telles kun innenfor samme
  // person/kilde (to personer kan lovlig ha identiske kjøp samme dag).
  useEffect(() => {
    const dates = files.flatMap(f => f.parse.rows.map(r => r.date));
    if (!dates.length) { setDbFps(new Map()); return; }
    const min = dates.reduce((a, b) => a < b ? a : b);
    const max = dates.reduce((a, b) => a > b ? a : b);
    let stale = false;
    (async () => {
      // Supabase returnerer maks 1000 rader per spørring. Uten paginering ville
      // en fil som spenner over mange måneder stille fått en UFULLSTENDIG liste
      // over eksisterende rader — og alt utenfor de 1000 ville sluppet inn som
      // «nytt» ved neste import. Hent til siden er kortere enn sidestørrelsen.
      const PAGE = 1000;
      const m = new Map<string, number>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('transactions').select('fingerprint,source')
          .gte('date', min).lte('date', max)
          .order('id').range(from, from + PAGE - 1);
        if (error || !data) break;
        for (const r of data as { fingerprint: string | null; source: string }[]) {
          if (!r.fingerprint) continue;
          const key = `${r.source}|${r.fingerprint}`;
          m.set(key, (m.get(key) ?? 0) + 1);
        }
        if (data.length < PAGE) break;
      }
      if (!stale) setDbFps(m);
    })();
    return () => { stale = true; };
  }, [files]);

  useEffect(() => {
    const hashes = [...new Set(files.map(f => f.fileHash))];
    if (!hashes.length) { setPrevHashes(new Map()); return; }
    supabase.from('finance_imports').select('file_hash,filename,imported_at').in('file_hash', hashes)
      .then(({ data }) => {
        const m = new Map<string, string>();
        for (const r of (data ?? []) as any[]) {
          if (r.file_hash) m.set(r.file_hash, `${r.filename ?? 'ukjent fil'} · ${String(r.imported_at ?? '').slice(0, 10)}`);
        }
        setPrevHashes(m);
      });
  }, [files]);

  // ── Annotering (parse → match → klassifiser → dedupe) ──────────────────────
  const review: ReviewFile[] = useMemo(() => prepareReview(files, ctx, dbFps), [files, ctx, dbFps]);

  const rowKey = (file: ReviewFile, idx: number) => `${file.id}:${idx}`;

  // Effektiv butikk for en rad, gitt brukerens valg så langt
  function effectiveOf(t: ReviewTx, key: string): { merchant?: Merchant; name?: string; category?: string; isSuggestion?: boolean; isIntermediary?: boolean } {
    const p = perTx.get(key);
    if (p) return { merchant: p.merchant, name: p.name, category: p.category };
    if (t.match.type === 'exact') {
      if (t.match.merchant.kind === 'intermediary') {
        return { merchant: t.match.merchant, name: t.match.merchant.name, category: t.match.merchant.category, isIntermediary: true };
      }
      return { merchant: t.match.merchant, name: t.match.merchant.name, category: t.match.merchant.category };
    }
    const r = resolutions.get(t.norm.aliasKey);
    if (r) return { merchant: r.merchant, name: r.name, category: r.category };
    if (t.match.type === 'suggestion') {
      if (accepted.has(t.norm.aliasKey)) {
        return { merchant: t.match.merchant, name: t.match.merchant.name, category: t.match.merchant.category };
      }
      return { isSuggestion: true };
    }
    // Auto-utelatte rader med full-score forslag viser forslagsnavnet (grået)
    return {};
  }

  const isIncluded = (t: ReviewTx, key: string) =>
    includeOverride.get(key) ?? (!t.isDuplicate && t.cls.includedByDefault);

  // ── Ukjente butikker, gruppert på aliasnøkkel på tvers av filene ───────────
  interface UnknownGroup {
    aliasKey: string; sample: ReviewTx; count: number; sum: number;
    raws: string[]; suggestion?: Merchant; suggestedName: string; suggestedCategory: string;
  }
  // Grupper deles i uløste og løste. De løste blir stående synlig i kortet —
  // ellers forsvinner butikken du nettopp navnga, og du må lete den fram nede i
  // transaksjonslista for å sette kategori.
  const { unknownGroups, resolvedGroups } = useMemo(() => {
    const handledByUser = (ak: string) => resolutions.has(ak) || accepted.has(ak);
    const map = new Map<string, UnknownGroup>();
    for (const file of review) {
      file.txs.forEach((t, i) => {
        const key = rowKey(file, i);
        if (!isIncluded(t, key)) return;
        const eff = effectiveOf(t, key);
        // Kjent fra registeret fra før = aldri «ukjent». Løst av deg = behold i lista.
        if (!handledByUser(t.norm.aliasKey) && (eff.name || eff.merchant)) return;
        if (t.cls.needsPerTxName) return;                 // Vipps o.l. — navngis per rad
        const g = map.get(t.norm.aliasKey);
        if (g) {
          g.count += 1; g.sum += t.norm.amount;
          if (g.raws.length < 2 && !g.raws.includes(t.norm.rawDescription)) g.raws.push(t.norm.rawDescription);
        } else {
          map.set(t.norm.aliasKey, {
            aliasKey: t.norm.aliasKey, sample: t, count: 1, sum: t.norm.amount,
            raws: [t.norm.rawDescription],
            suggestion: t.match.type === 'suggestion' ? t.match.merchant : undefined,
            suggestedName: t.match.type === 'none' ? t.match.suggestedName : '',
            suggestedCategory: t.match.type === 'none' ? t.match.suggestedCategory : 'annet',
          });
        }
      });
    }
    const all = [...map.values()].sort((a, b) => a.sum - b.sum);
    return {
      unknownGroups: all.filter(g => !handledByUser(g.aliasKey)),
      resolvedGroups: all.filter(g => handledByUser(g.aliasKey)),
    };
  }, [review, resolutions, accepted, includeOverride, perTx]);

  // ── Blokkere ───────────────────────────────────────────────────────────────
  const missingRates = useMemo(() => {
    const set = new Set<string>();
    for (const file of review) {
      file.txs.forEach((t, i) => {
        if (isIncluded(t, rowKey(file, i)) && t.norm.currency && !(fxRates[t.norm.currency] > 0)) set.add(t.norm.currency);
      });
    }
    return [...set];
  }, [review, includeOverride, fxRates]);

  const allCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const file of review) for (const t of file.txs) if (t.norm.currency) set.add(t.norm.currency);
    return [...set];
  }, [review]);

  const includedCount = review.reduce((s, f) => s + f.txs.filter((t, i) => isIncluded(t, rowKey(f, i))).length, 0);
  // Grunnlag for påminnelsen om å se over de automatisk utelatte radene
  const excludedTotal   = review.reduce((s, f) => s + f.txs.filter(t => !includedByDefault(t)).length, 0);
  const takenBackTotal  = review.reduce((s, f) => s + f.txs.filter((t, i) => !includedByDefault(t) && isIncluded(t, rowKey(f, i))).length, 0);
  const unseenExcluded  = review.filter(f => f.txs.some(t => !includedByDefault(t)) && !seenExcluded.has(f.id));

  // ── Løs en gruppe ──────────────────────────────────────────────────────────
  function resolveGroup(g: UnknownGroup, name: string, matched?: Merchant, category?: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    // En eksplisitt kategori vinner også når butikken ble matchet — ellers kan du
    // ikke overstyre kategorien på en ferdig løst gruppe.
    setResolutions(prev => new Map(prev).set(g.aliasKey, matched
      ? { merchant: matched, name: matched.name, category: category ?? matched.category }
      : { name: trimmed, category: category ?? g.suggestedCategory ?? 'annet' }));
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  async function doImport() {
    if (unknownGroups.length > 0) {
      setMsg(`⚠ ${unknownGroups.length} ukjent${unknownGroups.length !== 1 ? 'e' : ''} butikk${unknownGroups.length !== 1 ? 'er' : ''} må løses (eller utelates) før import.`);
      return;
    }
    if (missingRates.length > 0) {
      setMsg(`⚠ Sett vekslingskurs for ${missingRates.join(', ')} før import.`);
      return;
    }
    setImporting(true); setMsg('');
    try {
      // 1) Opprett nye butikker for løsninger uten eksisterende treff
      const resolvedMerchants = new Map<string, Merchant>();   // aliasKey → butikk
      for (const [aliasKey, r] of resolutions) {
        resolvedMerchants.set(aliasKey, r.merchant ?? await merchantsApi.ensureMerchant(r.name, r.category));
      }
      const perTxMerchants = new Map<string, Merchant>();      // rowKey → butikk
      for (const [key, r] of perTx) {
        perTxMerchants.set(key, r.merchant ?? await merchantsApi.ensureMerchant(r.name, r.category));
      }

      // 2) Alias-læring: løsninger + godtatte forslag → eksakt treff neste gang
      for (const [aliasKey, m] of resolvedMerchants) await merchantsApi.addAlias(aliasKey, m.id);
      for (const file of review) {
        for (const t of file.txs) {
          if (accepted.has(t.norm.aliasKey) && t.match.type === 'suggestion') {
            await merchantsApi.addAlias(t.norm.aliasKey, t.match.merchant.id);
          }
        }
      }

      // 3) Skriv hver fil
      let total = 0;
      let latestMonth = '';
      for (const file of review) {
        const rows = file.txs
          .map((t, i) => ({ t, key: rowKey(file, i) }))
          .filter(({ t, key }) => isIncluded(t, key));
        if (!rows.length) continue;

        const importMonth = detectMonth(rows.map(r => r.t.norm.date));
        const { data: rec, error: recErr } = await supabase.from('finance_imports').insert({
          source: STORED_SOURCE[file.zone as ZoneId], month: importMonth, filename: file.filename,
          file_hash: file.fileHash, row_count: rows.length,
          skipped_count: file.parse.rows.length - rows.length + file.parse.unparsed.length,
        }).select('id').single();
        if (recErr || !rec) throw new Error(recErr?.message ?? 'Kunne ikke opprette importlogg');

        const txRows = rows.map(({ t, key }) => {
          const eff = effectiveOf(t, key);
          const merchant = perTxMerchants.get(key) ?? eff.merchant ?? resolvedMerchants.get(t.norm.aliasKey);

          let amount = t.norm.amount;
          let fxNote: string | null = null;
          const meta: TxMeta & { aliasKey: string } = { ...t.norm.meta, aliasKey: t.norm.aliasKey };
          if (t.norm.currency) {
            const rate = fxRates[t.norm.currency];
            meta.origCurrency = t.norm.currency;
            meta.origAmount = amount;
            meta.fxRate = rate;
            amount = round2(amount * rate);
            fxNote = `${meta.origAmount!.toFixed(2).replace('.', ',')} ${t.norm.currency} · kurs ${String(rate).replace('.', ',')}`;
          }
          if (perTxMerchants.has(key) && t.match.type === 'exact' && t.match.merchant.kind === 'intermediary') {
            meta.intermediary = t.match.merchant.name.toLowerCase();
          }

          const isPlaceholder = merchant?.kind === 'intermediary';
          const kind = merchant && !isPlaceholder
            ? classifyTx(t.norm, { type: 'exact', merchant }).kind
            : t.cls.kind;

          const userNote = noteText.get(key)?.trim();
          const note = [fxNote, userNote].filter(Boolean).join(' · ') || null;

          return {
            import_id:          rec.id,
            date:               t.norm.date,
            description:        merchant?.name ?? eff.name ?? t.norm.merchantText,
            merchant_id:        merchant?.id ?? null,
            amount,
            source:             ownerOverride.get(key) ?? STORED_SOURCE[file.zone as ZoneId],
            category:           catOverride.get(key) ?? merchant?.category ?? eff.category ?? 'annet',
            category_confirmed: catOverride.has(key) || (!!merchant && !isPlaceholder),
            kind,
            month:              t.norm.date.slice(0, 7),
            raw_description:    t.norm.rawDescription,
            note,
            meta,
            fingerprint:        t.fingerprint,
          };
        });

        const { error } = await supabase.from('transactions').insert(txRows);
        if (error) throw new Error(error.message);
        total += txRows.length;
        const maxMonth = txRows.reduce((mx, r) => r.month > mx ? r.month : mx, '');
        if (maxMonth > latestMonth) latestMonth = maxMonth;
      }

      setMsg(`✓ ${total} transaksjoner importert!`);
      setFiles([]); setIncludeOverride(new Map()); setOwnerOverride(new Map());
      setResolutions(new Map()); setAccepted(new Set()); setPerTx(new Map());
      setCatOverride(new Map()); setNoteText(new Map());
      if (latestMonth) onImported(latestMonth);
    } catch (err: any) {
      setMsg('❌ ' + (err?.message ?? String(err)));
    } finally {
      setImporting(false);
    }
  }

  // ── Stiler ─────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: 'var(--surface)', borderRadius: 10, padding: 20,
    border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12,
  };
  const ey: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--muted)',
  };
  const GRID_COLS = '30px 106px 46px minmax(170px, 1.3fr) minmax(120px, 1fr) 120px 84px';
  const chip: React.CSSProperties = {
    fontSize: 10, padding: '1px 6px', borderRadius: 8, background: 'var(--bg)',
    color: 'var(--muted)', whiteSpace: 'nowrap', border: '1px solid var(--line)',
  };

  const zoneChips = (zoneId: ZoneId) =>
    files.filter(f => f.zone === zoneId).map(f => ({
      id: f.id,
      filename: f.filename,
      summary: `${f.parse.rows.length} rader`,
      error: f.parse.fileError,
      warn: prevHashes.has(f.fileHash) ? `Denne fila er importert før (${prevHashes.get(f.fileHash)})` : undefined,
    }));

  const catOptions = categories.map(c => c.key);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Soner */}
      <div style={card}>
        <div style={ey}>🏦 Bankeksport — DNB (.txt) · flere kontoer? slipp alle filene</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
          {(['bank_M', 'bank_L'] as ZoneId[]).map(z => (
            <MultiFileZone key={z} label={ZONES[z].label} accept={ZONES[z].accept}
              hint="DNB → Kontoutskrift → Last ned som .txt"
              chips={zoneChips(z)} onAdd={l => addFiles(ZONES[z], l)} onRemove={removeFile} />
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={ey}>💳 Bankeksport — Revolut (.csv)</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
          {(['revolut_M', 'revolut_L'] as ZoneId[]).map(z => (
            <MultiFileZone key={z} label={ZONES[z].label} accept={ZONES[z].accept}
              hint="Revolut → Kontoutskrift → Last ned som .csv"
              chips={zoneChips(z)} onAdd={l => addFiles(ZONES[z], l)} onRemove={removeFile} />
          ))}
        </div>
        {allCurrencies.length > 0 && (
          <div style={{
            padding: '12px 14px', borderRadius: 10,
            border: `1.5px solid ${missingRates.length ? 'var(--warn)' : 'var(--good)'}`,
            background: missingRates.length ? 'rgba(201,122,59,0.12)' : 'color-mix(in oklab, var(--good) 10%, var(--surface))',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              {missingRates.length ? `💱 Utenlandsk valuta (${allCurrencies.join(', ')}) — legg inn kurs` : '✅ Vekslingskurs satt'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
              Effektiv kurs = kroner brukt på påfylling ÷ valuta mottatt (f.eks. 5000 kr ÷ 425 € = 11,76).
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              {allCurrencies.map(cur => (
                <label key={cur} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700 }}>
                  1 {cur} =
                  <input type="text" inputMode="decimal" placeholder="11,76" value={fxText[cur] ?? ''}
                    onChange={e => setFxText(t => ({ ...t, [cur]: e.target.value }))}
                    style={{
                      width: 84, padding: '7px 9px', borderRadius: 8, fontSize: 14, fontWeight: 700, textAlign: 'right',
                      border: `2px solid ${fxRates[cur] > 0 ? 'var(--good)' : 'var(--warn)'}`,
                      background: 'var(--surface)', color: 'var(--ink)', outline: 'none',
                    }} />
                  kr {fxRates[cur] > 0 && <span style={{ color: 'var(--good)' }}>✓</span>}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={ey}>💳 Trumf Visa — felles (PDF)</div>
        <MultiFileZone label={ZONES.trumf.label} accept=".pdf"
          hint="Alle kjøp registreres som felles forbruk"
          chips={zoneChips('trumf')} onAdd={l => addFiles(ZONES.trumf, l)} onRemove={removeFile} />
      </div>

      {/* ── Ukjente butikker ── */}
      {(unknownGroups.length > 0 || resolvedGroups.length > 0) && (
        <div style={{ ...card, borderColor: unknownGroups.length > 0 ? 'var(--warn)' : 'var(--good)', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>🏪 Ukjente butikker</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {unknownGroups.length > 0
                ? `${unknownGroups.length} igjen å løse — gjelder alle radene (og huskes til neste import)`
                : 'Alle løst — kategori kan endres her'}
              {resolvedGroups.length > 0 && (
                <span style={{ color: 'var(--good)', fontWeight: 700 }}> · {resolvedGroups.length} løst</span>
              )}
            </span>
          </div>
          {unknownGroups.map(g => (
            <UnknownGroupRow key={g.aliasKey} group={g} merchants={merchantsApi.merchants}
              catOptions={catOptions}
              onResolve={(name, matched, cat) => resolveGroup(g, name, matched, cat)}
              onAccept={() => setAccepted(prev => new Set(prev).add(g.aliasKey))}
              onExclude={() => {
                // Utelat alle radene i gruppen
                setIncludeOverride(prev => {
                  const next = new Map(prev);
                  for (const file of review) {
                    file.txs.forEach((t, i) => { if (t.norm.aliasKey === g.aliasKey) next.set(rowKey(file, i), false); });
                  }
                  return next;
                });
              }} />
          ))}

          {/* Ferdig løste — blir stående så kategorien kan settes uten å lete i radlista */}
          {resolvedGroups.map(g => {
            const r = resolutions.get(g.aliasKey);
            const merchant = r?.merchant ?? (accepted.has(g.aliasKey) ? g.suggestion : undefined);
            const name = r?.name ?? merchant?.name ?? g.suggestedName;
            const cat  = r?.category ?? merchant?.category ?? g.suggestedCategory;
            return (
              <div key={g.aliasKey} style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '8px 12px', borderRadius: 9,
                background: 'color-mix(in oklab, var(--good) 8%, var(--surface))',
                border: '1px solid color-mix(in oklab, var(--good) 35%, var(--line))',
              }}>
                <span style={{ color: 'var(--good)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span title={g.raws.join('\n')} style={{
                  fontSize: 12, color: 'var(--muted)', maxWidth: 200,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{g.sample.norm.merchantText}</span>
                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>→</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {g.count} rad{g.count !== 1 ? 'er' : ''} · {fmtKr(Math.abs(g.sum))}
                </span>
                <CategoryPicker variant="field" value={cat} options={catOptions}
                  onChange={c => resolveGroup(g, name, merchant, c)} />
                <button
                  onClick={() => {
                    setResolutions(prev => { const n = new Map(prev); n.delete(g.aliasKey); return n; });
                    setAccepted(prev => { const n = new Set(prev); n.delete(g.aliasKey); return n; });
                  }}
                  title="Angre — legg tilbake som uløst"
                  style={{
                    marginLeft: 'auto', padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                    border: '1px solid var(--line)', background: 'transparent',
                    fontSize: 11.5, color: 'var(--muted)',
                  }}>
                  Angre
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Gjennomgang ── */}
      {review.length > 0 && (
        <div style={{ ...card, padding: 0, gap: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Gjennomgå transaksjoner</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{includedCount} klare for import</span>
            {unknownGroups.length === 0 && missingRates.length === 0 ? (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 10, background: 'color-mix(in oklab, var(--good) 16%, var(--surface))', color: 'var(--good)' }}>
                ✓ Alt klart
              </span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 10, background: 'rgba(201,122,59,0.16)', color: '#e65100' }}>
                ⚠ {unknownGroups.length > 0 ? `${unknownGroups.length} ukjente butikker` : ''}{unknownGroups.length > 0 && missingRates.length > 0 ? ' · ' : ''}{missingRates.length > 0 ? `kurs mangler (${missingRates.join('/')})` : ''}
              </span>
            )}
          </div>

          <div style={isMobile ? { overflowX: 'auto' } : undefined}>
            <div style={isMobile ? { minWidth: 720 } : undefined}>
              {review.map(file => (
                <FileSection key={file.id} file={file} rowKeyOf={i => rowKey(file, i)}
                  isIncluded={isIncluded} effectiveOf={effectiveOf}
                  gridCols={GRID_COLS} chipStyle={chip}
                  showExcluded={showExcluded.has(file.id)}
                  toggleExcluded={() => {
                    setShowExcluded(prev => { const n = new Set(prev); n.has(file.id) ? n.delete(file.id) : n.add(file.id); return n; });
                    setSeenExcluded(prev => prev.has(file.id) ? prev : new Set(prev).add(file.id));
                  }}
                  showUnparsed={showUnparsed.has(file.id)}
                  toggleUnparsed={() => setShowUnparsed(prev => { const n = new Set(prev); n.has(file.id) ? n.delete(file.id) : n.add(file.id); return n; })}
                  onToggleInclude={(key, val) => setIncludeOverride(prev => new Map(prev).set(key, val))}
                  onOwner={(key, v) => setOwnerOverride(prev => new Map(prev).set(key, v))}
                  ownerOf={key => ownerOverride.get(key)}
                  catOverride={catOverride}
                  onCat={(key, cat) => setCatOverride(prev => new Map(prev).set(key, cat))}
                  catOptions={catOptions}
                  noteText={noteText}
                  onNote={(key, text) => setNoteText(prev => {
                    const next = new Map(prev);
                    text.trim() ? next.set(key, text) : next.delete(key);
                    return next;
                  })}
                  editingNote={editingNote} setEditingNote={setEditingNote}
                  editingPerTx={editingPerTx} setEditingPerTx={setEditingPerTx}
                  onPerTx={(key, name, matched) => {
                    setPerTx(prev => new Map(prev).set(key, matched
                      ? { merchant: matched, name: matched.name, category: matched.category }
                      : { name, category: 'annet' }));
                    setEditingPerTx(null);
                  }}
                  merchants={merchantsApi.merchants}
                  accepted={accepted}
                  onAcceptSuggestion={aliasKey => setAccepted(prev => new Set(prev).add(aliasKey))}
                />
              ))}
            </div>
          </div>

          {/* Påminnelse: de utelatte radene er avhuket automatisk og bør ses over.
              Sperrer ikke importen — den er et dytt, ikke en port. */}
          {excludedTotal > 0 && (
            <div style={{
              padding: '11px 20px', borderTop: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              background: unseenExcluded.length > 0
                ? 'color-mix(in oklab, var(--warn) 10%, var(--surface))'
                : 'color-mix(in oklab, var(--good) 8%, var(--surface))',
            }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ flexShrink: 0 }}>{unseenExcluded.length > 0 ? '👀' : '✓'}</span>
                {unseenExcluded.length > 0 ? (
                  <span>
                    <strong>{excludedTotal} rad{excludedTotal !== 1 ? 'er' : ''} er utelatt automatisk.</strong>{' '}
                    Se gjennom dem før du importerer — er noe feil avhuket, blir det borte fra tallene.
                  </span>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>
                    Utelatte rader er gjennomgått{takenBackTotal > 0 ? ` — ${takenBackTotal} tatt med` : ''}.
                  </span>
                )}
              </span>
              {unseenExcluded.length > 0 && (
                <button
                  onClick={() => {
                    const ids = review.filter(f => f.txs.some(t => !includedByDefault(t))).map(f => f.id);
                    setShowExcluded(new Set(ids));
                    setSeenExcluded(prev => new Set([...prev, ...ids]));
                  }}
                  style={{
                    marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid var(--warn)', background: 'transparent',
                    fontSize: 12, fontWeight: 700, color: 'var(--warn)', flexShrink: 0,
                  }}>
                  Vis utelatte rader
                </button>
              )}
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: '13px 20px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Alt fra filene vises — interne flyttinger, kortoppgjør og duplikater er avhuket, men kan tas med.
            </span>
            <button onClick={doImport}
              disabled={importing || includedCount === 0 || unknownGroups.length > 0 || missingRates.length > 0}
              style={{
                marginLeft: 'auto', padding: '10px 22px', borderRadius: 9, border: 'none',
                background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: (importing || includedCount === 0 || unknownGroups.length > 0 || missingRates.length > 0) ? 'not-allowed' : 'pointer',
                opacity: (importing || includedCount === 0 || unknownGroups.length > 0 || missingRates.length > 0) ? 0.55 : 1,
              }}>
              {importing ? 'Importerer…' : `Importer ${includedCount} transaksjoner`}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div style={{
          padding: '11px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
          background: msg.startsWith('✓') ? 'rgba(74,138,110,0.14)' : 'rgba(217,95,95,0.14)',
          color: msg.startsWith('✓') ? 'var(--good)' : '#D9534F',
        }}>
          {msg}
        </div>
      )}
    </div>
  );
}

// ─── Én ukjent butikk-gruppe ──────────────────────────────────────────────────

function UnknownGroupRow({ group: g, merchants, catOptions, onResolve, onAccept, onExclude }: {
  group: { aliasKey: string; count: number; sum: number; raws: string[]; suggestion?: Merchant; suggestedName: string; suggestedCategory: string; sample: ReviewTx };
  merchants: Merchant[];
  catOptions: string[];
  onResolve: (name: string, matched?: Merchant, category?: string) => void;
  onAccept: () => void;
  onExclude: () => void;
}) {
  const [name, setName] = useState<{ value: string; matched?: Merchant } | null>(null);
  const [cat, setCat] = useState(g.suggestedCategory);
  const showCatPicker = name !== null && !name.matched;
  // Samme banktekst går ofte igjen på alle radene i gruppen — vis hver variant én gang
  const uniqueRaws = [...new Set(g.raws)];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 12px',
      borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{g.sample.norm.merchantText}</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {g.count} transaksjon{g.count !== 1 ? 'er' : ''} · {fmtKr(Math.abs(g.sum))}
        </span>
      </div>
      {/* Banktekstene i sin helhet — det er dem man dømmer forslaget ut fra, så
          de brytes over flere linjer i stedet for å klippes med ellipsis. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {uniqueRaws.slice(0, 4).map(r => (
          <span key={r} style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.35, wordBreak: 'break-word' }}>
            «{r}»
          </span>
        ))}
        {uniqueRaws.length > 4 && (
          <span title={uniqueRaws.slice(4).join('\n')} style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
            + {uniqueRaws.length - 4} andre varianter
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {g.suggestion && (
          <button onClick={onAccept} title={`Full match mot ${g.suggestion.name} — ett klikk for å godta`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8,
              border: '1.5px solid var(--accent)', background: 'var(--accent-soft)', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 700, color: 'var(--accent-deep)',
            }}>
            💡 Forslag: {g.suggestion.name}
            <CatTag cat={g.suggestion.category} confirmed />
            <span style={{ fontWeight: 400 }}>· godta</span>
          </button>
        )}
        <div style={{ width: 230, maxWidth: '100%' }}>
          <MerchantCombobox
            placeholder={g.suggestion ? '…eller velg/skriv en annen' : `f.eks. «${g.suggestedName}»`}
            options={merchants.filter(m => m.kind === 'merchant' || m.kind === 'person')}
            onCommit={(value, matched) => {
              setName({ value, matched });
              if (matched) onResolve(value, matched);
            }}
          />
        </div>
        {showCatPicker && (
          <>
            <CategoryPicker variant="field" value={cat} options={catOptions} onChange={setCat} />
            <button onClick={() => name && onResolve(name.value, undefined, cat)}
              style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Lagre ny butikk
            </button>
          </>
        )}
        <button onClick={onExclude} title="Utelat alle radene i denne gruppen fra importen"
          style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line)', background: 'transparent', fontSize: 11.5, color: 'var(--muted)', cursor: 'pointer' }}>
          Utelat alle
        </button>
      </div>
    </div>
  );
}

// ─── Én fil-seksjon i gjennomgangen ───────────────────────────────────────────

function FileSection(props: {
  file: ReviewFile;
  rowKeyOf: (idx: number) => string;
  isIncluded: (t: ReviewTx, key: string) => boolean;
  effectiveOf: (t: ReviewTx, key: string) => { merchant?: Merchant; name?: string; category?: string; isSuggestion?: boolean; isIntermediary?: boolean };
  gridCols: string;
  chipStyle: React.CSSProperties;
  showExcluded: boolean; toggleExcluded: () => void;
  showUnparsed: boolean; toggleUnparsed: () => void;
  onToggleInclude: (key: string, val: boolean) => void;
  onOwner: (key: string, v: Owner) => void;
  ownerOf: (key: string) => Owner | undefined;
  catOverride: Map<string, string>;
  onCat: (key: string, cat: string) => void;
  catOptions: string[];
  noteText: Map<string, string>;
  onNote: (key: string, text: string) => void;
  editingNote: string | null; setEditingNote: (k: string | null) => void;
  editingPerTx: string | null; setEditingPerTx: (k: string | null) => void;
  onPerTx: (key: string, name: string, matched?: Merchant) => void;
  merchants: Merchant[];
  accepted: Set<string>;
  onAcceptSuggestion: (aliasKey: string) => void;
}) {
  // effectiveOf og chipStyle brukes ikke her direkte, men sendes videre til TxRow via {...props}.
  const { file, rowKeyOf, isIncluded, gridCols } = props;
  const rows = file.txs.map((t, i) => ({ t, i, key: rowKeyOf(i), incl: isIncluded(t, rowKeyOf(i)) }));
  // Radene grupperes på hvordan de ble klassifisert VED IMPORT, ikke på hva du
  // har huket av nå. Ellers hopper en rad du tar med fra «Utelatt» rett opp i
  // hovedlista og må letes fram igjen for å redigeres — den blir liggende her,
  // full farge og med alle kontroller, så du kan gjøre resten på stedet.
  const included = rows.filter(r => includedByDefault(r.t));
  const excluded = rows.filter(r => !includedByDefault(r.t));
  // Avvik fra standarden — vises i overskriften så det ikke gjemmer seg i en kollapset liste
  const takenBack = excluded.filter(r => r.incl).length;

  // Utelatt-oppsummering per grunn
  const reasonCounts = new Map<string, number>();
  for (const r of excluded) {
    const reason = r.t.isDuplicate ? 'duplikat' : (r.t.cls.excludeReason ?? 'utelatt manuelt');
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  const months = [...new Set(rows.filter(r => r.incl).map(r => r.t.norm.date.slice(0, 7)))].sort();
  // Oppsummeringen teller det som faktisk blir importert
  const inclCount = rows.filter(r => r.incl).length;
  const exclCount = rows.length - inclCount;
  const dupOut    = rows.filter(r => !r.incl && r.t.isDuplicate).length;

  return (
    <div>
      {/* Fil-header med regnskapslinje */}
      <div style={{
        padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--line)', borderTop: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: SOURCE_COLOR[file.zone], flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 12 }}>{SOURCE_LABEL[file.zone]}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{file.filename}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--ink)' }}>{file.parse.rows.length + file.parse.unparsed.length} rader lest</strong>
          {' · '}{inclCount} klare
          {exclCount > 0 && <> · {exclCount} utelatt{dupOut > 0 ? ` (${dupOut} duplikat${dupOut !== 1 ? 'er' : ''})` : ''}</>}
          {file.parse.unparsed.length > 0 && <span style={{ color: '#D9534F', fontWeight: 700 }}> · {file.parse.unparsed.length} uleselige</span>}
          {months.length > 0 && <> · {months.join(' + ')}</>}
        </span>
      </div>

      {/* Uleselige rader */}
      {file.parse.unparsed.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--line)', background: 'rgba(217,95,95,0.06)' }}>
          <button onClick={props.toggleUnparsed} style={{ width: '100%', textAlign: 'left', padding: '6px 20px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11.5, color: '#D9534F', fontWeight: 600 }}>
            {props.showUnparsed ? '▾' : '▸'} {file.parse.unparsed.length} rad{file.parse.unparsed.length !== 1 ? 'er' : ''} kunne ikke tolkes — klikk for detaljer
          </button>
          {props.showUnparsed && file.parse.unparsed.map((u, i) => (
            <div key={i} style={{ padding: '4px 20px 6px', fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-2)', display: 'flex', gap: 10 }}>
              <span style={{ color: '#D9534F', flexShrink: 0 }}>{u.line ? `linje ${u.line}` : 'rad'} · {u.reason}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.raw}</span>
            </div>
          ))}
        </div>
      )}

      {/* Kolonneoverskrifter */}
      <div style={{
        display: 'grid', gridTemplateColumns: gridCols, gap: '0 10px', padding: '5px 20px', alignItems: 'center',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--muted)',
        background: 'var(--bg)', borderBottom: '1px solid var(--line)',
      }}>
        <span />
        <span title="Hvem utgiften tilhører">Hvem</span>
        <span>Dato</span>
        <span>Butikk</span>
        <span>Detaljer</span>
        <span>Kategori</span>
        <span style={{ textAlign: 'right' }}>Beløp</span>
      </div>

      {/* Inkluderte rader */}
      {included.map(({ t, key }) => (
        <TxRow key={key} t={t} rowKey={key} {...props} excludedRow={false} />
      ))}

      {/* Utelatte rader — kollapsbar gruppe */}
      {excluded.length > 0 && (
        <div style={{ borderTop: '1px dashed var(--line)' }}>
          <button onClick={props.toggleExcluded} style={{ width: '100%', textAlign: 'left', padding: '7px 20px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
            {props.showExcluded ? '▾' : '▸'} Utelatt: {[...reasonCounts.entries()].map(([r, n]) => `${n} ${r}`).join(' · ')}
            {takenBack > 0 && (
              <span style={{ color: 'var(--good)', fontWeight: 700 }}> · {takenBack} tatt med</span>
            )}
            {' — klikk for å se / ta med'}
          </button>
          {props.showExcluded && excluded.map(({ t, key }) => (
            <TxRow key={key} t={t} rowKey={key} {...props} excludedRow />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Én transaksjonsrad ───────────────────────────────────────────────────────

function TxRow({ t, rowKey: key, file, isIncluded, effectiveOf, gridCols, chipStyle, onToggleInclude, onOwner, ownerOf, catOverride, onCat, catOptions, noteText, onNote, editingNote, setEditingNote, editingPerTx, setEditingPerTx, onPerTx, merchants, onAcceptSuggestion, excludedRow }: {
  t: ReviewTx; rowKey: string; file: ReviewFile;
  isIncluded: (t: ReviewTx, key: string) => boolean;
  effectiveOf: (t: ReviewTx, key: string) => { merchant?: Merchant; name?: string; category?: string; isSuggestion?: boolean; isIntermediary?: boolean };
  gridCols: string; chipStyle: React.CSSProperties;
  onToggleInclude: (key: string, val: boolean) => void;
  onOwner: (key: string, v: Owner) => void;
  ownerOf: (key: string) => Owner | undefined;
  catOverride: Map<string, string>;
  onCat: (key: string, cat: string) => void;
  catOptions: string[];
  noteText: Map<string, string>;
  onNote: (key: string, text: string) => void;
  editingNote: string | null; setEditingNote: (k: string | null) => void;
  editingPerTx: string | null; setEditingPerTx: (k: string | null) => void;
  onPerTx: (key: string, name: string, matched?: Merchant) => void;
  merchants: Merchant[];
  onAcceptSuggestion: (aliasKey: string) => void;
  excludedRow: boolean;
}) {
  const incl = isIncluded(t, key);
  const eff = effectiveOf(t, key);
  const zone = file.zone as ZoneId;
  const isBankZone = zone !== 'trumf';
  const owner: Owner = ownerOf(key) ?? (STORED_SOURCE[zone] === 'trumf' ? 'felles' : STORED_SOURCE[zone]);
  const meta = t.norm.meta;
  const userNote = noteText.get(key);
  const catShown = catOverride.get(key) ?? eff.category ?? (t.cls.kind === 'income' ? 'inntekt' : 'annet');

  const sign = t.norm.amount > 0 ? '+' : '−';
  const amountStr = t.norm.currency
    ? `${sign}${Math.abs(t.norm.amount).toFixed(2).replace('.', ',')} ${CURRENCY_SYMBOL[t.norm.currency] ?? t.norm.currency}`
    : `${sign}${fmtKr(Math.abs(t.norm.amount)).replace(' kr', '')}`;

  const reason = t.isDuplicate ? 'duplikat' : t.cls.excludeReason;

  return (
    <>
    <div style={{
      display: 'grid', gridTemplateColumns: gridCols, gap: '0 10px', padding: '5px 20px',
      alignItems: 'center', borderBottom: editingNote === key ? 'none' : '1px solid var(--line)', fontSize: 12.5,
      opacity: incl ? 1 : 0.55, background: excludedRow ? 'var(--bg)' : undefined,
    }}>
      <input type="checkbox" checked={incl}
        title={incl ? 'Utelat fra import' : 'Ta med i import'}
        onChange={() => onToggleInclude(key, !incl)}
        style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }} />

      {isBankZone
        ? <OwnerPicker value={owner} onChange={v => onOwner(key, v)} />
        : <span style={{ fontSize: 12, color: 'var(--muted)' }}>🤝 Felles</span>}

      <span title={meta.purchasedAt ? `Kjøpt ${meta.purchasedAt}` : undefined} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {t.norm.date.slice(8)}.{t.norm.date.slice(5, 7)}.
      </span>

      {/* Butikk */}
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {editingPerTx === key ? (
          <MerchantCombobox autoFocus accent initial={eff.merchant && !eff.isIntermediary ? eff.name : ''}
            placeholder="velg/skriv butikk"
            options={merchants.filter(m => m.kind === 'merchant' || m.kind === 'person')}
            onCommit={(name, matched) => onPerTx(key, name, matched)}
            onCancel={() => setEditingPerTx(null)} />
        ) : eff.isSuggestion && t.match.type === 'suggestion' ? (
          /* Et forslag er en gjetning — da må hele banktekstet være synlig (ikke
             bare i et tooltip), og «skriv selv» må være like tilgjengelig som
             «godta». Ellers er eneste utvei å godta noe man ikke kan etterprøve. */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, padding: '2px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <button onClick={() => onAcceptSuggestion(t.norm.aliasKey)}
                title={`Forslag basert på likhet — klikk for å godta ${t.match.merchant.name}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px dashed var(--accent)', background: 'var(--accent-soft)', borderRadius: 7, padding: '2px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent-deep)', minWidth: 0 }}>
                💡 {t.match.merchant.name}?
              </button>
              <button onClick={() => setEditingPerTx(key)}
                title="Skriv eller velg en annen butikk for denne raden"
                style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 7, padding: '2px 7px', cursor: 'pointer', fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                ✎ skriv selv
              </button>
            </div>
            <span style={{ fontSize: 10.5, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.35, wordBreak: 'break-word' }}>
              «{t.norm.rawDescription}»
            </span>
          </div>
        ) : (
          <span onClick={() => incl && setEditingPerTx(key)}
            title={`Råtekst: ${t.norm.rawDescription}${eff.isIntermediary ? ' · Betalt via ' + eff.name + ' — klikk for å sette faktisk butikk' : incl ? ' · Klikk for å overstyre' : ''}`}
            style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: incl ? 'pointer' : 'default',
              fontWeight: eff.name ? 600 : 400,
              color: eff.name ? 'var(--ink)' : 'var(--muted)',
              fontStyle: eff.name ? 'normal' : 'italic',
            }}>
            {eff.name ?? t.norm.merchantText}
          </span>
        )}
        {eff.isIntermediary && editingPerTx !== key && (
          <span onClick={() => setEditingPerTx(key)}
            style={{ fontSize: 10.5, color: 'var(--accent-deep)', background: 'var(--accent-soft)', borderRadius: 7, padding: '1px 7px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            velg butikk
          </span>
        )}
      </div>

      {/* Detaljer-chips + kommentar */}
      <div style={{ display: 'flex', gap: 4, minWidth: 0, overflow: 'hidden', alignItems: 'center' }}>
        <button
          onClick={() => setEditingNote(editingNote === key ? null : key)}
          title={userNote ? `Kommentar: ${userNote}` : 'Legg til kommentar'}
          style={{
            width: 18, height: 18, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: userNote ? 'var(--accent-soft)' : 'transparent',
            cursor: 'pointer', color: userNote ? 'var(--accent)' : 'var(--muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, lineHeight: 1, padding: 0, opacity: userNote ? 1 : 0.6,
          }}
        >
          💬
        </button>
        {userNote && <span style={{ ...chipStyle, color: 'var(--accent-deep)', borderColor: 'var(--accent)' }} title={userNote}>{userNote.length > 18 ? userNote.slice(0, 18) + '…' : userNote}</span>}
        {reason && !incl && <span style={{ ...chipStyle, color: '#b5641f', borderColor: '#b5641f55' }}>{EXCLUDE_ICON[reason] ?? '·'} {reason}</span>}
        {meta.purchasedAt && meta.purchasedAt.includes(' ') && <span style={chipStyle} title={`Kjøpt ${meta.purchasedAt}`}>🕐 {meta.purchasedAt.slice(11)}</span>}
        {meta.origCurrency && meta.origAmount != null && (
          <span style={chipStyle} title={meta.fxRate ? `Kurs ${meta.fxRate}` : 'Utenlandsk valuta'}>
            💱 {Math.abs(meta.origAmount).toFixed(2).replace('.', ',')} {meta.origCurrency}
          </span>
        )}
        {meta.channel && <span style={chipStyle}>{meta.channel}</span>}
        {(meta.message || meta.reference) && <span style={chipStyle} title={[meta.message, meta.reference && `Ref: ${meta.reference}`].filter(Boolean).join('\n')}>ℹ️</span>}
        {(meta.loanPrincipal || meta.loanInterest) && (
          <span style={chipStyle} title={`Avdrag ${fmtKr(meta.loanPrincipal ?? 0)} · Renter ${fmtKr(meta.loanInterest ?? 0)}`}>
            🏠 avdrag/renter
          </span>
        )}
      </div>

      {/* Kategori — klikk for å endre KUN denne raden */}
      <div>
        {incl ? (
          <CategoryPicker
            value={catShown}
            options={catOptions}
            confirmed={catOverride.has(key) || !!eff.merchant}
            onChange={c => onCat(key, c)}
          />
        ) : (
          <CatTag cat={catShown} confirmed={catOverride.has(key) || !!eff.merchant} />
        )}
      </div>

      <span style={{
        textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap',
        color: t.norm.amount > 0 ? 'var(--good)' : 'var(--ink)',
      }}>
        {amountStr}
      </span>

      {/* Bankens egen tekst — full bredde under raden, kun på utelatte rader.
          Navnet er normalisert («Intern overføring»), så uten råteksten er det
          umulig å se HVA raden er og dermed om utelatelsen faktisk stemmer.
          Egen rad i griden så hele teksten får plass i stedet for å avkortes. */}
      {excludedRow && t.norm.rawDescription && (
        <span style={{
          gridColumn: '1 / -1', paddingLeft: 62, paddingBottom: 3,
          // --ink-3, ikke --ink-4: denne linja skal faktisk LESES for å vurdere om
          // utelatelsen stemmer, og --ink-4 gir bare 2,8:1 mot radbakgrunnen i lys modus.
          fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.35, color: 'var(--ink-3)',
          overflowWrap: 'anywhere',
        }}>
          {t.norm.rawDescription}
          {/* Bare metadata som IKKE allerede står i råteksten — ellers gjentas den */}
          {meta.reference && !t.norm.rawDescription.includes(meta.reference) && (
            <span style={{ opacity: 0.75 }}> · ref {meta.reference}</span>
          )}
          {meta.message && !t.norm.rawDescription.includes(meta.message) && (
            <span style={{ opacity: 0.75 }}> · {meta.message}</span>
          )}
        </span>
      )}
    </div>

    {/* Kommentar-editor på egen linje under raden */}
    {editingNote === key && (
      <div style={{ display: 'flex', gap: 6, padding: '2px 20px 8px 62px', borderBottom: '1px solid var(--line)' }}>
        <input
          autoFocus
          defaultValue={userNote ?? ''}
          placeholder="Kommentar til denne transaksjonen…"
          onKeyDown={e => {
            if (e.key === 'Enter') { onNote(key, (e.target as HTMLInputElement).value); setEditingNote(null); }
            if (e.key === 'Escape') setEditingNote(null);
          }}
          onBlur={e => { onNote(key, e.target.value); setEditingNote(null); }}
          style={{
            flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 5,
            border: '1px solid var(--accent)', background: 'var(--bg)', minWidth: 0, maxWidth: 480,
          }}
        />
      </div>
    )}
    </>
  );
}
