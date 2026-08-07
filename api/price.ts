export const config = { maxDuration: 10 };

// NOTE: the Prisjakt scraper is inlined here (and duplicated in
// api/cron/rollover.ts) on purpose. Vercel excludes `_`-prefixed files under
// /api from the build, so importing a shared `./_lib/prisjakt` module fails at
// runtime → FUNCTION_INVOCATION_FAILED on every request. Keep the two copies
// in sync when changing scraping logic.

interface PrisjaktResult {
  price: number;
  name: string | null;
  offerCount: number | null;
  currency: string;
}

// Coerce to a sane positive integer price, or null.
function toPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function fetchPrisjaktPrice(url: string): Promise<PrisjaktResult | null> {
  // Prisjakt sits behind Cloudflare, which can stall requests from datacenter
  // IPs. Abort well under maxDuration so a stall surfaces as a catchable error
  // instead of the platform killing the function.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  let html: string;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        'Referer': 'https://www.prisjakt.no/',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } finally {
    clearTimeout(timer);
  }

  // 1. JSON-LD (schema.org/Product) — Prisjakt's primary, reliable source
  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    try {
      const data = JSON.parse(block[1]);
      const product = Array.isArray(data) ? data.find((d: any) => d['@type'] === 'Product') : data['@type'] === 'Product' ? data : null;
      if (!product?.offers) continue;

      const name: string = product.name ?? null;
      const offers = product.offers;

      if (offers['@type'] === 'AggregateOffer') {
        const price = toPrice(offers.lowPrice);
        if (price != null) return { price, name, offerCount: offers.offerCount ?? null, currency: offers.priceCurrency ?? 'NOK' };
        continue;
      }
      const offerList = Array.isArray(offers) ? offers : [offers];
      const prices = offerList.map((o: any) => toPrice(o.price)).filter((p): p is number => p != null);
      if (prices.length) return { price: Math.min(...prices), name, offerCount: prices.length, currency: 'NOK' };
    } catch { /* skip malformed block */ }
  }

  // 2. Fallback: __NEXT_DATA__ (older Prisjakt pages)
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const props = JSON.parse(nextDataMatch[1])?.props?.pageProps;
      const price = toPrice(
        props?.product?.cheapestOffer?.price ??
        props?.cheapestOffer?.price ??
        props?.lowestPrice ??
        props?.product?.lowestPrice,
      );
      if (price != null) {
        return { price, name: props?.product?.name ?? props?.name ?? null, offerCount: props?.product?.offerCount ?? props?.offerCount ?? null, currency: 'NOK' };
      }
    } catch { /* ignore */ }
  }

  return null;
}

export default async function handler(req: any, res: any) {
  // Wrap everything so the function can never throw uncaught (which surfaces as
  // FUNCTION_INVOCATION_FAILED); worst case is a clean JSON error.
  try {
    const url = req?.query?.url as string | undefined;

    if (!url || !url.includes('prisjakt.no')) {
      return res.status(400).json({ error: 'Kun prisjakt.no-lenker støttes' });
    }

    const result = await fetchPrisjaktPrice(url);
    if (!result) return res.status(404).json({ error: 'Fant ikke pris på denne siden' });
    return res.json(result);
  } catch (err: any) {
    const msg = err?.name === 'AbortError'
      ? 'Prisjakt svarte ikke i tide – prøv igjen'
      : (err?.message ?? 'Noe gikk galt');
    return res.status(500).json({ error: msg });
  }
}
