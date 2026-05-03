/**
 * Workflow ComfyUI pour l'effacement d'objets par LAMA (Large Mask Inpainting).
 *
 * Utilise :
 *   - `comfyui-inpaint-nodes` (Acly) pour LAMA (big-lama.pt)
 *   - `ComfyUI-Inpaint-CropAndStitch` (lquesada) pour crop autour du mask +
 *     stitch de la zone inpainted dans le pano pleine résolution
 *
 * IMPORTANT : LAMA dans le node Acly tourne nativement à 256×256. Sur un
 * panorama 2048×1024 c'est catastrophique (flou partout, pas de suppression
 * nette). Solution : on crop autour du mask à 512×512, LAMA inpaint cette
 * zone, puis InpaintStitch recolle SEULEMENT la zone masquée dans le pano
 * original pleine résolution (le reste du pano n'est pas touché).
 *
 * Pipeline :
 *   1. LoadImage (pano source)
 *   2. LoadImage (mask PNG blanc/noir)
 *   3. ImageToMask (canal R)
 *   4. InpaintCropImproved : (image + mask) → (stitcher + cropped_image + cropped_mask)
 *      Avec context_from_mask_extend_factor=1.5 → crop 50% plus large que le mask
 *      pour donner du contexte à LAMA. Resize target = 512×512.
 *   5. LoadInpaintModel (big-lama.pt)
 *   6. InpaintWithModel : applique LAMA sur cropped_image + cropped_mask → inpainted
 *   7. InpaintStitchImproved : stitcher + inpainted → pano final (pleine res)
 *   8. SaveImage
 *
 * Pré-requis :
 *   - git clone https://github.com/Acly/comfyui-inpaint-nodes
 *   - git clone https://github.com/lquesada/ComfyUI-InpaintCropAndStitch
 *   - ComfyUI/models/inpaint/big-lama.pt
 */

export interface EraseWorkflowParams {
  /** Filename de la source uploadée dans ComfyUI input. */
  source_filename: string
  /** Filename du mask uploadé (blanc = à effacer, noir = à garder). */
  mask_filename: string
  /** Nom du modèle LAMA dans models/inpaint/. Défaut : big-lama.pt. */
  inpaint_model?: string
  /** Résolution cible du crop fed à LAMA. 512 = qualité vs vitesse optimale.
   *  768 = mieux pour grandes zones. 256 = plus rapide mais LAMA fait rien de plus. */
  crop_target_size?: number
  /** Facteur de contexte autour du mask. 1.2 = minimum (crop serré),
   *  1.5 = recommandé (donne du contexte à LAMA), 2.0+ = très généreux. */
  context_extend_factor?: number
}

export function buildEraseWorkflow(params: EraseWorkflowParams): Record<string, unknown> {
  const { source_filename, mask_filename } = params
  const modelName = params.inpaint_model ?? 'big-lama.pt'
  const targetSize = params.crop_target_size ?? 512
  const contextFactor = params.context_extend_factor ?? 1.5

  return {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: source_filename },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: mask_filename },
    },
    '3': {
      class_type: 'ImageToMask',
      inputs: { image: ['2', 0], channel: 'red' },
    },
    // Crop : isole une zone autour du mask pour que LAMA travaille à bonne résolution
    '4': {
      class_type: 'InpaintCropImproved',
      inputs: {
        image: ['1', 0],
        mask: ['3', 0],
        downscale_algorithm: 'bilinear',
        upscale_algorithm: 'bicubic',
        preresize: false,
        preresize_mode: 'ensure minimum resolution',
        preresize_min_width: 1024,
        preresize_min_height: 1024,
        preresize_max_width: 8192,
        preresize_max_height: 8192,
        mask_fill_holes: true,
        mask_expand_pixels: 4,        // grossit légèrement le mask pour bien couvrir l'objet
        mask_invert: false,
        mask_blend_pixels: 32,         // feathering du raccord au stitch
        mask_hipass_filter: 0.1,
        extend_for_outpainting: false,
        extend_up_factor: 1.0,
        extend_down_factor: 1.0,
        extend_left_factor: 1.0,
        extend_right_factor: 1.0,
        context_from_mask_extend_factor: contextFactor,
        output_resize_to_target_size: true,
        output_target_width: targetSize,
        output_target_height: targetSize,
        output_padding: '32',
        device_mode: 'gpu (much faster)',
      },
    },
    '5': {
      class_type: 'INPAINT_LoadInpaintModel',
      inputs: { model_name: modelName },
    },
    '6': {
      class_type: 'INPAINT_InpaintWithModel',
      inputs: {
        inpaint_model: ['5', 0],
        image: ['4', 1],    // cropped_image (output #1 de InpaintCropImproved)
        mask: ['4', 2],     // cropped_mask   (output #2)
        seed: Math.floor(Math.random() * 0xFFFFFFFF),
      },
    },
    // Stitch : recolle l'inpainted crop dans le pano original pleine résolution
    '7': {
      class_type: 'InpaintStitchImproved',
      inputs: {
        stitcher: ['4', 0],         // stitcher (output #0 de InpaintCropImproved)
        inpainted_image: ['6', 0],  // résultat LAMA
      },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: 'hero_erase' },
    },
  }
}
