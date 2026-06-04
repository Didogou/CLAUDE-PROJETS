import type { RecipeIngredient } from '@/data/recipes';

/**
 * Détecte les ingrédients "consommables de placard" (huile, sel,
 * épices, herbes…) — ils ne se scalent PAS quand on change le
 * nombre de personnes ("2x l'huile d'olive" ne veut rien dire).
 *
 * Doublé depuis shopping-lists.ts (server-only) — règle métier
 * commune mais on doit pouvoir l'utiliser côté client aussi.
 * Si la liste évolue, mettre à jour les deux.
 */
export function isPantryItem(ing: RecipeIngredient): boolean {
  if (ing.unit) {
    const u = ing.unit
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
    if (
      /^cs\b/.test(u) ||
      /^cc\b/.test(u) ||
      /^c\.?\s*a\.?\s*[sc]/.test(u) ||
      /^cuiller/.test(u) ||
      /^pinc/.test(u)
    ) {
      return true;
    }
  }
  const l = ing.label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const PANTRY_KEYWORDS = [
    'huile', 'vinaigre', 'sel', 'poivre', 'moutarde',
    'herbe', 'epice', 'paprika', 'curry', 'cumin', 'cannelle',
    'muscade', 'gingembre', 'curcuma', 'thym', 'romarin',
    'basilic', 'origan', 'persil', 'aneth', 'estragon',
    'farine', 'sucre', 'levure', 'bicarbonate',
    'miel', 'sirop', 'ketchup', 'sauce soja', 'sauce tomate',
  ];
  return PANTRY_KEYWORDS.some((k) => l.includes(k));
}

/**
 * Multiplie la quantité d'un ingrédient par un facteur de portions.
 * Les pantry items gardent leur quantité d'origine (ou null).
 *
 * Arrondi malin :
 *  - quantité finale < 1 : 1 décimale (0.5, 0.3…)
 *  - quantité entre 1 et 10 : 0.5 près (1.5, 2.5…)
 *  - quantité >= 10 : entier
 */
export function scaleIngredient(
  ing: RecipeIngredient,
  factor: number,
): RecipeIngredient {
  if (ing.quantity == null || isPantryItem(ing) || factor === 1) {
    return ing;
  }
  const raw = ing.quantity * factor;
  let q: number;
  if (raw < 1) {
    q = Math.round(raw * 10) / 10;
  } else if (raw < 10) {
    q = Math.round(raw * 2) / 2;
  } else {
    q = Math.round(raw);
  }
  return { ...ing, quantity: q };
}

/**
 * Scale tous les ingrédients d'une recette par un facteur portions.
 */
export function scaleIngredients(
  ingredients: RecipeIngredient[],
  factor: number,
): RecipeIngredient[] {
  if (factor === 1) return ingredients;
  return ingredients.map((i) => scaleIngredient(i, factor));
}
