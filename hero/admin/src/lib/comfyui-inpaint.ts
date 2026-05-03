/**
 * Workflow SDXL inpaint pour ComfyUI.
 *
 * Usage : remplacer une zone définie par un mask blanc dans une image source.
 * Cas d'usage principal dans Hero : réparer les mains/parties tronquées d'un
 * portrait extrait via SAM ("hands, detailed fingers" en prompt local).
 *
 * Pipeline :
 *   - LoadImage (source) → IMAGE
 *   - LoadImage (mask)   → IMAGE (blanc = zone à inpainter)
 *   - ImageToMask        → MASK (canal R)
 *   - VAEEncodeForInpaint (latent + masque dilaté de quelques px)
 *   - KSampler (denoise ~0.85 pour reconstruire la zone)
 *   - VAEDecode → SaveImage
 *
 * Indépendant du big switch de buildWorkflow (lib/comfyui.ts) — le workflow
 * inpaint a un cycle de vie spécifique (mask + image préalablement uploadés)
 * mieux servi par une route dédiée /api/comfyui/inpaint.
 */

export interface BuildInpaintWorkflowParams {
  /** Filename ComfyUI de l'image source (déjà uploadée). */
  source_filename: string
  /** Filename ComfyUI du mask (déjà uploadé, blanc = zone à inpainter). */
  mask_filename: string
  /** Filename du checkpoint SDXL. */
  checkpoint: string
  /** Prompt positif (ce qu'on veut générer dans la zone). */
  prompt_positive: string
  /** Prompt négatif. */
  prompt_negative?: string
  /** Steps KSampler. Défaut 30 (suffit pour inpaint). */
  steps?: number
  /** CFG. Défaut 7. */
  cfg?: number
  /** Denoise (0-1). Défaut 0.85 — assez élevé pour vraiment reconstruire. */
  denoise?: number
  /** Seed. Défaut -1 (random). */
  seed?: number
  /** Dilatation du mask (px) pour adoucir les bords. Défaut 6. */
  grow_mask_by?: number
  /**
   * Persos à injecter via IPAdapter FaceID dans la zone inpainted. Utilisé
   * par le bake panorama 360° : chaque NPC a son portrait comme référence
   * faciale, SDXL l'intègre naturellement dans la scène (ombres, lumière).
   *
   * Chaque entry nécessite :
   *  - portrait_filename : filename dans ComfyUI input (uploadé par la route)
   *  - mask_filename     : mask full (1024×1024 blanc) pour FaceID
   *  - weight            : force FaceID (0.7 défaut)
   */
  characters?: Array<{
    portrait_filename: string
    mask_filename: string
    weight?: number
  }>
  /**
   * Référence de style/ambiance via IPAdapter classique (non-FaceID).
   *
   * Passe une image de référence au modèle pour qu'il génère dans le masque du
   * contenu qui respecte l'éclairage, les couleurs et le grain de la source.
   * Cas d'usage principal : effacer un sujet dans une scène complexe sans que
   * SDXL invente une scène stéréotypée déconnectée du contexte (ex : foule
   * nocturne sous lumière sodium → la zone remplie garde les mêmes teintes
   * et silhouettes).
   *
   * Par convention, le filename utilisé est celui de l'image source elle-même
   * (style-ref = self). La route /api/comfyui/inpaint upload automatiquement
   * la source comme style-ref sauf si un autre filename est fourni.
   *
   * Weight recommandé : 0.5 à 0.7. Au-dessus → génère le même contenu,
   * en-dessous → effet de style léger.
   */
  style_reference?: {
    filename: string
    weight?: number
  }
}

const DEFAULT_NEGATIVE = 'blurry, deformed, low quality, watermark, text, extra fingers, missing fingers, mutated hands'

export function buildInpaintWorkflow(params: BuildInpaintWorkflowParams): Record<string, unknown> {
  const {
    source_filename,
    mask_filename,
    checkpoint,
    prompt_positive,
    prompt_negative = DEFAULT_NEGATIVE,
    steps = 30,
    cfg = 7,
    denoise = 0.85,
    seed = -1,
    grow_mask_by = 6,
    characters = [],
    style_reference,
  } = params

  const workflow: Record<string, unknown> = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: source_filename },
    },
    '3': {
      class_type: 'LoadImage',
      inputs: { image: mask_filename },
    },
    // ImageToMask : convertit le canal R d'une image en mask binaire
    '4': {
      class_type: 'ImageToMask',
      inputs: { image: ['3', 0], channel: 'red' },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt_positive, clip: ['1', 1] },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt_negative, clip: ['1', 1] },
    },
    // VAEEncodeForInpaint : encode l'image en latent + applique le mask
    '7': {
      class_type: 'VAEEncodeForInpaint',
      inputs: {
        pixels: ['2', 0],
        vae: ['1', 2],
        mask: ['4', 0],
        grow_mask_by,
      },
    },
  }

  // ── Chaîne IPAdapter : style-ref d'abord, puis persos (optionnels) ──
  // Le style-ref utilise le preset PLUS (non-FaceID) pour transférer
  // l'ambiance globale (lumière, teintes, grain). Les persos utilisent FACE
  // pour préserver l'identité faciale. Les deux chaînes peuvent coexister.
  let modelRef: [string, number] = ['1', 0]

  // Style-reference (IPAdapter classique)
  if (style_reference) {
    workflow['15'] = {
      class_type: 'IPAdapterUnifiedLoader',
      inputs: { model: modelRef, preset: 'PLUS (high strength)' },
    }
    workflow['16'] = {
      class_type: 'LoadImage',
      inputs: { image: style_reference.filename },
    }
    workflow['17'] = {
      class_type: 'IPAdapterAdvanced',
      inputs: {
        model: ['15', 0],
        ipadapter: ['15', 1],
        image: ['16', 0],
        weight: style_reference.weight ?? 0.6,
        weight_type: 'linear',
        combine_embeds: 'average',
        embeds_scaling: 'V only',
        start_at: 0.0,
        // Style-ref doit s'appliquer pendant toute la diffusion pour que le
        // contenu généré respecte l'ambiance (end_at < 1 laisse dériver).
        end_at: 1.0,
      },
    }
    modelRef = ['17', 0]
  }

  if (characters.length > 0) {
    workflow['20'] = {
      class_type: 'IPAdapterUnifiedLoader',
      inputs: { model: modelRef, preset: 'PLUS FACE (portraits)' },
    }
    modelRef = ['20', 0]
    characters.forEach((char, i) => {
      const baseId = 30 + i * 3
      const loadImgId = String(baseId)
      const maskImgId = String(baseId + 1)
      const ipaId = String(baseId + 2)
      workflow[loadImgId] = {
        class_type: 'LoadImage',
        inputs: { image: char.portrait_filename },
      }
      workflow[maskImgId] = {
        class_type: 'LoadImage',
        inputs: { image: char.mask_filename },
      }
      workflow[ipaId] = {
        class_type: 'IPAdapterAdvanced',
        inputs: {
          model: modelRef,
          ipadapter: ['20', 1],
          image: [loadImgId, 0],
          weight: char.weight ?? 0.7,
          weight_type: 'linear',
          combine_embeds: 'average',
          embeds_scaling: 'V only',
          start_at: 0.0,
          end_at: 0.8,
          attn_mask: [maskImgId, 1],
        },
      }
      modelRef = [ipaId, 0]
    })
  }

  workflow['8'] = {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: ['5', 0],
      negative: ['6', 0],
      latent_image: ['7', 0],
      seed: seed === -1 ? Math.floor(Math.random() * 1e15) : seed,
      steps,
      cfg,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise,
    },
  }
  workflow['9'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['8', 0], vae: ['1', 2] },
  }
  workflow['10'] = {
    class_type: 'SaveImage',
    inputs: { images: ['9', 0], filename_prefix: 'hero_inpaint' },
  }
  return workflow
}
