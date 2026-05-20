/**
 * Labels FR pour l'UI animation. Partagé entre AnimationTimeline (dropdowns
 * inline dans la cellule pellicule) et AnimationEditor (panneau en bas).
 *
 * ⚠ Les VALEURS d'enum (`wide`, `medium`, `static`…) sont mappées en EN dans
 * `src/lib/ltx-vantage-prompt.ts` (SHOT_PROMPT, CAMERA_PROMPT) — c'est cette
 * version EN qui part au modèle LTX.
 */

import type { Shot } from '@/components/image-editor/EditorStateContext'

/** Cadrage du plan — labels affichés en UI. */
export const SHOT_LABELS: Record<Shot['shot'], string> = {
  wide: 'Plan large',
  medium: 'Plan moyen',
  close_up: 'Gros plan',
  extreme_close_up: 'Très gros plan',
}

/** Mouvement caméra — labels affichés en UI. */
export const CAMERA_LABELS: Record<Shot['camera'], string> = {
  static: 'Caméra fixe',
  slow_zoom_in: 'Zoom avant lent',
  slow_zoom_out: 'Zoom arrière lent',
  pan_left: 'Panoramique gauche',
  pan_right: 'Panoramique droite',
  dolly_in: 'Travelling avant',
  dolly_out: 'Travelling arrière',
  handheld: 'Caméra portée',
}

/** Durées proposées (en secondes). LTX 2.3 sweet spot 3-8s. */
export const DURATION_OPTIONS: number[] = [3, 4, 5, 6, 7, 8]
