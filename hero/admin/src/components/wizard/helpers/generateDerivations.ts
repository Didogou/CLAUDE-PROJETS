/**
 * Helper autonome pour générer une séquence de frames "dérivations" à partir
 * d'une image source. Utilisé pour des animations frame-by-frame (flipbook).
 *
 * Pipeline :
 *   1. Upload source 1× dans ComfyUI input
 *   2. Pour chaque frame i ∈ [0, count) :
 *      - Prompt = basePrompt + angleVariations[i % N]
 *      - Workflow `transition` (img2img, denoise bas ~0.4)
 *      - Poll jusqu'à succès, upload dans Supabase sous storagePathPrefix_frame_i_...
 *   3. Retourne l'array ordonné des URLs (order matters pour l'animation)
 *
 * Angles variations = catalogue courts de vues subtiles pour donner un effet
 * "flipbook" avec micro-mouvements (vs des variantes franches). Le prompt
 * négatif est enrichi pour éviter que SDXL change la tenue/visage entre frames.
 *
 * Indépendant de toute UI React — callable depuis un sub-wizard ou d'un script.
 */

const DEFAULT_ANGLE_VARIATIONS = [
  'slight left angle view', 'slight right angle view', 'low angle dramatic view', 'high angle overview',
  'centered front view', 'three-quarter left view', 'three-quarter right view', 'over-the-shoulder view',
  'wider establishing shot', 'tighter close-up framing', 'slight dutch angle', 'eye-level shot',
  'subtle camera tilt up', 'subtle camera tilt down', 'profile left view', 'profile right view',
  'shallow depth of field', 'wide focal length', 'small position shift left', 'small position shift right',
]

const CONTINUITY_NEGATIVE_TAGS =
  'changing character appearance, different clothing, adding hat, cap, helmet, changing face, morphing, ' +
  'different person, altered outfit'

export interface GenerateDerivationsParams {
  /** Image source (gray bg portrait/fullbody OU scène entière). */
  sourceUrl: string
  /** Prompt de base du plan (description de la scène). */
  basePrompt: string
  /** Prompt négatif du plan (sera enrichi avec les tags continuité). */
  promptNegative: string
  /** Style (realistic/manga/…). */
  style: string
  /** Filename checkpoint SDXL. */
  checkpoint: string
  /** Nombre de frames. Défaut 20 (cohérent avec DerivationParams existant). */
  count?: number
  /** Denoise de l'img2img (0-1). Défaut 0.4 (variations subtiles). */
  denoise?: number
  steps?: number
  cfg?: number
  /** Préfixe Supabase pour stocker les frames. Un index frame s'ajoute. */
  storagePathPrefix: string
  /** Angles à cycler. Défaut = catalogue hero (20 angles subtils). */
  angleVariations?: string[]
  /** Callback de progression (frame_index, total, success). */
  onProgress?: (frameIndex: number, total: number, urlOrError: string | null, isError: boolean) => void
  /** Timeout par frame en ms. Défaut 180s. */
  frameTimeoutMs?: number
}

export interface GenerateDerivationsResult {
  /** URLs des frames générées dans l'ordre (peut être plus court que count si certaines ont échoué). */
  urls: string[]
  /** Erreurs par index de frame. */
  errors: Record<number, string>
}

export async function generateDerivations(params: GenerateDerivationsParams): Promise<GenerateDerivationsResult> {
  const {
    sourceUrl, basePrompt, promptNegative, style, checkpoint,
    count = 20, denoise = 0.4, steps = 35, cfg = 7,
    storagePathPrefix,
    angleVariations = DEFAULT_ANGLE_VARIATIONS,
    onProgress,
    frameTimeoutMs = 180_000,
  } = params

  // 1. Upload source 1× dans ComfyUI input
  const upRes = await fetch('/api/comfyui/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'url', url: sourceUrl, name: `derive_source_${Date.now()}` }),
  })
  const upData = await upRes.json()
  if (!upData.filename) throw new Error(upData.error || 'Upload source échoué')
  const sourceFilename = upData.filename as string

  // 2. Prompt négatif enrichi avec tags "continuity" pour stabilité inter-frames
  const effectiveNegative = `${promptNegative}, ${CONTINUITY_NEGATIVE_TAGS}`

  // 3. Boucle séquentielle (single GPU, impossible de paralléliser)
  const urls: string[] = []
  const errors: Record<number, string> = {}

  for (let i = 0; i < count; i++) {
    try {
      const variedPrompt = `${basePrompt}, ${angleVariations[i % angleVariations.length]}, same character same clothing`
      const res = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'transition',
          source_image: sourceFilename,
          prompt_positive: variedPrompt,
          prompt_negative: effectiveNegative,
          style,
          steps,
          cfg,
          seed: -1,
          denoise,
          checkpoint,
        }),
      })
      const d = await res.json()
      if (!d.prompt_id) { errors[i] = d.error || 'Pas de prompt_id'; onProgress?.(i, count, errors[i], true); continue }

      // Poll
      const start = Date.now()
      let done = false
      while (Date.now() - start < frameTimeoutMs) {
        await new Promise(r => setTimeout(r, 3000))
        const poll = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}`)
        const pd = await poll.json()
        if (pd.status === 'succeeded') {
          const storagePath = `${storagePathPrefix}_frame_${i}_${Date.now()}`
          const imgRes = await fetch(`/api/comfyui?prompt_id=${d.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`)
          const imgData = await imgRes.json()
          if (imgData.image_url) {
            const url = (imgData.image_url as string).split('?')[0]
            urls.push(url)
            onProgress?.(i, count, url, false)
          } else {
            errors[i] = imgData.error || 'URL image manquante'
            onProgress?.(i, count, errors[i], true)
          }
          done = true
          break
        }
        if (pd.status === 'failed') {
          errors[i] = pd.error || 'ComfyUI a renvoyé failed'
          onProgress?.(i, count, errors[i], true)
          done = true
          break
        }
      }
      if (!done) {
        errors[i] = `Timeout ${frameTimeoutMs / 1000}s`
        onProgress?.(i, count, errors[i], true)
      }
    } catch (err: unknown) {
      errors[i] = err instanceof Error ? err.message : String(err)
      onProgress?.(i, count, errors[i], true)
    }
  }

  return { urls, errors }
}
