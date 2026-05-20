/**
 * Helper SDXL portrait T2I via le workflow `portrait` déjà bâti dans
 * `comfyui.ts` (buildPortraitWorkflow). Réutilise Juggernaut / Animagine /
 * Pony — checkpoints SDXL déjà installés dans ComfyUI.
 *
 * Cas d'usage Hero : 3e moteur portrait (en plus de Z-Image et Flux Dev).
 * Avantage Juggernaut sur Z-Image : modèle plus orienté photoréalisme strict,
 * plus difficile à faire basculer en anime (utile pour resoudre le "style
 * mismatch" qu'on a sur Z-Image hybride anime+réaliste).
 *
 * Vitesse cible : ~30-40s/portrait (35 steps SDXL CFG 7).
 *
 * Refonte 2026-05-19.
 */

export interface SdxlPortraitProgress {
  stage: 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  label?: string
}

export interface SdxlPortraitOptions {
  prompt: string
  negativePrompt?: string
  storagePathPrefix: string
  /** Clé checkpoint : 'juggernaut' | 'animagine_xl_4' | 'pony_xl_v6' |
   *  'juggernaut+anime' | 'juggernaut+concept' | 'sdxl_base'. */
  checkpoint?: string
  /** Style (suffix bonus appliqué côté backend) : 'realistic' | 'anime' |
   *  'painting' | 'concept_art' | 'horror' | 'minimalist'. Voir STYLE_SUFFIXES. */
  style?: 'realistic' | 'anime' | 'painting' | 'concept_art' | 'horror' | 'minimalist'
  width?: number
  height?: number
  steps?: number
  cfg?: number
  seed?: number
  onProgress?: (p: SdxlPortraitProgress) => void
}

const POLL_INTERVAL_MS = 2000
const MAX_WAIT_MS = 3 * 60 * 1000  // 3 min — SDXL 35 steps ~30-40s en lowvram

export async function runSdxlPortrait(opts: SdxlPortraitOptions): Promise<string> {
  const { withOomRetry } = await import('./oom-retry')
  return await withOomRetry(() => runSdxlPortraitCore(opts), {
    onOomDetected: () => {
      opts.onProgress?.({ stage: 'queuing', label: 'Récupération mémoire CUDA, retry…' })
    },
  })
}

async function runSdxlPortraitCore(opts: SdxlPortraitOptions): Promise<string> {
  const {
    prompt, negativePrompt, storagePathPrefix,
    checkpoint, style, width, height, steps, cfg, seed,
    onProgress,
  } = opts

  onProgress?.({ stage: 'queuing', label: 'Génération SDXL…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'portrait',
      prompt_positive: prompt,
      prompt_negative: negativePrompt ?? '',
      checkpoint: checkpoint ?? 'juggernaut',
      style: style ?? 'realistic',
      width: width ?? 1024,
      height: height ?? 1024,
      steps: steps ?? 35,
      cfg: cfg ?? 7,
      seed: seed ?? -1,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'sdxl portrait queue failed')
  }

  onProgress?.({ stage: 'generating', label: 'Génération SDXL…' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'sdxl portrait failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('sdxl portrait timeout (3 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération…' })

  const storagePath = `${storagePathPrefix}_${Date.now()}`
  const iData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`
  ).then(r => r.json())
  if (!iData.url) {
    throw new Error(iData.error ?? 'sdxl portrait image fetch failed')
  }
  onProgress?.({ stage: 'done' })
  return iData.url
}
