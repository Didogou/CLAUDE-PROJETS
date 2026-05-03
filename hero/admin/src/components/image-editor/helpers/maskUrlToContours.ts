/**
 * Charge un mask PNG (noir/blanc, blanc = objet) et extrait ses contours
 * vectoriels via magic-wand-tool.
 *
 * Utilisé par SceneDetectionsOverlay pour rendre les contours des objets
 * pré-détectés sur le canvas (au lieu de simples bboxes rectangulaires).
 *
 * Retourne un tableau de contours en coordonnées normalisées 0-1 (relatives
 * au mask). Plusieurs contours possibles : objets en plusieurs morceaux
 * (ex: "throw pillows ×3" = 3 contours) ou avec trous (donut, fenêtre…).
 */

// @ts-expect-error : magic-wand-tool n'a pas de types officiels
import MagicWand from 'magic-wand-tool'
import type { MagicWandContour } from './magicWand'

interface MagicWandMaskInput {
  data: Uint8Array
  width: number
  height: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

// Cache : 1 mask URL → contours déjà extraits.
// Évite de recharger/re-décoder le PNG à chaque mount du composant.
const contoursCache = new Map<string, MagicWandContour[]>()

export function clearMaskContoursCache() {
  contoursCache.clear()
}

/**
 * Charge un mask PNG et retourne ses contours en coords 0-1.
 *
 * Lent au 1er appel (~200-500ms : fetch + decode + traceContours), instantané
 * ensuite (cache mémoire).
 */
export async function maskUrlToContours(maskUrl: string): Promise<MagicWandContour[]> {
  const cached = contoursCache.get(maskUrl)
  if (cached) return cached

  // 1. Charge l'image
  const img = await loadImage(maskUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight
  if (W === 0 || H === 0) return []

  // 2. Décode en pixels via canvas
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, W, H)
  const px = imageData.data

  // 3. Construit le mask binaire (1 = pixel blanc, 0 = noir)
  //    Et calcule les bounds en passant pour magic-wand-tool.
  const mask = new Uint8Array(W * H)
  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) {
    const rowStart = y * W
    for (let x = 0; x < W; x++) {
      // Luminance approximative via R+G+B (les masks sont monochromes anyway)
      const i = (rowStart + x) * 4
      const lum = (px[i] + px[i + 1] + px[i + 2]) / 3
      if (lum > 128) {
        mask[rowStart + x] = 1
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) {
    contoursCache.set(maskUrl, [])
    return []
  }

  const mwMask: MagicWandMaskInput = {
    data: mask, width: W, height: H,
    bounds: { minX, minY, maxX, maxY },
  }

  // 4. Trace + simplifie les contours (Douglas-Peucker tolerance 1px)
  const rawContours = MagicWand.traceContours(mwMask) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean; label: number
  }>
  const simplified = MagicWand.simplifyContours(rawContours, 1, 30) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean
  }>

  // 5. Normalise en 0-1
  const result: MagicWandContour[] = simplified.map(c => ({
    inner: c.inner,
    points: c.points.map(p => ({ x: p.x / W, y: p.y / H })),
  }))

  contoursCache.set(maskUrl, result)
  return result
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Mask image load failed: ${url}`))
    img.src = url
  })
}
