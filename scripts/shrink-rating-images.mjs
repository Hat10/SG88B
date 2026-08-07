/**
 * One-time: shrink the rating images already in Supabase Storage.
 *
 * Downloads each image, resizes it to max 1600px on the long edge and re-encodes
 * it in the SAME format at the SAME path, then overwrites it in place — so the
 * `image_path` references stored in `ratings` keep working untouched. Files that
 * wouldn't get smaller are left exactly as they are.
 *
 * Irreversible: --apply replaces the full-resolution originals with the smaller
 * versions. Uses the Supabase Storage REST API (service role) + `sharp`.
 *
 * Usage:
 *   node --env-file=.env scripts/shrink-rating-images.mjs            # dry run: reports savings, writes nothing
 *   node --env-file=.env scripts/shrink-rating-images.mjs --apply    # actually overwrite in Storage
 *
 * (Run with Node ≥20; the project's .nvmrc pins 24.)
 */
import sharp from 'sharp';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const APPLY   = process.argv.includes('--apply');
const BUCKET  = 'rating-images';
const MAX_DIM = 1600;
const QUALITY = 80;
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

async function download(name) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, { headers: auth });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function overwrite(name, buf, mime) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': mime, 'x-upsert': 'true' },
    body: buf,
  });
  if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function run() {
  const files = await listAll();
  console.log(`${files.length} filer i '${BUCKET}'` + (APPLY ? '  — APPLY (overskriver i Storage)\n' : '  — DRY RUN (skriver ingenting; kjør med --apply)\n'));

  let before = 0, after = 0, shrunk = 0, kept = 0, failed = 0;

  for (const f of files) {
    const mime = f.metadata?.mimetype ?? '';
    if (!mime.startsWith('image/')) { kept++; continue; }
    try {
      const orig = await download(f.name);
      before += orig.length;

      const src = sharp(orig, { failOn: 'none' }).rotate(); // rotate() bakes in EXIF orientation
      const meta = await src.metadata();
      const longest = Math.max(meta.width ?? 0, meta.height ?? 0);

      let pipe = src.resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true });
      if (meta.format === 'jpeg')      pipe = pipe.jpeg({ quality: QUALITY, mozjpeg: true });
      else if (meta.format === 'png')  pipe = pipe.png({ compressionLevel: 9 });
      else if (meta.format === 'webp') pipe = pipe.webp({ quality: QUALITY });
      else { after += orig.length; kept++; console.log(`  = ${f.name}  (${meta.format ?? mime}, hopper over)`); continue; }

      const out = await pipe.toBuffer();

      // Only overwrite when it's a real win (≥5% smaller); otherwise keep original.
      if (out.length < orig.length * 0.95) {
        if (APPLY) await overwrite(f.name, out, mime);
        after += out.length;
        shrunk++;
        const pct = Math.round((1 - out.length / orig.length) * 100);
        console.log(`  ↓ ${f.name}  ${kb(orig.length)} → ${kb(out.length)}  (-${pct}%${longest > MAX_DIM ? `, ${longest}px→${MAX_DIM}px` : ''})`);
      } else {
        after += orig.length;
        kept++;
        console.log(`  = ${f.name}  ${kb(orig.length)} (allerede liten)`);
      }
    } catch (e) {
      failed++;
      console.log(`  ✗ ${f.name}  — ${e.message} (hoppet over)`);
    }
  }

  console.log(`\nKrympet ${shrunk}, uendret ${kept}, feilet ${failed}.`);
  console.log(`Totalt: ${kb(before)} → ${kb(after)}  (-${before ? Math.round((1 - after / before) * 100) : 0}%)`);
  if (!APPLY) console.log('\nDette var en DRY RUN. Kjør på nytt med --apply for å faktisk lagre.');
}
run();
