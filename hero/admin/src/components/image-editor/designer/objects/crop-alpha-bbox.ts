/**
 * Crop un PNG (depuis une URL) au bbox de son contenu non-transparent.
 *
 * Utile pour transformer une découpe full-canvas (objet entouré de
 * transparence) en image "serrée" autour de l'objet — meilleur affichage
 * en miniature, et taille de fichier réduite après ré-upload.
 *
 * Retourne un Blob PNG cropté. Le caller s'occupe de l'upload Supabase.
 *
 * Refonte 2026-05-12 — extraction objet/perso.
 */

interface CropAlphaOptions {
  imageUrl: string
  /** Seuil alpha au-dessus duquel un pixel est considéré "présent". Défaut 16. */
  alphaThreshold?: number
  /** Padding en pixels autour du bbox calculé. Défaut 8. */
  padding?: number
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${url.slice(0, 100)}`))
    img.src = url
  })
}

export async function cropAlphaBbox(opts: CropAlphaOptions): Promise<Blob> {
  const { imageUrl, alphaThreshold = 16, padding = 8 } = opts
  const img = await loadImage(imageUrl)
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w === 0 || h === 0) throw new Error('Image dimensions 0')

  // Canvas pour scanner l'alpha
  const scanCanvas = document.createElement('canvas')
  scanCanvas.width = w
  scanCanvas.height = h
  const sctx = scanCanvas.getContext('2d', { willReadFrequently: true })
  if (!sctx) throw new Error('Canvas 2D context unavailable')
  sctx.drawImage(img, 0, 0)
  const imageData = sctx.getImageData(0, 0, w, h)
  const data = imageData.data

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
  if (maxX < 0 || maxY < 0) {
    throw new Error('Image entièrement transparente — rien à cropper')
  }

  // Applique padding (borné aux dims image)
  const cropX = Math.max(0, minX - padding)
  const cropY = Math.max(0, minY - padding)
  const cropW = Math.min(w - cropX, maxX - minX + 1 + 2 * padding)
  const cropH = Math.min(h - cropY, maxY - minY + 1 + 2 * padding)

  // Canvas de crop
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = cropW
  cropCanvas.height = cropH
  const cctx = cropCanvas.getContext('2d')
  if (!cctx) throw new Error('Canvas 2D context unavailable (crop)')
  cctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)

  return new Promise<Blob>((resolve, reject) => {
    cropCanvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Canvas toBlob failed')),
      'image/png',
    )
  })
}
