'use client';

import { useState } from 'react';
import { Flame } from 'lucide-react';
import { CalorieCounterSheetV2 } from './CalorieCounterSheetV2';

/**
 * Bouton rond "Mon suivi" — style identique au Bell des notifications.
 * Icône Flame coral dans un cercle blanc translucide. Au clic, ouvre
 * la sheet calorie V2 (incluant la section Eau).
 *
 * Placé dans le header sur la même ligne que Bell, juste à gauche.
 */
export function TrackingPill() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mon suivi nutritionnel"
        className="grid h-10 w-10 place-items-center rounded-full bg-white text-coral shadow-md ring-2 ring-coral transition hover:scale-105 active:scale-95"
      >
        <Flame className="h-5 w-5 fill-coral" strokeWidth={2} />
      </button>

      {open && (
        <CalorieCounterSheetV2
          onClose={() => setOpen(false)}
          onChanged={() => {}}
        />
      )}
    </>
  );
}
