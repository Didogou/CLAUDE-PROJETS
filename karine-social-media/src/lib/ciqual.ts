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
 * 3 niveaux de tolérance :
 *  1) Multi-mots : "pomme frite" → split + ILIKE '%pomme%' AND
 *     ILIKE '%frite%'. Matche "Frites de pommes de terre" sans
 *     dépendre de l'ordre. Mots <= 2 chars ignorés (de/à/la/le).
 *  2) Pluriels : ILIKE est substring-based, donc "frite" matche
 *     "frites" naturellement. Mais "pommes" ne matche pas "pomme"
 *     direct → on STRIP le 's' final côté token avant la requête
 *     (token >= 4 chars).
 *  3) Scoring de pertinence côté JS : on récupère un pool large
 *     puis on trie pour mettre le résultat le plus probable en 1er.
 *
 * Score (plus bas = mieux) :
 *   0 = match exact
 *   1 = name commence par "q," ou "q "
 *   2 = name commence par "q"
 *   3 = mot entier "q" présent (regex \bq\b)
 *   4 = tous tokens présents en sous-chaîne (fallback multi-mots)
 *   5 = sous-chaîne simple (mono-mot fallback)
 *
 * Tie-break : longueur du name (court = générique), alphabétique FR.
 */
export async function searchCiqualFoods(
  query: string,
  limit = 20,
): Promise<CiqualSearchResult[]> {
  const supabase = await createClient();
  const q = query.trim();
  if (q.length < 2) return [];

  // Split + nettoyage des tokens.
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => (t.length >= 5 && t.endsWith('s') ? t.slice(0, -1) : t));

  // Si rien d'utile après nettoyage, fallback sur la query brute.
  const searchTokens = tokens.length > 0 ? tokens : [q.toLowerCase()];

  const POOL = 60;
  let builder = (supabase as any)
    .from('ciqual_foods')
    .select('id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g');

  for (const t of searchTokens) {
    builder = builder.ilike('name', `%${t}%`);
  }
  builder = builder.limit(POOL);

  const { data, error } = await builder;
  if (error) return [];
  const rows = (data ?? []) as CiqualSearchResult[];

  const qLower = q.toLowerCase();
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp(`\\b${escape(qLower)}\\b`, 'i');

  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (n === qLower) return 0;
    if (n.startsWith(qLower + ',') || n.startsWith(qLower + ' ')) return 1;
    if (n.startsWith(qLower)) return 2;
    if (wordRe.test(name)) return 3;
    if (searchTokens.length > 1) return 4; // tous tokens présents (WHERE le garantit)
    return 5;
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
