/**
 * Détection automatique des tags diététiques sur les ingrédients
 * d'une fiche détaillée (recipe_sheet).
 *
 * Approche : heuristique conservative par recherche de mots-clés
 * exclus avec word boundaries (\b) pour éviter les faux positifs
 * (« poireau » ≠ « porc », « farine de riz » ≠ « farine de blé »).
 *
 * Override admin : Karine peut forcer un tag à `true` ou `false` via
 * les colonnes `is_vegetarian_override` / `is_gluten_free_override`.
 * Si null → l'auto-détection ci-dessous s'applique.
 *
 * NB : la détection s'applique au niveau d'UNE fiche (sheet). Pour la
 * recette mère, on agrège : toutes les fiches doivent être OK pour
 * que le tag s'affiche sur la card de la recette mère.
 */

import type { RecipeIngredient } from '@/data/recipes';

// ============================================================
// VÉGÉTARIEN
// ============================================================
// Décision Didier 2026-06-11 : œufs EXCLUS (lacto-végétarien strict).
// Sucre, miel, laitages, fromage : OK.
// ============================================================

const NON_VEGETARIAN_PATTERNS: RegExp[] = [
  // Viandes
  /\bpoulet\b/i,
  /\bb(?:œ|oe)uf\b/i,
  /\bporc\b/i,
  /\bagneau\b/i,
  /\bveau\b/i,
  /\bjambon\b/i,
  /\bsaucisse(?:s)?\b/i,
  /\bsaucisson\b/i,
  /\blardon(?:s)?\b/i,
  /\blard\b/i,
  /\bbacon\b/i,
  /\bchorizo\b/i,
  /\bmerguez\b/i,
  /\bviande(?:s)?\b/i,
  /\bvolaille(?:s)?\b/i,
  /\bdinde\b/i,
  /\bcanard\b/i,
  /\bcaille\b/i,
  /\blapin\b/i,
  /\bgibier\b/i,
  /\bfoie\s+gras\b/i,
  /\bfoie\b/i,
  /\bandouillette(?:s)?\b/i,
  /\bboudin\b/i,
  /\brôti\b/i,
  /\bescalope(?:s)?\b/i,
  /\bsteak(?:s)?\b/i,
  /\bnuggets?\b/i,
  /\bcuisse(?:s)?\s+de\s+(?:poulet|dinde)\b/i,
  /\bfilet(?:s)?\s+de\s+(?:poulet|dinde|porc|b(?:œ|oe)uf|canard|veau)\b/i,
  /\bémincé(?:s)?\s+de\s+(?:poulet|dinde|porc|b(?:œ|oe)uf|veau)\b/i,
  /\bhaché(?:s)?\b/i, // viande hachée — détection large
  // Poissons
  /\bthon\b/i,
  /\bsaumon\b/i,
  /\bcabillaud\b/i,
  /\bmerlu(?:s)?\b/i,
  /\bmorue\b/i,
  /\bsardine(?:s)?\b/i,
  /\banchois\b/i,
  /\btruite(?:s)?\b/i,
  /\bpoisson(?:s)?\b/i,
  /\bharreng(?:s)?\b/i,
  /\bhareng(?:s)?\b/i,
  /\bmaquereau(?:x)?\b/i,
  /\bdorade(?:s)?\b/i,
  /\bbar\b/i,
  /\bturbot\b/i,
  /\bsole(?:s)?\b/i,
  /\braie(?:s)?\b/i,
  // Fruits de mer / crustacés
  /\bcrevette(?:s)?\b/i,
  /\bgambas\b/i,
  /\bmoule(?:s)?\b/i,
  /\bhuître(?:s)?\b/i,
  /\bcrabe(?:s)?\b/i,
  /\blangoustine(?:s)?\b/i,
  /\bhomard(?:s)?\b/i,
  /\blangouste(?:s)?\b/i,
  /\bcalamar(?:s)?\b/i,
  /\bcalmar(?:s)?\b/i,
  /\bseiche(?:s)?\b/i,
  /\bpoulpe(?:s)?\b/i,
  /\bencornet(?:s)?\b/i,
  /\bcoquille(?:s)?\s+saint[-\s]jacques\b/i,
  /\bpétoncle(?:s)?\b/i,
  /\bbulot(?:s)?\b/i,
  /\bbigorneau(?:x)?\b/i,
  /\bsurimi\b/i,
  // Œufs (décision Didier 2026-06-11)
  /\bœuf(?:s)?\b/i,
  /\boeuf(?:s)?\b/i,
  /\bjaune(?:s)?\s+d['']œuf\b/i,
  /\bjaune(?:s)?\s+d['']oeuf\b/i,
  /\bblanc(?:s)?\s+d['']œuf\b/i,
  /\bblanc(?:s)?\s+d['']oeuf\b/i,
  // Bouillons d'origine animale (large mais conservateur)
  /\bbouillon\s+de\s+(?:poulet|b(?:œ|oe)uf|volaille|viande|poisson)\b/i,
];

// ============================================================
// SANS GLUTEN
// ============================================================
// Stratégie : on cherche les céréales avec gluten + dérivés. On NE
// matche PAS « farine » seul (trop large : farine de riz/sarrasin OK).
// ============================================================

const GLUTEN_PATTERNS: RegExp[] = [
  // Blé et dérivés
  /\bblé(?:s)?\b/i,
  /\bfarine\s+de\s+blé\b/i,
  /\bfarine\s+t\d+\b/i, // T45, T55, T65, T80…
  /\bsemoule(?:s)?\s+de\s+blé\b/i,
  /\bsemoule(?:s)?\b/i,
  /\bboulgour\b/i,
  /\bcouscous\b/i,
  /\bpâte(?:s)?\b/i, // pâtes alimentaires (risque faux positifs : « pâte feuilletée » OK gluten quand même)
  /\bspaghetti(?:s)?\b/i,
  /\bmacaroni(?:s)?\b/i,
  /\btagliatelle(?:s)?\b/i,
  /\blasagne(?:s)?\b/i,
  /\bravioli(?:s)?\b/i,
  /\bgnocchi(?:s)?\b/i,
  /\btortellini(?:s)?\b/i,
  // Autres céréales avec gluten
  /\borge\b/i,
  /\bseigle\b/i,
  /\bépeautre\b/i,
  /\bkamut\b/i,
  /\btriticale\b/i,
  /\bavoine\b/i, // contamination croisée par défaut — sauf override admin
  // Produits boulangés
  /\bpain\b/i,
  /\bbaguette(?:s)?\b/i,
  /\bbiscotte(?:s)?\b/i,
  /\bchapelure(?:s)?\b/i,
  /\bcroûton(?:s)?\b/i,
  /\bpain\s+(?:de\s+mie|complet|aux\s+céréales|burger|hamburger|bagel)\b/i,
  /\bbrioche(?:s)?\b/i,
  /\bcroissant(?:s)?\b/i,
  /\bviennoiserie(?:s)?\b/i,
  /\bbiscuit(?:s)?\b/i,
  /\bgâteau(?:x)?\s+(?:nature|au\s+chocolat)\b/i, // gâteaux classiques
  /\bcracker(?:s)?\b/i,
  /\bgaufre(?:s)?\b/i,
  /\bcrêpe(?:s)?\b/i, // crêpes au blé sauf override
  /\bblini(?:s)?\b/i,
  /\bgalette(?:s)?\s+de\s+blé\b/i,
  // Sauces / autres
  /\bsauce\s+soja\b/i, // sauf tamari → admin override
  /\bsoja\s+sauce\b/i,
  /\bbière(?:s)?\b/i,
  /\bsoupe\s+miso\b/i, // sauf override
];

// ============================================================
// SANS PORC
// ============================================================
// Spécifique : Karine veut pouvoir filtrer les recettes sans porc
// (sans imposer le végétarisme — poulet, bœuf, poisson OK).
// ============================================================

const PORK_PATTERNS: RegExp[] = [
  /\bporc\b/i,
  /\bjambon\b/i,
  /\bsaucisse(?:s)?\b/i,
  /\bsaucisson(?:s)?\b/i,
  /\blardon(?:s)?\b/i,
  /\blard\b/i,
  /\bbacon\b/i,
  /\bchorizo\b/i,
  /\bchipolata(?:s)?\b/i,
  /\bandouillette(?:s)?\b/i,
  /\bandouille(?:s)?\b/i,
  /\bboudin(?:s)?\s+noir(?:s)?\b/i,
  /\bsalami\b/i,
  /\bmortadelle\b/i,
  /\bpancetta\b/i,
  /\bcoppa\b/i,
  /\brosette\b/i,
  /\bsaindoux\b/i,
  /\bcouenne(?:s)?\b/i,
  /\bpâté(?:s)?\b/i,
  /\brillette(?:s)?\b/i,
];

// ============================================================
// LOGIQUE COMMUNE
// ============================================================

/**
 * Vrai si AUCUN ingrédient ne matche un pattern d'exclusion.
 * Si la liste est vide → on ne tag pas (conservative).
 */
function noMatch(
  ingredients: RecipeIngredient[] | null | undefined,
  patterns: RegExp[],
): boolean {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return false;
  for (const ing of ingredients) {
    const label = ing.label ?? '';
    if (!label.trim()) continue;
    for (const re of patterns) {
      if (re.test(label)) return false;
    }
  }
  return true;
}

/** Détection automatique végétarien (lacto-végétarien strict : œufs exclus). */
export function isVegetarianAuto(
  ingredients: RecipeIngredient[] | null | undefined,
): boolean {
  return noMatch(ingredients, NON_VEGETARIAN_PATTERNS);
}

/** Détection automatique sans gluten. */
export function isGlutenFreeAuto(
  ingredients: RecipeIngredient[] | null | undefined,
): boolean {
  return noMatch(ingredients, GLUTEN_PATTERNS);
}

/** Détection automatique sans porc. */
export function isPorkFreeAuto(
  ingredients: RecipeIngredient[] | null | undefined,
): boolean {
  return noMatch(ingredients, PORK_PATTERNS);
}

/**
 * Combine override admin (true/false/null) avec la détection auto.
 * - override === true  → renvoie true (forcé OK)
 * - override === false → renvoie false (forcé exclu)
 * - override === null  → renvoie le résultat de l'auto-détection
 */
export function resolveDietaryTag(
  override: boolean | null | undefined,
  autoFn: () => boolean,
): boolean {
  if (override === true) return true;
  if (override === false) return false;
  return autoFn();
}

/** Compute les 3 tags effectifs pour une fiche (avec ses overrides). */
export function computeSheetDietaryTags(
  ingredients: RecipeIngredient[] | null | undefined,
  vegetarianOverride: boolean | null | undefined,
  glutenFreeOverride: boolean | null | undefined,
  porkFreeOverride?: boolean | null | undefined,
): {
  isVegetarian: boolean;
  isGlutenFree: boolean;
  isPorkFree: boolean;
} {
  return {
    isVegetarian: resolveDietaryTag(vegetarianOverride, () =>
      isVegetarianAuto(ingredients),
    ),
    isGlutenFree: resolveDietaryTag(glutenFreeOverride, () =>
      isGlutenFreeAuto(ingredients),
    ),
    isPorkFree: resolveDietaryTag(porkFreeOverride, () =>
      isPorkFreeAuto(ingredients),
    ),
  };
}
