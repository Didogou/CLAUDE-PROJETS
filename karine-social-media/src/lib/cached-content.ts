import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getPublishedRecipesLite } from '@/lib/recipes';
import { getPublishedAdvice } from '@/lib/advice';
import { getPublishedTips } from '@/lib/tips';
import { getPublishedMenusLite } from '@/lib/menus';
import { getPublishedFeaturedPhotos } from '@/lib/featured-photos';

/**
 * Wrappers cachés pour les helpers de contenu publié.
 *
 * Pourquoi : audit perf 2026-06-12 — les pages publiques (`/recettes`,
 * `/conseils`, `/astuces`, `/menus`, `/`) sont en `force-dynamic`, donc
 * chaque hit déclenche un round-trip Supabase complet. Sur des pages
 * dont le contenu change 1-2× par semaine, c'est du gâchis.
 *
 * Stratégie : on cache les RESULTATS de ces helpers (qui ne dépendent
 * pas du user — ils renvoient le contenu PUBLIÉ pour tout le monde).
 * Le contexte user (favoris, likes-state) reste dynamique et hors-cache.
 *
 * Invalidation : les routes admin de publication/édition appellent
 * `revalidateTag('recipes' | 'tips' | 'advice' | 'menus')` après save.
 *
 * Cache : 60s par défaut (le contenu peut bouger via admin et on veut
 * voir le changement rapidement sans attendre 1 h). Au-delà, le tag
 * force le refresh dès qu'un admin publie.
 */

const CACHE_TTL = 60; // 1 min

export const getCachedPublishedRecipes = unstable_cache(
  async () => getPublishedRecipesLite(),
  ['cached-recipes-lite'],
  { revalidate: CACHE_TTL, tags: ['recipes'] },
);

export const getCachedPublishedAdvice = unstable_cache(
  async () => getPublishedAdvice(),
  ['cached-advice'],
  { revalidate: CACHE_TTL, tags: ['advice'] },
);

export const getCachedPublishedTips = unstable_cache(
  async () => getPublishedTips(),
  ['cached-tips'],
  { revalidate: CACHE_TTL, tags: ['tips'] },
);

export const getCachedPublishedMenus = unstable_cache(
  async () => getPublishedMenusLite(),
  ['cached-menus-lite'],
  { revalidate: CACHE_TTL, tags: ['menus'] },
);

export const getCachedFeaturedPhotos = unstable_cache(
  async () => getPublishedFeaturedPhotos(),
  ['cached-featured-photos'],
  { revalidate: CACHE_TTL, tags: ['featured-photos'] },
);

/**
 * Helpers d'invalidation à appeler dans les routes admin après
 * une opération qui modifie le contenu publié.
 *   - revalidateRecipes() : à appeler après POST/PATCH/DELETE recipe
 *     ou recipe_sheet
 *   - etc.
 */
// Next 16 : revalidateTag(tag, profile) — { expire: 0 } = invalidation
// immédiate (le prochain hit re-fetch).
const NOW = { expire: 0 };
export const revalidateRecipes = () => revalidateTag('recipes', NOW);
export const revalidateTips = () => revalidateTag('tips', NOW);
export const revalidateAdvice = () => revalidateTag('advice', NOW);
export const revalidateMenus = () => revalidateTag('menus', NOW);
export const revalidateFeaturedPhotos = () => revalidateTag('featured-photos', NOW);
