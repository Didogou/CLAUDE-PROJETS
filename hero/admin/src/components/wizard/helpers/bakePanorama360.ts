/**
 * Helper "bake" pour panorama 360° : intègre chaque NPC placé dans la scène
 * via SDXL inpainting + IPAdapter FaceID, au lieu des sprites 2D flat.
 *
 * Pipeline par NPC :
 *   1. Calcule la position pixel (x, y) + taille de la silhouette dans le pano flat
 *      à partir des coords sphériques (theta, phi, scale)
 *   2. Crop une région 1024×1024 centrée sur ce point depuis le pano source
 *   3. Dessine un mask (ellipse verticale silhouette humaine) à la position du NPC
 *      dans le crop, upload crop + mask vers Supabase
 *   4. Appelle /api/comfyui/inpaint avec le crop + mask + FaceID du NPC portrait
 *      → SDXL inpaint intègre le perso avec lumière/ombre de la scène
 *   5. Télécharge le crop inpainted, le blit dans le pano final à la même position
 *      (avec feathering aux bords du crop)
 *
 * Orchestrateur : loop N persos séquentiellement, composite le résultat final
 * en 1 seul pano PNG uploadé vers Supabase.
 *
 * Limites V1 :
 *   - Silhouette simpliste (ellipse) — pas de pose réelle
 *   - 1 seul perso par passe inpaint (évite conflits FaceID multi-char)
 *   - Si un perso est près du "bord" du pano équirectangulaire, le crop ne wrap
 *     pas (V2 : crop circulaire en rotation pour gérer le wraparound)
 */
import type { Npc, Item } from '@/types'
import type { SceneNpcPlacement, SceneItemPlacement } from '../types'
import { resolveNpcImageUrl } from './npcImageVariant'

export interface BakeProgress {
  /** Nom du NPC en cours. */
  charName: string
  /** Nb de NPCs déjà intégrés. */
  done: number
  /** Total de NPCs à intégrer. */
  total: number
  /** Numéro de l'essai en cours pour ce NPC (1-indexé). */
  attempt?: number
  /** Nombre max d'essais autorisés pour ce NPC. */
  maxAttempts?: number
  /** Dernier score du juge (0-10). Undefined tant que le juge n'a pas parlé. */
  lastScore?: number
}

export interface BakePanorama360Params {
  /** URL du panorama base (sans persos). */
  panoramaUrl: string
  /** Liste des NPCs placés à intégrer. */
  placements: SceneNpcPlacement[]
  /** NPCs disponibles (pour résoudre les portraits). */
  npcs: Npc[]
  /** Liste des items placés à dessiner en sprite sur le pano baked (optionnel).
   *  Les items ne sont pas inpaintés par IA : ils sont compositées tels quels,
   *  en respectant custom_url prioritaire sur le lookup DB. */
  itemPlacements?: SceneItemPlacement[]
  /** Items disponibles (pour résoudre illustration_url). */
  items?: Item[]
  /** Checkpoint SDXL. */
  checkpoint: string
  /** Contexte de scène pour le prompt (ex : prompt du plan). */
  sceneContext: string
  /** Prompt négatif. */
  promptNegative?: string
  /** Préfixe Supabase de stockage. */
  storagePathPrefix: string
  /** Nb max d'essais par NPC (avec juge Claude Vision). Défaut : 3.
   *  Mettre à 1 pour désactiver le juge + retry. */
  maxAttempts?: number
  /** Score mini accepté par le juge (0-10). Défaut : 6. En-dessous → retry. */
  minScore?: number
  /** Callback de progression (object pour extensibilité). */
  onProgress?: (p: BakeProgress) => void
}

/** Charge une image (CORS) et renvoie un HTMLImageElement. */
async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

/** Upload un blob PNG vers /api/upload-image → renvoie l'URL Supabase. */
async function uploadBlobPng(blob: Blob, storagePath: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'bake.png')
  form.append('path', storagePath)
  const res = await fetch('/api/upload-image', { method: 'POST', body: form })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Upload échoué (${res.status}): ${txt.slice(0, 200)}`)
  }
  const d = await res.json()
  if (!d.url) throw new Error(d.error || 'Upload : pas d\'URL')
  return d.url as string
}

/** Appelle le juge Claude Vision pour évaluer un crop inpainted.
 *  Retourne score/verdict/reason, ou null si le juge a planté (on laisse passer alors). */
async function judgeCandidate(params: {
  candidateUrl: string
  referenceUrl: string
  prompt: string
  npcName?: string
}): Promise<{ score: number; verdict: 'pass' | 'fail'; reason: string } | null> {
  try {
    const res = await fetch('/api/bake-judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate_url: params.candidateUrl,
        reference_url: params.referenceUrl,
        prompt: params.prompt,
        npc_name: params.npcName,
      }),
    })
    if (!res.ok) {
      console.warn('[bake/judge] HTTP', res.status, '— on laisse passer')
      return null
    }
    const d = await res.json()
    if (typeof d.score !== 'number') return null
    return { score: d.score, verdict: d.verdict === 'pass' ? 'pass' : 'fail', reason: d.reason ?? '' }
  } catch (err) {
    console.warn('[bake/judge] error:', err)
    return null
  }
}

/** Convertit theta/phi sphériques (degrés) en (x, y) pixels dans le pano équirectangulaire. */
function spherToPx(theta: number, phi: number, panoW: number, panoH: number): { x: number; y: number } {
  const x = ((theta % 360 + 360) % 360) / 360 * panoW
  const y = ((-phi / 180) + 0.5) * panoH
  return { x, y }
}

export async function bakePanorama360(params: BakePanorama360Params): Promise<string> {
  const { panoramaUrl, placements, npcs, checkpoint, sceneContext, promptNegative, storagePathPrefix, onProgress } = params
  const itemPlacements = params.itemPlacements ?? []
  const items = params.items ?? []
  const maxAttempts = Math.max(1, params.maxAttempts ?? 3)
  const minScore = params.minScore ?? 6

  // 1. Charge le pano source en canvas
  const panoImg = await loadImage(panoramaUrl)
  const panoW = panoImg.naturalWidth
  const panoH = panoImg.naturalHeight

  // Canvas final sur lequel on va composer les inpaints
  const finalCanvas = document.createElement('canvas')
  finalCanvas.width = panoW
  finalCanvas.height = panoH
  const finalCtx = finalCanvas.getContext('2d')!
  finalCtx.drawImage(panoImg, 0, 0)

  // Taille du crop (fixe à 1024, SDXL native)
  const CROP = 1024

  for (let idx = 0; idx < placements.length; idx++) {
    const p = placements[idx]
    const npc = npcs.find(n => n.id === p.npc_id)
    if (!npc) continue
    const portraitUrl = resolveNpcImageUrl(npc, p.image_variant)
    if (!portraitUrl) continue

    onProgress?.({ charName: npc.name, done: idx, total: placements.length, attempt: 1, maxAttempts })

    // Position pixel dans le pano
    const { x: cx, y: cy } = spherToPx(p.theta, p.phi, panoW, panoH)

    // Crop bounds (clamp aux bords du pano)
    const cropX = Math.max(0, Math.min(panoW - CROP, Math.round(cx - CROP / 2)))
    const cropY = Math.max(0, Math.min(panoH - CROP, Math.round(cy - CROP / 2)))

    // 2. Crop → upload (une seule fois, réutilisé pour tous les essais)
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = CROP
    cropCanvas.height = CROP
    const cctx = cropCanvas.getContext('2d')!
    cctx.drawImage(panoImg, cropX, cropY, CROP, CROP, 0, 0, CROP, CROP)
    const cropBlob: Blob = await new Promise((resolve, reject) => {
      cropCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    })
    const cropUrl = await uploadBlobPng(cropBlob, `${storagePathPrefix}_bake_crop_${idx}_${Date.now()}`)

    // 3. Mask silhouette (upload une fois, réutilisé)
    const figCx = cx - cropX
    const figCy = cy - cropY
    const figW = CROP * 0.18 * p.scale
    const figH = CROP * 0.55 * p.scale
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = CROP
    maskCanvas.height = CROP
    const mctx = maskCanvas.getContext('2d')!
    mctx.fillStyle = 'black'
    mctx.fillRect(0, 0, CROP, CROP)
    mctx.fillStyle = 'white'
    mctx.beginPath()
    mctx.ellipse(figCx, figCy, figW / 2, figH / 2, 0, 0, Math.PI * 2)
    mctx.fill()
    const maskBlob: Blob = await new Promise((resolve, reject) => {
      maskCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    })
    const maskUrl = await uploadBlobPng(maskBlob, `${storagePathPrefix}_bake_mask_${idx}_${Date.now()}`)

    // 4. Prompt (auto ou custom)
    const autoPrompt = `a person standing, ${npc.appearance ?? npc.description ?? npc.name}, in the scene, matching lighting, integrated naturally, ${sceneContext}`
    const promptPositive = p.bake_prompt?.trim()
      ? `${p.bake_prompt.trim()}, matching scene lighting, integrated naturally, ${sceneContext}`
      : autoPrompt
    const effectiveNegative = p.bake_negative?.trim()
      ? `${promptNegative ?? ''}, ${p.bake_negative.trim()}`
      : promptNegative

    // 5. Retry loop avec juge Claude Vision
    //    On génère jusqu'à `maxAttempts` inpaints, on les juge, on garde le meilleur.
    //    Si un passe le seuil → break immédiat (pas de tokens gaspillés).
    //    Si tous échouent → on utilise le meilleur score obtenu.
    let bestUrl: string | null = null
    let bestScore = -1
    let bestReason = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      onProgress?.({ charName: npc.name, done: idx, total: placements.length, attempt, maxAttempts, lastScore: bestScore >= 0 ? bestScore : undefined })

      const inpaintRes = await fetch('/api/comfyui/inpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: cropUrl,
          mask_url: maskUrl,
          checkpoint,
          prompt_positive: promptPositive,
          prompt_negative: effectiveNegative,
          storage_path: `${storagePathPrefix}_bake_out_${idx}_a${attempt}_${Date.now()}`,
          denoise: 0.9,
          steps: 30,
          cfg: 7,
          characters: [{ portraitUrl, name: npc.name, weight: 0.8 }],
        }),
      })
      if (!inpaintRes.ok) {
        console.warn(`[bake] inpaint failed for ${npc.name} (attempt ${attempt})`)
        continue
      }
      const inpaintData = await inpaintRes.json()
      if (!inpaintData.image_url) continue
      const candidateUrl = inpaintData.image_url as string

      // Si 1 seul essai demandé → on skip le juge (économie tokens + latence)
      if (maxAttempts === 1) {
        bestUrl = candidateUrl
        break
      }

      const verdict = await judgeCandidate({
        candidateUrl,
        referenceUrl: portraitUrl,
        prompt: promptPositive,
        npcName: npc.name,
      })

      if (!verdict) {
        // Juge indisponible → on considère ce candidat comme "probablement OK" et on arrête
        console.warn(`[bake] judge unavailable for ${npc.name}, accepting candidate ${attempt}`)
        bestUrl = candidateUrl
        break
      }
      console.log(`[bake] ${npc.name} attempt ${attempt}: score ${verdict.score}/10 (${verdict.verdict}) — ${verdict.reason}`)

      if (verdict.score > bestScore) {
        bestScore = verdict.score
        bestUrl = candidateUrl
        bestReason = verdict.reason
      }

      if (verdict.verdict === 'pass' && verdict.score >= minScore) {
        // Suffisant — on ne brûle pas de tokens pour faire mieux
        break
      }
    }

    if (!bestUrl) {
      console.warn(`[bake] no usable candidate for ${npc.name} after ${maxAttempts} attempts, skipping`)
      continue
    }
    if (bestScore >= 0 && bestScore < minScore) {
      console.warn(`[bake] ${npc.name} gardé au meilleur score ${bestScore}/10 malgré fail — ${bestReason}`)
    }

    // 6. Blit le meilleur candidat dans le pano final avec feathering
    const inpaintImg = await loadImage(bestUrl)
    const featherCanvas = document.createElement('canvas')
    featherCanvas.width = CROP
    featherCanvas.height = CROP
    const fctx = featherCanvas.getContext('2d')!
    fctx.drawImage(inpaintImg, 0, 0, CROP, CROP)
    const grad = fctx.createRadialGradient(CROP / 2, CROP / 2, CROP * 0.35, CROP / 2, CROP / 2, CROP * 0.5)
    grad.addColorStop(0, 'rgba(0,0,0,1)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    fctx.globalCompositeOperation = 'destination-in'
    fctx.fillStyle = grad
    fctx.fillRect(0, 0, CROP, CROP)
    fctx.globalCompositeOperation = 'source-over'
    finalCtx.drawImage(featherCanvas, cropX, cropY)
  }

  // 6. Compositage des items en sprites (pas d'IA — les items sont placés tels quels).
  //    Cela couvre à la fois les items en DB et les objets générés à la volée
  //    dans le compositeur (custom_url prioritaire).
  if (itemPlacements.length > 0) {
    onProgress?.({ charName: 'items', done: placements.length, total: placements.length + itemPlacements.length })
    for (const ip of itemPlacements) {
      const url = ip.custom_url ?? items.find(i => i.id === ip.item_id)?.illustration_url
      if (!url) continue
      try {
        const itemImg = await loadImage(url)
        const { x: ix, y: iy } = spherToPx(ip.theta, ip.phi, panoW, panoH)
        // Taille : 10% de la hauteur du pano à scale=1 (cohérent avec Pano360Composer)
        const size = panoH * 0.10 * ip.scale
        const w = size * 0.8
        const h = size * 0.8
        finalCtx.save()
        finalCtx.translate(ix, iy)
        if (ip.rotation) finalCtx.rotate((ip.rotation * Math.PI) / 180)
        finalCtx.drawImage(itemImg, -w / 2, -h / 2, w, h)
        finalCtx.restore()
      } catch (err) {
        console.warn(`[bake] item ${ip.item_id} load failed:`, err)
      }
    }
  }

  // 7. Upload final pano baked
  onProgress?.({ charName: 'final upload', done: placements.length + itemPlacements.length, total: placements.length + itemPlacements.length })
  const finalBlob: Blob = await new Promise((resolve, reject) => {
    finalCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
  })
  return await uploadBlobPng(finalBlob, `${storagePathPrefix}_pano360_baked_${Date.now()}`)
}
