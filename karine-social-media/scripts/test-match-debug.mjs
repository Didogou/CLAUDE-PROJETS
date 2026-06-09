#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?(.+?)["']?$/);
  if (m) env[m[1]] = m[2];
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const stem = (t) => (t.length >= 5 && t.endsWith('s') ? t.slice(0, -1) : t);
const normKeep = (s) => s.toLowerCase();
const normStrip = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');

const STOP_WORDS = new Set([
  'de','du','des','et','ou','au','aux','avec','sans','en','le','la','les','un','une','plus','bien','tres',
  'mure','mur','mature','frai','frais','fraiche','fraich',
  'pepite','morceau','tranche','rondelle','gousse','feuille','feuilles','cube','cubes','dose','doses','pincee','pincees',
]);
const MEAT_KEYWORDS = new Set(['poulet','dinde','boeuf','porc','agneau','veau','canard','lapin','jambon','saucisse','magret','bavette','entrecote','rumsteck','gigot','cordon','nugget','viande','poulets','dindes','jambons','saucisses','magrets']);
const RAW_RE = /\b(cru|crue|crus|crues)\b/;
const COOKED_RE = /\b(cuit|cuite|cuits|cuites|grill|r[ôo]ti|po[êe]l|brais|appert|vapeur|frit|frite|bouilli|blanchi|confit|mijot)/;
const LABEL_EXPLICIT_RAW_RE = /\b(cru|crue|crus|crues|tartare|carpaccio|sashimi)\b/;
const TRANSFORMED_RE = /\b(poudre|moulu|moulue|s[ée]che|s[ée]chee|s[ée]chees|sec|d[ée]shydrat|lyophilis|nectar|jus de|au sirop|en sirop|appertis|conserve|en bo[iî]te|congel|surgel)\b/;
const LABEL_TRANSFORMATION_RE = /\b(poudre|moulu|moulue|s[ée]che|sec|d[ée]shydrat|lyophilis|nectar|jus|sirop|appertis|conserve|en bo[iî]te|congel|surgel|en bocal)\b/;

const splitRe = /[\s,()/'’0-9%]+/;

function quickMatch(label, ciqualFoods) {
  const labelKeep = normKeep(label);
  const labelStrip = normStrip(label);
  const tokensKeepRaw = labelKeep.split(splitRe).filter(t => t.length >= 3);
  const tokensKeep = tokensKeepRaw.map(stem);
  const tokensStrip = labelStrip.split(splitRe).filter(t => t.length >= 3).map(stem);
  const rawTokens = [];
  for (let i = 0; i < tokensStrip.length; i++) {
    if (!STOP_WORDS.has(tokensStrip[i])) rawTokens.push({ keepRaw: tokensKeepRaw[i], keep: tokensKeep[i], strip: tokensStrip[i] });
  }
  if (rawTokens.length === 0) return;

  const isMeatLabel = rawTokens.some(t => MEAT_KEYWORDS.has(t.strip)) && !LABEL_EXPLICIT_RAW_RE.test(labelStrip);
  const labelHasTransform = LABEL_TRANSFORMATION_RE.test(labelStrip);

  const top = [];
  for (const f of ciqualFoods) {
    const fnameKeep = normKeep(f.name);
    const fnameStrip = normStrip(f.name);
    const fnameWordsKeepRaw = new Set(fnameKeep.split(splitRe).filter(w => w.length >= 3));
    const fnameWordsKeep = new Set([...fnameWordsKeepRaw].map(stem));
    const fnameWordsStrip = new Set(fnameStrip.split(splitRe).filter(w => w.length >= 3).map(stem));
    let matched = 0, score = 0;
    rawTokens.forEach((t, idx) => {
      let isMatch = false;
      if (fnameWordsKeep.has(t.keep)) isMatch = true;
      else if (t.keep === t.strip && fnameWordsStrip.has(t.strip)) isMatch = true;
      if (isMatch) {
        const w = idx === 0 ? 2 : 1;
        score += t.strip.length * w;
        matched++;
        if (fnameWordsKeepRaw.has(t.keepRaw)) score += 5;
      }
    });
    if (matched === 0) continue;
    if (matched > 1) score += (matched - 1) * 10;
    if (matched === rawTokens.length) score += 20;
    if (rawTokens.some(t => fnameStrip.startsWith(t.strip))) score += 5;
    if (rawTokens[0] && fnameStrip.startsWith(rawTokens[0].strip + ',')) score += 10;
    score -= Math.max(0, f.name.length - 15) * 0.25;
    if (isMeatLabel) {
      if (RAW_RE.test(fnameStrip)) score -= 15;
      if (COOKED_RE.test(fnameStrip)) score += 10;
    }
    if (!labelHasTransform && TRANSFORMED_RE.test(fnameStrip)) score -= 12;
    top.push({ id: f.id, name: f.name, score: Math.round(score * 10) / 10, matched });
  }
  top.sort((a, b) => b.score - a.score);
  const flags = [];
  if (isMeatLabel) flags.push('MEAT');
  if (labelHasTransform) flags.push('HAS_TRANSFORM');
  console.log(`\n=== "${label}" === tokens [${rawTokens.map(t => t.strip).join(', ')}]${flags.length ? ' (' + flags.join(',') + ')' : ''}`);
  for (const t of top.slice(0, 4)) {
    console.log(`  ${t.score.toString().padStart(6)} pts | ${t.matched}/${rawTokens.length} | #${t.id} ${t.name}`);
  }
}

const all = [];
for (let offset = 0; offset < 10000; offset += 1000) {
  const { data } = await supa.from('ciqual_foods').select('id, name').order('id').range(offset, offset + 999);
  if (!data || !data.length) break;
  all.push(...data);
  if (data.length < 1000) break;
}
console.log(`Ciqual : ${all.length} aliments`);

const CASES = [
  'banane bien mûre',
  'pépites de chocolat noir',
  'ananas frais',
  'avocat',
  'avocats bien mûrs',
  'bagel complet (ou aux graines)',
  'blanc de poulet',
  'jambon fumé',
  'crème liquide légère',
  'fromage frais léger',
  'fruit de la passion',
  'gingembre frais',
  'huile de coco fondue',
  'lait d\'amande',
  'lait végétal',
  'farine complète',
  'farine d\'avoine ou complète',
  'pâtes (penne ou rigatoni)',
  'pâte brisée légère',
  'pâtes',
];
for (const c of CASES) quickMatch(c, all);
