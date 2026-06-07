#!/usr/bin/env node
/**
 * Régénère les icônes PWA + favicon à partir d'une image source carrée.
 *
 * Tailles produites :
 *   - public/favicon-32.png        (favicon navigateur)
 *   - public/apple-touch-icon.png  (180×180, iOS "Ajouter à l'écran")
 *   - public/icon-192.png          (192×192, manifest PWA Android)
 *   - public/icon-512.png          (512×512, manifest PWA Android)
 *
 * Source par défaut : assets-source/06_ICONES_ET_UI/Icon.png
 *
 * Usage :
 *   node scripts/regen-icons.mjs
 *   node scripts/regen-icons.mjs --src=chemin/autre-icone.png
 */

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const src = args.src
  ? join(projectRoot, args.src)
  : join(projectRoot, 'assets-source/06_ICONES_ET_UI/Icon.png');

// Fond blush (cohérent avec le thème PWA) pour les zones transparentes
// remplies par `fit: contain`.
const BACKGROUND = { r: 253, g: 242, b: 243, alpha: 1 };

const SIZES = [
  { out: 'public/favicon-32.png', size: 32 },
  { out: 'public/apple-touch-icon.png', size: 180 },
  { out: 'public/icon-192.png', size: 192 },
  { out: 'public/icon-512.png', size: 512 },
];

console.log(`📥 Source : ${src}`);
try {
  const meta = await sharp(src).metadata();
  console.log(`   ${meta.width}×${meta.height} ${meta.format}\n`);
} catch (e) {
  console.error(`❌ Lecture source impossible : ${e.message}`);
  process.exit(1);
}

for (const { out, size } of SIZES) {
  const outPath = join(projectRoot, out);
  await sharp(src)
    .resize(size, size, { fit: 'contain', background: BACKGROUND })
    .png({ quality: 95 })
    .toFile(outPath);
  console.log(`✅ ${out} (${size}×${size})`);
}

console.log('\nℹ️  N\'oublie pas de hard-refresh ton iPhone après déploiement.');
console.log('   iOS cache agressivement les apple-touch-icon.');
