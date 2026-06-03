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
  | { type: 'recipe'; recipeId: string; recipeTitle: string }
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

/** Référence à une recette ajoutée à la liste. */
export type ShoppingListLinkedRecipe = {
  recipeId: string;
  recipeTitle: string;
  recipeCoverUrl: string | null;
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
