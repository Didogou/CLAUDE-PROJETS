'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Flame } from 'lucide-react';
import { CalorieCounterSheetV2 } from './CalorieCounterSheetV2';

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
  canEdit = true,
}: {
  behavior?: 'sheet' | 'login' | 'plan';
  /** Passé à CalorieCounterSheetV2 : si false, les boutons d'ajout
   *  de repas / eau sont remplacés par un CTA "S'abonner". */
  canEdit?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);

  const className =
    'grid h-8 w-8 place-items-center rounded-full bg-white text-coral shadow-md ring-2 ring-coral transition hover:scale-105 active:scale-95';
  const icon = <Flame className="h-4 w-4 fill-coral" strokeWidth={2} />;

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mon suivi nutritionnel"
        className={className}
      >
        {icon}
      </button>

      {open && (
        <CalorieCounterSheetV2
          onClose={() => setOpen(false)}
          onChanged={() => {}}
          canEdit={canEdit}
        />
      )}
    </>
  );
}
