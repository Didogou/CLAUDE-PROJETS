/**
 * Workflow Panorama 360° équirectangulaire pour ComfyUI.
 *
 * Principe : produit une image 2048×1024 (ratio 2:1) qui, rendue sur une
 * sphère (Three.js, A-Frame, Panoraven), donne une vue immersive à 360°.
 * Les bords gauche/droite sont rendus tileables via :
 *   - SeamlessTile (x_only) qui modifie le MODEL pendant le sampling
 *   - MakeCircularVAE (x_only) qui modifie le VAE pendant le decode
 *
 * Ces 2 modifs s'appliquent SEULEMENT sur l'axe X (horizontal) — pas de
 * wraparound vertical, puisque une scène 360° a un sol et un ciel distincts.
 *
 * En prime : un LoRA 360Redmond entraîné pour produire des équirectangulaires
 * cohérents (trigger words : "360, 360view").
 *
 * Installation requise (côté ComfyUI) :
 *   cd ComfyUI/custom_nodes
 *   git clone https://github.com/spinagon/ComfyUI-seamless-tiling.git
 *   # + télécharger 360Redmond.safetensors depuis
 *   #   https://huggingface.co/artificialguybr/360Redmond-360PanoramaSDXLLora
 *   # → dans ComfyUI/models/loras/
 */

export interface Panorama360Character {
  /** Filename du portrait NPC dans ComfyUI input (déjà uploadé par la route). */
  portrait_filename: string
  /** Filename du mask full 2048×1024 dans ComfyUI input (généré par la route). */
  mask_filename: string
  /** Poids IPAdapter FaceID (0-1). Défaut 0.7. */
  weight?: number
}

export interface BuildPanorama360WorkflowParams {
  /** Filename checkpoint SDXL (ex : 'juggernautXL_v9Rdphoto2Lightning.safetensors'). */
  checkpoint: string
  /** Prompt positif. Devrait contenir les trigger words "360, 360view". */
  prompt_positive: string
  prompt_negative?: string
  /** Suffix de style (ex : 'realistic', 'photo', 'bnw'). Appliqué côté prompt. */
  style_suffix?: string
  /** Largeur équirectangulaire (par défaut 2048 = valeur VR standard). */
  width?: number
  /** Hauteur équirectangulaire (par défaut 1024, ratio 2:1 obligatoire). */
  height?: number
  /** Filename du LoRA 360Redmond. Si absent, le pano sera généré sans LoRA. */
  lora_360?: string
  lora_strength_model?: number
  lora_strength_clip?: number
  /** Persos à injecter via IPAdapter FaceID (pour mode "scène" 3ème personne). */
  characters?: Panorama360Character[]
  /** Utiliser MakeCircularVAE pour décoder sans coutures. Défaut true.
   *  ⚠ À désactiver si erreur CUDA "invalid argument" sur GPU Blackwell
   *  (RTX 50 series). Sans ça, légère couture visible au raccord. */
  use_circular_vae?: boolean
  steps?: number
  cfg?: number
  seed?: number
}

const DEFAULT_NEGATIVE =
  'blurry, low quality, watermark, text, distorted, deformed, seams, ' +
  'visible tile boundaries, non-equirectangular, flat projection, cropped, wrong aspect'

// Tags ajoutés auto au prompt positif si pas déjà présents (cohérence avec LoRA 360Redmond)
const DEFAULT_360_TAGS = '360, 360view, equirectangular, panoramic spherical view'

export function buildPanorama360Workflow(params: BuildPanorama360WorkflowParams): Record<string, unknown> {
  const {
    checkpoint,
    prompt_positive,
    prompt_negative = DEFAULT_NEGATIVE,
    style_suffix,
    width = 2048,
    height = 1024,
    lora_360,
    lora_strength_model = 0.6,
    lora_strength_clip = 1.0,
    characters = [],
    use_circular_vae = true,
    steps = 35,
    cfg = 7,
    seed = -1,
  } = params

  // Injecte auto les trigger words + le style si manquants
  let finalPrompt = /\b360\b|equirectangular/i.test(prompt_positive)
    ? prompt_positive
    : `${prompt_positive}, ${DEFAULT_360_TAGS}`
  if (style_suffix) finalPrompt = `${finalPrompt}, ${style_suffix}`

  const workflow: Record<string, unknown> = {
    // 1. Checkpoint → MODEL, CLIP, VAE
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
  }

  // 2. LoRA optionnel (360Redmond pour cohérence équirectangulaire)
  let modelRef: [string, number] = ['1', 0]
  let clipRef: [string, number] = ['1', 1]
  if (lora_360) {
    workflow['2'] = {
      class_type: 'LoraLoader',
      inputs: {
        model: modelRef,
        clip: clipRef,
        lora_name: lora_360,
        strength_model: lora_strength_model,
        strength_clip: lora_strength_clip,
      },
    }
    modelRef = ['2', 0]
    clipRef = ['2', 1]
  }

  // 2.5. IPAdapter FaceID chain (si des persos sont fournis, mode "plan de scène")
  // Chaque perso injecte son visage dans la scène via PLUS FACE preset (sans InsightFace).
  // Le mask "full" permet à FaceID de placer le perso n'importe où dans le pano.
  if (characters.length > 0) {
    workflow['20'] = {
      class_type: 'IPAdapterUnifiedLoader',
      inputs: {
        model: modelRef,
        preset: 'PLUS FACE (portraits)',
      },
    }
    modelRef = ['20', 0]

    characters.forEach((char, i) => {
      const baseId = 30 + i * 3 // 30, 33, 36...
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
          attn_mask: [maskImgId, 1], // MASK output (index 1 de LoadImage)
        },
      }
      modelRef = [ipaId, 0]
    })
  }

  // 3. SeamlessTile (x_only) : modifie le MODEL pour que le sampling produise des bords tileables
  workflow['3'] = {
    class_type: 'SeamlessTile',
    inputs: {
      model: modelRef,
      tiling: 'x_only',
      copy_model: 'Make a copy',
    },
  }
  modelRef = ['3', 0]

  // 4. VAE circulaire (optionnel — à désactiver sur GPU Blackwell qui throw
  //    "CUDA invalid argument" sur MakeCircularVAE). Si désactivé, on utilise
  //    le VAE brut (couture légère possible au bord, acceptable pour test).
  let vaeRef: [string, number]
  if (use_circular_vae) {
    workflow['4'] = {
      class_type: 'MakeCircularVAE',
      inputs: {
        vae: ['1', 2],
        tiling: 'x_only',
        copy_vae: 'Make a copy',
      },
    }
    vaeRef = ['4', 0]
  } else {
    vaeRef = ['1', 2]
  }

  // 5. Prompts
  workflow['5'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: finalPrompt, clip: clipRef },
  }
  workflow['6'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: prompt_negative, clip: clipRef },
  }

  // 6. Latent 2:1
  workflow['7'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width, height, batch_size: 1 },
  }

  // 7. KSampler
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
      denoise: 1.0,
    },
  }

  // 8. VAE decode via le VAE circulaire
  workflow['9'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['8', 0], vae: vaeRef },
  }

  // 9. Save
  workflow['10'] = {
    class_type: 'SaveImage',
    inputs: { images: ['9', 0], filename_prefix: 'hero_panorama_360' },
  }

  return workflow
}
