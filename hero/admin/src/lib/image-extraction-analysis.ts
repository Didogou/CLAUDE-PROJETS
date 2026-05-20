/**
 * image-extraction-analysis — analyse + normalisation des PNG transparents
 * extraits (refonte 2026-05-09 — workflow extraction de personnage).
 *
 * Pourquoi gris #808080 et 1024×1024 ?
 *   Convention Hero (cf feedback_portrait_reference) — toutes les images
 *   portrait/fullbody utilisées comme RÉFÉRENCE pour les pipelines downstream
 *   (IPAdapter, FaceID, Insert Anything, Flux Kontext) doivent être sur ce
 *   fond gris neutre, en 1024×1024. Sans ça, les pipelines IPAdapter intègrent
 *   le fond original dans la "personnalité" du perso → résultats moches.
 *
 * Approche LOCALE (pas de Claude / Qwen) :
 *   1. computeAlphaBbox : scan canvas pour trouver la bbox du sujet
 *   2. detectImageKind  : aspect-ratio de la BBOX (pas du canvas !)
 *   3. composeOnGray    : crop bbox + scale-fit dans 1024×1024 gris
 */

const HERO_GRAY = '#808080'
const TARGET_SIZE = 1024
const PADDING_FRACTION = 0.08

export type ExtractedImageKind = 'portrait' | 'fullbody'

interface AlphaBbox {
  x: number
  y: number
  w: number
  h: number
}

/** Scanne les pixels alpha pour trouver la bounding box du sujet non-transparent.
 *  Sub-sampling pour perf sur grosses images (step adaptatif).
 *  Seuil alpha > 16 pour ignorer le bruit anti-alias des outils de découpe. */
async function computeAlphaBbox(img: HTMLImageElement): Promise<AlphaBbox | null> {
  const W = img.naturalWidth
  const H = img.naturalHeight
  if (W < 8 || H < 8) return null
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, W, H).data
  } catch {
    // Tainted canvas (CORS) — pas de scan possible, fallback null
    return null
  }
  let minX = W, minY = H, maxX = -1, maxY = -1
  const step = Math.max(1, Math.floor(Math.min(W, H) / 512))
  for (let y = 0; y < H; y += step) {
    const rowOff = y * W * 4
    for (let x = 0; x < W; x += step) {
      const alpha = data[rowOff + x * 4 + 3]
      if (alpha > 16) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null  // entièrement transparent
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Heuristique aspect-ratio basée sur la BBOX du sujet (pas le canvas).
 *  - h / w > 1.4 → 'fullbody' (perso debout)
 *  - sinon       → 'portrait'
 *  Si bbox impossible à calculer (CORS, image vide) → fallback 'portrait'. */
export async function detectImageKind(url: string): Promise<ExtractedImageKind> {
  const img = await loadImage(url)
  const bbox = await computeAlphaBbox(img)
  if (!bbox) return 'portrait'
  const ratio = bbox.h / Math.max(1, bbox.w)
  return ratio > 1.4 ? 'fullbody' : 'portrait'
}

/** Crée une image 1024×1024 fond gris #808080 avec le sujet de l'extraction
 *  recadré à sa bbox alpha et centré (avec padding). Convention Hero pour
 *  références IPAdapter / FaceID / Kontext.
 *
 *  - cropMode 'full'     : utilise toute la bbox du sujet (cas plein pied)
 *  - cropMode 'portrait' : prend les 45% supérieurs de la bbox + recentre
 *                          (cas portrait dérivé d'un plein pied)
 *
 *  Retourne l'URL Supabase de l'image composée, null en cas d'erreur. */
async function composeOnGray(
  url: string,
  storagePath: string,
  cropMode: 'full' | 'portrait',
  topRatio: number = 0.55,
): Promise<string | null> {
  try {
    const img = await loadImage(url)
    const bbox = await computeAlphaBbox(img)
    if (!bbox) return null

    // Sélectionne la zone à extraire selon le mode.
    // - 'full'     : bbox entière du sujet
    // - 'portrait' : top topRatio% de la bbox + fenêtre horizontale recadrée
    //                sur le centre. Default 0.55 (refonte 2026-05-12 — avant
    //                0.40 trop serré, coupait la tête sous un chapeau/plume
    //                haut). topRatio paramétrable pour les cas spéciaux.
    //                Largeur cible 1.3×sh (un peu large pour cadrage buste
    //                naturel — avant 1.0 = carré trop serré).
    let sx = bbox.x
    const sy = bbox.y
    let sw = bbox.w
    let sh = bbox.h
    if (cropMode === 'portrait') {
      sh = Math.max(8, Math.round(bbox.h * topRatio))
      const targetW = Math.min(bbox.w, Math.round(sh * 1.3))
      const cx = bbox.x + bbox.w / 2
      sx = Math.max(bbox.x, Math.round(cx - targetW / 2))
      sw = targetW
    }

    // Canvas de sortie 1024×1024 fond gris
    const out = document.createElement('canvas')
    out.width = TARGET_SIZE
    out.height = TARGET_SIZE
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = HERO_GRAY
    ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE)

    // Scale-fit avec padding (pas de stretch)
    const innerSize = TARGET_SIZE * (1 - PADDING_FRACTION * 2)
    const scale = Math.min(innerSize / sw, innerSize / sh)
    const dw = sw * scale
    const dh = sh * scale
    const dx = (TARGET_SIZE - dw) / 2
    const dy = (TARGET_SIZE - dh) / 2
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)

    const dataUrl = out.toDataURL('image/png')
    const r = await fetch('/api/storage/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: dataUrl, path: storagePath }),
    })
    if (!r.ok) return null
    const { url: uploadedUrl } = await r.json() as { url: string }
    return uploadedUrl
  } catch (err) {
    console.warn('[composeOnGray]', cropMode, err)
    return null
  }
}

/** Composite plein pied = bbox du sujet recadrée + scale-fit sur gris 1024. */
export async function composeFullbodyOnGray(
  url: string,
  storagePath: string,
): Promise<string | null> {
  return composeOnGray(url, storagePath, 'full')
}

/** Composite portrait = top 45% de la bbox du sujet (tête + buste) + scale-fit
 *  sur gris 1024. À utiliser quand on dérive un portrait depuis un plein pied. */
export async function composePortraitFromExtraction(
  url: string,
  storagePath: string,
): Promise<string | null> {
  return composeOnGray(url, storagePath, 'portrait')
}

/** Chroma-key client-side : remplace les pixels proches de #808080 (le fond
 *  gris neutre Hero) par alpha=0. Upload Supabase et retourne l'URL stable.
 *
 *  Cas d'usage (refonte 2026-05-09) : drag-and-drop d'un perso depuis la
 *  banque sur la scène — la banque stocke les persos sur fond gris (convention
 *  IPAdapter), mais pour l'overlay CSS direct on veut un PNG transparent.
 *
 *  Tolérance ±14 par canal pour gérer l'anti-aliasing JPEG/PNG sur les bords.
 *  Risque : si le perso porte un t-shirt gris très proche de #808080, ses
 *  pixels seraient aussi virés. Tolérance volontairement basse pour limiter
 *  ce faux positif. À affiner si besoin (ex: edge-detect pour ne toucher
 *  que les pixels périphériques). */
export async function chromaKeyGrayToTransparent(
  url: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const img = await loadImage(url)
    const W = img.naturalWidth
    const H = img.naturalHeight
    if (W < 8 || H < 8) return null
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    let data: ImageData
    try {
      data = ctx.getImageData(0, 0, W, H)
    } catch {
      // Tainted canvas (CORS) — pas de scan possible
      return null
    }
    const px = data.data
    const TARGET = 128       // #808080
    const TOLERANCE = 14     // ±14 par canal (~5%)
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i]
      const g = px[i + 1]
      const b = px[i + 2]
      if (
        Math.abs(r - TARGET) <= TOLERANCE &&
        Math.abs(g - TARGET) <= TOLERANCE &&
        Math.abs(b - TARGET) <= TOLERANCE
      ) {
        px[i + 3] = 0
      }
    }
    ctx.putImageData(data, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    const r = await fetch('/api/storage/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: dataUrl, path: storagePath }),
    })
    if (!r.ok) return null
    const { url: uploadedUrl } = await r.json() as { url: string }
    return uploadedUrl
  } catch (err) {
    console.warn('[chromaKeyGrayToTransparent]', err)
    return null
  }
}

/** Convertit un Blob (issu de buildLivePreviewBlobUrl) en data URL puis upload
 *  sur Supabase. Retourne l'URL stable (= utilisable plus tard, après refresh). */
export async function uploadBlobAsImage(
  blob: Blob,
  storagePath: string,
): Promise<string | null> {
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('FileReader failed'))
      reader.readAsDataURL(blob)
    })
    const r = await fetch('/api/storage/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: dataUrl, path: storagePath }),
    })
    if (!r.ok) return null
    const { url } = await r.json() as { url: string }
    return url
  } catch (err) {
    console.warn('[uploadBlobAsImage]', err)
    return null
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`load failed: ${url}`))
    img.src = url
  })
}
