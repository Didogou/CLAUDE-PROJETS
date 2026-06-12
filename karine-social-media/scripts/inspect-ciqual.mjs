#!/usr/bin/env node
/**
 * Diagnostic : lit un fichier Ciqual XLSX et affiche ce que le parser
 * détecte (colonnes mappées, colonnes non utilisées, échantillon).
 *
 * USAGE :
 *   node scripts/inspect-ciqual.mjs "C:/Users/didie/Downloads/Table Ciqual 2025_FR_2025_11_03 (2).xlsx"
 */

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/inspect-ciqual.mjs <path>');
  process.exit(1);
}

const buffer = readFileSync(filePath);
const workbook = XLSX.read(buffer, { type: 'buffer' });

console.log('📁 Fichier :', filePath);
console.log('📑 Onglets :', workbook.SheetNames.join(' | '));

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Trouve le meilleur onglet (même logique que le parser)
let bestSheet = null;
for (const name of workbook.SheetNames) {
  const norm = normalize(name);
  if (norm.includes('read me') || norm.includes('evolution')) continue;
  const sheet = workbook.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  if (rows.length === 0) continue;
  const headers = Object.keys(rows[0]);
  if (headers.some((h) => normalize(h).includes('alim_code') || normalize(h).includes('code aliment'))) {
    bestSheet = name;
    break;
  }
}

if (!bestSheet) {
  console.error('❌ Aucun onglet exploitable trouvé.');
  process.exit(1);
}

console.log(`\n✅ Onglet retenu : "${bestSheet}"`);

const sheet = workbook.Sheets[bestSheet];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
const headers = Object.keys(rows[0]);

console.log(`\n📊 Nombre de colonnes : ${headers.length}`);
console.log(`📊 Nombre de lignes : ${rows.length}`);

console.log(`\n🔍 Recherche colonnes AGS :`);
const agsCandidates = headers.filter((h) => {
  const n = normalize(h);
  return n.includes('ag satur') || n.includes('ags ') || n.includes('saturated') || n.includes('acides gras satur');
});
if (agsCandidates.length === 0) {
  console.log('   ❌ Aucune colonne AGS trouvée');
  console.log('\n   Toutes les colonnes qui contiennent "satur" ou "ag" :');
  for (const h of headers) {
    if (/satur|ag /i.test(h)) console.log('     -', JSON.stringify(h));
  }
} else {
  for (const c of agsCandidates) {
    console.log('   ✓ Trouvé :', JSON.stringify(c));
    // Échantillon 3 valeurs
    const samples = rows.slice(0, 5).map((r) => r[c]);
    console.log('     Échantillon :', samples);
  }
}

console.log(`\n📋 Toutes les colonnes du fichier :`);
for (const h of headers) {
  console.log('   -', h);
}
