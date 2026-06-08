'use client';

import { useEffect } from 'react';
import { trackView, type RecentViewType } from '@/lib/recent-views';

/**
 * Composant invisible à placer sur les pages détail (recette, astuce,
 * conseil, menu) pour enregistrer la visite.
 *
 *  - localStorage : historique perso "vues récentes" affiché à
 *    l'utilisatrice sur sa page accueil.
 *  - BDD page_views : analytics admin (top recettes/menus, ratio
 *    abonné/anonyme). Fire-and-forget, ne bloque pas le rendu.
 *
 * Usage :
 *   <TrackView type="recipe" id={slug} label={title} imageUrl={cover} href={`/recettes/${slug}`} />
 */

// Map type local → target_type BDD. Identiques sauf pour défense
// éventuelle (si on ajoute un type local non analytisé plus tard).
const TYPE_TO_TARGET: Record<RecentViewType, 'recipe' | 'menu' | 'tip' | 'advice'> = {
  recipe: 'recipe',
  menu: 'menu',
  tip: 'tip',
  advice: 'advice',
};

export function TrackView({
  type,
  id,
  label,
  imageUrl,
  href,
}: {
  type: RecentViewType;
  id: string;
  label: string;
  imageUrl: string | null;
  href: string;
}) {
  useEffect(() => {
    // 1. Historique perso (localStorage)
    trackView({ type, id, label, imageUrl, href });
    // 2. Analytics BDD (fire-and-forget). Try/catch implicite via .catch
    //    — aucun cas où on doit faire échouer le rendu de la page.
    void fetch('/api/track-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: href,
        targetType: TYPE_TO_TARGET[type],
        targetId: id,
        referrer: typeof document !== 'undefined' ? document.referrer || null : null,
      }),
      keepalive: true,
    }).catch(() => {
      /* tracking jamais bloquant */
    });
  }, [type, id, label, imageUrl, href]);

  return null;
}
