/**
 * Workflow Florence-2 + SAM 2 pour ComfyUI.
 *
 * Cas d'usage : requêtes complexes avec raisonnement spatial relationnel
 * ("le coussin SUR le canapé", "la voiture DEVANT la maison").
 * GroundingDINO ne comprend pas ces relations — il retourne TOUS les coussins.
 * Florence-2 (Microsoft) supporte ça via 2 modes principaux :
 *   - REFERRING_EXPRESSION_SEGMENTATION (REG) : phrase → polygone direct
 *   - CAPTION_TO_PHRASE_GROUNDING : phrase → bbox(es) (puis SAM 2 → mask précis)
 *
 * Notre choix : CAPTION_TO_PHRASE_GROUNDING + SAM 2 = bbox raisonné par
 * Florence + mask haute précision par SAM 2. Pipeline en 2 étapes mais le
 * meilleur résultat global.
 *
 * Installation côté ComfyUI :
 *   cd ComfyUI/custom_nodes
 *   git clone https://github.com/kijai/ComfyUI-Florence2
 *   cd ComfyUI-Florence2
 *   ../../venv/Scripts/python.exe -m pip install -r requirements.txt
 *   # Modèle Florence-2 base (~270MB) téléchargé au 1er run dans
 *   # ComfyUI/models/LLM/Florence-2-base/
 *
 * SAM 2 (kijai) déjà installé pour le mode prompt-point manuel — réutilisé ici.
 */

export interface BuildFlorenceSAM2WorkflowParams {
  /** Filename de l'image dans ComfyUI input folder (déjà uploadée). */
  image_filename: string
  /** Phrase EN selon le mode :
   *   - res  : expression relationnelle UN sujet ("the cushion on the sofa")
   *   - ctpg : noun phrases multi-classes ("sofa . cushions on the sofa") */
  prompt_text: string
  /** Mode Florence-2 :
   *   - 'res'  (default) : referring_expression_segmentation, UN sujet précis
   *                        désigné par la relation (sortie : polygone direct)
   *   - 'ctpg' : caption_to_phrase_grounding, PLUSIEURS objets via leurs phrases
   *              (sortie : bboxes → SAM 2 → mask pixel-precis multi-objets) */
  mode?: 'res' | 'ctpg'
  /** Variante Florence-2. 'base' = 270MB, 'large' = 770MB (plus précis). */
  florence_model?: 'base' | 'large'
}

const FLORENCE_MODELS = {
  base: 'microsoft/Florence-2-base',
  large: 'microsoft/Florence-2-large',
}

/**
 * Workflow : image + texte → Florence-2 (CAPTION_TO_PHRASE_GROUNDING)
 *   → bboxes → SAM 2 (kijai) → mask PRÉCIS au pixel.
 *
 * V1 (mask Florence direct) → REMPLACÉ : Florence retourne juste les bboxes,
 * pas un vrai mask. La sortie était un rectangle grossier englobant l'objet.
 * V2 (CE QU'ON FAIT MAINTENANT) :
 *   - Florence-2 retourne data JSON avec bboxes
 *   - Florence2toCoordinates (kijai SAM2 pack) parse le JSON → BBOX
 *   - Sam2Segmentation prend les BBOX → mask précis au pixel
 *
 * Sortie : PNG mask binaire dans ComfyUI output (format identique à
 * Grounded-SAM pour réutiliser le pipeline frontend existant).
 */
export function buildFlorenceSAM2Workflow(params: BuildFlorenceSAM2WorkflowParams): Record<string, unknown> {
  const { image_filename, prompt_text, florence_model = 'base', mode = 'res' } = params

  // Workflow commun : load image + load Florence + Florence2Run
  const base: Record<string, unknown> = {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: image_filename },
    },
    '2': {
      class_type: 'DownloadAndLoadFlorence2Model',
      inputs: {
        model: FLORENCE_MODELS[florence_model],
        precision: 'fp16',
        attention: 'sdpa',
      },
    },
    '3': {
      class_type: 'Florence2Run',
      inputs: {
        image: ['1', 0],
        florence2_model: ['2', 0],
        text_input: prompt_text,
        task: mode === 'ctpg' ? 'caption_to_phrase_grounding' : 'referring_expression_segmentation',
        fill_mask: true,
        keep_model_loaded: true,
        max_new_tokens: 1024,
        num_beams: 3,
        do_sample: false,
        output_mask_select: '',
        seed: 1,
      },
    },
  }

  if (mode === 'res') {
    // RES : Florence sort un polygone précis du sujet désigné. On utilise le
    // mask directement, pas besoin de SAM 2 — la précision RES suffit.
    return {
      ...base,
      '4': {
        class_type: 'MaskToImage',
        inputs: { mask: ['3', 1] },        // Florence2Run MASK output (index 1)
      },
      '5': {
        class_type: 'SaveImage',
        inputs: { images: ['4', 0], filename_prefix: 'hero_florence_res_mask' },
      },
    }
  }

  // CTPG : Florence sort des bboxes pour CHAQUE noun phrase détectée.
  // On les passe à SAM 2 pour avoir des masks pixel-precis multi-objets.
  return {
    ...base,
    // 4. Parse les bboxes depuis le data JSON Florence (index 3 = data)
    '4': {
      class_type: 'Florence2toCoordinates',
      inputs: {
        data: ['3', 3],
        index: '',                          // empty = toutes les bboxes
        batch: false,
      },
    },
    // 5. Charge SAM 2
    '5': {
      class_type: 'DownloadAndLoadSAM2Model',
      inputs: {
        model: 'sam2_hiera_large.safetensors',
        segmentor: 'single_image',
        device: 'cuda',
        precision: 'fp16',
      },
    },
    // 6. SAM 2 segmentation depuis les bboxes Florence → mask multi-objets
    '6': {
      class_type: 'Sam2Segmentation',
      inputs: {
        sam2_model: ['5', 0],
        image: ['1', 0],
        keep_model_loaded: true,
        bboxes: ['4', 1],                  // index 1 = BBOX output
        individual_objects: false,         // false = union de toutes les bboxes en 1 mask
      },
    },
    '7': {
      class_type: 'MaskToImage',
      inputs: { mask: ['6', 0] },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: 'hero_florence_ctpg_mask' },
    },
  }
}
