/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServiceClient } from '@/lib/supabase/server';
import { CiqualBaseReport } from '@/components/admin/CiqualBaseReport';

export const dynamic = 'force-dynamic';

export type CiqualBaseEntry = {
  id: number;
  name: string;
  groupName: string | null;
  subgroupName: string | null;
  imageUrl: string | null;
  avgUnitWeightG: number | null;
  avgUnitWeightSource: 'mistral' | 'karine' | null;
  aliases: string[];
  /** True si l'aliment est reference au moins une fois (recette/menu/scan).
   *  False si on l'a charge depuis la base complete pour permettre
   *  d'ajouter un alias dessus alors qu'il n'est pas encore utilise. */
  isUsed: boolean;
  /** Compteurs d'usage : reflète d'où vient l'aliment dans l'écosystème. */
  usage: {
    recipes: number;
    menus: number;
    userScans: number;
  };
};

/**
 * Page admin /admin/recettes/ciqual-base — rapport de la "base de
 * connaissances Ciqual" effectivement utilisée par Karine + ses
 * abonnées. Permet à Karine de voir :
 *
 *   - Quels aliments sont référencés dans ses recettes/menus
 *   - Quels aliments ses abonnées scannent dans le calorie tracker
 *   - Quel est le poids unitaire connu (avg_unit_weight_g) + sa source
 *   - Quels alias en langage naturel pointent vers chaque aliment
 *   - Quelles vignettes sont disponibles
 *
 * Périmètre : uniquement les Ciqual UTILISÉS (≈ 200-300 entrées sur
 * les ~3500 totaux). C'est ce qui compte pour la gouvernance.
 */
export default async function CiqualBasePage() {
  const supa = createServiceClient() as any;

  // 1. Collecter les ciqual_food_id de toutes les sources
  // Clés = alim_code STABLE (ce que stockent désormais les ingrédients
  // et les scans food_log). Les alias, eux, restent indexés par id interne.
  const linkedCodes = new Set<number>();
  // Source A : recipes
  const recipesAUsage = new Map<number, number>();
  const { data: recipeSheets } = await supa
    .from('recipe_sheets')
    .select('ingredients');
  for (const sh of (recipeSheets ?? []) as Array<{ ingredients: any[] }>) {
    const ings = Array.isArray(sh.ingredients) ? sh.ingredients : [];
    for (const ing of ings) {
      const id = typeof ing.ciqual_alim_code === 'number' ? ing.ciqual_alim_code : null;
      if (id === null) continue;
      linkedCodes.add(id);
      recipesAUsage.set(id, (recipesAUsage.get(id) ?? 0) + 1);
    }
  }

  // Source B : menus
  const menusUsage = new Map<number, number>();
  const { data: mealSheets } = await supa
    .from('menu_meal_sheets')
    .select('ingredients');
  for (const sh of (mealSheets ?? []) as Array<{ ingredients: any[] }>) {
    const ings = Array.isArray(sh.ingredients) ? sh.ingredients : [];
    for (const ing of ings) {
      const id = typeof ing.ciqual_alim_code === 'number' ? ing.ciqual_alim_code : null;
      if (id === null) continue;
      linkedCodes.add(id);
      menusUsage.set(id, (menusUsage.get(id) ?? 0) + 1);
    }
  }

  // Source C : scans utilisateurs (food_log_entries.source='ciqual')
  const scansUsage = new Map<number, number>();
  const { data: scans } = await supa
    .from('food_log_entries')
    .select('source_ref_id')
    .eq('source', 'ciqual');
  for (const row of (scans ?? []) as Array<{ source_ref_id: string | null }>) {
    const idNum = row.source_ref_id ? Number(row.source_ref_id) : null;
    if (!idNum || Number.isNaN(idNum)) continue;
    linkedCodes.add(idNum);
    scansUsage.set(idNum, (scansUsage.get(idNum) ?? 0) + 1);
  }

  // 2. Fetch TOUS les Ciqual (paginé, ~3500). Necessaire pour permettre
  //    a Karine d'ajouter un alias sur un aliment qui n'est PAS encore
  //    utilise (ex. "Farine de blé tendre T150" qu'elle veut lier a
  //    l'alias "farine complete"). Le toggle UI permettra de filtrer
  //    sur les utilises seulement.
  const ciqualMap = new Map<number, any>();
  const PAGE = 1000;
  for (let offset = 0; offset < 10000; offset += PAGE) {
    const { data } = await supa
      .from('ciqual_foods')
      .select(
        'id, alim_code, name, group_name, subgroup_name, image_url, avg_unit_weight_g, avg_unit_weight_source',
      )
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    const arr = (data ?? []) as any[];
    if (arr.length === 0) break;
    for (const c of arr) ciqualMap.set(Number(c.id), c);
    if (arr.length < PAGE) break;
  }

  // 3. Fetch TOUS les alias (status='resolved') pour pouvoir afficher
  //    les badges sur les aliments non-utilises aussi.
  const aliasesByCiqual = new Map<number, string[]>();
  for (let offset = 0; offset < 100000; offset += PAGE) {
    const { data } = await supa
      .from('ciqual_aliases')
      .select('ciqual_id, alias_display, status')
      .eq('status', 'resolved')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    const arr = (data ?? []) as Array<{ ciqual_id: number; alias_display: string }>;
    if (arr.length === 0) break;
    for (const a of arr) {
      const list = aliasesByCiqual.get(Number(a.ciqual_id)) ?? [];
      list.push(a.alias_display);
      aliasesByCiqual.set(Number(a.ciqual_id), list);
    }
    if (arr.length < PAGE) break;
  }

  // 4. Total Ciqual pour ratio (référence sur les ~3500)
  const totalCiqual = ciqualMap.size;

  // 5. Construit les entrées + tri par groupe puis nom
  const entries: CiqualBaseEntry[] = [];
  for (const [id, c] of ciqualMap) {
    const w = c.avg_unit_weight_g;
    // Usage indexé par alim_code (clé des liens) ; alias par id interne.
    const code = Number(c.alim_code);
    entries.push({
      id,
      name: c.name ?? '',
      groupName: c.group_name ?? null,
      subgroupName: c.subgroup_name ?? null,
      imageUrl: c.image_url ?? null,
      avgUnitWeightG: typeof w === 'number' && w > 0.01 ? Number(w) : null,
      avgUnitWeightSource: c.avg_unit_weight_source ?? null,
      aliases: aliasesByCiqual.get(id) ?? [],
      isUsed: linkedCodes.has(code),
      usage: {
        recipes: recipesAUsage.get(code) ?? 0,
        menus: menusUsage.get(code) ?? 0,
        userScans: scansUsage.get(code) ?? 0,
      },
    });
  }
  entries.sort((a, b) => {
    const ga = a.groupName ?? '';
    const gb = b.groupName ?? '';
    if (ga !== gb) return ga.localeCompare(gb);
    return a.name.localeCompare(b.name);
  });

  return (
    <CiqualBaseReport entries={entries} totalCiqual={totalCiqual} />
  );
}
