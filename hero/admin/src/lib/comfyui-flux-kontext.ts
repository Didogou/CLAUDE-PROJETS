/**
 * Helper pour le workflow `flux_kontext` de ComfyUI (Flux.1 Kontext Dev).
 *
 * Édition d'image par instruction texte avec optionnellement une 2ème image
 * de référence (multi-image conditioning natif via ReferenceLatent).
 *
 * Cas d'usage Hero :
 *   - INSERTION perso dans une scène : source = scène, ref = portrait/fullbody
 *     du perso, instruction = "Place [Nom] [placement] in the scene"
 *   - REMOVE / MODIFY attribut : source = scène, ref = absent, instruction texte
 *
 * Stack (déjà installé) :
 *   - flux1-kontext-dev-Q4_K_S.gguf (~6.8 GB)
 *   - t5xxl_fp16.safetensors, clip_l.safetensors, ae.safetensors (Flux encoders)
 *
 * VRAM 8 GB : 3-7 min/run avec sysmem fallback ON. Lent mais ça marche.
 *
 * Pattern factorisé depuis POC `/editor-test/flux-kontext` validé 2026-04-30.
 */

export interface FluxKontextProgress {
  stage: 'upload' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  label?: string
}

export interface FluxKontextOptions {
  /** URL Supabase de l'image source (la scène à modifier). */
  sourceUrl: string
  /** URL Supabase de l'image de référence (perso à insérer, etc.).
   *  Optionnel : si absent, mode single-image (instruction-only edit). */
  refUrl?: string
  /** Instruction texte (EN recommandé pour Flux). Ex: "Place Lyralia sitting
   *  on the bench in the scene". Le translate FR→EN doit être fait en amont. */
  prompt: string
  /** Préfixe Supabase Storage pour ranger le résultat. */
  storagePathPrefix: string
  /** FluxGuidance value (≠ CFG sampler). Défaut 2.5 (officiel BFL Kontext,
   *  vs 30 pour Flux Fill, vs 3.5 pour Flux Dev). */
  guidance?: number
  /** Steps KSampler. Défaut 20. */
  steps?: number
  /** Seed (-1 = random). */
  seed?: number
  /** Callback de progression — pour l'UI. */
  onProgress?: (p: FluxKontextProgress) => void
}

const POLL_INTERVAL_MS = 4000
// 12 min : Flux Kontext sur 8 GB peut être très lent (sysmem swap).
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

/** Lance Flux Kontext (single ou multi-image) et attend le résultat. */
export async function runFluxKontext(opts: FluxKontextOptions): Promise<string> {
  const { sourceUrl, refUrl, prompt, storagePathPrefix, guidance, steps, seed, onProgress } = opts

  onProgress?.({ stage: 'upload', label: 'Préparation…' })

  // Free VRAM avant ce workflow lourd
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
  await new Promise(r => setTimeout(r, 1500))

  const upSrc = await uploadToComfy(sourceUrl, 'kontext_src')
  const upRef = refUrl ? await uploadToComfy(refUrl, 'kontext_ref') : undefined

  onProgress?.({ stage: 'queuing', label: 'Insertion en cours…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'flux_kontext',
      source_image: upSrc,
      ...(upRef ? { reference_image: upRef } : {}),
      prompt_positive: prompt,
      prompt_negative: '',
      cfg: guidance ?? 2.5,
      steps: steps ?? 20,
      seed: seed ?? -1,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'flux_kontext queue failed')
  }

  onProgress?.({ stage: 'generating', label: 'Insertion en cours… (3-7 min sur 8 GB)' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'flux_kontext failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('flux_kontext timeout (12 min) — sysmem fallback peut-être désactivé')

  onProgress?.({ stage: 'fetching', label: 'Récupération…' })

  const storagePath = `${storagePathPrefix}_${Date.now()}`
  const iData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`
  ).then(r => r.json())
  if (!iData.image_url) throw new Error(iData.error ?? 'flux_kontext image_url manquante')

  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})

  onProgress?.({ stage: 'done' })
  return iData.image_url as string
}
