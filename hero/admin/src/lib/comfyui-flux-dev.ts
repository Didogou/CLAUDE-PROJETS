/**
 * Helper pour le workflow `flux_dev` de ComfyUI (Flux.1 Dev T2I, BFL 2024).
 *
 * Modèle non-distillé → vraie variance entre seeds (à l'inverse de Z-Image
 * Turbo). Plus lent (60-90s sur 8 GB Q5_K_S) mais rendu plus diversifié.
 *
 * Cas d'usage Hero :
 *   - Alternative à Z-Image quand l'auteur veut de vraies variantes du même prompt
 *   - Génération de portrait premium quand la qualité prime sur la vitesse
 *
 * Stack 8 GB VRAM :
 *   - flux1-dev-Q5_K_S.gguf (~8 GB, GGUF Q5_K_S)
 *   - t5xxl_fp16.safetensors (~9 GB, RAM CPU)
 *   - clip_l.safetensors (~250 MB)
 *   - ae.safetensors (~340 MB, déjà installé)
 *
 * NÉCESSITE NVIDIA Sysmem Fallback ON (sinon OOM 8 GB).
 */

export interface FluxDevProgress {
  stage: 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  label?: string
}

export interface FluxDevOptions {
  /** Prompt EN (ou FR — Flux T5 comprend bien les 2 mais EN > FR). */
  prompt: string
  /** Negative prompt — peu d'effet sur Flux (CFG=1) mais possible. */
  negativePrompt?: string
  /** Préfixe Supabase Storage pour ranger le résultat. */
  storagePathPrefix: string
  /** Largeur image. Défaut 1024. */
  width?: number
  /** Hauteur image. Défaut 1024. */
  height?: number
  /** Steps KSampler. Défaut 25. */
  steps?: number
  /** FluxGuidance value (≠ CFG sampler). Défaut 3.5 (officiel BFL Dev). */
  guidance?: number
  /** Seed (-1 = random). */
  seed?: number
  /** Override du fichier UNet GGUF (Q4_K_S si Q5 ne passe pas en VRAM). */
  unetFile?: string
  /** Callback de progression — pour l'UI. */
  onProgress?: (p: FluxDevProgress) => void
}

const POLL_INTERVAL_MS = 3000
// 10 min : sur 8 GB avec Q5_K_S le swap CPU↔GPU constant peut ralentir
// énormément. 60-90s sur 12+ GB, mais 4-8 min courant sur 8 GB lowvram.
const MAX_WAIT_MS = 10 * 60 * 1000

/** Lance le workflow flux_dev et attend le résultat (URL Supabase). */
export async function runFluxDev(opts: FluxDevOptions): Promise<string> {
  const {
    prompt, negativePrompt, storagePathPrefix,
    width, height, steps, guidance, seed, unetFile,
    onProgress,
  } = opts

  // Free VRAM avant (anti-OOM 8 GB)
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
  await new Promise(r => setTimeout(r, 1500))

  onProgress?.({ stage: 'queuing', label: 'Génération Flux Dev…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'flux_dev',
      prompt_positive: prompt,
      prompt_negative: negativePrompt ?? '',
      width: width ?? 1024,
      height: height ?? 1024,
      steps: steps ?? 25,
      // params.cfg utilisé comme FluxGuidance côté builder
      cfg: guidance ?? 3.5,
      seed: seed ?? -1,
      checkpoint: unetFile,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'flux_dev queue failed')
  }

  onProgress?.({ stage: 'generating', label: 'Génération Flux Dev…' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'flux_dev failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('flux_dev timeout (5 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération…' })

  const storagePath = `${storagePathPrefix}_${Date.now()}`
  const iData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`
  ).then(r => r.json())
  if (!iData.image_url) throw new Error(iData.error ?? 'flux_dev image_url manquante')

  // Free VRAM après
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})

  onProgress?.({ stage: 'done' })
  return iData.image_url as string
}
