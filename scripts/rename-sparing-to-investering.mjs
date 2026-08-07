/**
 * One-off migration: rename the finance category key `sparing` → `investering`
 * (the label was already "Investering"; this aligns the stored key).
 *
 * Uses the Supabase REST API directly (no supabase-js → no WebSocket needed).
 * Idempotent and safe to re-run (matches nothing the second time).
 *
 * Usage:
 *   node --env-file=.env scripts/rename-sparing-to-investering.mjs
 *   (.env must contain SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run with: node --env-file=.env …)');
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function countSparing(table) {
  const res = await fetch(`${url}/rest/v1/${table}?category=eq.sparing&select=*`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  if (!res.ok) { console.error(`Count ${table} failed:`, res.status, await res.text()); process.exit(1); }
  const cr = res.headers.get('content-range'); // e.g. "0-4/5" or "*/0"
  return cr ? parseInt(cr.split('/')[1], 10) || 0 : 0;
}

async function migrate(table) {
  const res = await fetch(`${url}/rest/v1/${table}?category=eq.sparing`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ category: 'investering' }),
  });
  if (!res.ok) { console.error(`${table} update failed:`, res.status, await res.text()); process.exit(1); }
  return (await res.json()).length;
}

async function run() {
  const txBefore = await countSparing('transactions');
  const mBefore  = await countSparing('merchants');
  console.log(`Before: transactions=${txBefore}, merchants=${mBefore} with category='sparing'`);
  if (txBefore + mBefore === 0) { console.log('Nothing to migrate. ✓'); return; }

  const txUpd = await migrate('transactions');
  const mUpd  = await migrate('merchants');
  const txAfter = await countSparing('transactions');
  const mAfter  = await countSparing('merchants');

  console.log(`Updated: transactions=${txUpd}, merchants=${mUpd}`);
  console.log(`After:   transactions=${txAfter}, merchants=${mAfter} still on 'sparing' (should be 0)`);
  console.log(txAfter === 0 && mAfter === 0 ? 'Migrering fullført! 🎉' : '⚠ Noen rader gjenstår.');
}

run();
