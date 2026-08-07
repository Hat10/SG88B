/**
 * Migrate categories + snapshots from old portfolio-tracker Supabase
 * to the felles Supabase project.
 *
 * Usage:
 *   OLD_URL=https://xxxx.supabase.co \
 *   OLD_KEY=eyJ... \
 *   node scripts/migrate-portfolio.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ── Old project (portfolio-tracker) ──────────────────────────────────────────
const OLD_URL = process.env.OLD_URL;
const OLD_KEY = process.env.OLD_KEY;

// ── New project (felles) ─────────────────────────────────────────────────────
const NEW_URL = 'https://nltchoeqlvhlevqmwxys.supabase.co';
const NEW_KEY = 'sb_publishable_q15sev9NSqW-vv5AZ9_tCA_aSXFK7W5';

if (!OLD_URL || !OLD_KEY) {
  console.error('Missing OLD_URL or OLD_KEY env vars.');
  console.error('Run: OLD_URL=https://xxxx.supabase.co OLD_KEY=eyJ... node scripts/migrate-portfolio.mjs');
  process.exit(1);
}

const oldDb = createClient(OLD_URL, OLD_KEY);
const newDb = createClient(NEW_URL, NEW_KEY);

async function migrate() {
  console.log('Reading from old project…');

  const { data: cats, error: catsErr } = await oldDb.from('categories').select('*').order('sort_order');
  if (catsErr) { console.error('Failed to read categories:', catsErr.message); process.exit(1); }

  const { data: snaps, error: snapsErr } = await oldDb.from('snapshots').select('*').order('month');
  if (snapsErr) { console.error('Failed to read snapshots:', snapsErr.message); process.exit(1); }

  console.log(`  Found ${cats.length} categories, ${snaps.length} snapshots`);

  // ── Ensure tables exist in new project ───────────────────────────────────
  // (Run scripts/portfolio-migration.sql first if you haven't already)

  // ── Write categories ──────────────────────────────────────────────────────
  if (cats.length > 0) {
    console.log('Writing categories…');
    const { error } = await newDb.from('categories').upsert(cats, { onConflict: 'id' });
    if (error) { console.error('Failed to write categories:', error.message); process.exit(1); }
    console.log(`  ✓ ${cats.length} categories inserted/updated`);
  }

  // ── Write snapshots ───────────────────────────────────────────────────────
  if (snaps.length > 0) {
    console.log('Writing snapshots…');
    const { error } = await newDb.from('snapshots').upsert(snaps, { onConflict: 'month' });
    if (error) { console.error('Failed to write snapshots:', error.message); process.exit(1); }
    console.log(`  ✓ ${snaps.length} snapshots inserted/updated`);
  }

  console.log('\nMigrering fullført! 🎉');
}

migrate();
