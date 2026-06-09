/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit-ciqual/list
 *
 * Retourne la liste DEDOUBLONNEE de tous les couples (ingredient →
 * ciqual) à auditer. Si "pepites de chocolat noir" → "Chocolat blanc"
 * apparait dans 5 recettes, on ne renvoie qu'UNE ligne avec le nombre
 * de recettes concernees + leurs titres. Mistral n'est interroge
 * qu'une seule fois par couple unique → economise du temps et des
 * requetes (Mistral free = 1 req/s strict).
 *
 * Cle de dedoublon : (ingredient_label_normalise, ciqual_id). La
 * normalisation est lower+trim pour ne pas distinguer "Bagel" et
 * "bagel".
 *
 * Output :
 *   { items: [{ key, ingredient_label, ciqual_id, ciqual_name,
 *               recipes: [{ id, title, sheet_index }, ...] }, ...] }
 */
export type AuditItem = {
  key: string;
  ingredient_label: string;
  ciqual_id: number;
  ciqual_name: string;
  recipes: Array<{ id: number; title: string; sheet_index: number }>;
};

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supa = createServiceClient() as any;

  // 1) Toutes les recettes (juste id + title)
  const { data: recipesRaw } = await supa
    .from('recipes')
    .select('id, title')
    .order('title', { ascending: true });
  const recipes = (recipesRaw ?? []) as Array<{ id: number; title: string }>;
  const recipeTitle = new Map<number, string>();
  for (const r of recipes) recipeTitle.set(r.id, r.title);

  // 2) Tous les sheets (avec leurs ingredients jsonb)
  const { data: sheetsRaw } = await supa
    .from('recipe_sheets')
    .select('recipe_id, sheet_index, ingredients');
  const sheets = (sheetsRaw ?? []) as Array<{
    recipe_id: number;
    sheet_index: number;
    ingredients: Array<{ label?: string; ciqual_food_id?: number }> | null;
  }>;

  // 3) On collecte les ciqual_food_id référencés pour aller chercher
  //    leur nom en une seule requête (paginée). PostgREST limite à
  //    1000 lignes par requête.
  const ciqualIds = new Set<number>();
  for (const s of sheets) {
    if (!Array.isArray(s.ingredients)) continue;
    for (const ing of s.ingredients) {
      if (typeof ing?.ciqual_food_id === 'number') ciqualIds.add(ing.ciqual_food_id);
    }
  }

  const ciqualName = new Map<number, string>();
  const idsArr = [...ciqualIds];
  const CHUNK = 500;
  for (let i = 0; i < idsArr.length; i += CHUNK) {
    const slice = idsArr.slice(i, i + CHUNK);
    const { data } = await supa
      .from('ciqual_foods')
      .select('id, name')
      .in('id', slice);
    for (const row of (data ?? []) as Array<{ id: number; name: string }>) {
      ciqualName.set(row.id, row.name);
    }
  }

  // 4) Aplatissement + DEDOUBLON sur (label_norm, ciqual_id).
  // On agrege les recettes concernees dans `recipes[]` pour pouvoir
  // afficher "5 recettes : Cookies, Banana bread, ..." cote UI.
  const normLabel = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
  const dedup = new Map<string, AuditItem>();
  for (const s of sheets) {
    const title = recipeTitle.get(s.recipe_id);
    if (!title) continue;
    if (!Array.isArray(s.ingredients)) continue;
    for (const ing of s.ingredients) {
      if (typeof ing?.ciqual_food_id !== 'number') continue;
      if (!ing.label) continue;
      const cname = ciqualName.get(ing.ciqual_food_id);
      if (!cname) continue;

      const key = `${normLabel(ing.label)}|${ing.ciqual_food_id}`;
      const existing = dedup.get(key);
      if (existing) {
        // Eviter d'ajouter 2 fois la meme recette (au cas ou plusieurs
        // sheets de la meme recette utilisent le meme couple)
        const alreadyIn = existing.recipes.some(
          (r) => r.id === s.recipe_id && r.sheet_index === s.sheet_index,
        );
        if (!alreadyIn) {
          existing.recipes.push({
            id: s.recipe_id,
            title,
            sheet_index: s.sheet_index,
          });
        }
      } else {
        dedup.set(key, {
          key,
          ingredient_label: ing.label,
          ciqual_id: ing.ciqual_food_id,
          ciqual_name: cname,
          recipes: [
            { id: s.recipe_id, title, sheet_index: s.sheet_index },
          ],
        });
      }
    }
  }

  // Tri : par label asc (utile pour voir les "banane*" groupees)
  const items = [...dedup.values()];
  items.sort((a, b) =>
    a.ingredient_label.localeCompare(b.ingredient_label, 'fr'),
  );

  return NextResponse.json({
    items,
    stats: {
      uniqueCount: items.length,
      totalOccurrences: items.reduce((sum, i) => sum + i.recipes.length, 0),
    },
  });
}
