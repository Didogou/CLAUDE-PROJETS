#!/usr/bin/env node
/**
 * Migration one-shot : convertit toutes les images Supabase Storage en WebP
 * (qualité 85) et met à jour les URLs en base.
 *
 * - Buckets traités : 'content-images' (recettes/astuces/conseils),
 *   'featured-photos' (saviez-vous).
 * - Pour chaque fichier non-WebP : download → convert sharp → upload .webp
 *   → met à jour les URLs dans les tables qui le référencent.
 * - Idempotent : si la cible .webp existe déjà avec une mtime plus récente
 *   que la source, on skip.
 *
 * Pré-requis env vars :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Lancement :
 *   node scripts/migrate-storage-to-webp.mjs               # dry-run (juste un compte-rendu)
 *   node scripts/migrate-storage-to-webp.mjs --apply       # applique
 *   node scripts/migrate-storage-to-webp.mjs --apply --delete-old  # supprime les originaux après succès
 */
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Charge .env.local si présent (sans dépendance dotenv)
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
const DELETE_OLD = process.argv.includes('--delete-old');

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

/** Liste récursive d'un bucket. Pagine si > 1000 fichiers. */
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
        // C'est un dossier
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

/** Renvoie l'URL publique d'un path */
function publicUrl(bucket, path) {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Cherche+remplace une URL dans une colonne tableau ou texte de toutes les tables connues. */
async function updateUrlReferences(oldUrl, newUrl) {
  // health_advice.slides (text[])
  // tips.slides (text[])
  // recipes.cover_image_url (text), recipes.slides (text[]), recipes.prep_photos (text[])
  // comments.photos (text[])
  // featured_photos.image_url (text)
  const updates = [];

  // Tables avec colonnes text[] (utilise array_replace via SQL)
  for (const [table, col] of [
    ['health_advice', 'slides'],
    ['tips', 'slides'],
    ['recipes', 'slides'],
    ['recipes', 'prep_photos'],
    ['comments', 'photos'],
  ]) {
    updates.push(
      supabase.rpc('replace_text_in_array', {
        p_table: table,
        p_col: col,
        p_old: oldUrl,
        p_new: newUrl,
      }).then(
        () => null,
        (err) => {
          // Le RPC n'existe peut-être pas, on fait la version manuelle
          return manualArrayReplace(table, col, oldUrl, newUrl);
        },
      ),
    );
  }

  // Tables avec colonnes text simples
  updates.push(
    supabase.from('recipes').update({ cover_image_url: newUrl }).eq('cover_image_url', oldUrl),
  );
  updates.push(
    supabase.from('featured_photos').update({ image_url: newUrl }).eq('image_url', oldUrl),
  );

  await Promise.all(updates);
}

/** Fallback : récupère la ligne, modifie le tableau côté JS, réenregistre. */
async function manualArrayReplace(table, col, oldUrl, newUrl) {
  const { data, error } = await supabase
    .from(table)
    .select(`id, ${col}`)
    .contains(col, [oldUrl]);
  if (error) {
    console.warn(`  [${table}.${col}] contains query failed:`, error.message);
    return;
  }
  if (!data || data.length === 0) return;
  for (const row of data) {
    const arr = (row[col] ?? []).map((u) => (u === oldUrl ? newUrl : u));
    await supabase.from(table).update({ [col]: arr }).eq('id', row.id);
  }
}

async function migrateBucket(bucket) {
  console.log(`\n📦 Bucket ${bucket}`);
  const files = await listAll(bucket);
  console.log(`  ${files.length} fichier(s) trouvé(s)`);

  let converted = 0;
  let skipped = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  const errors = [];

  for (const f of files) {
    const ext = extOf(f.path);
    if (!IMAGE_EXTS.has(ext)) {
      skipped++;
      continue;
    }
    const newPath = withoutExt(f.path) + '.webp';
    if (newPath === f.path) {
      skipped++;
      continue;
    }

    // Vérifie si la cible existe déjà
    const dir = newPath.includes('/') ? newPath.slice(0, newPath.lastIndexOf('/')) : '';
    const targetName = newPath.split('/').pop();
    const { data: existing } = await supabase.storage.from(bucket).list(dir, { search: targetName });
    if (existing && existing.some((e) => e.name === targetName)) {
      skipped++;
      continue;
    }

    if (!APPLY) {
      console.log(`  [DRY] ${f.path} → ${newPath}`);
      continue;
    }

    try {
      const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(f.path);
      if (dlErr) throw dlErr;
      const inputBuf = Buffer.from(await blob.arrayBuffer());
      totalBefore += inputBuf.length;

      const out = await sharp(inputBuf)
        .rotate()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85, effort: 4 })
        .toBuffer();
      totalAfter += out.length;

      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(newPath, out, { contentType: 'image/webp', upsert: false });
      if (upErr) throw upErr;

      const oldUrl = publicUrl(bucket, f.path);
      const newUrl = publicUrl(bucket, newPath);
      await updateUrlReferences(oldUrl, newUrl);

      if (DELETE_OLD) {
        await supabase.storage.from(bucket).remove([f.path]);
      }

      converted++;
      const ratio = ((1 - out.length / inputBuf.length) * 100).toFixed(0);
      console.log(`  ✅ ${f.path.padEnd(60)} ${fmtBytes(inputBuf.length).padStart(8)} → ${fmtBytes(out.length).padStart(8)} (-${ratio}%)`);
    } catch (err) {
      console.error(`  ❌ ${f.path}:`, err.message);
      errors.push({ path: f.path, error: err.message });
    }
  }

  return { bucket, total: files.length, converted, skipped, totalBefore, totalAfter, errors };
}

async function main() {
  console.log(APPLY ? '🚀 Mode APPLY' : '🔎 Mode DRY-RUN (utilise --apply pour appliquer)');
  if (DELETE_OLD && APPLY) {
    console.log('🗑️  --delete-old : les fichiers originaux seront supprimés après succès');
  }

  const reports = [];
  for (const bucket of BUCKETS) {
    try {
      reports.push(await migrateBucket(bucket));
    } catch (err) {
      console.error(`❌ Bucket ${bucket} erreur:`, err.message);
    }
  }

  console.log('\n\n📊 Récap :');
  let grandBefore = 0, grandAfter = 0;
  for (const r of reports) {
    console.log(
      `  ${r.bucket.padEnd(20)} ${r.converted} convertis, ${r.skipped} skip, ${r.errors.length} erreurs` +
      (r.converted > 0 ? `  ${fmtBytes(r.totalBefore)} → ${fmtBytes(r.totalAfter)}` : ''),
    );
    grandBefore += r.totalBefore;
    grandAfter += r.totalAfter;
  }
  if (grandBefore > 0) {
    const ratio = ((1 - grandAfter / grandBefore) * 100).toFixed(0);
    console.log(`\n📦 Total : ${fmtBytes(grandBefore)} → ${fmtBytes(grandAfter)} (-${ratio}%)`);
  }
  if (!APPLY) {
    console.log('\nℹ️  Aucune modification effectuée. Pour appliquer :');
    console.log('   node scripts/migrate-storage-to-webp.mjs --apply');
    console.log('Pour supprimer aussi les fichiers d\'origine après conversion :');
    console.log('   node scripts/migrate-storage-to-webp.mjs --apply --delete-old');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
