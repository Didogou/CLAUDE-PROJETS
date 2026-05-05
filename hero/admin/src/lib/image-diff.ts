/**
 * Image diff helper — extrait un perso comme PNG transparent à partir de
 * 2 images générées par le même modèle (composite avec perso vs clean BG sans).
 *
 * Cas d'usage Hero (validé 2026-05-02) :
 *   Pipeline insertion perso :
 *     1. Kontext compose Duke → composite (Duke + scène)
 *     2. Kontext remove Duke  → clean BG (scène sans Duke)
 *     3. extractCharacterByDiff(composite, cleanBg) → Duke transparent PNG
 *     4. addLayer(media_url = Duke transparent) → multi-perso composables
 *
 * Pourquoi ça marche : Kontext compose et Kontext remove sortent du même
 * modèle avec la même graine de tokenizer → les BG matchent au pixel près
 * EN DEHORS du perso. La différence pixel = silhouette + ombres du perso.
 *
 * Tradeoff : pas d'appel server, ~2-3s en browser. Quality : excellente
 * pour Kontext (drift BG minime), pourrait être moins bonne sur d'autres
 * modèles avec plus de variance pixel.
 */

/** Charge une image cross-origin via <Image>. Retourne l'élément prêt à dessiner. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${url.slice(0, 100)}`))
    img.src = url
  })
}

export interface ExtractCharacterOptions {
  /** URL Supabase de l'image avec le perso (Kontext compose) */
  compositeUrl: string
  /** URL Supabase de l'image sans le perso (Kontext remove) */
  cleanBgUrl: string
  /** Préfixe path Supabase pour le PNG transparent uploadé.
   *  Ex: `test/scene-42_char_transparent` → fichier final
   *  `test/scene-42_char_transparent/{timestamp}.png` */
  storagePathPrefix: string
  /** Distance RGB Euclidienne min pour pixel "différent". Défaut 25.
   *  Plus haut = moins de noise BG mais perso plus rongé bords. */
  threshold?: number
}

/**
 * Extrait le perso (différences pixel) entre `compositeUrl` et `cleanBgUrl`,
 * uploade le PNG transparent dans Supabase Storage, retourne l'URL Supabase.
 *
 * GARANTIE : retourne TOUJOURS une URL HTTPS Supabase persistante. Pas de
 * blob URL exposée au caller (cf `feedback_always_persist_to_supabase.md`).
 *
 * @returns URL Supabase HTTPS du PNG transparent (persistant, survit refresh).
 * @throws Error si l'upload Supabase échoue (le caller doit gérer pour ne PAS
 *               créer un calque sans média).
 */
export async function extractCharacterByDiff(
  opts: ExtractCharacterOptions,
): Promise<string> {
  const { compositeUrl, cleanBgUrl, storagePathPrefix, threshold = 25 } = opts
  const [compositeImg, cleanImg] = await Promise.all([
    loadImage(compositeUrl),
    loadImage(cleanBgUrl),
  ])

  // On utilise les dimensions du composite comme référence. Si le clean BG
  // a des dims différentes (rare avec Kontext mais possible), on le scale.
  const w = compositeImg.naturalWidth
  const h = compositeImg.naturalHeight

  // Canvas principal pour le composite
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context not available')
  ctx.drawImage(compositeImg, 0, 0, w, h)
  const compData = ctx.getImageData(0, 0, w, h)

  // Canvas séparé pour le clean BG (scaled si besoin)
  const offscreen = document.createElement('canvas')
  offscreen.width = w
  offscreen.height = h
  const offCtx = offscreen.getContext('2d', { willReadFrequently: true })
  if (!offCtx) throw new Error('Offscreen 2D context not available')
  offCtx.drawImage(cleanImg, 0, 0, w, h)
  const cleanData = offCtx.getImageData(0, 0, w, h)

  // Calcule le diff pixel par pixel
  const result = ctx.createImageData(w, h)
  const thresholdSq = threshold * threshold
  let charPixelCount = 0

  for (let i = 0; i < compData.data.length; i += 4) {
    const dr = compData.data[i]     - cleanData.data[i]
    const dg = compData.data[i + 1] - cleanData.data[i + 1]
    const db = compData.data[i + 2] - cleanData.data[i + 2]
    // Distance Euclidienne au carré (évite sqrt)
    const distSq = dr * dr + dg * dg + db * db

    if (distSq > thresholdSq) {
      // Pixel changé → appartient au perso, conserve la couleur du composite
      result.data[i]     = compData.data[i]
      result.data[i + 1] = compData.data[i + 1]
      result.data[i + 2] = compData.data[i + 2]
      result.data[i + 3] = 255
      charPixelCount++
    } else {
      // Pixel identique → BG, transparent
      result.data[i + 3] = 0
    }
  }

  console.log(`[image-diff] threshold=${threshold} → ${charPixelCount} char pixels (${(charPixelCount / (w * h) * 100).toFixed(1)}% du frame)`)

  ctx.putImageData(result, 0, 0)

  // ── Upload Supabase intégré (garantie no-blob-url-leakage) ──
  // Le canvas → PNG blob → data URL → POST upload-image → URL Supabase.
  // On utilise data URL car la route /api/storage/upload-image accepte ce format.
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), 'image/png')
  })

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })

  const res = await fetch('/api/storage/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data_url: dataUrl,
      path: `${storagePathPrefix}/${Date.now()}.png`,
    }),
  })
  const data = await res.json()
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? `image-diff: Supabase upload failed (HTTP ${res.status})`)
  }

  console.log('[image-diff] uploaded to Supabase:', data.url)
  return data.url as string
}
