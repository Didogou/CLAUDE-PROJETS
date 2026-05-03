/**
 * SAM Prompt-point — extraction sémantique d'1 objet via SAM 2 (kijai).
 *
 * Workflow :
 *   1. User clique sur 1 point de l'objet désiré
 *   2. POST /api/comfyui/segment avec { image_url, points: [{x, y, positive: true}] }
 *   3. ComfyUI exécute SAM 2 → retourne 1 mask PNG (URL Supabase)
 *   4. On décode le mask côté client et trace les contours pour marching ants
 *
 * Différence vs SAM Auto :
 *   - SAM Auto = drag rect → N objets dans la zone (sur-détecte)
 *   - SAM Prompt = click point → 1 objet sémantique entier (canapé éclairé OK,
 *     même avec gradients lumineux ou textures complexes)
 *
 * Coût : ~1-2 secondes de compute serveur (GPU). Utilise Supabase pour stocker
 * le mask retourné. Coût $/usage négligeable (compute existant).
 */

import { uploadMaskFromData } from './magicWand'

// @ts-expect-error : magic-wand-tool n'a pas de types officiels
import MagicWand from 'magic-wand-tool'

export interface SamPromptContour {
  points: Array<{ x: number; y: number }>
  inner: boolean
}

interface SamPromptInput {
  imageUrl: string
  /** Coordonnées normalisées 0-1 du point cliqué */
  x: number
  y: number
  storagePathPrefix: string
}

interface SamPromptResult {
  maskUrl: string
  bbox: { x1: number; y1: number; x2: number; y2: number }
  area: number
  contours: SamPromptContour[]
}

/**
 * Lance SAM 2 en mode prompt-point pour extraire 1 objet sémantique.
 * Retourne null si SAM ne trouve rien (rare mais possible).
 *
 * Note : le mask retourné par SAM est ré-uploadé via uploadMaskFromData pour
 * normalisation (l'API renvoie son propre mask, mais on uniformise les
 * formats avec les autres helpers).
 */
export async function samPromptToMaskUrl(input: SamPromptInput): Promise<SamPromptResult | null> {
  const { imageUrl, x, y, storagePathPrefix } = input

  // 1. Charge l'image pour connaître les dimensions naturelles
  const img = await loadImage(imageUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight

  // Convertit coords normalisées en pixels
  const px = Math.round(x * W)
  const py = Math.round(y * H)

  // 2. Call API SAM 2 avec un seul point positif
  const res = await fetch('/api/comfyui/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      points: [{ x: px, y: py, positive: true }],
    }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`SAM Prompt a échoué (${res.status}). ${txt.slice(0, 200)}`)
  }
  const d = await res.json() as { mask_url?: string; error?: string }
  if (!d.mask_url) {
    throw new Error(d.error || 'SAM Prompt : pas de mask retourné')
  }

  // 3. Charge le mask retourné par SAM
  const maskImg = await loadImage(d.mask_url)
  const mw = maskImg.naturalWidth
  const mh = maskImg.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = mw
  canvas.height = mh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context indisponible')
  ctx.drawImage(maskImg, 0, 0)
  const maskImageData = ctx.getImageData(0, 0, mw, mh)

  // 4. Convertit en mask binaire (seuil R > 128)
  const binaryData = new Uint8Array(mw * mh)
  let area = 0
  let minX = mw, minY = mh, maxX = 0, maxY = 0
  for (let i = 0; i < mw * mh; i++) {
    const r = maskImageData.data[i * 4]
    if (r > 128) {
      binaryData[i] = 1
      area++
      const px = i % mw
      const py = Math.floor(i / mw)
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
  }
  if (area === 0) return null

  // 5. Trace contours pour marching ants
  const mwMask = {
    data: binaryData,
    width: mw,
    height: mh,
    bounds: { minX, minY, maxX, maxY },
  }
  const rawContours = MagicWand.traceContours(mwMask) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean; label: number
  }>
  const simplified = MagicWand.simplifyContours(rawContours, 1, 30) as Array<{
    points: Array<{ x: number; y: number }>; inner: boolean
  }>
  const contours: SamPromptContour[] = simplified.map(c => ({
    inner: c.inner,
    points: c.points.map(p => ({ x: p.x / mw, y: p.y / mh })),
  }))

  // Le mask URL retourné par /api/comfyui/segment est déjà sur Supabase, on
  // le réutilise tel quel (pas besoin de re-upload). Retour final :
  return {
    maskUrl: d.mask_url,
    bbox: {
      x1: minX / mw,
      y1: minY / mh,
      x2: (maxX + 1) / mw,
      y2: (maxY + 1) / mh,
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
