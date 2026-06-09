#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?(.+?)["']?$/);
  if (m) env[m[1]] = m[2];
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 1) Cherche tous les "bagel" en Ciqual
const { data: bagels } = await supa
  .from('ciqual_foods')
  .select('id, name, group_name')
  .ilike('name', '%bagel%');
console.log(`\n=== Bagels en Ciqual : ${bagels?.length ?? 0} ===`);
for (const b of bagels ?? []) {
  console.log(`  #${b.id} ${b.name}  [${b.group_name}]`);
}

// 2) Cherche aussi riz complet pour comparer
const { data: riz } = await supa
  .from('ciqual_foods')
  .select('id, name, group_name')
  .ilike('name', '%riz%complet%')
  .limit(5);
console.log(`\n=== Riz complet en Ciqual (top 5) ===`);
for (const r of riz ?? []) {
  console.log(`  #${r.id} ${r.name}  [${r.group_name}]`);
}

// 3) Reproduit le quickMatchCiqual du code TS pour le tester en local
const stem = (t) => (t.length >= 5 && t.endsWith('s') ? t.slice(0, -1) : t);
const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');

function quickMatchCiqual(label, ciqualFoods) {
  const rawTokens = norm(label).split(/[\s,()/'’]+/).filter((t) => t.length >= 3).map(stem);
  if (rawTokens.length === 0) return null;
  let bestScore = 0;
  let best = null;
  const top = [];
  for (const f of ciqualFoods) {
    const fname = norm(f.name);
    let matched = 0;
    let score = 0;
    rawTokens.forEach((t, idx) => {
      if (fname.includes(t)) {
        const weight = idx === 0 ? 2 : 1;
        score += t.length * weight;
        matched++;
      }
    });
    if (matched === 0) continue;
    if (matched === rawTokens.length) score += 20;
    if (rawTokens.some((t) => fname.startsWith(t))) score += 5;
    score -= Math.max(0, f.name.length - 15) * 0.5;
    top.push({ id: f.id, name: f.name, score: Math.round(score * 10) / 10, matched });
    if (score > bestScore) { bestScore = score; best = f; }
  }
  top.sort((a, b) => b.score - a.score);
  console.log(`\n=== Top 10 matches pour "${label}" ===`);
  console.log(`Tokens tokenises : [${rawTokens.join(', ')}]`);
  for (const t of top.slice(0, 10)) {
    console.log(`  ${t.score.toString().padStart(6)} pts | matched ${t.matched}/${rawTokens.length} | #${t.id} ${t.name}`);
  }
  return bestScore >= 6 ? best : null;
}

// Fetch tout Ciqual paginé
const all = [];
for (let offset = 0; offset < 10000; offset += 1000) {
  const { data } = await supa
    .from('ciqual_foods')
    .select('id, name')
    .order('id', { ascending: true })
    .range(offset, offset + 999);
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
}
console.log(`\n✓ ${all.length} aliments Ciqual charges`);

quickMatchCiqual('bagel complet ou aux graines', all);
quickMatchCiqual('bagel', all);
quickMatchCiqual('bagel complet', all);
