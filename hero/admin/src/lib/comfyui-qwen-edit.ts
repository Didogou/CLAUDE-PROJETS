/**
 * comfyui-qwen-edit — wrapper Qwen Image Edit 2511 (text-prompted edit sans
 * référence image). Pour la barre IA "Demande à l'IA d'éditer ce plan…".
 *
 * Refonte 2026-05-11 — câble enfin la barre IA qui était mock jusque-là.
 *
 * Stack : Qwen Image Edit 2511 + Lightning 4-steps LoRA (gain ~6× vs base).
 * Edit text-only sur l'image source, pas de mask = applique l'instruction
 * sur toute l'image en préservant ce qui n'est pas mentionné. Idéal pour :
 *   - "ajoute un ballon dans la main droite du joueur"
 *   - "change la couleur du maillot en rouge"
 *   - "rends la scène nocturne"
 *   - "supprime le panier de basket"
 *
 * Coût ~30-60s sur 8 GB VRAM avec Lightning. Sans Lightning ~3-5 min.
 */

export interface QwenEditProgress {
  stage: 'upload' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  label?: string
}

export interface QwenEditOptions {
  /** URL Supabase de l'image source à éditer. */
  sourceUrl: string
  /** Instruction d'édition en langage naturel (FR ou EN). */
  prompt: string
  /** Préfixe Storage pour le résultat. */
  storagePathPrefix: string
  /** Lightning 4-steps. Default true (rapide). */
  useLightning?: boolean
  /** Seed (-1 = random). */
  seed?: number
  onProgress?: (p: QwenEditProgress) => void
}

const POLL_INTERVAL_MS = 4000
// 6 min : avec Lightning sur 8 GB, ~30-60s typique. Sans Lightning ~3-5 min.
// 6 min de marge pour les cas borderline (premier load du modèle, queue chargée).
const MAX_WAIT_MS = 6 * 60 * 1000

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

/** Mesure les dimensions naturelles d'une image, calcule l'aspect, retourne
 *  des dims target compatibles Qwen Image Edit (multiples de 32, longer edge
 *  ≤ 1280 sur 8 GB VRAM). Refonte 2026-05-11 — fix EmptyLatent hardcoded
 *  qui distordait les images 9:16 / 4:3 / panoramas en carré. */
async function computeQwenDimensions(sourceUrl: string): Promise<{ width: number; height: number }> {
  if (typeof window === 'undefined') return { width: 1024, height: 1024 }
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 1024, h: 1024 })
    img.src = sourceUrl
  })
  const LONGER = 1024
  const round32 = (v: number) => Math.max(320, Math.round(v / 32) * 32)
  if (dims.w === 0 || dims.h === 0) return { width: 1024, height: 1024 }
  const isLandscape = dims.w >= dims.h
  const longerOut = LONGER
  const shorterOut = round32(LONGER * Math.min(dims.w, dims.h) / Math.max(dims.w, dims.h))
  return isLandscape
    ? { width: longerOut, height: shorterOut }
    : { width: shorterOut, height: longerOut }
}

/** Lance Qwen Image Edit sur une image source avec un prompt d'édition.
 *  Retourne l'URL Supabase du résultat. Throw si timeout / fail.
 *  Wrap avec retry-on-OOM automatique (refonte 2026-05-12). */
export async function runQwenImageEdit(opts: QwenEditOptions): Promise<string> {
  const { withOomRetry } = await import('./oom-retry')
  return await withOomRetry(() => runQwenImageEditCore(opts), {
    onOomDetected: () => {
      opts.onProgress?.({ stage: 'queuing', label: 'Récupération mémoire CUDA, retry…' })
    },
  })
}

async function runQwenImageEditCore(opts: QwenEditOptions): Promise<string> {
  const { sourceUrl, prompt, storagePathPrefix, useLightning = true, seed, onProgress } = opts

  onProgress?.({ stage: 'upload', label: 'Préparation…' })
  // Mesure source AVANT upload pour passer dims au workflow → préserve aspect
  // (refonte 2026-05-11 — sinon EmptyLatent hardcoded carré 1024² distord
  // toute image non-1:1).
  const [upSrc, dims] = await Promise.all([
    uploadToComfy(sourceUrl, 'qwen_edit_src'),
    computeQwenDimensions(sourceUrl),
  ])

  onProgress?.({ stage: 'queuing', label: 'Édition en cours…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'qwen_image_edit',
      source_image: upSrc,
      prompt_positive: prompt,
      prompt_negative: 'blurry, distorted, watermark, text, signature, low quality',
      use_lightning: useLightning,
      width: dims.width,
      height: dims.height,
      seed: seed ?? -1,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'qwen_image_edit queue failed')
  }

  onProgress?.({
    stage: 'generating',
    label: useLightning
      ? 'Édition en cours… (~30-60s avec Lightning)'
      : 'Édition en cours… (~3-5 min sans Lightning)',
  })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'qwen_image_edit failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('qwen_image_edit timeout (6 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération…' })

  const storagePath = `${storagePathPrefix}_${Date.now()}`
  const iData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`,
  ).then(r => r.json())
  if (!iData.image_url) throw new Error(iData.error ?? 'qwen_image_edit image_url manquante')

  onProgress?.({ stage: 'done' })
  return iData.image_url as string
}
