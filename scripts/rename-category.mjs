/**
 * Generic finance-category key rename in transactions + merchants.
 * Uses the Supabase REST API (no supabase-js → no WebSocket needed). Idempotent.
 *
 * Usage:
 *   FROM=lønn TO=inntekt node --env-file=.env scripts/rename-category.mjs
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM = process.env.FROM;
const TO = process.env.TO;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!FROM || !TO) { console.error('Missing FROM / TO (e.g. FROM=lønn TO=inntekt)'); process.exit(1); }

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const enc = encodeURIComponent(FROM);

async function count(table) {
  const res = await fetch(`${url}/rest/v1/${table}?category=eq.${enc}&select=*`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  if (!res.ok) { console.error(`Count ${table} failed:`, res.status, await res.text()); process.exit(1); }
  const cr = res.headers.get('content-range');
  return cr ? parseInt(cr.split('/')[1], 10) || 0 : 0;
}
async function migrate(table) {
  const res = await fetch(`${url}/rest/v1/${table}?category=eq.${enc}`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ category: TO }),
  });
  if (!res.ok) { console.error(`${table} update failed:`, res.status, await res.text()); process.exit(1); }
  return (await res.json()).length;
}

async function run() {
  const txBefore = await count('transactions');
  const mBefore  = await count('merchants');
  console.log(`'${FROM}' → '${TO}'  | before: transactions=${txBefore}, merchants=${mBefore}`);
  if (txBefore + mBefore === 0) { console.log('Nothing to migrate. ✓'); return; }
  const txUpd = await migrate('transactions');
  const mUpd  = await migrate('merchants');
  const txAfter = await count('transactions');
  const mAfter  = await count('merchants');
  console.log(`Updated: transactions=${txUpd}, merchants=${mUpd} | remaining on '${FROM}': ${txAfter + mAfter}`);
  console.log(txAfter + mAfter === 0 ? 'Migrering fullført! 🎉' : '⚠ Noen rader gjenstår.');
}
run();
