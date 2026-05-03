/**
 * Helpers pour convertir des traits de pinceau (vecteurs normalisés) en
 * masque PNG B&W uploadé et utilisable par les actions downstream
 * (erase, inpaint, extract, motion_brush).
 *
 * Le format de sortie est identique à celui produit par `combineMasksMulti`
 * pour la baguette magique SAM : PNG opaque avec canal rouge = mask
 * (blanc = zone concernée, noir = hors zone).
 */
import type { BrushStroke } from '../EditorStateContext'

/** Upload un Blob via /api/upload-image (multipart) → renvoie l'URL publique. */
async function uploadBlob(blob: Blob, storagePath: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'brush-mask.png')
  form.append('path', storagePath)
  const res = await fetch('/api/upload-image', { method: 'POST', body: form })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Upload mask pinceau échoué (${res.status}) : ${txt.slice(0, 200)}`)
  }
  const d = await res.json()
  if (!d.url) throw new Error(d.error || 'Upload : URL manquante')
  return d.url as string
}

/**
 * Dessine la liste de strokes sur un canvas 2D déjà sizé.
 * Canvas doit être clear avant (fond noir implicite pour mask B&W).
 * Les modes 'erase' utilisent `destination-out` pour effacer les strokes
 * 'paint' précédents — ordre chronologique respecté.
 */
export function renderStrokesToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: BrushStroke[],
) {
  // Fond noir (zones NON concernées)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  // Rayon normalisé × min(w,h) = rayon en pixels absolus
  const scale = Math.min(width, height)

  for (const stroke of strokes) {
    const radiusPx = Math.max(1, stroke.radius * scale)
    ctx.lineWidth = radiusPx * 2       // diamètre (line = 2 × rayon)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (stroke.mode === 'paint') {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = '#fff'
      ctx.fillStyle = '#fff'
    } else {
      // Erase : efface ce qui a été peint avant (destination-out = supprime
      // les pixels existants où le stroke passe).
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = '#000'
      ctx.fillStyle = '#000'
    }

    if (stroke.points.length === 0) continue
    if (stroke.points.length === 1) {
      // Un seul point = juste un cercle (tap sans drag)
      const p = stroke.points[0]
      ctx.beginPath()
      ctx.arc(p.x * width, p.y * height, radiusPx, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    // Polyline + cercles aux extrémités pour un début/fin arrondis propres
    ctx.beginPath()
    const first = stroke.points[0]
    ctx.moveTo(first.x * width, first.y * height)
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i]
      ctx.lineTo(p.x * width, p.y * height)
    }
    ctx.stroke()
  }
  // Reset composite op après la passe (important si caller réutilise le ctx)
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * Génère un mask PNG B&W à partir des strokes, à la résolution naturelle de
 * l'image source, puis l'uploade sur Supabase.
 *
 * Le mask produit suit la même convention que les masks SAM :
 *   - canal rouge = mask (>= 128 = zone concernée)
 *   - fond noir opaque, premier plan blanc opaque (pas de transparence)
 *
 * Si aucun stroke (ou strokes uniquement en erase), renvoie null.
 */
export async function brushStrokesToMaskUrl(
  strokes: BrushStroke[],
  imageUrl: string,
  storagePathPrefix: string,
): Promise<string | null> {
  if (strokes.length === 0) return null

  // Charge l'image source pour récupérer les dims naturelles (mask doit matcher).
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = imageUrl
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Impossible de charger l\'image source'))
  })
  const w = img.naturalWidth
  const h = img.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context indisponible')

  renderStrokesToCanvas(ctx, w, h, strokes)

  // Vérifie qu'il reste au moins 1 pixel blanc (sinon mask vide = inutile)
  const sample = ctx.getImageData(0, 0, w, h).data
  let hasAnyWhite = false
  for (let i = 0; i < sample.length; i += 4) {
    if (sample[i] > 127) { hasAnyWhite = true; break }
  }
  if (!hasAnyWhite) return null

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob renvoie null')), 'image/png')
  })

  const storagePath = `${storagePathPrefix}_brush_${Date.now()}`
  return await uploadBlob(blob, storagePath)
}
