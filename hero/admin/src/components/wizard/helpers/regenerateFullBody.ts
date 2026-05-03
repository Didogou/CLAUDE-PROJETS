/**
 * Helper autonome : à partir d'un portrait détouré (fond gris #808080),
 * régénère un plan plein-pied posé neutre en utilisant IPAdapter FaceID
 * pour préserver le visage/silhouette.
 *
 * Réutilise le workflow `scene_composition` existant. Pas de background_image
 * (donc pas de ControlNet) → la composition est libre, seul le visage est
 * contraint par la référence FaceID. Mask type 'full' → la contrainte FaceID
 * s'applique sur toute l'image.
 *
 * Usage :
 *   const fullBodyUrl = await regenerateFullBody({
 *     portraitUrl: '<URL du PNG détouré>',
 *     checkpoint: 'juggernaut_xl_v9.safetensors',
 *     style: 'realistic',
 *     aspectRatio: '9:16',
 *     prompt: 'portrait of a young black-skinned man ...',  // description du perso
 *     storagePathPrefix: 'npcs/<npcId>/fullbody',
 *   })
 *
 * Retour : URL Supabase de l'image générée, ou throw sur erreur.
 */

export interface RegenerateFullBodyParams {
  /** URL Supabase du portrait détouré (PNG fond gris). */
  portraitUrl: string
  /** Filename ComfyUI du checkpoint (ex: 'juggernautXL_v9Rdphoto2Lightning.safetensors'). */
  checkpoint: string
  /** Style du projet (realistic, manga, ...). */
  style: string
  /** Ratio pour le plein-pied. '9:16' par défaut (format portrait vertical). */
  aspectRatio?: '9:16' | '1:1' | '16:9'
  /** Description détaillée du perso pour le prompt — visage/vêtements/morphologie. */
  prompt: string
  /** Prompt négatif (optionnel, défaut raisonnable). */
  promptNegative?: string
  /** Chemin Supabase où stocker le résultat. */
  storagePathPrefix: string
  /** Force IPAdapter FaceID (0-1). 0.85 par défaut pour fidélité max. */
  faceWeight?: number
  steps?: number
  cfg?: number
}

const DEFAULT_FULLBODY_PROMPT_SUFFIX =
  'full body shot, standing pose, neutral posture, head to toes visible, ' +
  'facing camera, simple light gray studio backdrop, soft studio lighting, ' +
  'full figure, detailed face, clean composition'

const DEFAULT_NEGATIVE =
  'cropped, partial body, close-up, zoomed in, bust shot, face only, ' +
  'headshot, cut off limbs, busy background, multiple people, text, watermark, blurry'

export async function regenerateFullBody(params: RegenerateFullBodyParams): Promise<string> {
  const {
    portraitUrl,
    checkpoint,
    style,
    aspectRatio = '9:16',
    prompt,
    promptNegative,
    storagePathPrefix,
    faceWeight = 0.85,
    steps = 35,
    cfg = 7,
  } = params

  // 1. Upload le portrait détouré dans le dossier input de ComfyUI
  const upRes = await fetch('/api/comfyui/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'url', url: portraitUrl, name: 'fullbody_ref' }),
  })
  const upData = await upRes.json()
  if (!upData.filename) throw new Error(upData.error || 'Upload portrait échoué')
  const portraitFilename = upData.filename as string

  // 2. Dimensions + upload du mask 'full' (sera généré côté serveur s'il n'existe pas)
  const dims: [number, number] =
    aspectRatio === '1:1' ? [1024, 1024] :
    aspectRatio === '16:9' ? [1360, 768] :
    [768, 1360]

  const maskRes = await fetch('/api/comfyui/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'mask', preset: 'full', width: dims[0], height: dims[1] }),
  })
  const maskData = await maskRes.json()
  if (!maskData.filename) throw new Error(maskData.error || 'Génération mask full échouée')

  // 3. Compose le prompt : description utilisateur + tags plein-pied
  const finalPrompt = `${prompt}, ${DEFAULT_FULLBODY_PROMPT_SUFFIX}`
  const finalNegative = promptNegative ?? DEFAULT_NEGATIVE

  // 4. Lance scene_composition avec 1 seul character (FaceID sur le portrait détouré)
  const genRes = await fetch('/api/comfyui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: 'scene_composition',
      prompt_positive: finalPrompt,
      prompt_negative: finalNegative,
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
    }),
  })
  const genData = await genRes.json()
  if (!genData.prompt_id) throw new Error(genData.error || 'Soumission ComfyUI échouée')

  // 5. Poll jusqu'à complétion (max 5 min)
  const startT = Date.now()
  const MAX_WAIT = 5 * 60 * 1000
  while (Date.now() - startT < MAX_WAIT) {
    await new Promise(r => setTimeout(r, 3000))
    const pollRes = await fetch(`/api/comfyui?prompt_id=${genData.prompt_id}`)
    const pollData = await pollRes.json()
    if (pollData.status === 'succeeded') {
      // 6. Récupère l'image + upload Supabase (storagePathPrefix)
      const storagePath = `${storagePathPrefix}_${Date.now()}`
      const imgRes = await fetch(
        `/api/comfyui?prompt_id=${genData.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`,
      )
      const imgData = await imgRes.json()
      if (!imgData.image_url) throw new Error(imgData.error || 'Récupération image échouée')
      return imgData.image_url.split('?')[0] as string
    }
    if (pollData.status === 'failed') {
      throw new Error(pollData.error || 'ComfyUI a échoué')
    }
  }
  throw new Error('Timeout génération plein-pied (5 min)')
}
