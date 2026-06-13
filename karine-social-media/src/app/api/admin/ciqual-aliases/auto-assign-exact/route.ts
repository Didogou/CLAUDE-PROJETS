/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/ciqual-aliases/auto-assign-exact
 *
 * Auto-résolution par CORRESPONDANCE EXACTE de terme.
 *
 * Pour chaque conflit (un alias `pending` pointant vers plusieurs entrées
 * Ciqual), on garde le candidat dont le NOM CONTIENT TOUS LES MOTS de
 * l'alias (mots de ≥ 3 lettres ; les petits mots-outils « de/du/la… » sont
 * ignorés). Ex. :
 *   « huile olive » → « Huile d'olive vierge extra » ✅
 *   « cote porc »   → « Porc, côte, crue » ✅
 *
 * Cas « cru » : si l'alias contient cru/crue/crus/crues, on ne retient que
 * les candidats portant une version crue (toutes formes équivalentes).
 *
 * Priorité « ordre » : entre les candidats valides, on privilégie ceux où
 * les mots de l'alias suivent l'ORDRE des mots du nom Ciqual.
 *
 * Si PLUSIEURS candidats contiennent tous les mots, on prend le plus
 * canonique = le nom avec le MOINS de mots. On n'assigne que si ce minimum
 * est UNIQUE (sinon ambigu → résolution manuelle). Le candidat retenu passe
 * `resolved`, les autres du même alias passent `rejected`.
 *
 * Idempotent : ne touche que les lignes `status='pending'`.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .replace(/[’']/g, "'")
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mots normalisés (séparateurs : espaces, virgules, parenthèses,
 *  apostrophes, slash, %, chiffres, tirets). */
function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[\s,()/'%0-9-]+/)
    .filter(Boolean);
}

/** Marqueurs « cru » (toutes formes équivalentes). */
const RAW = new Set(['cru', 'crue', 'crus', 'crues']);

/** Vrai si `words` apparaissent dans CET ORDRE comme sous-séquence de
 *  `toks` (pas forcément contigus ; cru/crue/… considérés équivalents). */
function orderedSubseq(words: string[], toks: string[]): boolean {
  let i = 0;
  for (const t of toks) {
    if (i >= words.length) break;
    const w = words[i];
    if (t === w || (RAW.has(w) && RAW.has(t))) i++;
  }
  return i === words.length;
}

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient() as any;

  // 1. Tous les aliases pending (paginé)
  type Row = { id: number; alias: string; ciqual_id: number };
  const pending: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('ciqual_aliases')
      .select('id, alias, ciqual_id')
      .eq('status', 'pending')
      .order('alias')
      .range(offset, offset + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    pending.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // 2. Groupe par alias → ne garde que les conflits (>1 ciqual_id distinct)
  const byAlias = new Map<string, Row[]>();
  for (const r of pending) {
    const list = byAlias.get(r.alias) ?? [];
    list.push(r);
    byAlias.set(r.alias, list);
  }
  const conflicts: Array<{ alias: string; rows: Row[] }> = [];
  for (const [alias, rows] of byAlias) {
    if (new Set(rows.map((r) => r.ciqual_id)).size > 1) conflicts.push({ alias, rows });
  }

  // 3. Récupère les noms Ciqual des candidats (1 passe, chunks de 500)
  const allIds = [...new Set(conflicts.flatMap((c) => c.rows.map((r) => r.ciqual_id)))];
  const nameById = new Map<number, string>();
  for (let i = 0; i < allIds.length; i += 500) {
    const chunk = allIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('ciqual_foods')
      .select('id, name')
      .in('id', chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of (data as Array<{ id: number; name: string }>) ?? []) {
      nameById.set(row.id, row.name);
    }
  }

  // 4. Pour chaque conflit, cherche le candidat en correspondance exacte
  const keepIds: number[] = [];
  const rejectIds: number[] = [];
  let assigned = 0;

  for (const { alias, rows } of conflicts) {
    // Mots de l'alias (≥ 3 lettres → ignore « de/du/la/aux… »).
    const aliasWords = tokenize(alias).filter((w) => w.length >= 3);
    if (aliasWords.length === 0) continue;

    // Si l'alias mentionne « cru/crue/… », on EXIGE une version crue parmi
    // les candidats (cru/crue/crus/crues traités comme équivalents, pour
    // ne pas rater « cru » vs « crue »). Les autres mots restent exigés.
    const wantRaw = aliasWords.some((w) => RAW.has(w));
    const reqWords = aliasWords.filter((w) => !RAW.has(w));

    const cands = rows.map((r) => {
      const name = nameById.get(r.ciqual_id) ?? '';
      const toks = tokenize(name);
      return {
        id: r.id,
        toksArr: toks,
        tokens: new Set(toks),
        wordCount: toks.length,
        hasRaw: toks.some((t) => RAW.has(t)),
      };
    });

    // RÈGLE : le nom Ciqual contient TOUS les mots de l'alias (hors marqueur
    // cru) ET, si l'alias demande du cru, porte aussi un marqueur cru.
    const matches = cands.filter(
      (c) => reqWords.every((w) => c.tokens.has(w)) && (!wantRaw || c.hasRaw),
    );
    if (matches.length === 0) continue;

    // PRIORITÉ : candidats où les mots de l'alias suivent l'ORDRE des mots
    // du nom Ciqual (sous-séquence ordonnée). Sinon on retombe sur tous.
    const ordered = matches.filter((c) => orderedSubseq(aliasWords, c.toksArr));
    const pool = ordered.length > 0 ? ordered : matches;

    // Dans le pool retenu : le plus canonique (moins de mots), si unique.
    let chosen = pool[0];
    if (pool.length > 1) {
      const minWc = Math.min(...pool.map((c) => c.wordCount));
      const top = pool.filter((c) => c.wordCount === minWc);
      if (top.length !== 1) continue; // égalité → résolution manuelle
      chosen = top[0];
    }

    keepIds.push(chosen.id);
    for (const r of rows) if (r.id !== chosen.id) rejectIds.push(r.id);
    assigned++;
  }

  // 5. Écritures batch (chunks de 200)
  for (let i = 0; i < keepIds.length; i += 200) {
    const chunk = keepIds.slice(i, i + 200);
    const { error } = await supabase
      .from('ciqual_aliases')
      .update({ status: 'resolved' })
      .in('id', chunk)
      .eq('status', 'pending');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  for (let i = 0; i < rejectIds.length; i += 200) {
    const chunk = rejectIds.slice(i, i + 200);
    const { error } = await supabase
      .from('ciqual_aliases')
      .update({ status: 'rejected' })
      .in('id', chunk)
      .eq('status', 'pending');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    scanned: conflicts.length,
    assigned,
    rejected: rejectIds.length,
  });
}
