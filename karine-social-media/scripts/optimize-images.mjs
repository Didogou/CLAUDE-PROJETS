#!/usr/bin/env node
/**
 * Optimise toutes les PNG/JPG dans public/images/ → version WebP côte à côte.
 * Resize aussi les fichiers trop grands (max 1920×1920 pour fonds, 512×512 pour icônes).
 *
 * Usage : node scripts/optimize-images.mjs
 *
 * Le script est idempotent : il skip les fichiers déjà optimisés (timestamp).
 * Les .png originaux sont conservés (fallback pour navigateurs anciens).
 */
import { readdir, stat, mkdir } from 'node:fs/promises';
import { join, extname, basename, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images');

// Cibles par dossier (max W × H, qualité)
const TARGETS = {
  icons:   { maxW: 512,  maxH: 512,  quality: 82 }, // icônes tuiles
  default: { maxW: 1920, maxH: 1920, quality: 78 }, // fonds, illustrations
};

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function isCandidate(path) {
  const ext = extname(path).toLowerCase();
  return ['.png', '.jpg', '.jpeg'].includes(ext);
}

function targetFor(path) {
  if (path.includes(`${'/'}icons${'/'}`) || path.includes(`\\icons\\`)) {
    return TARGETS.icons;
  }
  return TARGETS.default;
}

async function optimizeOne(path) {
  const ext = extname(path);
  const webpPath = path.slice(0, -ext.length) + '.webp';

  // Skip si .webp déjà à jour
  try {
    const [src, dst] = await Promise.all([stat(path), stat(webpPath)]);
    if (dst.mtimeMs >= src.mtimeMs) return { path, skipped: true };
  } catch {
    /* webp absent → on génère */
  }

  const { maxW, maxH, quality } = targetFor(path);
  await mkdir(dirname(webpPath), { recursive: true });

  const before = (await stat(path)).size;
  const meta = await sharp(path).metadata();
  let pipeline = sharp(path);
  if ((meta.width ?? 0) > maxW || (meta.height ?? 0) > maxH) {
    pipeline = pipeline.resize({
      width: maxW,
      height: maxH,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  await pipeline.webp({ quality, effort: 5 }).toFile(webpPath);
  const after = (await stat(webpPath)).size;

  const rel = relative(ROOT, path).replace(/\\/g, '/');
  const ratio = ((1 - after / before) * 100).toFixed(0);
  return { path: rel, before, after, ratio, skipped: false };
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const results = [];
  for await (const path of walk(ROOT)) {
    if (!isCandidate(path)) continue;
    try {
      results.push(await optimizeOne(path));
    } catch (err) {
      console.error('Erreur sur', path, err.message);
    }
  }
  const optimized = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n✅ ${optimized.length} image(s) optimisée(s), ${skipped} skip.\n`);
  for (const r of optimized) {
    console.log(`  ${r.path.padEnd(50)} ${fmtBytes(r.before).padStart(8)} → ${fmtBytes(r.after).padStart(8)} (-${r.ratio}%)`);
  }
  const totalBefore = optimized.reduce((s, r) => s + r.before, 0);
  const totalAfter = optimized.reduce((s, r) => s + r.after, 0);
  if (totalBefore > 0) {
    const ratio = ((1 - totalAfter / totalBefore) * 100).toFixed(0);
    console.log(`\n📦 Total : ${fmtBytes(totalBefore)} → ${fmtBytes(totalAfter)} (-${ratio}%)\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
