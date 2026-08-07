// ─────────────────────────────────────────────────────────────────────────────
// Kjøpekraft-motoren — én felles kilde for boligkjøpekraft-beregningen.
//
// Tidligere lå denne formelen duplisert (og divergerende) i Hus.tsx,
// Dashboard.tsx og formue/HouseGoalPage.tsx. Nå bor formelen + standard-
// parametrene her, ett sted.
//
// Modell (norsk boligkjøp):
//   maksLån        = max(0, årslønn × lånemultipel − annet lån)
//   maks fra EK    = egenkapital ÷ (egenkapitalkrav%)          (EK-taket)
//   maks fra lån   = egenkapital + maksLån                     (inntekts-/lånetaket)
//   kjøpekraft     = max(0, min(maks fra EK, maks fra lån))
// ─────────────────────────────────────────────────────────────────────────────

/** Parametre som styrer kjøpekraft-beregningen. */
export interface BuyingPowerParams {
  /** Hvor mange ganger årslønn banken låner ut (typisk 5). */
  loanMultiple: number;
  /** Egenkapitalkrav i prosent (typisk 10). */
  equityPct: number;
}

export const DEFAULT_BP_PARAMS: BuyingPowerParams = {
  loanMultiple: 5,
  equityPct: 10,
};

/** Det beregningen trenger: egenkapital, samlet årslønn og evt. annet lån. */
export interface BuyingPowerInput {
  /** Egenkapital (formue − boliglån). */
  equity: number;
  /** Samlet årslønn (brutto). */
  annualIncome: number;
  /** Annet lån / gjeld som trekkes fra låneevnen. Default 0. */
  otherLoans?: number;
}

export interface BuyingPowerResult {
  equity: number;
  annualIncome: number;
  otherLoans: number;
  /** Maks lån: max(0, årslønn × lånemultipel − annet lån). */
  maxLoan: number;
  /** EK-taket: egenkapital ÷ (egenkapitalkrav%). 0 hvis egenkapital ≤ 0. */
  maxFromEquity: number;
  /** Inntekts-/lånetaket: egenkapital + maks lån. */
  maxFromLoan: number;
  /** Faktisk kjøpekraft: max(0, min(maxFromEquity, maxFromLoan)). */
  maxPurchase: number;
  /** Hvilket tak som begrenser kjøpekraften. */
  limitedBy: 'equity' | 'loan';
}

/**
 * Kanonisk kjøpekraft-beregning. Send alltid inn `params` fra useBuyingPowerParams
 * (DB-synket); utelates de, brukes standardreglene (5 × inntekt, 10 % EK).
 */
export function calcBuyingPower(
  input: BuyingPowerInput,
  params: BuyingPowerParams = DEFAULT_BP_PARAMS,
): BuyingPowerResult {
  const { equity, annualIncome } = input;
  const otherLoans = input.otherLoans ?? 0;

  const maxLoan       = Math.max(0, annualIncome * params.loanMultiple - otherLoans);
  const maxFromEquity = equity > 0 ? equity / (params.equityPct / 100) : 0;
  const maxFromLoan   = equity + maxLoan;
  const maxPurchase   = Math.max(0, Math.min(maxFromEquity, maxFromLoan));

  return {
    equity,
    annualIncome,
    otherLoans,
    maxLoan,
    maxFromEquity,
    maxFromLoan,
    maxPurchase,
    limitedBy: maxFromEquity <= maxFromLoan ? 'equity' : 'loan',
  };
}

/** Minimal form for en månedsføring (matcher FinanceEntry strukturelt). */
export interface FinanceLike {
  assets: number;
  boligLaan: number;
  annetLaan: number;
  salary: number;
}

/** Kjøpekraft for én person ut fra en månedsføring. */
export function bpFromEntry(e: FinanceLike, params?: BuyingPowerParams): BuyingPowerResult {
  return calcBuyingPower({
    equity: e.assets - e.boligLaan,
    annualIncome: e.salary,
    otherLoans: e.annetLaan,
  }, params);
}

/** Samlet kjøpekraft for to personer. `b` kan være null (da telles kun `a`). */
export function bpFromCombined(a: FinanceLike, b: FinanceLike | null, params?: BuyingPowerParams): BuyingPowerResult {
  return calcBuyingPower({
    equity:       (a.assets - a.boligLaan) + (b ? b.assets - b.boligLaan : 0),
    annualIncome: a.salary + (b ? b.salary : 0),
    otherLoans:   a.annetLaan + (b ? b.annetLaan : 0),
  }, params);
}
