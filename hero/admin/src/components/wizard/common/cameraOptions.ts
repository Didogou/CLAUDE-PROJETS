/**
 * Catalogues partagés pour les dropdowns "Cadrage" et "Angle / POV".
 *
 * Dimensions orthogonales :
 *   - Cadrage (framing) : distance sujet/caméra (plan large → très gros plan)
 *   - Angle / POV      : point de vue (de face, profil, plongée, ¾…)
 *
 * Les deux tags sont injectés en fin de prompt au moment de la génération.
 * Format anglais compris par Juggernaut/Animagine ; Pony reçoit une traduction
 * Danbooru via /api/translate-to-pony-tags sur le prompt composé final.
 */

export interface CameraOption {
  key: string
  label: string
  /** Tag positif ajouté au prompt. */
  tag: string
  /** Tags à ajouter au negative quand on "force" cet angle (anti-tags). */
  antiTags?: string
}

export const FRAMING_OPTIONS: CameraOption[] = [
  { key: '',              label: '— Cadrage par défaut —', tag: '' },
  { key: 'extreme_wide',  label: '🌍 Plan très large',      tag: 'extreme wide shot, vast panoramic view, subject tiny in environment',
    antiTags: 'close-up, extreme close-up, medium shot, portrait shot, tight crop, full body, bust shot' },
  { key: 'wide',          label: '🏞️ Plan large',           tag: 'wide establishing shot, full scene visible',
    antiTags: 'close-up, extreme close-up, macro shot, tight crop, portrait shot' },
  { key: 'long',          label: '🌄 Plan d\'ensemble',     tag: 'long shot, full figure with surrounding environment',
    antiTags: 'close-up, extreme close-up, medium shot, portrait shot, tight crop' },
  { key: 'medium',        label: '👤 Plan moyen',           tag: 'medium shot, character from waist up',
    antiTags: 'close-up, extreme close-up, wide shot, full body, long shot' },
  { key: 'closeup',       label: '🔍 Gros plan',            tag: 'close-up shot, face and shoulders',
    antiTags: 'wide shot, full body, long shot, establishing shot' },
  { key: 'extreme_close', label: '👁 Très gros plan',       tag: 'extreme close-up, eyes and face detail',
    antiTags: 'wide shot, full body, medium shot, long shot' },
  { key: 'cowboy',        label: '🤠 Plan américain',       tag: 'cowboy shot, from mid-thigh up',
    antiTags: 'close-up, full body, wide shot' },
  { key: 'full_body',     label: '🧍 Plein pied',            tag: 'full body shot, subject visible head to toes',
    antiTags: 'close-up, extreme close-up, portrait shot, bust shot, medium shot, cropped' },
]

export const POV_OPTIONS: CameraOption[] = [
  { key: '',              label: '— Angle par défaut —',   tag: '' },
  { key: 'front',         label: '⬛ De face',              tag: 'front view, facing camera directly',
    antiTags: 'from behind, back view, side profile, rear view' },
  { key: 'side',          label: '⏩ De profil',             tag: 'side profile view, subject facing sideways',
    antiTags: 'front view, back view, three quarter view' },
  { key: 'back',          label: '🔙 De dos',               tag: 'from behind, back view, rear perspective',
    antiTags: 'front view, facing camera, side profile' },
  { key: 'three_quarter', label: '↗ Trois-quarts',          tag: 'three quarter view, 45 degree angle',
    antiTags: 'front view, side profile, back view' },
  { key: 'low_angle',     label: '⬆ Contre-plongée',       tag: 'low angle shot looking up, dramatic upward perspective',
    antiTags: 'high angle, birds eye view, eye level, top-down, flat perspective' },
  { key: 'high_angle',    label: '⬇ Plongée',              tag: 'high angle shot looking down, bird perspective',
    antiTags: 'low angle, worms eye view, eye level, ground level perspective' },
  { key: 'birds_eye',     label: '🦅 Vue aérienne',         tag: 'birds eye view from above, top-down perspective, aerial view',
    antiTags: 'low angle, eye level, worms eye, side view, back view, front view, ground perspective, normal perspective' },
  { key: 'worms_eye',     label: '🐛 Vue rasante',          tag: 'worms eye view from ground level, very low perspective',
    antiTags: 'high angle, birds eye, eye level, top-down, aerial view' },
  { key: 'over_shoulder', label: '🎯 Par-dessus épaule',    tag: 'over the shoulder shot',
    antiTags: 'front view, full body' },
  { key: 'dutch',         label: '🎭 Plan incliné',          tag: 'dutch angle, tilted camera, dynamic composition',
    antiTags: 'straight angle, level horizon' },
  { key: 'eye_level',     label: '👁 Au niveau œil',        tag: 'eye level shot, neutral perspective',
    antiTags: 'high angle, low angle, birds eye view, worms eye view, top-down, tilted camera' },
]

/**
 * Compose le prompt en injectant les tags Cadrage + Angle.
 *
 *   - `force=false` (défaut) : tags en FIN de prompt, sans pondération.
 *     SDXL peut les ignorer si le reste du prompt est long.
 *   - `force=true`           : tags en DÉBUT de prompt avec pondération (:1.4),
 *     plus de poids pour vraiment imposer la caméra.
 */
export function composePromptWithCamera(
  basePrompt: string,
  framingKey: string,
  povKey: string,
  extraAddon?: string,
  force = false,
): string {
  const framing = FRAMING_OPTIONS.find(o => o.key === framingKey)?.tag
  const pov = POV_OPTIONS.find(o => o.key === povKey)?.tag
  const cameraTags: string[] = []
  if (framing) cameraTags.push(force ? `(${framing}:1.4)` : framing)
  if (pov)     cameraTags.push(force ? `(${pov}:1.4)` : pov)

  const parts: string[] = []
  if (force && cameraTags.length > 0) {
    // Tags en TÊTE pour max d'impact
    parts.push(...cameraTags, basePrompt)
  } else {
    // Tags en queue, pas de pondération
    parts.push(basePrompt, ...cameraTags)
  }
  if (extraAddon && extraAddon.trim()) parts.push(extraAddon.trim())
  return parts.join(', ')
}

/**
 * Renvoie les anti-tags à ajouter au prompt négatif pour pousser activement
 * l'angle/cadrage opposé. Utilisé uniquement en mode `force=true`.
 */
export function composeNegativeForCamera(framingKey: string, povKey: string, force: boolean): string {
  if (!force) return ''
  const parts: string[] = []
  const framingAnti = FRAMING_OPTIONS.find(o => o.key === framingKey)?.antiTags
  const povAnti = POV_OPTIONS.find(o => o.key === povKey)?.antiTags
  if (framingAnti) parts.push(framingAnti)
  if (povAnti)     parts.push(povAnti)
  return parts.join(', ')
}
