#!/usr/bin/env node
/**
 * Nettoyage post-migration : supprime les fichiers .jpg / .png / .jpeg /
 * .heic dans Supabase Storage QUI ONT DEJA une version .webp à côté.
 *
 * À lancer APRÈS migrate-storage-to-webp.mjs --apply, une fois qu'on a
 * vérifié visuellement que tout marche.
 *
 * Pre-requis env vars :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Lancement :
 *   node scripts/cleanup-originals.mjs              # dry-run (liste sans rien faire)
 *   node scripts/cleanup-originals.mjs --apply      # supprime pour de vrai
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const envPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '.env.local',
  );
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* pas de .env.local */ }

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const BUCKETS = ['content-images', 'featured-photos'];
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'heic']);

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function extOf(path) {
  const m = path.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

function withoutExt(path) {
  return path.replace(/\.[a-z0-9]+$/i, '');
}

async function listAll(bucket, prefix = '') {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        const children = await listAll(bucket, full);
        out.push(...children);
      } else {
        out.push({ path: full, metadata: item.metadata });
      }
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return out;
}

async function cleanupBucket(bucket) {
  console.log(`\n📦 Bucket ${bucket}`);
  const files = await listAll(bucket);
  const byPath = new Map(files.map((f) => [f.path, f]));

  const toDelete = [];
  for (const f of files) {
    const ext = extOf(f.path);
    if (!IMAGE_EXTS.has(ext)) continue;
    const webpPath = withoutExt(f.path) + '.webp';
    if (byPath.has(webpPath)) {
      toDelete.push({ path: f.path, size: f.metadata?.size ?? 0 });
    }
  }

  if (toDelete.length === 0) {
    console.log('  Aucun original à supprimer.');
    return { bucket, deleted: 0, freed: 0 };
  }

  const totalFreed = toDelete.reduce((s, x) => s + x.size, 0);

  if (!APPLY) {
    for (const x of toDelete) {
      console.log(`  [DRY] supprimer ${x.path}  (${fmtBytes(x.size)})`);
    }
    console.log(`  → ${toDelete.length} fichiers a supprimer, ${fmtBytes(totalFreed)} libérés`);
    return { bucket, deleted: 0, freed: 0, would: toDelete.length, wouldFree: totalFreed };
  }

  // Supprime par paquets de 100 (limite API Supabase Storage)
  const paths = toDelete.map((x) => x.path);
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) {
      console.error(`  ❌ erreur sur lot ${i}:`, error.message);
      continue;
    }
    deleted += chunk.length;
    for (const p of chunk) {
      console.log(`  🗑️  ${p}`);
    }
  }
  console.log(`  ✅ ${deleted} fichiers supprimés, ${fmtBytes(totalFreed)} libérés`);
  return { bucket, deleted, freed: totalFreed };
}

async function main() {
  console.log(APPLY ? '🗑️  Mode APPLY (suppression réelle)' : '🔎 Mode DRY-RUN');
  const reports = [];
  for (const bucket of BUCKETS) {
    try {
      reports.push(await cleanupBucket(bucket));
    } catch (err) {
      console.error(`❌ Bucket ${bucket}:`, err.message);
    }
  }
  console.log('\n📊 Récap :');
  let total = 0, totalFreed = 0;
  for (const r of reports) {
    const n = APPLY ? r.deleted : r.would ?? 0;
    const f = APPLY ? r.freed : r.wouldFree ?? 0;
    console.log(`  ${r.bucket.padEnd(20)} ${n} fichier(s), ${fmtBytes(f)}`);
    total += n;
    totalFreed += f;
  }
  console.log(`\n📦 Total : ${total} fichier(s), ${fmtBytes(totalFreed)} libérés`);
  if (!APPLY) {
    console.log('\nℹ️  Mode dry-run. Pour appliquer :');
    console.log('   npm run cleanup-originals -- --apply');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
