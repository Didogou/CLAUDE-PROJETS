/**
 * Clés de la matrice 2×2 des vues d'un personnage.
 *
 *   - portrait_gray    → IPAdapter FaceID + fiche compacte
 *   - portrait_scenic  → carte joueur immersive
 *   - fullbody_gray    → IPAdapter ref forte + fiche complète
 *   - fullbody_scenic  → image directe pour un plan
 *
 * Mapping vers les colonnes Npc :
 *   portrait_gray    → portrait_url
 *   portrait_scenic  → portrait_scenic_url
 *   fullbody_gray    → fullbody_gray_url
 *   fullbody_scenic  → fullbody_scenic_url
 */
export type CharacterVariantKey =
  | 'portrait_gray'
  | 'portrait_scenic'
  | 'fullbody_gray'
  | 'fullbody_scenic'

export const VARIANT_LABELS: Record<CharacterVariantKey, string> = {
  portrait_gray: 'Portrait fond gris',
  portrait_scenic: 'Portrait avec décor',
  fullbody_gray: 'Plein-pied fond gris',
  fullbody_scenic: 'Plein-pied avec décor',
}

export const VARIANT_NPC_FIELD: Record<CharacterVariantKey, 'portrait_url' | 'portrait_scenic_url' | 'fullbody_gray_url' | 'fullbody_scenic_url'> = {
  portrait_gray: 'portrait_url',
  portrait_scenic: 'portrait_scenic_url',
  fullbody_gray: 'fullbody_gray_url',
  fullbody_scenic: 'fullbody_scenic_url',
}

export const VARIANT_USAGE: Record<CharacterVariantKey, string> = {
  portrait_gray: 'Référence IPAdapter FaceID + fiche compacte',
  portrait_scenic: 'Carte joueur immersive',
  fullbody_gray: 'Référence IPAdapter forte + fiche complète',
  fullbody_scenic: 'Image directe pour un plan',
}
