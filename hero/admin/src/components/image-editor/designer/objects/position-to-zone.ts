/**
 * Convertit une position normalized (0..1) en label de zone Kontext.
 *
 * Découpe le canvas en 9 zones (3×3 grille) et retourne une instruction
 * de placement utilisable dans le prompt Flux Kontext / Qwen Edit.
 *
 * Refonte Objet 2026-05-12. Option B (spatial reasoning via scene_analyses)
 * sera ajoutée plus tard pour des hints plus précis ("on the desk").
 */

export type ZoneKey =
  | 'top-left'    | 'top-center'    | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

const ZONE_LABELS_EN: Record<ZoneKey, string> = {
  'top-left':      'in the upper-left area',
  'top-center':    'in the upper-center area',
  'top-right':     'in the upper-right area',
  'middle-left':   'in the middle-left area',
  'middle-center': 'in the center',
  'middle-right':  'in the middle-right area',
  'bottom-left':   'in the lower-left area',
  'bottom-center': 'in the lower-center area',
  'bottom-right':  'in the lower-right area',
}

const ZONE_LABELS_FR: Record<ZoneKey, string> = {
  'top-left':      'en haut à gauche',
  'top-center':    'en haut au centre',
  'top-right':     'en haut à droite',
  'middle-left':   'au milieu à gauche',
  'middle-center': 'au centre',
  'middle-right':  'au milieu à droite',
  'bottom-left':   'en bas à gauche',
  'bottom-center': 'en bas au centre',
  'bottom-right':  'en bas à droite',
}

/** Découpe en 9 zones — 0..1/3 = première colonne/ligne, etc. */
export function positionToZone(x: number, y: number): ZoneKey {
  const cx = x < 1 / 3 ? 'left' : x < 2 / 3 ? 'center' : 'right'
  const cy = y < 1 / 3 ? 'top' : y < 2 / 3 ? 'middle' : 'bottom'
  return `${cy}-${cx}` as ZoneKey
}

export function zoneLabelEn(zone: ZoneKey): string {
  return ZONE_LABELS_EN[zone]
}

export function zoneLabelFr(zone: ZoneKey): string {
  return ZONE_LABELS_FR[zone]
}
