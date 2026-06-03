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
 * Recherche par nom (compteur calories — résolution "j'ai mangé un
 * yaourt").
 *
 * Bug observé 2026-06-03 : ORDER BY name ASC + ilike '%q%' →
 *   "pomme" → "Aligot (purée de pomme de terre...)" (A < P).
 *
 * Fix : on récupère un large pool puis on trie côté JS par
 * pertinence :
 *   0 = match exact
 *   1 = name commence par "q," ou "q "
 *   2 = name commence par "q"
 *   3 = mot entier "q" présent dans le name
 *   4 = q présent en sous-chaîne (fallback)
 *
 * Tie-break : longueur du name (court = plus générique), puis
 * alphabétique FR.
 */
export async function searchCiqualFoods(
  query: string,
  limit = 20,
): Promise<CiqualSearchResult[]> {
  const supabase = await createClient();
  const q = query.trim();
  if (q.length < 2) return [];

  // Pool large pour le tri côté serveur ; l'index trigram garde
  // la requête rapide même sans LIMIT serré.
  const POOL = 60;
  const { data, error } = await (supabase as any)
    .from('ciqual_foods')
    .select('id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g')
    .ilike('name', `%${q}%`)
    .limit(POOL);

  if (error) return [];
  const rows = (data ?? []) as CiqualSearchResult[];

  const qLower = q.toLowerCase();
  const wordRe = new RegExp(
    `\\b${qLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    'i',
  );

  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (n === qLower) return 0;
    if (n.startsWith(qLower + ',') || n.startsWith(qLower + ' ')) return 1;
    if (n.startsWith(qLower)) return 2;
    if (wordRe.test(name)) return 3;
    return 4;
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
