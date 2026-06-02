'use client';

import { useEffect } from 'react';
import { trackView, type RecentViewType } from '@/lib/recent-views';

/**
 * Composant invisible à placer sur les pages détail (recette, astuce,
 * conseil, menu) pour enregistrer la visite dans l'historique local.
 *
 * Usage :
 *   <TrackView type="recipe" id={slug} label={title} imageUrl={cover} href={`/recettes/${slug}`} />
 */
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
    trackView({ type, id, label, imageUrl, href });
  }, [type, id, label, imageUrl, href]);

  return null;
}
