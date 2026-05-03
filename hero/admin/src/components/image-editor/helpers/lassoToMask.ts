/**
 * Lasso → Mask : convertit un polygone (Polygonal ou Free Lasso) en PNG mask.
 *
 * Workflow :
 *   1. Reçoit les points du polygone en coords normalisées 0-1
 *   2. Rasterise le polygone fermé (rempli) sur un canvas full-size de l'image
 *   3. Génère un PNG noir/blanc + contours pour marching ants
 *   4. Upload le PNG sur Supabase
 *
 * Le polygone est fermé automatiquement (le dernier point est reconnecté au 1er
 * via le `Z` du path SVG / canvas closePath()). Pas besoin que le user trace
 * exactement jusqu'au point de départ.
 */

import { uploadMaskFromData } from './magicWand'

// @ts-expect-error : magic-wand-tool n'a pas de types officiels
import MagicWand from 'magic-wand-tool'

export interface LassoContour {
  points: Array<{ x: number; y: number }>
  inner: boolean
}

interface LassoInput {
  imageUrl: string
  /** Points du polygone en coords normalisées 0-1 (au moins 3 points) */
  points: Array<{ x: number; y: number }>
  storagePathPrefix: string
}

interface LassoResult {
  maskUrl: string
  bbox: { x1: number; y1: number; x2: number; y2: number }
  area: number
  contours: LassoContour[]
}

/**
 * Convertit un polygone en mask binaire + URL.
 * Retourne null si le polygone est dégénéré (< 3 points ou aire nulle).
 */
export async function lassoPolygonToMaskUrl(input: LassoInput): Promise<LassoResult | null> {
  const { imageUrl, points, storagePathPrefix } = input
  if (points.length < 3) return null

  // 1. Charge l'image pour les dims naturelles
  const img = await loadImage(imageUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight

  // 2. Rasterise le polygone rempli sur un canvas binaire
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context indisponible')

  // Fond noir, polygone blanc rempli
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'white'
  ctx.beginPath()
  ctx.moveTo(points[0].x * W, points[0].y * H)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * W, points[i].y * H)
  }
  ctx.closePath()
  ctx.fill()

  // 3. Extrait imageData → binaryData (1 si blanc, 0 si noir)
  const imageData = ctx.getImageData(0, 0, W, H)
  const binaryData = new Uint8Array(W * H)
  let area = 0
  let minX = W, minY = H, maxX = 0, maxY = 0
  for (let i = 0; i < W * H; i++) {
    if (imageData.data[i * 4] > 128) {
      binaryData[i] = 1
      area++
      const x = i % W
      const y = Math.floor(i / W)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (area === 0) return null

  // 4. Trace contours pour marching ants (réutilise magic-wand-tool)
  const mwMask = {
    data: binaryData,
    width: W,
    height: H,
    bounds: { minX, minY, maxX, maxY },
  }
  const rawContours = MagicWand.traceContours(mwMask) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean; label: number
  }>
  const simplified = MagicWand.simplifyContours(rawContours, 1, 30) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean
  }>
  const contours: LassoContour[] = simplified.map(c => ({
    inner: c.inner,
    points: c.points.map(p => ({ x: p.x / W, y: p.y / H })),
  }))

  // 5. Upload PNG mask
  const maskUrl = await uploadMaskFromData(
    { data: binaryData, width: W, height: H },
    `${storagePathPrefix}_lasso_${Date.now()}`,
  )

  return {
    maskUrl,
    bbox: {
      x1: minX / W,
      y1: minY / H,
      x2: (maxX + 1) / W,
      y2: (maxY + 1) / H,
    },
    area,
    contours,
  }
}

// ── Helper local ──────────────────────────────────────────────────────────

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${url}`))
    img.src = url
  })
}
