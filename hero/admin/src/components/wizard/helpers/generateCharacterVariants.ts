/**
 * Helper autonome : à partir d'un portrait extrait, génère la matrice 2×2
 * de vues d'un personnage (cadrage portrait/plein-pied × fond gris/scénique).
 *
 * Le portrait extrait sert de référence IPAdapter (FaceID + Plus stackés)
 * pour préserver visage, silhouette, vêtements et accessoires d'une variante
 * à l'autre.
 *
 * Les variantes "scenic" reçoivent le contexte de scène (prompt du plan) en
 * arrière-plan ; les "gray" un fond studio neutre.
 *
 * Description physique automatique via Claude vision si pas fournie — sert
 * à uniformiser le perso entre les 4 sorties (sans demander à l'utilisateur
 * de retaper).
 *
 * Génération séquentielle (single GPU). Chaque erreur est isolée : les autres
 * variantes restent générées, l'erreur est remontée dans `errors`.
 */
import type { CharacterVariantKey } from './characterVariantKeys'
import { describePortraitWithVision } from './describePortraitWithVision'

export interface GenerateCharacterVariantsParams {
  /** URL Supabase du portrait détouré (PNG fond gris) — sert de référence IPAdapter. */
  portraitUrl: string
  /** Filename ComfyUI du checkpoint (ex: 'juggernautXL_v9Rdphoto2Lightning.safetensors'). */
  checkpoint: string
  /** Style du projet (realistic, manga, ...). */
  style: string
  /** Description physique du perso. Si vide, sera générée par Claude vision sur le portrait. */
  baseDescription?: string
  /** Contexte scénique pour les variantes "scenic" (prompt du plan d'origine). */
  sceneContext: string
  /** Prompt négatif. Défaut raisonnable si absent. */
  promptNegative?: string
  /** Chemin Supabase de base (ex: "npcs/<npcId>" ou "temp/extract_<sectionId>"). */
  storagePathPrefix: string
  /** Variantes à générer. Défaut : les 4. */
  variants?: CharacterVariantKey[]
  /** Force IPAdapter FaceID (0-1). 0.95 par défaut pour fidélité max. */
  faceWeight?: number
  /** Force IPAdapter Plus (0-1). 0.45 par défaut (style/habits sans figer la compo). */
  styleWeight?: number
  steps?: number
  cfg?: number
  /** Callback de progression : appelé après chaque variante générée (ou en erreur). */
  onProgress?: (key: CharacterVariantKey, status: 'started' | 'done' | 'error', url?: string, error?: string) => void
}

export interface GenerateCharacterVariantsResult {
  portrait_gray?: string
  portrait_scenic?: string
  fullbody_gray?: string
  fullbody_scenic?: string
  /** Description physique générée (réutilisable pour debug ou re-génération). */
  description?: string
  /** Erreurs éventuelles par clé de variante. */
  errors?: Partial<Record<CharacterVariantKey, string>>
}

// Tags hand-safe systématiquement ajoutés aux plein-pieds (les portraits
// chest-up ne montrent pas les mains donc inutiles côté positif).
const HAND_SAFE_POSITIVE = 'detailed hands, five clear fingers per hand, anatomically correct hands, clean fingers'

// Négatif renforcé : couvre les hallucinations classiques SDXL sur mains/visages.
const DEFAULT_NEGATIVE =
  'blurry, distorted, watermark, text, low quality, multiple people, duplicate, ' +
  'extra limbs, mutated, deformed hands, mutated hands, fused fingers, ' +
  'extra fingers, missing fingers, poorly drawn hands, bad anatomy, ' +
  'disfigured face, asymmetric eyes, cross-eyed'

const PROMPT_TEMPLATES: Record<CharacterVariantKey, (desc: string, scene: string) => { prompt: string; dims: [number, number] }> = {
  portrait_gray: (desc) => ({
    prompt: `${desc}, portrait shot from chest up, facing camera, simple light gray studio backdrop, soft studio lighting, clean background, detailed face, sharp features`,
    dims: [1024, 1024],
  }),
  portrait_scenic: (desc, scene) => ({
    prompt: `${desc}, portrait shot from chest up, facing camera, ${scene}, atmospheric lighting, detailed face, sharp features, cinematic composition`,
    dims: [1024, 1024],
  }),
  fullbody_gray: (desc) => ({
    prompt: `${desc}, full body shot, standing pose, neutral posture, head to toes visible, facing camera, simple light gray studio backdrop, soft studio lighting, full figure, ${HAND_SAFE_POSITIVE}, detailed face`,
    dims: [768, 1360],
  }),
  fullbody_scenic: (desc, scene) => ({
    prompt: `${desc}, full body shot, standing pose, head to toes visible, ${scene}, atmospheric lighting, full figure, ${HAND_SAFE_POSITIVE}, detailed face, cinematic composition`,
    dims: [768, 1360],
  }),
}

export async function generateCharacterVariants(params: GenerateCharacterVariantsParams): Promise<GenerateCharacterVariantsResult> {
  const {
    portraitUrl,
    checkpoint,
    style,
    sceneContext,
    promptNegative = DEFAULT_NEGATIVE,
    storagePathPrefix,
    variants = ['portrait_gray', 'portrait_scenic', 'fullbody_gray', 'fullbody_scenic'],
    faceWeight = 0.95,
    styleWeight = 0.45,
    steps = 35,
    cfg = 7,
    onProgress,
  } = params

  // 1. Description physique (auto via Claude si pas fournie)
  let description = params.baseDescription?.trim() ?? ''
  if (!description) description = await describePortraitWithVision(portraitUrl)
  if (!description) description = 'a person, neutral expression' // fallback minimal

  // 2. Upload du portrait dans ComfyUI input (1× pour les 4 variantes)
  const upRes = await fetch('/api/comfyui/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'url', url: portraitUrl, name: 'variant_ref' }),
  })
  const upData = await upRes.json()
  if (!upData.filename) throw new Error(upData.error || 'Upload portrait référence échoué')
  const portraitFilename = upData.filename as string

  // 3. Pour chaque variante, génère séquentiellement (single GPU)
  const result: GenerateCharacterVariantsResult = { description, errors: {} }

  for (const key of variants) {
    onProgress?.(key, 'started')
    const tpl = PROMPT_TEMPLATES[key]
    const { prompt, dims } = tpl(description, sceneContext || '')

    try {
      // Mask 'full' pour FaceID (s'applique sur toute l'image)
      const maskRes = await fetch('/api/comfyui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'mask', preset: 'full', width: dims[0], height: dims[1] }),
      })
      const maskData = await maskRes.json()
      if (!maskData.filename) throw new Error(maskData.error || 'Mask full échoué')

      // Workflow scene_composition avec FaceID + IPAdapter Plus stack
      const genRes = await fetch('/api/comfyui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'scene_composition',
          prompt_positive: prompt,
          prompt_negative: promptNegative,
          style,
          width: dims[0],
          height: dims[1],
          steps,
          cfg,
          seed: -1,
          checkpoint,
          characters: [{
            portrait_filename: portraitFilename,
            mask: { type: 'full' },
            weight: faceWeight,
          }],
          // IPAdapter Plus sur le même portrait → préserve habits/couleurs/style
          style_reference_image: portraitFilename,
          style_reference_weight: styleWeight,
        }),
      })
      const genData = await genRes.json()
      if (!genData.prompt_id) throw new Error(genData.error || 'Soumission ComfyUI échouée')

      // Poll
      const startT = Date.now()
      const MAX_WAIT = 5 * 60 * 1000
      let url: string | null = null
      while (Date.now() - startT < MAX_WAIT) {
        await new Promise(r => setTimeout(r, 3000))
        const pollRes = await fetch(`/api/comfyui?prompt_id=${genData.prompt_id}`)
        const pollData = await pollRes.json()
        if (pollData.status === 'succeeded') {
          const storagePath = `${storagePathPrefix}_${key}_${Date.now()}`
          const imgRes = await fetch(
            `/api/comfyui?prompt_id=${genData.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`,
          )
          const imgData = await imgRes.json()
          if (!imgData.image_url) throw new Error(imgData.error || 'Récupération image échouée')
          url = (imgData.image_url as string).split('?')[0]
          break
        }
        if (pollData.status === 'failed') throw new Error(pollData.error || 'ComfyUI a échoué')
      }
      if (!url) throw new Error('Timeout (5 min)')

      result[key] = url
      onProgress?.(key, 'done', url)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors![key] = msg
      onProgress?.(key, 'error', undefined, msg)
    }
  }

  if (Object.keys(result.errors!).length === 0) delete result.errors
  return result
}
