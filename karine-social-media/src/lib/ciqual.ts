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
  /** Champs supplémentaires nécessaires au calcul Nutri-Score
   *  (ajoutés 2026-06-08). La RPC retourne setof ciqual_foods donc
   *  les a déjà — c'est juste le mapping qui ne les remontait pas. */
  fibers_g: number | null;
  sugars_g: number | null;
  salt_g: number | null;
  sodium_mg: number | null;
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
  // Sanitize qNorm pour PostgREST `.or()` : retire les caractères qui
  // cassent le parser de filtres (virgule, parenthèses, deux-points,
  // wildcards LIKE %, _, *, anti-slash). Garde lettres unicode, chiffres,
  // espace, apostrophe, tiret. Fix audit agent C 2026-06-12.
  const qNorm = normalize(q).replace(/[^\p{L}\p{N}\s'-]/gu, '');

  // === Recherche en parallèle dans 2 sources ===
  //  (1) RPC search_ciqual_foods : matche les tokens contre name/group/subgroup
  //  (2) Table ciqual_aliases : matche la query normalisée contre les
  //      aliases (expressions naturelles générées par Mistral + validées
  //      par Karine).
  //
  // Pourquoi 2 queries au lieu d'une RPC unique : la RPC actuelle ne
  // sait pas joindre `ciqual_aliases`. À optimiser plus tard via RPC
  // étendue. Pour l'instant 2 round-trips Supabase = ~50 ms, OK.
  //
  // Filtre alias : on prend status='resolved' (validé par Karine) +
  // status='pending' (pas encore trié). On EXCLUT status='rejected'
  // (alias explicitement écarté par Karine).
  const [rpcResult, aliasResult] = await Promise.all([
    (supabase as any).rpc('search_ciqual_foods', {
      query_tokens: searchTokens,
      limit_n: POOL,
    }),
    (supabase as any)
      .from('ciqual_aliases')
      .select(
        'alias, ciqual_id, status, ciqual_foods!inner(id, alim_code, name, group_name, kcal_per_100g, proteins_g, lipids_g, carbs_g, fibers_g, sugars_g, salt_g, sodium_mg)',
      )
      .neq('status', 'rejected')
      .or(`alias.eq.${qNorm},alias.like.${qNorm}%,alias.like.%${qNorm}%`)
      .limit(30),
  ]);

  if (rpcResult.error) return [];

  const rows = ((rpcResult.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    alim_code: Number(r.alim_code),
    name: String(r.name),
    group_name: (r.group_name as string | null) ?? null,
    kcal_per_100g:
      r.kcal_per_100g === null ? null : Number(r.kcal_per_100g),
    proteins_g: r.proteins_g === null ? null : Number(r.proteins_g),
    lipids_g: r.lipids_g === null ? null : Number(r.lipids_g),
    carbs_g: r.carbs_g === null ? null : Number(r.carbs_g),
    // Champs Nutri-Score (la RPC les retourne tous, on les map maintenant)
    fibers_g: r.fibers_g === null ? null : Number(r.fibers_g),
    sugars_g: r.sugars_g === null ? null : Number(r.sugars_g),
    salt_g: r.salt_g === null ? null : Number(r.salt_g),
    sodium_mg: r.sodium_mg === null ? null : Number(r.sodium_mg),
  })) as CiqualSearchResult[];

  // Indexe les rows actuelles par id pour dedup vs aliases.
  const byId = new Map<number, CiqualSearchResult>();
  for (const r of rows) byId.set(r.id, r);

  // Pour chaque match alias, on récupère l'aliment Ciqual associé.
  // Si pas déjà dans byId, on l'ajoute. On note aussi le meilleur alias
  // matché (qualité du match) pour le scoring.
  type AliasHit = { alias: string; aliasScore: number; status: string };
  const aliasHitsByFoodId = new Map<number, AliasHit>();
  if (!aliasResult.error && Array.isArray(aliasResult.data)) {
    for (const row of aliasResult.data as Array<{
      alias: string;
      ciqual_id: number;
      status: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ciqual_foods: any;
    }>) {
      const food = row.ciqual_foods;
      if (!food) continue;
      const foodId = Number(food.id);
      // Score d'alias (plus bas = meilleur) :
      //   0 = alias exact, 1 = startsWith, 2 = substring
      const a = row.alias;
      let aScore: number;
      if (a === qNorm) aScore = 0;
      else if (a.startsWith(qNorm)) aScore = 1;
      else aScore = 2;

      // On garde le meilleur alias par aliment (si plusieurs matchent)
      const prev = aliasHitsByFoodId.get(foodId);
      if (!prev || aScore < prev.aliasScore) {
        aliasHitsByFoodId.set(foodId, {
          alias: a,
          aliasScore: aScore,
          status: row.status,
        });
      }

      if (!byId.has(foodId)) {
        byId.set(foodId, {
          id: foodId,
          alim_code: Number(food.alim_code),
          name: String(food.name),
          group_name: (food.group_name as string | null) ?? null,
          kcal_per_100g:
            food.kcal_per_100g === null ? null : Number(food.kcal_per_100g),
          proteins_g: food.proteins_g === null ? null : Number(food.proteins_g),
          lipids_g: food.lipids_g === null ? null : Number(food.lipids_g),
          carbs_g: food.carbs_g === null ? null : Number(food.carbs_g),
          fibers_g: food.fibers_g === null ? null : Number(food.fibers_g),
          sugars_g: food.sugars_g === null ? null : Number(food.sugars_g),
          salt_g: food.salt_g === null ? null : Number(food.salt_g),
          sodium_mg: food.sodium_mg === null ? null : Number(food.sodium_mg),
        });
      }
    }
  }

  const allRows = [...byId.values()];

  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp(`\\b${escape(qNorm)}\\b`, 'i');

  // Scoring ordonné. Distingue préfixe AVEC VIRGULE (= variante
  // stricte du même aliment : "banane, chair sans peau, crue") du
  // préfixe AVEC ESPACE (= variété/qualificatif : "banane plantain"
  // qui est un aliment différent). Sans ça, "banane plantain" gagnait
  // à tort sur "banane" tout court.
  //
  // Les aliases (resolved/pending) BOOSTENT le score : un alias exact
  // se voit attribuer score 0 (top), startsWith → 1, substring → 2.
  // Si le name a un meilleur score que l'alias, on prend le name.
  const score = (r: CiqualSearchResult): number => {
    const n = normalize(r.name);
    let nameScore: number;
    if (n === qNorm) nameScore = 0;
    else if (n.startsWith(qNorm + ',')) nameScore = 1;
    else if (n.startsWith(qNorm + ' ')) nameScore = 2;
    else if (n.startsWith(qNorm)) nameScore = 3;
    else if (wordRe.test(n)) nameScore = 4;
    else if (searchTokens.length > 1) nameScore = 5;
    else nameScore = 6;

    const aliasHit = aliasHitsByFoodId.get(r.id);
    if (!aliasHit) return nameScore;
    // Alias resolved = priorité absolue (Karine a validé).
    // Alias pending = légère pénalité (pas encore trié, peut être un conflit).
    const penalty = aliasHit.status === 'pending' ? 0.5 : 0;
    return Math.min(nameScore, aliasHit.aliasScore + penalty);
  };

  allRows.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name.localeCompare(b.name, 'fr');
  });

  return allRows.slice(0, limit);
}
