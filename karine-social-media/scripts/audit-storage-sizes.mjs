#!/usr/bin/env node
/**
 * Audit des fichiers en Supabase Storage : taille totale, par bucket,
 * par dossier, et liste des Top 50 plus gros fichiers.
 *
 * Détecte si des photos sont stockées BRUTES (> 500 KB en moyenne sur
 * un bucket = compression manquante côté server/client).
 *
 * USAGE :
 *   node scripts/audit-storage-sizes.mjs
 *
 * REQUIS : .env.local avec NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY (ne PAS commit le fichier).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

// Parse .env.local et .env manuellement (pas de dépendance dotenv).
function loadEnv(file) {
  if (!existsSync(file)) return;
  const content = readFileSync(file, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    // Strip wrapping quotes
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv('.env.local');
loadEnv('.env');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    '❌ NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env.local',
  );
  process.exit(1);
}

const supabase = createClient(url, key);

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function listAllInBucket(bucket, prefix = '', acc = []) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) {
    console.warn(`  ⚠️  ${bucket}/${prefix} → ${error.message}`);
    return acc;
  }
  for (const item of data ?? []) {
    if (item.metadata && typeof item.metadata.size === 'number') {
      // fichier
      acc.push({
        bucket,
        path: prefix ? `${prefix}/${item.name}` : item.name,
        size: item.metadata.size,
        contentType: item.metadata.mimetype,
        createdAt: item.created_at,
      });
    } else if (item.id === null) {
      // dossier (récursion)
      await listAllInBucket(
        bucket,
        prefix ? `${prefix}/${item.name}` : item.name,
        acc,
      );
    }
  }
  return acc;
}

async function main() {
  console.log('🔍 AUDIT SUPABASE STORAGE — taille des fichiers\n');
  console.log('URL :', url);
  console.log('Heure :', new Date().toISOString());
  console.log('─'.repeat(70));

  const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
  if (bErr) {
    console.error('❌ Erreur listBuckets :', bErr.message);
    process.exit(1);
  }
  console.log(`\n📦 ${buckets.length} buckets détectés :`);
  for (const b of buckets) {
    console.log(`  - ${b.name} (public=${b.public})`);
  }

  const allFiles = [];
  for (const bucket of buckets) {
    console.log(`\n📁 Scan bucket "${bucket.name}"...`);
    const files = await listAllInBucket(bucket.name);
    console.log(`   → ${files.length} fichiers trouvés`);
    allFiles.push(...files);
  }

  if (allFiles.length === 0) {
    console.log('\n⚠️  Aucun fichier trouvé.');
    return;
  }

  // === Stats globales ===
  const totalSize = allFiles.reduce((s, f) => s + f.size, 0);
  const totalCount = allFiles.length;
  const avgSize = totalSize / totalCount;
  console.log('\n═'.repeat(70));
  console.log('📊 STATS GLOBALES');
  console.log('═'.repeat(70));
  console.log(`Total fichiers     : ${totalCount}`);
  console.log(`Taille totale      : ${humanBytes(totalSize)}`);
  console.log(`Taille moyenne     : ${humanBytes(avgSize)}`);

  // === Stats par bucket ===
  console.log('\n═'.repeat(70));
  console.log('📦 PAR BUCKET');
  console.log('═'.repeat(70));
  const byBucket = new Map();
  for (const f of allFiles) {
    if (!byBucket.has(f.bucket))
      byBucket.set(f.bucket, { count: 0, size: 0, files: [] });
    const b = byBucket.get(f.bucket);
    b.count++;
    b.size += f.size;
    b.files.push(f);
  }
  for (const [bucket, stats] of byBucket) {
    const avg = stats.size / stats.count;
    const flag = avg > 500 * 1024 ? ' 🔴 GROS' : avg > 200 * 1024 ? ' 🟠' : ' 🟢';
    console.log(
      `${bucket.padEnd(30)} ${String(stats.count).padStart(6)} fichiers — total ${humanBytes(stats.size).padStart(10)} — moy ${humanBytes(avg).padStart(8)}${flag}`,
    );
  }

  // === Top 50 plus gros fichiers ===
  console.log('\n═'.repeat(70));
  console.log('🐘 TOP 50 PLUS GROS FICHIERS');
  console.log('═'.repeat(70));
  const top = [...allFiles].sort((a, b) => b.size - a.size).slice(0, 50);
  for (let i = 0; i < top.length; i++) {
    const f = top[i];
    console.log(
      `${String(i + 1).padStart(3)}. ${humanBytes(f.size).padStart(8)} | ${f.bucket}/${f.path}`,
    );
  }

  // === Distribution par taille ===
  console.log('\n═'.repeat(70));
  console.log('📊 DISTRIBUTION PAR TAILLE');
  console.log('═'.repeat(70));
  const buckets_ = [
    { label: '< 50 KB', max: 50 * 1024, count: 0 },
    { label: '50 - 200 KB', max: 200 * 1024, count: 0 },
    { label: '200 - 500 KB', max: 500 * 1024, count: 0 },
    { label: '500 KB - 1 MB', max: 1024 * 1024, count: 0 },
    { label: '1 - 2 MB', max: 2 * 1024 * 1024, count: 0 },
    { label: '2 - 5 MB', max: 5 * 1024 * 1024, count: 0 },
    { label: '> 5 MB (CRITIQUE)', max: Infinity, count: 0 },
  ];
  for (const f of allFiles) {
    for (const b of buckets_) {
      if (f.size <= b.max) {
        b.count++;
        break;
      }
    }
  }
  for (const b of buckets_) {
    const pct = ((b.count / totalCount) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(Number(pct) / 2));
    const flag = b.label.includes('CRITIQUE') && b.count > 0 ? ' 🔴' : '';
    console.log(`  ${b.label.padEnd(20)} ${String(b.count).padStart(6)} (${pct}%) ${bar}${flag}`);
  }

  // === Conclusion ===
  console.log('\n═'.repeat(70));
  console.log('🎯 CONCLUSION');
  console.log('═'.repeat(70));
  const huge = allFiles.filter((f) => f.size > 1024 * 1024).length;
  const total_huge_size = allFiles
    .filter((f) => f.size > 1024 * 1024)
    .reduce((s, f) => s + f.size, 0);
  if (huge > 0) {
    console.log(
      `🔴 ${huge} fichiers > 1 MB (${humanBytes(total_huge_size)}) = compression défaillante`,
    );
    console.log(
      `   → Re-compresser ces fichiers économiserait ~${humanBytes(total_huge_size * 0.9)} (90% de réduction typique)`,
    );
  } else {
    console.log('🟢 Aucun fichier > 1 MB — compression OK');
  }
  if (avgSize > 300 * 1024) {
    console.log(
      `⚠️  Moyenne globale ${humanBytes(avgSize)} > 300 KB — vérifier la qualité de compression`,
    );
  }
}

main().catch((e) => {
  console.error('❌ Erreur fatale :', e);
  process.exit(1);
});
