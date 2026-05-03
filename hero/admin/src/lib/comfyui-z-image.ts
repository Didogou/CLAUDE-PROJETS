/**
 * Helper pour le workflow `z_image` de ComfyUI (Z-Image Turbo, Alibaba 2026).
 *
 * Z-Image Turbo : T2I distillé 6B params, 8 steps, instruction-following
 * supérieur à Flux.2 Dev sur tests indé. Anime + réaliste dans un même modèle.
 *
 * Cas d'usage Hero : génération de portrait personnage à partir d'un prompt
 * texte libre. Remplace SDXL Juggernaut + Animagine XL — Z-Image résout les
 * problèmes de bias gender / éléments oubliés (chapeau, etc.) qu'on avait
 * sur Animagine.
 *
 * Stack 8 GB VRAM (RTX 5060 Blackwell) :
 *   - z_image_turbo_nvfp4.safetensors (4.5 GB)
 *   - qwen_3_4b_fp8_mixed.safetensors (5.6 GB) — text encoder
 *   - ae.safetensors (Flux VAE, déjà installé)
 *
 * Vitesse cible : ~20-30s/image (8 steps).
 */

export interface ZImageProgress {
  stage: 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  label?: string
}

export interface ZImageOptions {
  /** Prompt texte (FR ou EN — Z-Image comprend bien les 2 via text encoder Qwen). */
  prompt: string
  /** Negative prompt — peu d'effet sur Z-Image distillé (CFG=1) mais possible. */
  negativePrompt?: string
  /** Préfixe Supabase Storage pour ranger le résultat. */
  storagePathPrefix: string
  /** Largeur image. Défaut 1024. */
  width?: number
  /** Hauteur image. Défaut 1024. */
  height?: number
  /** Steps KSampler. Défaut 8 (turbo distillé). */
  steps?: number
  /** Seed (-1 = random). */
  seed?: number
  /** Override du fichier diffusion (fallback bf16 si NVFP4 plante). */
  diffusionFile?: string
  /** Callback de progression — pour l'UI. */
  onProgress?: (p: ZImageProgress) => void
}

const POLL_INTERVAL_MS = 2000
const MAX_WAIT_MS = 3 * 60 * 1000   // 3 min — Z-Image est rapide (20-30s)

/** Lance le workflow z_image et attend le résultat (URL Supabase). */
export async function runZImage(opts: ZImageOptions): Promise<string> {
  const {
    prompt, negativePrompt, storagePathPrefix,
    width, height, steps, seed, diffusionFile,
    onProgress,
  } = opts

  // Free VRAM avant (anti-OOM 8 GB)
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
  await new Promise(r => setTimeout(r, 1000))

  onProgress?.({ stage: 'queuing', label: 'Génération Z-Image…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'z_image',
      prompt_positive: prompt,
      prompt_negative: negativePrompt ?? '',
      width: width ?? 1024,
      height: height ?? 1024,
      steps: steps ?? 8,
      cfg: 1.0,
      seed: seed ?? -1,
      checkpoint: diffusionFile,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'z_image queue failed')
  }

  onProgress?.({ stage: 'generating', label: 'Génération Z-Image…' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'z_image failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('z_image timeout (3 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération…' })

  const storagePath = `${storagePathPrefix}_${Date.now()}`
  const iData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`
  ).then(r => r.json())
  if (!iData.image_url) throw new Error(iData.error ?? 'z_image image_url manquante')

  // Free VRAM après
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})

  onProgress?.({ stage: 'done' })
  return iData.image_url as string
}
