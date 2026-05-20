/**
 * Types + moteur d'interpolation pour les keyframes runtime des pellicules.
 *
 * Phase B du chantier keyframes 2026-05-18 (migration 089).
 *
 * Modèle : array de keyframes triés par `t` croissant. Chaque keyframe pose
 * des valeurs CIBLES sur certaines props (toutes optionnelles — props non
 * définies = héritent du keyframe précédent ou de la valeur par défaut).
 *
 * Interpolation : entre keyframe N et N+1, on calcule t-relatif (0→1), on
 * applique l'easing pour obtenir un facteur, puis on lerp chaque prop.
 *
 * Easing : 4 presets (linear / ease-in / ease-out / ease-in-out) qui suivent
 * les conventions CSS cubic-bezier standard.
 */

export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

/** Une keyframe au temps `t` (ms relatif au début de la pellicule).
 *  Tous les props sont optionnels : on n'anime que ce qu'on déclare. */
export interface PelliculeKeyframe {
  t: number  // ms relatif au début pellicule
  props: {
    position_x?: number  // % canvas (translate X), default 0 = pas de décalage
    position_y?: number  // % canvas (translate Y), default 0
    scale?: number       // facteur d'échelle, default 1.0
    opacity?: number     // 0-1, default 1.0
    rotation?: number    // degrés, default 0
  }
  /** Easing appliqué entre CE keyframe et le SUIVANT (le dernier keyframe
   *  n'utilise pas son easing). Default 'linear'. */
  easing?: KeyframeEasing
}

/** Valeurs par défaut quand aucun keyframe ne définit la prop. */
export const KEYFRAME_DEFAULTS = {
  position_x: 0,
  position_y: 0,
  scale: 1.0,
  opacity: 1.0,
  rotation: 0,
} as const

/** Valeurs interpolées à un instant donné (= ce que le runtime applique). */
export interface InterpolatedKeyframeState {
  position_x: number
  position_y: number
  scale: number
  opacity: number
  rotation: number
}

// ── Easing functions ────────────────────────────────────────────────────

/** Applique l'easing au facteur t (0-1). Implémentations cubic-bezier
 *  équivalentes aux presets CSS standards. */
export function applyEasing(t: number, easing: KeyframeEasing = 'linear'): number {
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      // cubic-bezier(0.42, 0, 1, 1) ≈ t * t * (2 - t) approximation simple
      return t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t)
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
  }
}

// ── Interpolation engine ────────────────────────────────────────────────

/** Calcule l'état interpolé à `cursorMs` (relatif au début de la pellicule).
 *  Retourne null si pas de keyframes (= rendu statique).
 *  Hors borne : avant le 1er kf = valeurs du 1er kf ; après le dernier =
 *  valeurs du dernier. */
export function interpolateKeyframes(
  keyframes: PelliculeKeyframe[] | null | undefined,
  cursorMs: number,
): InterpolatedKeyframeState | null {
  if (!keyframes || keyframes.length === 0) return null
  // S'assurer que c'est trié par t
  const sorted = [...keyframes].sort((a, b) => a.t - b.t)

  // Avant le 1er
  if (cursorMs <= sorted[0].t) {
    return resolveProps(sorted[0].props, null)
  }
  // Après le dernier
  if (cursorMs >= sorted[sorted.length - 1].t) {
    return resolveProps(sorted[sorted.length - 1].props, null)
  }

  // Trouve le segment [kfA, kfB] qui contient cursorMs
  for (let i = 0; i < sorted.length - 1; i++) {
    const kfA = sorted[i]
    const kfB = sorted[i + 1]
    if (cursorMs >= kfA.t && cursorMs <= kfB.t) {
      const span = kfB.t - kfA.t
      const tRel = span > 0 ? (cursorMs - kfA.t) / span : 0
      const tEased = applyEasing(tRel, kfA.easing ?? 'linear')
      // Pour chaque prop, on prend la valeur de A (ou défaut si A ne la définit
      // pas) et on lerp vers la valeur de B (ou défaut).
      return {
        position_x: lerp(getProp(kfA, 'position_x'), getProp(kfB, 'position_x'), tEased),
        position_y: lerp(getProp(kfA, 'position_y'), getProp(kfB, 'position_y'), tEased),
        scale:      lerp(getProp(kfA, 'scale'),      getProp(kfB, 'scale'),      tEased),
        opacity:    lerp(getProp(kfA, 'opacity'),    getProp(kfB, 'opacity'),    tEased),
        rotation:   lerp(getProp(kfA, 'rotation'),   getProp(kfB, 'rotation'),   tEased),
      }
    }
  }
  // Théoriquement inaccessible (les checks de bord couvrent tout)
  return resolveProps(sorted[sorted.length - 1].props, null)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function getProp(kf: PelliculeKeyframe, key: keyof typeof KEYFRAME_DEFAULTS): number {
  const v = kf.props[key]
  return typeof v === 'number' ? v : KEYFRAME_DEFAULTS[key]
}

function resolveProps(
  props: PelliculeKeyframe['props'],
  _prev: InterpolatedKeyframeState | null,
): InterpolatedKeyframeState {
  return {
    position_x: props.position_x ?? KEYFRAME_DEFAULTS.position_x,
    position_y: props.position_y ?? KEYFRAME_DEFAULTS.position_y,
    scale:      props.scale      ?? KEYFRAME_DEFAULTS.scale,
    opacity:    props.opacity    ?? KEYFRAME_DEFAULTS.opacity,
    rotation:   props.rotation   ?? KEYFRAME_DEFAULTS.rotation,
  }
}

/** Construit une string CSS transform depuis un état interpolé. */
export function keyframeStateToCssTransform(s: InterpolatedKeyframeState): string {
  const parts: string[] = []
  if (s.position_x !== 0 || s.position_y !== 0) {
    parts.push(`translate(${s.position_x}%, ${s.position_y}%)`)
  }
  if (s.scale !== 1) {
    parts.push(`scale(${s.scale})`)
  }
  if (s.rotation !== 0) {
    parts.push(`rotate(${s.rotation}deg)`)
  }
  return parts.join(' ') || 'none'
}
