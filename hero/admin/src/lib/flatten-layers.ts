/**
 * Flatten plusieurs calques en UNE image composite (PNG).
 *
 * Utilité : LTX 2.3 I2V (animation) attend une seule image source. Si l'auteur
 * a inséré des persos via calques transparents (Insert Anything → image-diff),
 * il faut "aplatir" base + calques en une seule image AVANT de soumettre à LTX.
 * Sinon LTX reçoit juste l'image base sans les persos → identité perdue.
 *
 * Cf décision 2026-05-03 : flatten on-demand au moment de la gen animation.
 *
 * GARANTIE : retourne une URL HTTPS Supabase persistante (cf
 * `feedback_always_persist_to_supabase.md`).
 */

import type { EditorLayer } from '@/components/image-editor/types'

interface FlattenOptions {
  baseImageUrl: string
  /** Calques à composer dans l'ordre (premier = sous, dernier = au-dessus). */
  layers: EditorLayer[]
  /** Préfixe Supabase pour l'image flattened. */
  storagePathPrefix: string
  /** Quel calque considérer comme "Base" : si fourni et que layers[0] est cette
   *  base, on la skip pour éviter de dessiner la base 2× (base déjà dans
   *  baseImageUrl). Défaut : skip layers[0] systématiquement (convention Hero). */
  skipFirstLayerAsBase?: boolean
}

/** Charge une image cross-origin en respectant les CORS (Supabase OK). */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`flatten: image load failed: ${url.slice(0, 100)}`))
    img.src = url
  })
}

/**
 * Compose base + calques visibles dans un canvas, uploade Supabase, retourne URL.
 *
 * Optimisation 2026-05-05 : si après filtrage il n'y a aucun calque composable
 * (cas typique : plan sans overlay perso), on retourne `baseImageUrl` directement
 * sans toucher au canvas ni à Supabase Storage. Économise ~1-2s + un upload
 * par génération. La garantie "URL Supabase persistante" est préservée tant que
 * les callers passent eux-mêmes une `baseImageUrl` Supabase (vérifié pour les
 * 2 callers existants : CatalogAnimation + new-layout/page.tsx).
 *
 * Calques skipés (V1) :
 *   - `visible: false`
 *   - type vidéo (LTX I2V veut une frame statique, pas une vidéo)
 *   - type weather/particles (rendu canvas2D dynamique, pas un asset image)
 *   - sans `media_url` ni `baked_url`
 *   - URL `blob:` (mortes au refresh)
 *   - layers[0] (par convention = base, déjà dans baseImageUrl)
 */
export async function flattenLayersToImage(opts: FlattenOptions): Promise<string> {
  const { baseImageUrl, layers, storagePathPrefix, skipFirstLayerAsBase = true } = opts

  if (!baseImageUrl) throw new Error('flatten: baseImageUrl requis')

  // 1. Filtrer les calques composables AVANT toute opération coûteuse.
  //    Si zéro calque → on retourne baseImageUrl directement (skip canvas +
  //    re-encode + upload Supabase = ~1-2s + storage gaspillé sinon).
  const composables = layers.filter((l, idx) => {
    if (skipFirstLayerAsBase && idx === 0) return false  // base déjà dans baseImageUrl
    if (l.visible === false) return false
    if (l.weather) return false  // particles canvas, pas un asset image
    const url = l.baked_url ?? l.media_url
    if (!url) return false
    if (typeof url !== 'string') return false
    // Skip vidéos (LTX I2V veut une frame statique)
    if (/\.(mp4|webm|mov|gif)(\?|$)/i.test(url)) return false
    // Skip blob URLs (mortes, ne se chargeront pas — defensive)
    if (url.startsWith('blob:')) {
      console.warn('[flatten] Skipping layer with blob URL:', l.name, url)
      return false
    }
    return true
  })

  if (composables.length === 0) {
    console.log('[flatten] No composable layers → returning baseImageUrl directly (skip canvas + upload)')
    return baseImageUrl
  }

  // 2. Au moins 1 calque à composer → on charge la base + setup canvas
  const baseImg = await loadImage(baseImageUrl)
  const W = baseImg.naturalWidth
  const H = baseImg.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('flatten: canvas 2D context indisponible')

  // Dessine la base puis composite les overlays par-dessus
  ctx.drawImage(baseImg, 0, 0, W, H)

  console.log(`[flatten] Compositing base + ${composables.length} layer(s) into ${W}×${H} canvas`)

  // 3. Compose chaque calque par-dessus
  for (const layer of composables) {
    const url = layer.baked_url ?? layer.media_url
    if (!url) continue
    try {
      const img = await loadImage(url)
      const opacity = typeof layer.opacity === 'number' ? layer.opacity : 1
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity))
      // Position offset (utile pour ajustements visuels — défaut 0,0)
      const ox = layer.position_offset?.x ?? 0
      const oy = layer.position_offset?.y ?? 0
      // Dessine à la taille du canvas (les calques transparents PNG ont les
      // mêmes dimensions que la base par convention).
      ctx.drawImage(img, ox, oy, W, H)
    } catch (err) {
      console.warn('[flatten] Layer load failed, skipping:', layer.name, err)
    }
  }

  ctx.globalAlpha = 1  // reset

  // 4. Canvas → blob → data URL → upload Supabase
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('flatten: toBlob failed')), 'image/png')
  })
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('flatten: FileReader failed'))
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
    throw new Error(data.error ?? `flatten: Supabase upload failed (HTTP ${res.status})`)
  }

  console.log('[flatten] uploaded composite to Supabase:', data.url)
  return data.url as string
}
