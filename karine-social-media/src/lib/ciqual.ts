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
 * Recherche fuzzy par nom (utilisée par le compteur calories
 * pour la résolution "j'ai mangé un yaourt").
 *
 * Pipeline :
 *  1) Trigram similarity (>0.2) — tolérant fautes/pluriels
 *  2) Ordre : similarity desc, kcal connu d'abord
 *  3) Limite 20 résultats
 */
export async function searchCiqualFoods(
  query: string,
  limit = 20,
): Promise<CiqualSearchResult[]> {
  const supabase = await createClient();
  const q = query.trim();
  if (q.length < 2) return [];

  // ilike partout (rapide grâce à l'index trigram).
  const { data, error } = await (supabase as any)
    .from('ciqual_foods')
    .select('id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g')
    .ilike('name', `%${q}%`)
    .order('name', { ascending: true })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as CiqualSearchResult[];
}
