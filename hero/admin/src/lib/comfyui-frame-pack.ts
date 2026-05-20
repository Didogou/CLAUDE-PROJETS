/**
 * Helper pour le workflow `framepack` de ComfyUI (Kijai/ComfyUI-FramePackWrapper).
 *
 * FramePack (lllyasviel + Stanford/MIT, avril 2025, arXiv:2504.12626) :
 * "next-frame prediction" sur HunyuanVideo 13B avec compression de contexte
 * O(1). Permet de générer des vidéos longues (60s+) sur 6-8 GB VRAM.
 *
 * Cas d'usage Hero (à valider) :
 *   - Plans atmosphère long (>20s) : traveling lent, scène contemplative,
 *     plans silencieux où LTX 2.3 cape à ~20s.
 *
 * Modèles requis (cf README repo + workflow exemple) :
 *   - models/diffusion_models/FramePackI2V_HY_fp8_e4m3fn.safetensors (~13 GB)
 *     ou bf16 (~25 GB) pour meilleure qualité
 *   - models/text_encoders/clip_l.safetensors (déjà chez Hero)
 *   - models/text_encoders/llava_llama3_fp16.safetensors (~9 GB)
 *   - models/vae/hunyuan_video_vae_bf16.safetensors (~250 MB)
 *   - models/clip_vision/sigclip_vision_patch14_384.safetensors (déjà chez Hero)
 *
 * Setup install : voir mémoire `project_framepack_install_2026_05_14`
 * (rapport complet : modèles téléchargés, paths, premier test, comparaison LTX).
 *
 * ⚠ TODO : le workflow `framepack.api.json` n'est pas encore livré. La fonction
 * throw une erreur claire jusqu'à export depuis ComfyUI Web (Save API format)
 * du workflow exemple `framepack_hv_example.json`.
 */

export interface FramePackProgress {
  stage: 'upload' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  label?: string
}

export interface FramePackOptions {
  /** URL publique de l'image source (1ère frame de la vidéo). I2V mode. */
  sourceImageUrl: string
  /** Prompt EN/FR décrivant la scène + le mouvement. */
  prompt: string
  /** Negative prompt (default = blurry, low quality, distorted). */
  negativePrompt?: string
  /** Durée de la vidéo en secondes. FramePack supporte 60s+ (vs LTX 2.3 capé 20s). */
  durationSec: number
  /** FPS de sortie (default 30). Multiplié par durée = total frames. */
  fps?: number
  /** Largeur (default 480, FramePack natif 480p). */
  width?: number
  /** Hauteur (default 832 = portrait 9:16). */
  height?: number
  /** Steps denoise (default 25). */
  steps?: number
  /** CFG (default 1.0 — FramePack utilise distilled guidance). */
  cfg?: number
  /** Seed (default random). */
  seed?: number
  /** Préfixe Supabase Storage pour la vidéo finale. */
  storagePathPrefix: string
  /** Callback de progression. */
  onProgress?: (p: FramePackProgress) => void
}

const POLL_INTERVAL_MS = 4000
// 60s à 30fps avec 1.5-2.5 s/frame sur 8 GB → ~30-45 min worst case
const MAX_WAIT_MS = 60 * 60 * 1000

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

/** Lance le workflow framepack et retourne l'URL Supabase de la vidéo finale. */
export async function runFramePack(opts: FramePackOptions): Promise<string> {
  const {
    sourceImageUrl, prompt, negativePrompt, storagePathPrefix,
    durationSec, fps, width, height, steps, cfg, seed,
    onProgress,
  } = opts

  onProgress?.({ stage: 'upload', label: 'Upload image source…' })
  const upImage = await uploadToComfy(sourceImageUrl, 'framepack_input')

  onProgress?.({ stage: 'queuing', label: 'Queue ComfyUI (FramePack)…' })
  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'framepack',
      source_image: upImage,
      prompt_positive: prompt,
      prompt_negative: negativePrompt ?? 'blurry, low quality, distorted, watermark, text',
      duration_sec: durationSec,
      fps: fps ?? 30,
      width: width ?? 480,
      height: height ?? 832,
      steps: steps ?? 25,
      cfg: cfg ?? 1.0,
      seed: seed ?? -1,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'framepack queue failed')
  }

  onProgress?.({ stage: 'generating', label: `Génération FramePack ${durationSec}s (peut prendre 30+ min)…` })
  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'framepack failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('framepack timeout (60 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération vidéo…' })
  const storagePath = `${storagePathPrefix}_${Date.now()}`
  const vData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=video_info&storage_path=${encodeURIComponent(storagePath)}`,
  ).then(r => r.json())
  if (!vData.video_url) throw new Error(vData.error ?? 'framepack video_url manquante')

  onProgress?.({ stage: 'done' })
  return vData.video_url as string
}
