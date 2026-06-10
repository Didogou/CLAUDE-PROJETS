'use client';

import Link from 'next/link';
import { Flame } from 'lucide-react';

/**
 * Bouton rond "Mon suivi calorique".
 *
 * Toujours affiché si la feature calorie est activée globalement —
 * y compris pour les visiteurs non connectés et les utilisatrices
 * sans abonnement. L'apparence est identique dans tous les cas
 * (icône Flame coral cerclée), seul le comportement au clic change :
 *
 *  - 'sheet' : ouvre la sheet calorie V2 (utilisatrice abonnée/patiente)
 *  - 'login' : navigue vers /login?next=/ (visiteuse non connectée)
 *  - 'plan'  : navigue vers /mon-plan (connectée mais sans abonnement)
 *
 * Cette uniformité visuelle évite que l'icône "apparaisse/disparaisse"
 * selon le statut, ce qui était discriminant pour les nouvelles
 * visiteuses.
 */
export function TrackingPill({
  behavior = 'sheet',
}: {
  behavior?: 'sheet' | 'login' | 'plan';
  /** @deprecated — le contrôle accès est désormais géré par la page
   *  /mes-calories elle-même. La prop est conservée pour back-compat
   *  des appels existants (ignorée). */
  canEdit?: boolean;
} = {}) {
  // Taille legerement augmentee (h-9 vs h-8, flamme h-5 vs h-4) +
  // pulse-soft pour signaler que c'est une action vivante (clic =
  // ouvrir le tracker calorique).
  const className =
    'anim-pulse-soft grid h-9 w-9 place-items-center rounded-full bg-white text-coral shadow-md ring-2 ring-coral transition hover:scale-105 active:scale-95';
  const icon = <Flame className="h-5 w-5 fill-coral" strokeWidth={2} />;

  if (behavior === 'login') {
    return (
      <Link
        href="/login?next=/"
        aria-label="Mon suivi nutritionnel — connecte-toi pour activer"
        className={className}
      >
        {icon}
      </Link>
    );
  }

  if (behavior === 'plan') {
    return (
      <Link
        href="/mon-plan"
        aria-label="Mon suivi nutritionnel — réservé aux abonnées"
        className={className}
      >
        {icon}
      </Link>
    );
  }

  // Mode 'sheet' (utilisatrice connectée + abonnée) : on ouvre maintenant
  // la PAGE /mes-calories au lieu d'une sheet modale, pour contourner
  // les bugs WebKit iOS sur les `position: fixed` portés dans body
  // (cf. agent diag 2026-06-07 + decision 2026-06-07 phase 1).
  // La prop `canEdit` n'a plus besoin d'être transmise — la page gère
  // ce check via la session côté server component.
  return (
    <Link
      href="/mes-calories"
      aria-label="Mon suivi nutritionnel"
      className={className}
    >
      {icon}
    </Link>
  );
}
