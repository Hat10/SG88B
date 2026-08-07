// Matching av butikktekst mot butikkregisteret.
//
// Tre nivåer:
//   1. Eksakt alias-treff  → anvendes automatisk (dette er «læringen»)
//   2. Fuzzy tokenmatch    → FORSLAG som må bekreftes i review (aldri auto)
//   3. Ingen treff         → forslag til nytt navn + kategori
//
// Fuzzy-en er bygget for bankenes avkortede navn: alias-token som er prefiks
// av butikknavn-token teller («diabetikersente» ↔ «Diabetikersenteret»,
// «ohl» ↔ «Ohlson»), men aldri motsatt vei («sparebanken» matcher IKKE «Spar»).

import type { Merchant, MerchantAlias, MatchResult, NormTx } from './types';
import { suggestCategory } from './categoryRules';
import { suggestDisplayName } from './normalize';

export interface MatchContext {
  merchants: Merchant[];
  merchantById: Map<string, Merchant>;
  aliasToMerchant: Map<string, Merchant>;
}

export function buildMatchContext(merchants: Merchant[], aliases: MerchantAlias[]): MatchContext {
  const merchantById = new Map(merchants.map(m => [m.id, m]));
  const aliasToMerchant = new Map<string, Merchant>();
  for (const a of aliases) {
    const m = merchantById.get(a.merchant_id);
    if (m) aliasToMerchant.set(a.alias, m);
  }
  return { merchants, merchantById, aliasToMerchant };
}

// Ord-tokens uten rene tall (butikknummer skal ikke telle med i navnematching)
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-zæøåéèüöä0-9]+/).filter(t => t && !/^\d+$/.test(t));
}

// alias-token matcher butikk-token: likt, eller avkortet prefiks (min 3 tegn)
function tokenMatches(aliasTok: string, merchantTok: string): boolean {
  return aliasTok === merchantTok
    || (aliasTok.length >= 3 && merchantTok.length > aliasTok.length && merchantTok.startsWith(aliasTok));
}

interface Scored { merchant: Merchant; score: number; tokens: number }

function scoreAgainst(aliasTokens: string[], merchant: Merchant): Scored | null {
  const mTokens = tokenize(merchant.name);
  if (!mTokens.length || !aliasTokens.length) return null;
  // Første ordet må stemme — ellers foreslår vi ikke noe som helst
  if (!tokenMatches(aliasTokens[0], mTokens[0])) return null;
  const covered = mTokens.filter(mt => aliasTokens.some(at => tokenMatches(at, mt))).length;
  const coverage = covered / mTokens.length;
  if (coverage < 0.5) return null;
  return { merchant, score: coverage, tokens: mTokens.length };
}

export function matchMerchant(tx: NormTx, ctx: MatchContext): MatchResult {
  const exact = ctx.aliasToMerchant.get(tx.aliasKey);
  if (exact) return { type: 'exact', merchant: exact };

  const aliasTokens = tokenize(tx.aliasKey);
  let best: Scored | null = null;
  for (const m of ctx.merchants) {
    const s = scoreAgainst(aliasTokens, m);
    if (!s) continue;
    // Best dekning vinner; ved likhet den mest spesifikke (flest tokens i navnet)
    if (!best || s.score > best.score || (s.score === best.score && s.tokens > best.tokens)) best = s;
  }
  if (best) return { type: 'suggestion', merchant: best.merchant, score: best.score };

  return {
    type: 'none',
    suggestedName: suggestDisplayName(tx.merchantText),
    suggestedCategory: suggestCategory(`${tx.merchantText} ${tx.rawDescription}`),
  };
}
