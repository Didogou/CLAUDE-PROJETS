/**
 * Helpers d'extraction SAM auto pour le fold Découpe.
 *
 * Workflow :
 *   1. L'utilisateur trace un rectangle sur l'image
 *   2. Appel à extractZonesFromRect :
 *      - Crop l'image sur le rectangle → uploade la version croppée
 *      - Appelle /api/comfyui/segment-auto sur le crop → reçoit N masks
 *      - Remappe chaque mask dans les coords de l'image pleine (pad avec
 *        transparence hors du rect) → uploade les full-size masks
 *      - Calcule la bbox de chaque zone en coords normalisées 0-1
 *   3. Le composant Canvas affiche les zones comme overlays cliquables
 *   4. L'utilisateur clique une zone → actions disponibles (erase, inpaint,
 *      créer calque animé…)
 *
 * Toutes les conversions de coordonnées sont en pixels naturels (image source)
 * pour garantir la correspondance pixel-perfect avec les actions downstream.
 */

export interface ExtractZonesInput {
  imageUrl: string
  /** Rectangle en coords normalisées 0-1 (état `cutSelection` du contexte). */
  rect: { x1: number; y1: number; x2: number; y2: number }
  /** Préfixe Supabase pour l'upload des masks remappés. */
  storagePathPrefix: string
  /**
   * Granularité de la segmentation (filtrage côté client après SAM auto) :
   *   - 'large'  (NOUVEAU) : seul les zones > 3% du crop. Ne garde que les
   *     gros objets (canapé, arbre entier, voiture). 5-15 zones max.
   *   - 'coarse' (défaut historique) : zones > 0.3% du crop. Compromis.
   *     30-80 zones typiquement.
   *   - 'fine' : zones > 0.05% du crop. Tout détail individuel détecté.
   *     50-200 zones, peut être overwhelming.
   *
   *   Background (>90% du crop) toujours filtré peu importe le mode.
   */
  granularity?: 'large' | 'coarse' | 'fine'
}

export interface ExtractedZone {
  /** URL du mask PNG full-size (même dimensions que l'image source). */
  maskUrl: string
  /** Index d'ordre SAM (0 = plus grand objet typiquement). */
  index: number
  /** Bbox de l'objet dans l'image source (coords normalisées 0-1). */
  bbox: { x1: number; y1: number; x2: number; y2: number }
  /** Aire du mask en pixels (pour tri par taille). Optionnel pour rétro-compat. */
  area?: number
}

/** Charge une image (avec crossOrigin pour pouvoir la lire en canvas). */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${url.slice(0, 80)}`))
    img.src = url
  })
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

/**
 * Crop l'image sur le rectangle et upload la version croppée.
 * Retourne l'URL + les offsets pour le remapping des masks.
 */
async function cropAndUpload(
  imageUrl: string,
  rect: { x1: number; y1: number; x2: number; y2: number },
  storagePathPrefix: string,
): Promise<{ cropUrl: string; natW: number; natH: number; offsetX: number; offsetY: number; cropW: number; cropH: number }> {
  const img = await loadImage(imageUrl)
  const natW = img.naturalWidth
  const natH = img.naturalHeight
  const offsetX = Math.round(rect.x1 * natW)
  const offsetY = Math.round(rect.y1 * natH)
  const cropW = Math.round((rect.x2 - rect.x1) * natW)
  const cropH = Math.round((rect.y2 - rect.y1) * natH)

  const canvas = document.createElement('canvas')
  canvas.width = cropW
  canvas.height = cropH
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, offsetX, offsetY, cropW, cropH, 0, 0, cropW, cropH)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  const cropUrl = await uploadBlob(blob, `${storagePathPrefix}_extract_crop_${Date.now()}`)
  return { cropUrl, natW, natH, offsetX, offsetY, cropW, cropH }
}

/**
 * Remappe un mask (dimensions = cropW × cropH) en mask full-size (natW × natH)
 * avec le mask placé au bon offset et du noir partout ailleurs.
 * Calcule aussi la bbox normalisée pour positionner l'overlay UI.
 */
async function remapMaskToFullSize(
  maskCropUrl: string,
  params: { natW: number; natH: number; offsetX: number; offsetY: number; cropW: number; cropH: number },
  storagePathPrefix: string,
  index: number,
): Promise<{ fullMaskUrl: string; bbox: { x1: number; y1: number; x2: number; y2: number }; area: number }> {
  const { natW, natH, offsetX, offsetY, cropW, cropH } = params
  const maskImg = await loadImage(maskCropUrl)

  // 1. Crée une surface natW × natH noire et colle le mask au bon offset
  const canvas = document.createElement('canvas')
  canvas.width = natW
  canvas.height = natH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, natW, natH)
  ctx.drawImage(maskImg, 0, 0, cropW, cropH, offsetX, offsetY, cropW, cropH)

  // 2. Lit les pixels pour calculer la bbox ET l'aire (seulement dans la zone du crop)
  const data = ctx.getImageData(offsetX, offsetY, cropW, cropH).data
  let minX = cropW, minY = cropH, maxX = -1, maxY = -1
  let area = 0
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const idx = (y * cropW + x) * 4
      if (data[idx] > 127) {
        area++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  // Bbox en coords image source normalisées 0-1
  const bbox = maxX < 0 ? { x1: 0, y1: 0, x2: 0, y2: 0 } : {
    x1: (offsetX + minX) / natW,
    y1: (offsetY + minY) / natH,
    x2: (offsetX + maxX + 1) / natW,
    y2: (offsetY + maxY + 1) / natH,
  }

  // 3. Upload le mask full-size
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  const fullMaskUrl = await uploadBlob(blob, `${storagePathPrefix}_extract_mask_${index}_${Date.now()}`)
  return { fullMaskUrl, bbox, area }
}

/**
 * Flow principal : crop + segment-auto + remap des masks.
 *
 * Filtre les zones trop petites (< 0.2% du crop) : probablement du bruit SAM.
 */
export async function extractZonesFromRect({
  imageUrl, rect, storagePathPrefix, granularity = 'coarse',
}: ExtractZonesInput): Promise<ExtractedZone[]> {
  // 1. Crop + upload
  const cropInfo = await cropAndUpload(imageUrl, rect, storagePathPrefix)

  // 2. Appel SAM auto — on ne passe AUCUN param SAM côté serveur.
  //    Le node custom HeroSam2AutoIndividual a un bug connu avec
  //    `min_mask_region_area > 0` (remove_small_regions peut tout vider et
  //    faire planter MaskToImage). On garde donc les défauts SAM et on filtre
  //    les petits masks CÔTÉ CLIENT après réception (granularity='coarse').
  const cropArea = cropInfo.cropW * cropInfo.cropH
  const res = await fetch('/api/comfyui/segment-auto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: cropInfo.cropUrl }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`SAM auto a échoué (${res.status}). ${txt.slice(0, 200)}`)
  }
  const d = await res.json() as { masks: Array<{ url: string; index: number }> }
  if (!Array.isArray(d.masks) || d.masks.length === 0) {
    return []
  }

  // 3. Remappe chaque mask + filtre selon la granularité (côté client)
  //
  // Filtrage :
  //   - Toujours : skip les zones dégénérées (bbox vide), skip les masks
  //     >90% du crop (background).
  //   - Mode 'large'  : seuil 3% du crop → garde uniquement les gros objets.
  //   - Mode 'coarse' : seuil 0.3% du crop → compromis.
  //   - Mode 'fine'   : seuil 0.05% du crop → tout détail détecté.
  const areaThresholdPct =
    granularity === 'large'  ? 0.03   // 3%
    : granularity === 'fine' ? 0.0005 // 0.05%
    :                          0.003  // 0.3% (coarse)
  const minArea = Math.max(50, Math.floor(cropArea * areaThresholdPct))
  const maxAreaBackground = Math.floor(cropArea * 0.9)
  const zones: ExtractedZone[] = []
  for (const m of d.masks) {
    try {
      const { fullMaskUrl, bbox, area } = await remapMaskToFullSize(m.url, cropInfo, storagePathPrefix, m.index)
      if (bbox.x2 <= bbox.x1 || bbox.y2 <= bbox.y1) continue
      if (area > maxAreaBackground) continue // background quasi plein-crop
      if (area < minArea) continue            // trop petit pour ce mode
      zones.push({ maskUrl: fullMaskUrl, index: m.index, bbox, area })
    } catch (err) {
      console.warn('[extractZones] mask remap failed:', m.index, err)
    }
  }
  // Tri par aire descendante : les plus gros objets d'abord (UX : on voit les
  // candidates sérieux en premier, le bruit éventuel en bas)
  zones.sort((a, b) => (b.area ?? 0) - (a.area ?? 0))
  return zones
}

/**
 * Union pixel-par-pixel de N masks (1, 2, … N). Upload unique, quelle que soit
 * la longueur → plus rapide que `combineMasks` en chaîne.
 *
 * Cas d'usage : toggle de sélection multi-zones → recalcul de l'union à chaque
 * clic utilisateur.
 */
export async function combineMasksMulti(
  urls: string[],
  storagePathPrefix: string,
): Promise<string | null> {
  if (urls.length === 0) return null
  if (urls.length === 1) return urls[0]  // évite upload redondant

  const images = await Promise.all(urls.map(loadImageInternal))
  const W = images[0].naturalWidth
  const H = images[0].naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H)

  // Pour chaque mask suivant, on accumule le MAX par pixel
  for (const img of images) {
    const tmp = document.createElement('canvas')
    tmp.width = W; tmp.height = H
    const tmpCtx = tmp.getContext('2d')!
    tmpCtx.drawImage(img, 0, 0, W, H)
    const tmpData = tmpCtx.getImageData(0, 0, W, H)
    for (let i = 0; i < data.data.length; i += 4) {
      if (tmpData.data[i] > 127) {
        data.data[i] = 255
        data.data[i + 1] = 255
        data.data[i + 2] = 255
      }
      data.data[i + 3] = 255
    }
  }
  ctx.putImageData(data, 0, 0)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  return await uploadBlob(blob, `${storagePathPrefix}_mask_union_${Date.now()}`)
}

function loadImageInternal(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${url.slice(0, 80)}`))
    img.src = url
  })
}

/**
 * Combine deux masks pixel-par-pixel.
 *   - op='union'    : pixel blanc si blanc dans A OU B → étend la sélection (shift+clic)
 *   - op='subtract' : pixel blanc si blanc dans A ET noir dans B → retire B de A (alt+clic)
 *
 * Les deux masks doivent être de même taille (tous les masks full-size le sont,
 * car remappés à natW×natH par `remapMaskToFullSize`).
 */
export async function combineMasks(
  urlA: string,
  urlB: string,
  op: 'union' | 'subtract',
  storagePathPrefix: string,
): Promise<string> {
  const imgA = await loadImage(urlA)
  const imgB = await loadImage(urlB)
  const W = imgA.naturalWidth
  const H = imgA.naturalHeight

  const canvasA = document.createElement('canvas')
  canvasA.width = W; canvasA.height = H
  const ctxA = canvasA.getContext('2d')!
  ctxA.drawImage(imgA, 0, 0, W, H)
  const dataA = ctxA.getImageData(0, 0, W, H)

  const canvasB = document.createElement('canvas')
  canvasB.width = W; canvasB.height = H
  const ctxB = canvasB.getContext('2d')!
  ctxB.drawImage(imgB, 0, 0, W, H)
  const dataB = ctxB.getImageData(0, 0, W, H)

  for (let i = 0; i < dataA.data.length; i += 4) {
    const a = dataA.data[i]
    const b = dataB.data[i]
    const v = op === 'union'
      ? (a > 127 || b > 127 ? 255 : 0)
      : (a > 127 && b <= 127 ? 255 : 0)
    dataA.data[i] = v
    dataA.data[i + 1] = v
    dataA.data[i + 2] = v
    dataA.data[i + 3] = 255
  }
  ctxA.putImageData(dataA, 0, 0)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvasA.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  return await uploadBlob(blob, `${storagePathPrefix}_mask_${op}_${Date.now()}`)
}

/**
 * Convertit le PNG RGBA d'un calque extrait (alpha=subject) en mask B&W
 * opaque (blanc où subject, noir ailleurs, alpha=255 partout).
 *
 * Nécessaire pour les workflows ComfyUI qui attendent un mask "dessiné" (ex :
 * motion_brush, inpaint) et non un PNG transparent.
 */
export async function layerAlphaToMask(
  layerUrl: string,
  storagePathPrefix: string,
): Promise<string> {
  const img = await loadImage(layerUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, W, H)

  for (let i = 0; i < data.data.length; i += 4) {
    const v = data.data[i + 3] > 127 ? 255 : 0
    data.data[i] = v
    data.data[i + 1] = v
    data.data[i + 2] = v
    data.data[i + 3] = 255
  }
  ctx.putImageData(data, 0, 0)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  return await uploadBlob(blob, `${storagePathPrefix}_layer_mask_${Date.now()}`)
}

/**
 * Calcule un PREVIEW LOCAL (en mémoire, pas d'upload) du résultat d'extraction
 * tel qu'il apparaîtrait si l'utilisateur cliquait "Extraire" maintenant.
 * Retourne une blob URL — le caller DOIT revoke() cette URL quand il en
 * change ou unmount, sinon fuite mémoire.
 *
 * Pipeline single-canvas :
 *   1. Si baseExtractedUrl (= cutResultUrl) → drawImage comme point de départ
 *   2. Construit un canvas mask : union des selectedMaskUrls (via lighten) +
 *      brush strokes (via renderStrokesToCanvas)
 *   3. Extrait les pixels source via le mask (luminance R → alpha)
 *   4. drawImage extract par-dessus le base
 *   5. canvas.toBlob → URL.createObjectURL
 *
 * Retourne null si rien à afficher.
 */
export async function buildLivePreviewBlobUrl(opts: {
  imageUrl: string
  baseExtractedUrl: string | null
  selectedMaskUrls: string[]
  brushStrokes: import('../EditorStateContext').BrushStroke[]
}): Promise<string | null> {
  const { imageUrl, baseExtractedUrl, selectedMaskUrls, brushStrokes } = opts
  const filteredMaskUrls = selectedMaskUrls.filter(u => !u.startsWith('pending:'))
  if (!baseExtractedUrl && filteredMaskUrls.length === 0 && brushStrokes.length === 0) {
    return null
  }

  const srcImg = await loadImageInternal(imageUrl)
  const W = srcImg.naturalWidth
  const H = srcImg.naturalHeight

  const out = document.createElement('canvas')
  out.width = W; out.height = H
  const octx = out.getContext('2d')
  if (!octx) return null

  // 1. Base déjà extraite (cutResultUrl)
  if (baseExtractedUrl) {
    try {
      const baseImg = await loadImageInternal(baseExtractedUrl)
      octx.drawImage(baseImg, 0, 0, W, H)
    } catch {
      // Si le base PNG ne charge pas (rare), on continue sans
    }
  }

  // 2 + 3. Construit le mask combiné + extrait depuis la source
  if (filteredMaskUrls.length > 0 || brushStrokes.length > 0) {
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = W; maskCanvas.height = H
    const mctx = maskCanvas.getContext('2d')!
    mctx.fillStyle = '#000'
    mctx.fillRect(0, 0, W, H)

    // Union des masks SAM/Lasso/Magic Wand (lighten = max par pixel)
    if (filteredMaskUrls.length > 0) {
      const maskImages = await Promise.all(filteredMaskUrls.map(loadImageInternal))
      mctx.globalCompositeOperation = 'lighten'
      for (const mi of maskImages) {
        mctx.drawImage(mi, 0, 0, W, H)
      }
      mctx.globalCompositeOperation = 'source-over'
    }

    // Brush strokes : rasterise dans un canvas temp puis union (lighten)
    if (brushStrokes.length > 0) {
      const { renderStrokesToCanvas } = await import('./brushToMask')
      const tmp = document.createElement('canvas')
      tmp.width = W; tmp.height = H
      const tctx = tmp.getContext('2d')!
      renderStrokesToCanvas(tctx, W, H, brushStrokes)
      mctx.globalCompositeOperation = 'lighten'
      mctx.drawImage(tmp, 0, 0)
      mctx.globalCompositeOperation = 'source-over'
    }

    // Extrait : source + alpha = mask R channel
    const extract = document.createElement('canvas')
    extract.width = W; extract.height = H
    const ectx = extract.getContext('2d')!
    ectx.drawImage(srcImg, 0, 0, W, H)
    const maskData = mctx.getImageData(0, 0, W, H)
    const extractData = ectx.getImageData(0, 0, W, H)
    for (let i = 0; i < extractData.data.length; i += 4) {
      extractData.data[i + 3] = maskData.data[i]
    }
    ectx.putImageData(extractData, 0, 0)

    // Compose par-dessus le base
    octx.drawImage(extract, 0, 0)
  }

  const blob: Blob = await new Promise((resolve, reject) => {
    out.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  return URL.createObjectURL(blob)
}

/**
 * Compose un nouveau PNG transparent par-dessus un PNG composite existant.
 * Les deux ont les mêmes dimensions (full-size de l'image source). Alpha
 * compositing 'source-over' standard : le nouveau remplace l'ancien là où il
 * est opaque, l'ancien reste là où le nouveau est transparent.
 *
 * Cas d'usage : bouton "Extraire" du Designer. Chaque clic enrichit la même
 * vignette dans le panneau gauche au lieu d'en créer une nouvelle.
 *
 * Si baseUrl est null, on retourne directement newLayerUrl (premier extract,
 * pas de composite à faire — économise un re-upload).
 */
export async function compositeExtractedPng(
  baseUrl: string | null,
  newLayerUrl: string,
  storagePathPrefix: string,
): Promise<string> {
  if (!baseUrl) return newLayerUrl

  const baseImg = await loadImage(baseUrl)
  const newImg = await loadImage(newLayerUrl)
  const W = baseImg.naturalWidth
  const H = baseImg.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(baseImg, 0, 0, W, H)
  ctx.drawImage(newImg, 0, 0, W, H) // source-over par défaut

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  return await uploadBlob(blob, `${storagePathPrefix}_extract_composite_${Date.now()}`)
}

/**
 * Extrait le sujet d'une zone (via son mask full-size) en PNG RGBA **pleine taille**
 * de l'image source, avec transparence partout sauf dans le mask.
 *
 * Utilisé pour créer un nouveau calque animé : le PNG résultant s'aligne
 * parfaitement sur la Base (position_offset: 0) et peut être empilé comme
 * overlay transparent.
 */
export async function extractZoneAsTransparentFullSize(
  sourceUrl: string,
  maskUrl: string,
  storagePathPrefix: string,
): Promise<string> {
  const srcImg = await loadImage(sourceUrl)
  const maskImg = await loadImage(maskUrl)
  const natW = srcImg.naturalWidth
  const natH = srcImg.naturalHeight

  // 1. Dessine le mask sur une surface natW × natH
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = natW; maskCanvas.height = natH
  const mctx = maskCanvas.getContext('2d')!
  mctx.drawImage(maskImg, 0, 0, natW, natH)
  const maskData = mctx.getImageData(0, 0, natW, natH)

  // 2. Dessine la source sur une surface natW × natH
  const out = document.createElement('canvas')
  out.width = natW; out.height = natH
  const octx = out.getContext('2d')!
  octx.drawImage(srcImg, 0, 0, natW, natH)
  const outData = octx.getImageData(0, 0, natW, natH)

  // 3. Injecte la luminance du mask dans l'alpha de la source
  //    → pixels source où mask=blanc → visibles, ailleurs → transparents
  for (let i = 0; i < outData.data.length; i += 4) {
    outData.data[i + 3] = maskData.data[i]
  }
  octx.putImageData(outData, 0, 0)

  // 4. Upload
  const blob: Blob = await new Promise((resolve, reject) => {
    out.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  return await uploadBlob(blob, `${storagePathPrefix}_layer_extract_${Date.now()}`)
}
