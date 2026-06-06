import { createClient } from '@/lib/supabase/server';

export type CiqualStats = {
  totalFoods: number;
  lastImportAt: string | null;
  groupsCount: number;
};

/**
 * État de la table Ciqual pour la page admin :
 * combien d'aliments, dernier import, combien de groupes.
 */
export async function getCiqualStats(): Promise<CiqualStats> {
  const supabase = await createClient();

  const { count: totalFoods } = await (supabase as any)
    .from('ciqual_foods')
    .select('id', { count: 'exact', head: true });

  const { data: latest } = await (supabase as any)
    .from('ciqual_foods')
    .select('imported_at')
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: groupsRaw } = await (supabase as any)
    .from('ciqual_foods')
    .select('group_name')
    .not('group_name', 'is', null);

  const groups = new Set<string>();
  for (const row of (groupsRaw ?? []) as Array<{ group_name: string | null }>) {
    if (row.group_name) groups.add(row.group_name);
  }

  return {
    totalFoods: totalFoods ?? 0,
    lastImportAt: latest?.imported_at ?? null,
    groupsCount: groups.size,
  };
}

export type CiqualSearchResult = {
  id: number;
  alim_code: number;
  name: string;
  group_name: string | null;
  kcal_per_100g: number | null;
  proteins_g: number | null;
  lipids_g: number | null;
  carbs_g: number | null;
};

/**
 * Recherche par nom (compteur calories).
 *
 * Pipeline V3 :
 *  1) Tokenisation : split + drop mots <= 2 chars (de/à/la) + strip
 *     's' final pour les mots >= 5 (pommes → pomme).
 *  2) Appel RPC `search_ciqual_foods` côté Postgres :
 *     - normalise tokens via unaccent + lower
 *     - matche chaque token (AND) dans name OR group_name OR
 *       subgroup_name
 *     - retourne un pool large (60).
 *     → résout "boeuf" qui matche "Bœuf" et "cote" qui matche "côte".
 *     → résout "boeuf cru" qui matche via subgroup "viandes de bœuf"
 *       même si "cru" n'est pas exactement dans le name.
 *  3) Scoring de pertinence côté JS (avec normalisation accents) :
 *     0 = exact, 1 = "q,"/q ", 2 = startsWith, 3 = mot entier,
 *     4 = tokens présents (multi), 5 = sous-chaîne (mono).
 *  4) Tie-break : longueur (court = générique), alphabétique FR.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

export async function searchCiqualFoods(
  query: string,
  limit = 20,
): Promise<CiqualSearchResult[]> {
  const supabase = await createClient();
  const q = query.trim();
  if (q.length < 2) return [];

  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => (t.length >= 5 && t.endsWith('s') ? t.slice(0, -1) : t));

  const searchTokens = tokens.length > 0 ? tokens : [q.toLowerCase()];
  const POOL = 60;

  const { data, error } = await (supabase as any).rpc('search_ciqual_foods', {
    query_tokens: searchTokens,
    limit_n: POOL,
  });
  if (error) return [];
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    alim_code: Number(r.alim_code),
    name: String(r.name),
    group_name: (r.group_name as string | null) ?? null,
    kcal_per_100g:
      r.kcal_per_100g === null ? null : Number(r.kcal_per_100g),
    proteins_g: r.proteins_g === null ? null : Number(r.proteins_g),
    lipids_g: r.lipids_g === null ? null : Number(r.lipids_g),
    carbs_g: r.carbs_g === null ? null : Number(r.carbs_g),
  })) as CiqualSearchResult[];

  const qNorm = normalize(q);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp(`\\b${escape(qNorm)}\\b`, 'i');

  // Scoring ordonné. Distingue préfixe AVEC VIRGULE (= variante
  // stricte du même aliment : "banane, chair sans peau, crue") du
  // préfixe AVEC ESPACE (= variété/qualificatif : "banane plantain"
  // qui est un aliment différent). Sans ça, "banane plantain" gagnait
  // à tort sur "banane" tout court.
  const score = (name: string): number => {
    const n = normalize(name);
    if (n === qNorm) return 0;
    if (n.startsWith(qNorm + ',')) return 1; // variante stricte
    if (n.startsWith(qNorm + ' ')) return 2; // variété (banane plantain)
    if (n.startsWith(qNorm)) return 3;
    if (wordRe.test(n)) return 4;
    if (searchTokens.length > 1) return 5;
    return 6;
  };

  rows.sort((a, b) => {
    const sa = score(a.name);
    const sb = score(b.name);
    if (sa !== sb) return sa - sb;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name.localeCompare(b.name, 'fr');
  });

  return rows.slice(0, limit);
}
