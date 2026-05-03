/**
 * Conversions entre coordonnées sphériques (theta/phi) et pixels dans l'image.
 *
 * Pour les plans standards : on traite x/y comme des pourcentages relatifs
 *   (theta ∈ [0, 360] mappe à x ∈ [0, panoW], phi ∈ [-90, 90] mappe à y)
 * ce qui permet d'utiliser le même modèle de données pour les plans 2D et
 * les panoramas 360°. Pour un plan 2D, seuls les placements avec theta entre
 * 0 et 360 et phi entre -90 et 90 sont valides (aucune contrainte de wrap).
 */

export function sphericalToPx(
  theta: number,
  phi: number,
  panoW: number,
  panoH: number,
): { x: number; y: number } {
  const x = (theta / 360) * panoW
  const y = ((-phi / 180) + 0.5) * panoH
  return { x, y }
}

export function pxToSpherical(
  x: number,
  y: number,
  panoW: number,
  panoH: number,
): { theta: number; phi: number } {
  const theta = (x / panoW) * 360
  const phi = -((y / panoH) - 0.5) * 180
  return { theta, phi }
}

/**
 * Taille d'un sprite NPC en pixels sur l'image d'affichage.
 * Scale = 1 → ~10% de la hauteur de l'image = taille typique d'un perso.
 */
export function spritePxSize(scale: number, displayH: number): number {
  return displayH * 0.10 * scale
}
