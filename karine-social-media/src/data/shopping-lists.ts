/**
 * Types de la liste de courses V2 — user-scopée, persistée en DB,
 * agrégeant les recettes choisies + le menu de la semaine + les ajouts
 * manuels.
 *
 * Distinct de `ShoppingListItem` (data/menus.ts) qui décrit la liste
 * STATIQUE attachée à un menu (extraite par Vision côté admin).
 */

/** Origine d'une contribution à un item de la liste. */
export type ShoppingItemSource =
  | {
      type: 'sheet';
      /** UUID stable de la fiche détaillée (recipe_sheets.id). */
      sheetId: string;
      /** Slug de la recette mère, pour reconstruire l'URL. */
      recipeSlug: string;
      /** Titre de la fiche au moment de l'ajout (snapshot). */
      sheetTitle: string;
    }
  | { type: 'menu'; menuId: string; menuTitle: string | null }
  | { type: 'manual' };

/** Une contribution d'une source à un item. */
export type ShoppingItemContribution = {
  source: ShoppingItemSource;
  /** Quantité apportée par cette source. null si sans quantité (ex: huile d'olive, sel). */
  quantity: number | null;
};

/** Un item de la liste de courses V2. */
export type ShoppingListV2Item = {
  /** Dedup key stable (e.g. "épicerie|huile d'olive" lowercase). */
  key: string;
  category: string;
  label: string;
  unit: string | null;
  note: string | null;
  /** Somme des contributions. null = sans quantité (item présent mais pas de qté à afficher). */
  totalQuantity: number | null;
  checked: boolean;
  /** Traçabilité pour pouvoir retirer les contributions d'une recette. */
  contributions: ShoppingItemContribution[];
};

/** Référence à une fiche détaillée (sheet) ajoutée à la liste.
 *
 *  Nommée "LinkedRecipe" pour rétrocompat des champs DB (le JSON
 *  reste stocké dans `linked_recipes` en DB) mais sémantiquement c'est
 *  une référence vers une recipe_sheet.
 */
export type ShoppingListLinkedRecipe = {
  /** sheet id (UUID recipe_sheets.id). */
  sheetId: string;
  /** slug de la recette mère (pour URL /recettes/[slug]). */
  recipeSlug: string;
  /** Titre snapshot de la sheet au moment de l'ajout. */
  sheetTitle: string;
  /** Image snapshot de la sheet au moment de l'ajout. */
  sheetCoverUrl: string | null;
  addedAt: string;
};

/** La liste de courses complète, telle que renvoyée par l'API. */
export type ShoppingListV2 = {
  id: string;
  userId: string;
  name: string;
  status: 'active' | 'archived';
  linkedMenuId: string | null;
  linkedRecipes: ShoppingListLinkedRecipe[];
  items: ShoppingListV2Item[];
  createdAt: string;
  archivedAt: string | null;
  updatedAt: string;
};

/** Calcule la clé de dédup pour un item. Stable tant que category+label
 *  ne changent pas (lowercase, trim). */
export function itemDedupKey(category: string, label: string): string {
  return `${category}|${label}`.toLowerCase().trim();
}
