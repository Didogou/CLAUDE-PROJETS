/**
 * Helpers d'extraction d'un personnage depuis une image source.
 *
 * Deux modes :
 *   - extractByBox   : crop carré centré autour d'un rectangle tracé par drag
 *   - extractByMask  : utilise un mask binaire (issu de SAM 2) comme alpha-cutout
 *
 * Les deux renvoient une URL Supabase d'une image PNG détourée composée sur
 * fond gris #808080 (format exigé par IPAdapter FaceID/Plus).
 *
 * Dépendances :
 *   - /api/upload-image (multipart ou JSON) — upload blob → URL publique
 *   - /api/remove-bg                        — rembg local → fond gris
 *   - /api/comfyui/segment (mode mask)      — SAM 2 points → mask PNG
 *
 * Rend le composant SubExtractCharacter plus léger et permet de réutiliser
 * ces helpers depuis d'autres contextes (NpcTab, etc.).
 */
import type { Box } from '../common/BoxSelector'
import type { SAMPoint } from '../common/SAMSelector'

/** Monte une Image() et attend son chargement (throw sur erreur CORS). */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const el = new Image()
  el.crossOrigin = 'anonymous'
  el.src = src
  await new Promise<void>((resolve, reject) => {
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('Chargement image source échoué (CORS ?)'))
  })
  return el
}

/** Upload un Blob via /api/upload-image (multipart) → renvoie l'URL publique. */
async function uploadBlob(blob: Blob, storagePath: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'upload.png')
  form.append('path', storagePath)
  const res = await fetch('/api/upload-image', { method: 'POST', body: form })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Upload échoué (${res.status}) : ${txt.slice(0, 200)}`)
  }
  const d = await res.json()
  if (!d.url) throw new Error(d.error || 'Upload : URL manquante')
  return d.url as string
}

/** Appelle rembg local via /api/remove-bg. Message d'erreur explicite si serveur absent. */
async function callRembg(imageUrl: string): Promise<string> {
  const res = await fetch('/api/remove-bg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    const isFetchFailed = /fetch failed|ECONNREFUSED/i.test(errText)
    throw new Error(
      isFetchFailed
        ? 'Serveur rembg local (127.0.0.1:8189) injoignable. Vérifie qu\'il est bien démarré (python rembg_server.py).'
        : `rembg a renvoyé une erreur (${res.status}) : ${errText.slice(0, 300)}`,
    )
  }
  const d = await res.json()
  if (!d.image_url) throw new Error(d.error || 'rembg : pas d\'URL en retour')
  return d.image_url as string
}

// ── Mode 1 : extraction par rectangle (drag box) ────────────────────────────

export interface ExtractByBoxParams {
  imgEl: HTMLImageElement
  sourceUrl: string
  box: Box // coords en pixels display
}

/** Crop carré centré autour de la box + padding transparent, puis rembg. */
export async function extractByBox({ imgEl, sourceUrl, box }: ExtractByBoxParams): Promise<string> {
  const natW = imgEl.naturalWidth
  const natH = imgEl.naturalHeight
  const dispW = imgEl.clientWidth
  const dispH = imgEl.clientHeight
  const ratioX = natW / dispW
  const ratioY = natH / dispH
  const sx = box.x * ratioX
  const sy = box.y * ratioY
  const sw = box.w * ratioX
  const sh = box.h * ratioY

  const side = Math.max(sw, sh)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(side)
  canvas.height = Math.round(side)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const offX = (side - sw) / 2
  const offY = (side - sh) / 2
  const srcImg = await loadImage(sourceUrl)
  ctx.drawImage(srcImg, sx, sy, sw, sh, offX, offY, sw, sh)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })

  const tempPath = `temp/extract_box_${Date.now()}`
  const cropUrl = await uploadBlob(blob, tempPath)
  return await callRembg(cropUrl)
}

// ── Mode 2 : extraction par mask (SAM 2 points) ────────────────────────────

export interface ExtractByMaskParams {
  imgEl: HTMLImageElement
  sourceUrl: string
  points: SAMPoint[] // coords en pixels display
}

/**
 * Core : compose source × mask (luminance comme alpha) sur fond gris, centre
 * carré, upload. Utilisé par TOUS les modes de sélection SAM
 * (points guidés, auto-segmentation baguette, etc.).
 *
 * Pourquoi `destination-in` ne marche PAS : le PNG de mask exporté par ComfyUI
 * a alpha=255 partout (canal alpha opaque, mask codé en luminance R/G/B).
 * On lit donc la luminance pixel-par-pixel et on l'injecte dans l'alpha du
 * crop source via ImageData.
 */
export interface ExtractByMaskUrlParams {
  imgEl: HTMLImageElement
  sourceUrl: string
  maskUrl: string
  /** Préfixe Supabase pour l'upload du résultat. Défaut : 'temp/extract_sam_{timestamp}'. */
  storagePathPrefix?: string
}

export async function extractByMaskUrl({ imgEl, sourceUrl, maskUrl, storagePathPrefix }: ExtractByMaskUrlParams): Promise<string> {
  const natW = imgEl.naturalWidth
  const natH = imgEl.naturalHeight

  // 1. Charge source + mask
  const srcImg = await loadImage(sourceUrl)
  const maskImg = await loadImage(maskUrl)

  // 2. Lit le mask sur une surface natW×natH (scaling auto si dimensions diffèrent)
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = natW; maskCanvas.height = natH
  const mctx = maskCanvas.getContext('2d')!
  mctx.drawImage(maskImg, 0, 0, natW, natH)
  const maskData = mctx.getImageData(0, 0, natW, natH)

  // 3. BBox du mask
  let minX = natW, minY = natH, maxX = -1, maxY = -1
  for (let y = 0; y < natH; y++) {
    for (let x = 0; x < natW; x++) {
      const idx = (y * natW + x) * 4
      if (maskData.data[idx] > 127) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0 || maxY < 0) {
    throw new Error('Mask vide.')
  }
  const pad = 4
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(natW - 1, maxX + pad); maxY = Math.min(natH - 1, maxY + pad)
  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1
  const side = Math.max(cropW, cropH)

  // 4. Canvas intermédiaire : crop source + alpha issu du mask
  const srcCrop = document.createElement('canvas')
  srcCrop.width = cropW; srcCrop.height = cropH
  const sctx = srcCrop.getContext('2d')!
  sctx.drawImage(srcImg, minX, minY, cropW, cropH, 0, 0, cropW, cropH)
  const srcData = sctx.getImageData(0, 0, cropW, cropH)
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const srcIdx = (y * cropW + x) * 4
      const mIdx = ((y + minY) * natW + (x + minX)) * 4
      srcData.data[srcIdx + 3] = maskData.data[mIdx]
    }
  }
  sctx.putImageData(srcData, 0, 0)

  // 5. Canvas final : fond gris #808080 carré centré
  const out = document.createElement('canvas')
  out.width = Math.round(side); out.height = Math.round(side)
  const octx = out.getContext('2d')!
  octx.fillStyle = '#808080'
  octx.fillRect(0, 0, out.width, out.height)
  const offX = (side - cropW) / 2
  const offY = (side - cropH) / 2
  octx.drawImage(srcCrop, offX, offY)

  // 6. Export + upload
  const blob: Blob = await new Promise((resolve, reject) => {
    out.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  const tempPath = storagePathPrefix ?? `temp/extract_sam_${Date.now()}`
  return await uploadBlob(blob, tempPath)
}

/**
 * Flow SAM par points :
 *   1. Convertit les points display → coords naturelles
 *   2. Appelle /api/comfyui/segment → récupère maskUrl
 *   3. Délègue à extractByMaskUrl pour la composition finale
 */
export async function extractByMask({ imgEl, sourceUrl, points }: ExtractByMaskParams): Promise<string> {
  const natW = imgEl.naturalWidth
  const natH = imgEl.naturalHeight
  const dispW = imgEl.clientWidth
  const dispH = imgEl.clientHeight
  const ratioX = natW / dispW
  const ratioY = natH / dispH
  const naturalPoints = points.map(p => ({
    x: Math.round(p.x * ratioX),
    y: Math.round(p.y * ratioY),
    positive: p.positive,
  }))

  const segRes = await fetch('/api/comfyui/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: sourceUrl, points: naturalPoints }),
  })
  if (!segRes.ok) {
    const errText = await segRes.text().catch(() => '')
    throw new Error(`SAM a échoué (${segRes.status}). ${errText.slice(0, 300)}`)
  }
  const segData = await segRes.json()
  if (!segData.mask_url) throw new Error(segData.error || 'SAM : pas de mask retourné')

  return await extractByMaskUrl({ imgEl, sourceUrl, maskUrl: segData.mask_url })
}
