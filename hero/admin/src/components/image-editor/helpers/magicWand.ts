/**
 * Magic Wand classique (non-IA) — sélection par tolérance couleur depuis un pixel.
 *
 * Workflow 2-étapes (perf-critique) :
 *   1. computeFloodFill (synchrone après image load) :
 *      - Charge l'image dans un canvas (cache via imageDataCache)
 *      - Lance le flood fill (10-50ms)
 *      - Trace + simplifie les contours (10ms)
 *      → Retourne contours + mask data IMMÉDIATEMENT pour rendu marching ants
 *   2. uploadMaskFromData (async, en arrière-plan) :
 *      - Sérialise le mask en PNG noir/blanc
 *      - Upload Supabase (500ms-2s selon réseau)
 *      → Retourne l'URL du mask, utilisable comme n'importe quel mask SAM
 *
 * Cette séparation garantit un retour visuel INSTANT (marching ants) sans
 * attendre l'upload réseau qui peut être lent.
 */

// @ts-expect-error : magic-wand-tool n'a pas de types officiels
import MagicWand from 'magic-wand-tool'

interface MagicWandImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  bytes: 4
}

interface MagicWandMask {
  data: Uint8Array
  width: number
  height: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** Un contour = polygone fermé. Plusieurs contours peuvent décrire un mask
 *  (ex : un mask en forme de donut a 1 contour outer + 1 contour inner). */
export interface MagicWandContour {
  /** Points du polygone en coords image source normalisées 0-1. */
  points: Array<{ x: number; y: number }>
  /** true si c'est un contour intérieur (trou dans la zone). */
  inner: boolean
}

/** Résultat instantané du compute (avant upload PNG). */
export interface FloodFillCompute {
  /** Contours vectoriels pour rendu marching ants SVG (coords 0-1). */
  contours: MagicWandContour[]
  /** Bbox en coords image source normalisées 0-1. */
  bbox: { x1: number; y1: number; x2: number; y2: number }
  /** Nombre de pixels dans le mask (filtre selections trop petites). */
  area: number
  /** Mask binaire brut + dimensions (pour upload PNG en arrière-plan). */
  rawMask: { data: Uint8Array; width: number; height: number }
}

interface ComputeFloodFillInput {
  imageUrl: string
  /** Coordonnées normalisées 0-1 du pixel cliqué. */
  x: number
  y: number
  /** Tolérance couleur (1-100). */
  threshold: number
}

// ── Cache imageData : évite de recharger l'image à chaque click ──────────
//
// Indexé par URL. Une fois chargée et décodée en ImageData, on garde la
// référence pour réutilisation. Pour Magic Wand, le user clique souvent
// plusieurs fois sur la même image → cache crucial pour la perf instant.
const imageDataCache = new Map<string, MagicWandImageData>()

/** Pré-charge une image dans le cache imageData. À appeler quand on entre
 *  en mode 'magic_wand' pour que le 1er click soit instantané. */
export async function preloadImageData(imageUrl: string): Promise<void> {
  if (imageDataCache.has(imageUrl)) return
  const img = await loadImage(imageUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context indisponible')
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, W, H)
  imageDataCache.set(imageUrl, {
    data: imageData.data,
    width: W,
    height: H,
    bytes: 4,
  })
}

/** Vide le cache imageData (à appeler si l'image source change). */
export function clearImageDataCache() {
  imageDataCache.clear()
}

/**
 * Compute synchrone du floodFill depuis un pixel cliqué.
 * RAPIDE (~10-50ms si l'imageData est en cache, sinon ~200-500ms pour load).
 *
 * Retourne null si le mask est dégénéré (vide ou hors limites).
 */
export async function computeFloodFill(
  input: ComputeFloodFillInput,
): Promise<FloodFillCompute | null> {
  const { imageUrl, x, y, threshold } = input

  // 1. Récupère imageData (cache hit ou load)
  let imgData = imageDataCache.get(imageUrl)
  if (!imgData) {
    await preloadImageData(imageUrl)
    imgData = imageDataCache.get(imageUrl)
  }
  if (!imgData) throw new Error('imageData indisponible')
  const W = imgData.width
  const H = imgData.height

  // 2. Convertit coords normalisées en pixels
  const px = Math.max(0, Math.min(W - 1, Math.round(x * W)))
  const py = Math.max(0, Math.min(H - 1, Math.round(y * H)))

  // 3. Flood fill
  const mask = MagicWand.floodFill(imgData, px, py, threshold) as MagicWandMask | null
  if (!mask) return null

  // 4. Aire (filtrage zones dégénérées)
  let area = 0
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] === 1) area++
  }
  if (area === 0) return null

  const bbox = mask.bounds
  if (bbox.maxX < bbox.minX || bbox.maxY < bbox.minY) return null

  // 5. Trace + simplifie contours (Douglas-Peucker tolerance 1px)
  const rawContours = MagicWand.traceContours(mask) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean; label: number
  }>
  const simplified = MagicWand.simplifyContours(rawContours, 1, 30) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean
  }>
  const contours: MagicWandContour[] = simplified.map(c => ({
    inner: c.inner,
    points: c.points.map(p => ({ x: p.x / W, y: p.y / H })),
  }))

  return {
    contours,
    bbox: {
      x1: bbox.minX / W,
      y1: bbox.minY / H,
      x2: (bbox.maxX + 1) / W,
      y2: (bbox.maxY + 1) / H,
    },
    area,
    rawMask: { data: mask.data, width: mask.width, height: mask.height },
  }
}

/**
 * Upload async du mask binaire en PNG noir/blanc full-size.
 * Lent (~500ms-2s selon réseau). À appeler en arrière-plan après affichage
 * des marching ants pour l'utilisateur.
 */
export async function uploadMaskFromData(
  rawMask: { data: Uint8Array; width: number; height: number },
  storagePathPrefix: string,
): Promise<string> {
  const { data, width, height } = rawMask
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D mask context indisponible')

  const imageData = ctx.createImageData(width, height)
  for (let i = 0; i < data.length; i++) {
    const v = data[i] === 1 ? 255 : 0
    const j = i * 4
    imageData.data[j] = v
    imageData.data[j + 1] = v
    imageData.data[j + 2] = v
    imageData.data[j + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  const path = `${storagePathPrefix}_mwand_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  return await uploadBlob(blob, path)
}

/**
 * Wrapper convenience : compute + upload en une seule call.
 * Garde la compat API "1-shot" pour les consumers qui n'ont pas besoin
 * de séparer les 2 étapes (ex: CatalogEdit avant l'optimisation marching ants).
 */
export async function floodFillToMaskUrl(
  input: ComputeFloodFillInput & { storagePathPrefix: string },
): Promise<{ maskUrl: string; bbox: FloodFillCompute['bbox']; area: number; contours: MagicWandContour[] } | null> {
  const compute = await computeFloodFill(input)
  if (!compute) return null
  const maskUrl = await uploadMaskFromData(compute.rawMask, input.storagePathPrefix)
  return { maskUrl, bbox: compute.bbox, area: compute.area, contours: compute.contours }
}

// ── Helpers locaux ────────────────────────────────────────────────────────

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${url}`))
    img.src = url
  })
}

async function uploadBlob(blob: Blob, storagePath: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'mask.png')
  form.append('path', storagePath)
  const res = await fetch('/api/upload-image', { method: 'POST', body: form })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Upload mask échoué (${res.status}) : ${txt.slice(0, 200)}`)
  }
  const d = await res.json() as { url?: string; error?: string }
  if (!d.url) throw new Error(d.error || 'Upload mask : URL manquante')
  return d.url
}
