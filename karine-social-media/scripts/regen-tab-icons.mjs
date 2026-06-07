#!/usr/bin/env node
/**
 * Régénère les icônes d'onglets de la page /recettes-v2 à partir des
 * illustrations source Karine.
 *
 * Convention :
 *   Source  : assets-source/06_ICONES_ET_UI/<name>.png (1024×1024, alpha)
 *   Sortie  : public/recettes/onglets/<name>.webp     (256×256, WebP q85)
 *
 * Onglets attendus :
 *   - salade.png    → salades.webp   (✅ livrée)
 *   - plat.png      → plats.webp     (⏳)
 *   - dessert.png   → desserts.webp  (⏳)
 *   - boisson.png   → boissons.webp  (⏳)
 *   - snack.png     → snacks.webp    (⏳)
 *
 * Si un fichier source manque, le script le saute sans erreur (utile
 * pour itérer au fur et à mesure que Karine livre les illustrations).
 */

import sharp from 'sharp';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const SRC_DIR = join(projectRoot, 'assets-source/06_ICONES_ET_UI');
const OUT_DIR = join(projectRoot, 'public/recettes/onglets');
mkdirSync(OUT_DIR, { recursive: true });

// Mapping nom-fichier-source → nom-fichier-output.
// Les noms source respectent ce que Karine livre dans le dossier
// (majuscules incluses : Sauce.png, Boissons.png).
const ONGLETS = [
  { src: 'salade.png', out: 'salades.webp' },
  { src: 'Entrée.png', out: 'entrees.webp' },
  { src: 'plat.png', out: 'plats.webp' },
  { src: 'Sauce.png', out: 'sauces.webp' },
  { src: 'dessert.png', out: 'desserts.webp' },
  { src: 'Boissons.png', out: 'boissons.webp' },
  { src: 'gouter.png', out: 'gouter.webp' },
  { src: 'Pouce.png', out: 'sur-le-pouce.webp' },
  { src: 'Fete.png', out: 'repas-fete.webp' },
  { src: 'famille.png', out: 'repas-famille.webp' },
  { src: 'apero.png', out: 'apero-dinatoire.webp' },
];

console.log(`📥 Source : ${SRC_DIR}`);
console.log(`📤 Sortie : ${OUT_DIR}\n`);

for (const { src, out } of ONGLETS) {
  const srcPath = join(SRC_DIR, src);
  const outPath = join(OUT_DIR, out);

  if (!existsSync(srcPath)) {
    console.log(`⏭️  ${src.padEnd(15)} → pas encore livrée`);
    continue;
  }

  await sharp(srcPath)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 85 })
    .toFile(outPath);
  const kb = Math.round(statSync(outPath).size / 1024);
  console.log(`✅ ${src.padEnd(15)} → ${out} (${kb} KB)`);
}

console.log('\nℹ️  Pour ajouter une icône : place le PNG 1024×1024 transparent');
console.log('   dans assets-source/06_ICONES_ET_UI/ avec le nom attendu,');
console.log('   puis relance ce script.');
