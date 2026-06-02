import { RECIPE_CATEGORY_SLUGS, type CapabilityKey } from '@/data/capabilities';

/**
 * Mapping pur d'un path concret vers la capability qu'il consomme.
 * Retourne null si le path n'est protégé par aucune capability (= ouvert
 * à tous : home, /mon-plan, /profil, pages d'auth, etc.).
 *
 * Utilisé par le proxy/middleware (pour rediriger les visiteurs sans accès)
 * ET par la home (pour afficher un cadenas sur les tuiles inaccessibles).
 *
 *   /recettes              → recipes.enter_section
 *   /recettes/<category>   → recipes.see_recipes_in_category   (whitelist)
 *   /recettes/<other>      → recipes.open_recipe_detail
 *   /menus                 → weekly_menu.enter_section
 *   /menus/<id>            → weekly_menu.open_detail
 *   /astuces[/...]         → tips.enter_section
 *   /conseils[/...]        → advice.enter_section
 *   /notifications         → notifications.access
 */
export function pathToCapability(pathname: string): CapabilityKey | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const segments = clean.split('/').filter(Boolean);

  if (segments[0] === 'recettes') {
    if (segments.length === 1) return 'recipes.enter_section';
    const sub = segments[1];
    if ((RECIPE_CATEGORY_SLUGS as readonly string[]).includes(sub)) {
      return 'recipes.see_recipes_in_category';
    }
    return 'recipes.open_recipe_detail';
  }

  if (segments[0] === 'menus') {
    if (segments.length === 1) return 'weekly_menu.enter_section';
    return 'weekly_menu.open_detail';
  }

  if (segments[0] === 'astuces') return 'tips.enter_section';
  if (segments[0] === 'conseils') return 'advice.enter_section';
  if (segments[0] === 'notifications') return 'notifications.access';

  return null;
}
