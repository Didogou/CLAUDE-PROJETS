/**
 * GrabCut (OpenCV.js) — extraction d'objet par graph cut depuis un rectangle.
 *
 * Algo classique 2004 (Microsoft Research, non-IA neurale moderne) :
 *   1. User dessine un rect autour de l'objet
 *   2. OpenCV initialise un modèle GMM (Gaussian Mixture) :
 *      - Pixels HORS rect = "définitivement background"
 *      - Pixels DANS rect = "probablement foreground" (incertain)
 *   3. Optimisation par graph cut → coupe optimale FG/BG
 *   4. Itère 3-5 fois, raffinant les modèles GMM
 *   → Retourne 1 mask binaire propre (foreground vs background)
 *
 * Avantages vs SAM/Magic Wand :
 *   - Robuste aux gradients lumineux (modèle statistique vs pixel-par-pixel)
 *   - 100% client (pas de GPU/serveur, juste CPU)
 *   - 1 objet propre (pas d'over-segmentation)
 *   - Mature (20 ans, bien testé)
 *
 * Limites :
 *   - Bundle 10 MB OpenCV.js (lazy-loadé à la 1ère utilisation)
 *   - 1 objet par call (drag rect par objet désiré)
 *   - Hair/transparent edges sans alpha matting
 *   - Compute ~500ms-2s sur CPU correct
 */

import { uploadMaskFromData } from './magicWand'

// @ts-expect-error : magic-wand-tool n'a pas de types officiels
import MagicWand from 'magic-wand-tool'

// ── Lazy-load OpenCV.js ───────────────────────────────────────────────────
//
// OpenCV.js fait 10 MB → on charge UNIQUEMENT quand l'utilisateur active
// GrabCut pour la 1ère fois. Une fois chargé, garde le module en cache
// pour tous les usages suivants.

// Le bundle @techstark/opencv-js (~11 MB) contient des `require('fs')` qui
// ne passent pas dans un bundler client (Turbopack/Webpack). On le charge donc
// via une balise <script> runtime depuis /public/opencv.js (copié au setup).
// Cela bypass le bundler ET garantit le lazy-load (10 MB hors bundle initial).
type CV = any
let opencvPromise: Promise<CV> | null = null

/**
 * Lazy-load OpenCV.js depuis /opencv.js (servi par Next depuis public/).
 * Idempotent : appels suivants retournent la même promise.
 */
export function loadOpenCV(): Promise<CV> {
  if (opencvPromise) return opencvPromise
  if (typeof window === 'undefined') {
    // SSR : on ne peut pas charger OpenCV.js côté serveur.
    opencvPromise = Promise.reject(new Error('OpenCV.js requires browser environment'))
    return opencvPromise
  }

  opencvPromise = new Promise<CV>((resolve, reject) => {
    const w = window as Window & { cv?: CV; Module?: { onRuntimeInitialized?: () => void } }

    // Si déjà loadé (cv.Mat disponible), résout direct.
    if (w.cv && w.cv.Mat) {
      console.log('[grabCut] OpenCV.js déjà loadé')
      resolve(w.cv)
      return
    }

    let resolved = false
    function tryResolve(source: string) {
      if (resolved) return
      if (w.cv && w.cv.Mat) {
        console.log(`[grabCut] OpenCV.js prêt (${source})`)
        resolved = true
        resolve(w.cv)
      }
    }

    // ── Approche 1 : hook officiel Module.onRuntimeInitialized
    // (firé par opencv.js après compilation WASM)
    w.Module = w.Module || {}
    const previousInit = w.Module.onRuntimeInitialized
    w.Module.onRuntimeInitialized = () => {
      if (previousInit) { try { previousInit() } catch (err) { console.warn(err) } }
      tryResolve('Module.onRuntimeInitialized')
    }

    // ── Approche 2 : polling fallback (au cas où le hook ne fire pas)
    let polls = 0
    const MAX_POLLS = 100  // 30s
    const pollId = setInterval(() => {
      polls++
      tryResolve('polling')
      if (resolved) {
        clearInterval(pollId)
        return
      }
      if (polls >= MAX_POLLS) {
        clearInterval(pollId)
        if (!resolved) {
          console.error('[grabCut] timeout 30s — window.cv =', w.cv)
          reject(new Error('OpenCV.js timeout (30s) — WASM init failed ?'))
        }
      }
    }, 300)

    // Inject script tag
    console.log('[grabCut] download /opencv.js (~11 MB)…')
    const script = document.createElement('script')
    script.src = '/opencv.js'
    script.async = true
    script.onload = () => {
      console.log('[grabCut] script /opencv.js téléchargé, attente init WASM…')
      tryResolve('script.onload')  // au cas où WASM est déjà prêt
    }
    script.onerror = () => {
      clearInterval(pollId)
      reject(new Error('Failed to load /opencv.js (vérifie qu\'il est dans public/)'))
    }
    document.head.appendChild(script)
  })
  return opencvPromise
}

/** Vérifie si OpenCV.js est déjà chargé (sans déclencher le download) */
export function isOpenCVLoaded(): boolean {
  return opencvPromise !== null
}

// ── Types ────────────────────────────────────────────────────────────────

export interface GrabCutContour {
  points: Array<{ x: number; y: number }>
  inner: boolean
}

interface GrabCutInput {
  imageUrl: string
  /** Rectangle de sélection en coords normalisées 0-1 */
  rect: { x1: number; y1: number; x2: number; y2: number }
  storagePathPrefix: string
  /** Nombre d'itérations GrabCut. 5 = bon compromis qualité/vitesse. */
  iterations?: number
}

interface GrabCutResult {
  /** URL du mask PNG noir/blanc upload */
  maskUrl: string
  bbox: { x1: number; y1: number; x2: number; y2: number }
  area: number
  contours: GrabCutContour[]
}

// ── Compute GrabCut ───────────────────────────────────────────────────────

/**
 * Lance GrabCut sur un rectangle d'image. Retourne le mask + contours + URL.
 *
 * Étapes :
 *   1. Lazy-load OpenCV.js si nécessaire (~3-5s la 1ère fois)
 *   2. Charge l'image dans un canvas + cv.Mat
 *   3. Initialise mask + bgdModel + fgdModel
 *   4. cv.grabCut avec GC_INIT_WITH_RECT (5 itérations par défaut)
 *   5. Convertit le mask GrabCut (0/1/2/3) → mask binaire (FG = 1)
 *   6. Trace contours via magic-wand-tool (réutilisé)
 *   7. Upload PNG mask → URL
 */
export async function grabCutToMaskUrl(input: GrabCutInput): Promise<GrabCutResult | null> {
  const { imageUrl, rect, storagePathPrefix, iterations = 5 } = input

  const cv = await loadOpenCV()

  // 1. Charge l'image
  const img = await loadImage(imageUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight

  // Convertit le rect normalisé en pixels
  const rx = Math.max(0, Math.floor(rect.x1 * W))
  const ry = Math.max(0, Math.floor(rect.y1 * H))
  const rw = Math.min(W - rx, Math.ceil((rect.x2 - rect.x1) * W))
  const rh = Math.min(H - ry, Math.ceil((rect.y2 - rect.y1) * H))
  if (rw < 10 || rh < 10) return null

  // 2. Source Mat depuis canvas
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context indisponible')
  ctx.drawImage(img, 0, 0)
  const src = cv.imread(canvas)
  // GrabCut nécessite RGB, pas RGBA
  const srcRGB = new cv.Mat()
  cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB, 0)

  // 3. Mask + models
  const mask = new cv.Mat()
  const bgdModel = new cv.Mat()
  const fgdModel = new cv.Mat()
  const grabCutRect = new cv.Rect(rx, ry, rw, rh)

  // 4. Run GrabCut
  cv.grabCut(srcRGB, mask, grabCutRect, bgdModel, fgdModel, iterations, cv.GC_INIT_WITH_RECT)

  // 5. Convertit mask GrabCut → mask binaire :
  //    valeurs : 0=GC_BGD, 1=GC_FGD, 2=GC_PR_BGD, 3=GC_PR_FGD
  //    On garde GC_FGD (1) et GC_PR_FGD (3) comme foreground.
  const binaryData = new Uint8Array(W * H)
  let area = 0
  let minX = W, minY = H, maxX = 0, maxY = 0
  // mask.data est une Uint8Array exposée par OpenCV.js
  const md = mask.data as Uint8Array
  for (let i = 0; i < md.length; i++) {
    const v = md[i]
    if (v === 1 || v === 3) {
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

  // Cleanup OpenCV Mats (important — GC manuel pour éviter memory leaks)
  src.delete()
  srcRGB.delete()
  mask.delete()
  bgdModel.delete()
  fgdModel.delete()

  if (area === 0) return null

  // 6. Trace contours via magic-wand-tool (réutilisé : même algo, lib déjà là)
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
  const contours: GrabCutContour[] = simplified.map(c => ({
    inner: c.inner,
    points: c.points.map(p => ({ x: p.x / W, y: p.y / H })),
  }))

  // 7. Upload PNG mask
  const maskUrl = await uploadMaskFromData(
    { data: binaryData, width: W, height: H },
    `${storagePathPrefix}_grabcut_${Date.now()}`,
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
