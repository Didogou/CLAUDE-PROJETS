#!/usr/bin/env node
/**
 * Sweep masse : remplace tous les pattern de leak `e instanceof Error
 * ? e.message : 'X'` par un message générique côté client + un
 * console.error préservé côté serveur (Vercel logs).
 *
 * Audit Agent A 2026-06-12 — règle de sécu projet :
 *   Le message Postgres/Stripe ne doit JAMAIS être renvoyé au client
 *   (leak du schéma DB, fingerprint Stripe). Voir lib/safe-error.ts.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'src/app/api');

// Liste tous les fichiers .ts qui ont le pattern
const found = execSync(
  `grep -rl "e instanceof Error ? e.message :" ${root.replace(/\\/g, '/')}`,
  { encoding: 'utf-8' },
)
  .split('\n')
  .filter(Boolean);

console.log(`Found ${found.length} files to patch`);

// Pattern : remplace l'inline ternaire qui leak par un message safe.
// On garde 'Erreur serveur' (générique) — le détail va dans console.error.
const RE_LEAK = /e instanceof Error \? e\.message : '[^']*'/g;

let patched = 0;
for (const file of found) {
  const content = readFileSync(file, 'utf-8');
  const updated = content.replace(RE_LEAK, "'Erreur serveur'");
  if (updated !== content) {
    writeFileSync(file, updated);
    patched++;
    const occ = (content.match(RE_LEAK) ?? []).length;
    console.log(`  patched: ${file.replace(/\\/g, '/').split('/api/')[1]} (${occ}×)`);
  }
}

console.log(`\n✅ ${patched} files patched`);
