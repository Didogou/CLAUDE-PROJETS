/**
 * Helper pour LTX 2.3 + IC LoRA Dual Characters (Lightricks + MaqueAI).
 *
 * Pipeline cinématique multi-perso : prend 1 image + prompt structuré
 * (scene/characters/shots) → vidéo MP4 avec persos animés en plusieurs plans.
 *
 * État 2026-05-02 :
 *   - Modèles téléchargés (LTX 2.3 GGUF, distilled LoRA, IC LoRA Dual, Gemma, VAE)
 *   - Custom node ComfyUI-LTXVideo à jour
 *   - ⚠ Workflow API JSON à exporter depuis ComfyUI puis bake dans Hero
 *     (cf. instructions dans la page POC `/editor-test/ltx-dual-characters`)
 *
 * Workflow type backend : 'ltx_2_3_dual'
 * Le builder lit un JSON template (ltx_2_3_dual.api.json) et substitue :
 *   - LoadImage filename (= image source uploadée)
 *   - CLIPTextEncode positive widget_values (= prompt positif)
 *   - CLIPTextEncode negative widget_values (= prompt négatif)
 *   - Optionnel : seed pour variance
 */

import { extractFramesFromVideo } from './extract-frames'

export interface Ltx23DualProgress {
  stage: 'upload' | 'queuing' | 'generating' | 'fetching' | 'extracting_frames' | 'done' | 'error'
  label?: string
}

export interface Ltx23DualOptions {
  /** URL Supabase de l'image source à animer. */
  imageUrl: string
  /** Prompt positif structuré (scene/characters/shot 1.../shot 2...). */
  positivePrompt: string
  /** Prompt négatif (court). */
  negativePrompt?: string
  /** Seed (-1 = random). */
  seed?: number
  /** Callback de progression UI. */
  onProgress?: (p: Ltx23DualProgress) => void
  /** Si true, capture première + dernière frame du MP4 et upload Supabase
   *  (cf décision 2026-05-03 : vignette banque + modale "image début/fin"
   *  ont besoin de ces thumbnails). Défaut true. Mettre false pour tests
   *  rapides où on ne stocke pas dans la banque. */
  extractFrames?: boolean
}

/** Résultat enrichi avec les frames extraites (si extractFrames!=false). */
export interface Ltx23DualResult {
  video_url: string
  /** URL Supabase de la 1ère frame du MP4 (état initial). null si extractFrames=false. */
  first_frame_url: string | null
  /** URL Supabase de la dernière frame du MP4 (état final figé). null si extractFrames=false. */
  last_frame_url: string | null
}

const POLL_INTERVAL_MS = 5000
// 12 min : LTX 2.3 sur 8 GB lowvram = lent (modèle 14 GB + Gemma 9.4 GB en
// swap RAM/VRAM constant)
const MAX_WAIT_MS = 12 * 60 * 1000

/** Upload une image (URL Supabase) dans le file store de ComfyUI. */
async function uploadToComfy(url: string, name: string): Promise<string> {
  const res = await fetch('/api/comfyui/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'url', url, name }),
  })
  const data = await res.json()
  if (!res.ok || !data.filename) {
    throw new Error(data.error ?? `comfy upload ${name} failed`)
  }
  return data.filename
}

/** Lance LTX 2.3 + IC LoRA Dual Characters et attend le résultat. Extrait
 *  automatiquement la première et la dernière frame du MP4 généré (sauf si
 *  `extractFrames: false`). */
export async function runLtx23Dual(opts: Ltx23DualOptions): Promise<Ltx23DualResult> {
  const { imageUrl, positivePrompt, negativePrompt, seed, onProgress } = opts
  const extractFrames = opts.extractFrames !== false  // défaut true

  onProgress?.({ stage: 'upload', label: 'Préparation…' })

  // Free VRAM avant ce workflow ultra-lourd (~24 GB combinés)
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
  await new Promise(r => setTimeout(r, 2000))

  const upImg = await uploadToComfy(imageUrl, 'ltx_dual_src')

  onProgress?.({ stage: 'queuing', label: 'Queue ComfyUI…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'ltx_2_3_dual',
      source_image: upImg,
      prompt_positive: positivePrompt,
      prompt_negative: negativePrompt ?? 'pc game, console game, video game, cartoon, childish, ugly, distorted face, deformed hands, watermark, text, blurry',
      seed: seed ?? -1,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'ltx_2_3_dual queue failed')
  }

  onProgress?.({ stage: 'generating', label: 'Génération vidéo… (3-5 min sur 8 GB lowvram)' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'ltx_2_3_dual failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('ltx_2_3_dual timeout (12 min) — sysmem fallback peut-être désactivé')

  onProgress?.({ stage: 'fetching', label: 'Récupération vidéo…' })

  // LTX produit une vidéo MP4 (pas une image) → action=video_info pour la fetch
  const storagePath = `test/ltx-dual/result_${Date.now()}`
  const vRes = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`
  ).then(r => r.json())
  if (!vRes.video_url) throw new Error(vRes.error ?? 'video_url manquante (sortie pas une vidéo ?)')

  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})

  // Capture des 2 frames (1ère + dernière) — vignette banque + modale copie.
  // Si l'extraction échoue (CORS, vidéo cassée), on log mais on retourne la
  // vidéo quand même : les frames sont un nice-to-have, pas un bloquant.
  let firstFrameUrl: string | null = null
  let lastFrameUrl: string | null = null
  if (extractFrames) {
    onProgress?.({ stage: 'extracting_frames', label: 'Capture des miniatures…' })
    try {
      const frames = await extractFramesFromVideo({
        videoUrl: vRes.video_url as string,
        storagePathPrefix: `test/ltx-dual/frames`,
      })
      firstFrameUrl = frames.first_frame_url
      lastFrameUrl = frames.last_frame_url
    } catch (err) {
      console.warn('[runLtx23Dual] extractFrames failed (non-bloquant):', err)
    }
  }

  onProgress?.({ stage: 'done' })
  return {
    video_url: vRes.video_url as string,
    first_frame_url: firstFrameUrl,
    last_frame_url: lastFrameUrl,
  }
}
