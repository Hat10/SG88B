/**
 * One-off migration: rename the wish_items.list values `mikkel` → `andreas`
 * and `leah` → `taran` (the app code was renamed to match; existing rows
 * still say `mikkel`/`leah` until this runs, and would otherwise disappear
 * from the Ønskeliste view).
 *
 * IMPORTANT — run this SQL first (Supabase SQL editor), or every PATCH below
 * will fail: the `wish_items_list_check` CHECK constraint only allows
 * 'felles' | 'mikkel' | 'leah' today and must be widened first:
 *
 *   alter table wish_items drop constraint wish_items_list_check;
 *   alter table wish_items add constraint wish_items_list_check
 *     check (list = any (array['felles','andreas','taran']));
 *
 * Uses the Supabase REST API directly (no supabase-js → no WebSocket needed).
 * Idempotent and safe to re-run (matches nothing once already migrated).
 *
 * Usage:
 *   node --env-file=.env scripts/rename-wish-list-migration.mjs
 *   (.env must contain SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run with: node --env-file=.env …)');
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const RENAMES = [
  { from: 'mikkel', to: 'andreas' },
  { from: 'leah',   to: 'taran' },
];

async function count(from) {
  const res = await fetch(`${url}/rest/v1/wish_items?list=eq.${from}&select=*`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  if (!res.ok) { console.error(`Count failed for '${from}':`, res.status, await res.text()); process.exit(1); }
  const cr = res.headers.get('content-range'); // e.g. "0-4/5" or "*/0"
  return cr ? parseInt(cr.split('/')[1], 10) || 0 : 0;
}

async function migrate(from, to) {
  const res = await fetch(`${url}/rest/v1/wish_items?list=eq.${from}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ list: to }),
  });
  if (!res.ok) { console.error(`Update failed for '${from}' → '${to}':`, res.status, await res.text()); process.exit(1); }
  return (await res.json()).length;
}

async function run() {
  let remaining = 0;
  for (const { from, to } of RENAMES) {
    const before = await count(from);
    console.log(`'${from}' → '${to}'  | before: wish_items=${before}`);
    if (before === 0) { console.log('Nothing to migrate. ✓'); continue; }
    const updated = await migrate(from, to);
    const after = await count(from);
    remaining += after;
    console.log(`Updated: wish_items=${updated} | remaining on '${from}': ${after}`);
  }
  console.log(remaining === 0 ? 'Migrering fullført! 🎉' : '⚠ Noen rader gjenstår.');
}

run();
