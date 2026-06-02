'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Petit hook réutilisable pour animer ouverture/fermeture d'une lightbox.
 *
 *  - `phase` vaut 'enter' au mount, 'exit' quand on lance la fermeture.
 *  - `requestClose()` déclenche la phase 'exit' puis appelle `onClose`
 *    après la durée d'animation pour démonter proprement.
 *
 * Utilisé par les classes CSS .ie-lightbox-in / .ie-lightbox-out
 * (définies dans globals.css) — voir SaviezVousLightbox, TipDetailModal,
 * et les 2 lightbox de RecipeDetailView.
 */
export type LightboxPhase = 'enter' | 'exit';

const EXIT_DURATION_MS = 240;

export function useLightboxAnim(onClose: () => void): {
  phase: LightboxPhase;
  requestClose: () => void;
} {
  const [phase, setPhase] = useState<LightboxPhase>('enter');

  const requestClose = useCallback(() => {
    setPhase('exit');
    window.setTimeout(onClose, EXIT_DURATION_MS);
  }, [onClose]);

  // Escape déclenche le requestClose pour passer par l'anim de sortie
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return { phase, requestClose };
}
