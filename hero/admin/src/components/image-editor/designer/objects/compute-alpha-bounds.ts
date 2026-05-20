/**
 * Calcule la bbox (bounding box) du contenu non-transparent d'un PNG.
 *
 * Sert à :
 *  - Définir la zone cliquable runtime d'un objet positionné (refonte
 *    Objet 2026-05-12, spec : "click_bounds = bbox auto du PNG via alpha").
 *  - Permettre des positionnements / déplacements précis du calque transparent.
 *
 * Retourne les bounds en coordonnées normalisées 0..1 (= % de la largeur/
 * hauteur de l'image source).
 */

interface ComputeAlphaBoundsOptions {
  /** URL HTTPS du PNG transparent à analyser. */
  imageUrl: string
  /** Seuil alpha au-dessus duquel un pixel est "non transparent" (0..255).
   *  Défaut 16 (≈ 6%) — exclut les pixels presque-vides issus de l'anti-aliasing. */
  alphaThreshold?: number
}

export interface AlphaBounds {
  /** x du coin haut-gauche, normalized 0..1. */
  x: number
  /** y du coin haut-gauche, normalized 0..1. */
  y: number
  /** Largeur, normalized 0..1. */
  w: number
  /** Hauteur, normalized 0..1. */
  h: number
}

/** Charge une image cross-origin via <Image>. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${url.slice(0, 100)}`))
    img.src = url
  })
}

/**
 * Scan le canal alpha pour trouver minX/minY/maxX/maxY des pixels visibles.
 * Si aucun pixel non-transparent → retourne null.
 */
export async function computeAlphaBounds(opts: ComputeAlphaBoundsOptions): Promise<AlphaBounds | null> {
  const { imageUrl, alphaThreshold = 16 } = opts
  const img = await loadImage(imageUrl)
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w === 0 || h === 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data  // Uint8ClampedArray RGBA

  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]
      if (a > alphaThreshold) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null  // entièrement transparent

  return {
    x: minX / w,
    y: minY / h,
    w: (maxX - minX + 1) / w,
    h: (maxY - minY + 1) / h,
  }
}
