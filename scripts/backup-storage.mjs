/**
 * Incrementally back up the Supabase Storage bucket to backups/storage/.
 *
 * Only downloads files we don't already have locally, so nightly re-runs cost
 * almost no egress (unchanged files are never re-fetched). Files deleted from
 * Storage are deliberately KEPT in the backup — a backup shouldn't lose history.
 *
 * Uses the Storage REST API (service role) + Node built-ins only (global fetch,
 * fs) — no npm install needed in CI.
 *
 * Usage (CI or local):
 *   node --env-file=.env scripts/backup-storage.mjs
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const BUCKET = 'rating-images';
const DEST   = `backups/storage/${BUCKET}`;
const auth = { apikey: key, Authorization: `Bearer ${key}` };

async function listAll() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) { console.error('list failed', res.status, await res.text()); process.exit(1); }
    const batch = await res.json();
    out.push(...batch.filter((o) => o.id && o.name !== '.emptyFolderPlaceholder'));
    if (batch.length < 1000) break;
  }
  return out;
}

// Returns the local file size, or -1 if it doesn't exist yet.
const localSize = (p) => stat(p).then((s) => s.size, () => -1);

async function run() {
  const files = await listAll();
  await mkdir(DEST, { recursive: true });

  let downloaded = 0, present = 0, failed = 0;
  for (const f of files) {
    const local = `${DEST}/${f.name}`;
    const have = await localSize(local);
    // Skip only when we already hold a copy of the same size — so a re-encoded
    // (shrunk) image with the same name still gets re-synced, regardless of the
    // order things were run in. The remote size comes free from the listing.
    if (have >= 0 && f.metadata?.size != null && have === f.metadata.size) { present++; continue; }
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(f.name)}`, { headers: auth });
    if (!res.ok) { console.error(`  ✗ ${f.name}: ${res.status}`); failed++; continue; }
    await writeFile(local, Buffer.from(await res.arrayBuffer()));
    downloaded++;
  }

  console.log(`Storage-backup '${BUCKET}': ${downloaded} lastet ned, ${present} uendret, ${failed} feilet (${files.length} totalt).`);
  if (failed) process.exit(1);
}
run();
