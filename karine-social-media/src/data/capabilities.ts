/**
 * Types et constantes du système de capabilities.
 *
 * 1 capability = 1 action utilisateur autorisée ou non au visiteur sans plan.
 * Les abonnés/patientes/admin ont TOUJOURS toutes les capabilities (ne pas
 * configurer pour eux : ils paient pour avoir tout).
 */

export type CapabilityKey =
  // Recettes
  | 'recipes.enter_section'
  | 'recipes.see_categories'
  | 'recipes.see_recipes_in_category'
  | 'recipes.open_recipe_detail'
  // Menu de la semaine
  | 'weekly_menu.enter_section'
  | 'weekly_menu.see_current_cover'
  | 'weekly_menu.navigate_weeks'
  | 'weekly_menu.open_detail'
  // Astuces
  | 'tips.enter_section'
  // Conseils
  | 'advice.enter_section'
  // Idées
  | 'ideas.submit'
  // Notifications
  | 'notifications.access';

export type Capability = {
  key: CapabilityKey;
  groupKey: string;
  groupLabel: string;
  label: string;
  description: string | null;
  allowedWithoutPlan: boolean;
  sortOrder: number;
};

/**
 * Pour le matching path → capability dans le proxy/middleware.
 * On distingue les catégories statiques (whitelist) du détail dynamique.
 */
export const RECIPE_CATEGORY_SLUGS = [
  'petits-dejeuners',
  'entrees',
  'plats',
  'desserts',
  'salades',
  'boissons',
  'aperos-dinatoires',
  'gouters',
  'sauces',
  'repas-de-fete',
] as const;

export type RecipeCategorySlug = (typeof RECIPE_CATEGORY_SLUGS)[number];
