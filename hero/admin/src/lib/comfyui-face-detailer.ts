/**
 * Helper pour le workflow `face_detailer_only` de ComfyUI.
 *
 * Pipeline en 1 pass : prend une image source (ex: plein pied T2I) + une
 * image de référence (ex: portrait), détecte le visage via YOLO, swap via
 * IPAdapter FaceID Plus v2 + InsightFace pour matcher l'identité de la ref.
 *
 * Retourne l'URL Supabase de l'image finale. Voir POC validé
 * `controlnet-character-swap` (phase B) et mémoire
 * `project_character_swap_validated_pipeline_2026_04_30`.
 */

export interface FaceDetailerProgress {
  /** Étape actuelle, pour driver l'UI. */
  stage: 'upload' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  /** Message lisible (ex: "Affinage du visage…"). */
  label?: string
}

export interface FaceDetailerOptions {
  /** URL Supabase de l'image source à affiner (ex: plein pied T2I). */
  sourceUrl: string
  /** URL Supabase de l'image ref dont on veut le visage (ex: portrait). */
  refUrl: string
  /** Prompt positif (souvent : tags du perso, sinon "detailed face"). */
  prompt?: string
  /** Préfixe Supabase Storage pour ranger le résultat final. */
  storagePathPrefix: string
  /** Poids IPAdapter FaceID (0.5-1.5, défaut 1.0). */
  faceWeight?: number
  /** Denoise du face swap (0.3-0.7, défaut 0.5). */
  faceDenoise?: number
  /** Callback de progression — pour l'UI. */
  onProgress?: (p: FaceDetailerProgress) => void
}

const POLL_INTERVAL_MS = 3000
const MAX_WAIT_MS = 5 * 60 * 1000   // 5 min, voir POC

/** Upload une image (URL Supabase) dans le file store de ComfyUI.
 *  Retourne le `filename` à passer aux nodes du workflow. */
export async function uploadToComfy(url: string, name: string): Promise<string> {
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

/** Lance le workflow face_detailer_only et attend le résultat (final URL). */
export async function runFaceDetailer(opts: FaceDetailerOptions): Promise<string> {
  const {
    sourceUrl, refUrl, prompt, storagePathPrefix,
    faceWeight = 1.0, faceDenoise = 0.5, onProgress,
  } = opts

  onProgress?.({ stage: 'upload', label: 'Préparation…' })

  // Free VRAM avant ce workflow lourd (anti-OOM 8 GB)
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
  await new Promise(r => setTimeout(r, 1500))

  const upSrc = await uploadToComfy(sourceUrl, 'cc_fd_src')
  const upRef = await uploadToComfy(refUrl, 'cc_fd_ref')

  onProgress?.({ stage: 'queuing', label: 'Affinage du visage…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'face_detailer_only',
      source_image: upSrc,
      reference_image: upRef,
      prompt_positive: prompt?.trim() || 'detailed face, beautiful eyes, sharp features',
      prompt_negative: 'blurry, low quality, deformed face, distorted',
      face_weight: faceWeight,
      face_denoise: faceDenoise,
      seed: -1,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'face_detailer queue failed')
  }

  onProgress?.({ stage: 'generating', label: 'Affinage du visage…' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'face_detailer failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('face_detailer timeout (5 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération…' })

  const storagePath = `${storagePathPrefix}_face_${Date.now()}`
  const iData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`
  ).then(r => r.json())
  if (!iData.image_url) throw new Error(iData.error ?? 'face_detailer image_url manquante')

  // Free VRAM après (anti-OOM run suivant)
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})

  onProgress?.({ stage: 'done' })
  return iData.image_url as string
}
