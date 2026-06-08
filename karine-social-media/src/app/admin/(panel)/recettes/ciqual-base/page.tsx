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
  const linkedIds = new Set<number>();
  // Source A : recipes
  const recipesAUsage = new Map<number, number>();
  const { data: recipeSheets } = await supa
    .from('recipe_sheets')
    .select('ingredients');
  for (const sh of (recipeSheets ?? []) as Array<{ ingredients: any[] }>) {
    const ings = Array.isArray(sh.ingredients) ? sh.ingredients : [];
    for (const ing of ings) {
      const id = typeof ing.ciqual_food_id === 'number' ? ing.ciqual_food_id : null;
      if (id === null) continue;
      linkedIds.add(id);
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
      const id = typeof ing.ciqual_food_id === 'number' ? ing.ciqual_food_id : null;
      if (id === null) continue;
      linkedIds.add(id);
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
    linkedIds.add(idNum);
    scansUsage.set(idNum, (scansUsage.get(idNum) ?? 0) + 1);
  }

  if (linkedIds.size === 0) {
    return (
      <CiqualBaseReport entries={[]} totalCiqual={0} />
    );
  }

  // 2. Fetch les Ciqual concernés (1 query IN, peut être splittée si > 1000)
  const idArr = Array.from(linkedIds);
  const ciqualMap = new Map<number, any>();
  // PostgREST IN ne supporte pas plus de quelques milliers d'ids → on
  // batche par 500 pour être prudent.
  for (let i = 0; i < idArr.length; i += 500) {
    const slice = idArr.slice(i, i + 500);
    const { data } = await supa
      .from('ciqual_foods')
      .select(
        'id, name, group_name, subgroup_name, image_url, avg_unit_weight_g, avg_unit_weight_source',
      )
      .in('id', slice);
    for (const c of (data ?? []) as any[]) {
      ciqualMap.set(Number(c.id), c);
    }
  }

  // 3. Fetch les alias (status='resolved' uniquement — les pending et
  //    rejected ne participent pas à la prod).
  const aliasesByCiqual = new Map<number, string[]>();
  for (let i = 0; i < idArr.length; i += 500) {
    const slice = idArr.slice(i, i + 500);
    const { data } = await supa
      .from('ciqual_aliases')
      .select('ciqual_id, alias_display, status')
      .in('ciqual_id', slice)
      .eq('status', 'resolved');
    for (const a of (data ?? []) as Array<{ ciqual_id: number; alias_display: string }>) {
      const arr = aliasesByCiqual.get(Number(a.ciqual_id)) ?? [];
      arr.push(a.alias_display);
      aliasesByCiqual.set(Number(a.ciqual_id), arr);
    }
  }

  // 4. Total Ciqual pour ratio (référence sur les ~3500)
  const { count: totalCiqual } = await supa
    .from('ciqual_foods')
    .select('id', { count: 'exact', head: true });

  // 5. Construit les entrées + tri par groupe puis nom
  const entries: CiqualBaseEntry[] = [];
  for (const id of linkedIds) {
    const c = ciqualMap.get(id);
    if (!c) continue;
    const w = c.avg_unit_weight_g;
    entries.push({
      id,
      name: c.name ?? '',
      groupName: c.group_name ?? null,
      subgroupName: c.subgroup_name ?? null,
      imageUrl: c.image_url ?? null,
      // Le sentinel 0.0001 = "1 unité n'a pas de sens" (huile, sel) → on
      // affiche "N/A" plutôt qu'une valeur bidon.
      avgUnitWeightG: typeof w === 'number' && w > 0.01 ? Number(w) : null,
      avgUnitWeightSource: c.avg_unit_weight_source ?? null,
      aliases: aliasesByCiqual.get(id) ?? [],
      usage: {
        recipes: recipesAUsage.get(id) ?? 0,
        menus: menusUsage.get(id) ?? 0,
        userScans: scansUsage.get(id) ?? 0,
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
    <CiqualBaseReport
      entries={entries}
      totalCiqual={totalCiqual ?? 0}
    />
  );
}
