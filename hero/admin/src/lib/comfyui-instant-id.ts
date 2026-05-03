/**
 * Helper pour le workflow `instant_id` de ComfyUI.
 *
 * InstantID (Tencent, 2026) : consistent character from face ref. Tu donnes
 * 1 image de visage en référence + un prompt → SDXL génère l'image avec
 * l'identité PRÉSERVÉE (visage, traits, race, etc.).
 *
 * Stack : SDXL + InstantID model + InstantID ControlNet + InsightFace antelopev2.
 *
 * Cas d'usage Hero :
 *   - Créer un portrait de perso (1ère gen libre = définit le visage)
 *   - Toutes les gens suivantes (plein pied, scènes) utilisent ce portrait
 *     comme face_ref → identité cohérente partout
 *   - Remplace le pipeline B1 (T2I + FaceDetailer) par 1 seul pass plus propre
 *
 * Voir mémoire `project_character_swap_validated_pipeline_2026_04_30` pour
 * le contexte de la transition vers InstantID.
 */

export interface InstantIdProgress {
  stage: 'upload' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  label?: string
}

export interface InstantIdOptions {
  /** URL Supabase de l'image de référence (le visage à préserver). */
  refUrl: string
  /** Prompt EN/FR. Si FR, on traduit côté backend via /api/translate-prompt
   *  (TODO : à brancher comme dans useImageGeneration). Pour l'instant on envoie
   *  brut → backend ne traduit pas par défaut sur ce workflow. */
  prompt: string
  /** Negative prompt — défaut blurry/deformed. */
  negativePrompt?: string
  /** Préfixe Supabase Storage pour ranger le résultat. */
  storagePathPrefix: string
  /** Checkpoint SDXL (clé ou filename). Défaut Juggernaut.
   *  - 'juggernaut' = réaliste défaut
   *  - 'animagine_xl_4' = anime
   *  - 'sdxl_base' = polyvalent neutre */
  checkpoint?: string
  /** Largeur (PAS exactement 1024 — watermark training data). Défaut 1016. */
  width?: number
  /** Hauteur. Défaut 1016. */
  height?: number
  /** Poids InstantID model = force d'identité visage (0-1.5, défaut 0.8).
   *  Recommandation Cubiq : 0.7-0.8. */
  instantidWeight?: number
  /** Poids ControlNet face landmarks = contrainte composition (0-1.5, défaut
   *  = même valeur que weight). Pour FULLBODY descendre à 0.2-0.3 — c'est
   *  CE levier qui débloque la composition (le ControlNet pèse 75% sur la
   *  composition selon Cubiq). */
  instantidCnStrength?: number
  /** Fraction du KSampler où InstantID arrête d'agir (0-1, défaut 1).
   *  0.5 = identité injectée pendant 1ère moitié du denoising, SDXL libre
   *  ensuite pour composer (utile pour fullbody). */
  instantidEnd?: number
  /** Steps KSampler. Défaut 30. */
  steps?: number
  /** CFG bas recommandé pour InstantID (4-5). Défaut 4.5. */
  cfg?: number
  /** Seed (-1 = random). */
  seed?: number
  /** Callback de progression — pour l'UI. */
  onProgress?: (p: InstantIdProgress) => void
}

const POLL_INTERVAL_MS = 3000
const MAX_WAIT_MS = 5 * 60 * 1000

/** Upload une image (URL Supabase) dans le file store de ComfyUI.
 *  Retourne le `filename` à passer aux nodes du workflow. */
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

/** Lance le workflow instant_id et attend le résultat (final URL Supabase). */
export async function runInstantId(opts: InstantIdOptions): Promise<string> {
  const {
    refUrl, prompt, negativePrompt, storagePathPrefix,
    checkpoint, width, height,
    instantidWeight, instantidCnStrength, instantidEnd, steps, cfg, seed,
    onProgress,
  } = opts

  onProgress?.({ stage: 'upload', label: 'Préparation…' })

  // Free VRAM avant ce workflow lourd (anti-OOM 8 GB)
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
  await new Promise(r => setTimeout(r, 1500))

  const upRef = await uploadToComfy(refUrl, 'cc_instantid_ref')

  onProgress?.({ stage: 'queuing', label: 'Génération InstantID…' })

  const queueRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'instant_id',
      reference_image: upRef,
      prompt_positive: prompt,
      prompt_negative: negativePrompt ?? 'blurry, low quality, deformed face, distorted, watermark',
      checkpoint: checkpoint ?? 'juggernaut',
      width: width ?? 1016,
      height: height ?? 1016,
      instantid_weight: instantidWeight ?? 0.8,
      ...(instantidCnStrength !== undefined ? { instantid_cn_strength: instantidCnStrength } : {}),
      instantid_end: instantidEnd ?? 1,
      steps: steps ?? 30,
      cfg: cfg ?? 4.5,
      seed: seed ?? -1,
    }),
  }).then(r => r.json())

  if (!queueRes.prompt_id) {
    throw new Error(queueRes.error ?? 'instant_id queue failed')
  }

  onProgress?.({ stage: 'generating', label: 'Génération InstantID…' })

  const deadline = Date.now() + MAX_WAIT_MS
  let succeeded = false
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
    if (sData.error) throw new Error(sData.error)
    if (sData.status === 'failed') throw new Error(sData.error ?? 'instant_id failed')
    if (sData.status === 'succeeded') { succeeded = true; break }
  }
  if (!succeeded) throw new Error('instant_id timeout (5 min)')

  onProgress?.({ stage: 'fetching', label: 'Récupération…' })

  const storagePath = `${storagePathPrefix}_${Date.now()}`
  const iData = await fetch(
    `/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`
  ).then(r => r.json())
  if (!iData.image_url) throw new Error(iData.error ?? 'instant_id image_url manquante')

  // Free VRAM après (anti-OOM run suivant)
  await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})

  onProgress?.({ stage: 'done' })
  return iData.image_url as string
}
