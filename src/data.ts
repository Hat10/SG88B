export type Who = 'M' | 'L' | 'f';

export interface FinanceEntry {
  month: string;
  // Asset classes — each gets its own expected return in the prognosis.
  eiendom: number;
  aksjefond: number;
  rentefond: number;
  annet: number;
  /** Total assets = eiendom + aksjefond + rentefond + annet (kept for buying-power math). */
  assets: number;
  boligLaan: number;
  annetLaan: number;
  salary: number;
}

/** The four asset-class keys, in display order. */
export const ASSET_CLASSES = [
  { key: 'eiendom',   label: 'Eiendom' },
  { key: 'aksjefond', label: 'Aksjefond' },
  { key: 'rentefond', label: 'Rentefond' },
  { key: 'annet',     label: 'Annet' },
] as const;

export type Priority = 'lav' | 'middels' | 'høy';
export type PriceSource = 'manual' | 'prisjakt';
export interface ShoppingItem {
  id?: string;
  t: string; on: boolean; who: Who; note?: string;
  priority: Priority; addedAt: string;
  price?: number; priceUrl?: string; priceSource?: PriceSource;
  dealPct?: number; // % below 30-day average when at a 30-day low (set by cron); undefined = no deal
  dealAvg30?: number; // rounded 30-day average price (set by cron); lets the screen show the kr saving
}

export interface FlippingProject {
  id: string;
  project_name: string;
  purchase_price: number;
  sale_price: number | null;
  created_at: string;
  updated_at: string;
}

export interface FlippingCost {
  id: string;
  project_id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  created_at: string;
}
