// Pipeline 2-étapes : Florence dense_region_caption → N×SAM single bbox.
// individual_objects=true ne split pas → on appelle SAM N fois.

const FLORENCE_MODELS = {
  base: 'microsoft/Florence-2-base',
  large: 'microsoft/Florence-2-large',
}

// ── Workflow A : Florence-2 detection only ────────────────────────────────

export interface BuildSceneFlorenceParams {
  image_filename: string
  florence_model?: 'base' | 'large'
}

export function buildSceneFlorenceWorkflow(params: BuildSceneFlorenceParams): Record<string, unknown> {
  const { image_filename, florence_model = 'large' } = params
  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
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
        text_input: '',
        task: 'dense_region_caption',
        fill_mask: false,
        keep_model_loaded: true,
        max_new_tokens: 1024,
        num_beams: 3,
        do_sample: false,
        output_mask_select: '',
        seed: 1,
      },
    },
    // Sauve la caption (labels + locations encodés)
    '4': {
      class_type: 'HeroSaveText',
      inputs: {
        text: ['3', 2],
        filename_prefix: 'scene_caption',
      },
    },
  }
}

// ── Workflow A2 : Florence-2 <OD> object detection ──────────────────────
// Complément de dense_region_caption : retourne les OBJETS INDIVIDUELS
// (pillow, chair, plant…) que dense_region_caption regroupe parfois dans
// la description d'un objet plus large.
//
// Output : data JSON {bboxes: [...], labels: [...]} en pixels source.

export function buildSceneFlorenceODWorkflow(params: BuildSceneFlorenceParams): Record<string, unknown> {
  const { image_filename, florence_model = 'large' } = params
  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
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
        text_input: '',
        // ⚠ Le node kijai appelle <OD> "region_caption" (mapping ligne 382 de
        // leur nodes.py : 'region_caption': '<OD>'). Le nom est trompeur.
        task: 'region_caption',
        fill_mask: false,
        keep_model_loaded: true,
        max_new_tokens: 1024,
        num_beams: 3,
        do_sample: false,
        output_mask_select: '',
        seed: 1,
      },
    },
    // ⚠ Pour region_caption (= <OD>), le data JSON ne contient QUE des
    // bboxes sans labels (cf kijai nodes.py L567 : `out_data.append(bboxes)`).
    // Les labels sont dans la caption STRING (output index 2) au format
    // "couch<loc_x><loc_y>...". On sauve donc la caption text comme pour
    // dense_region_caption — même parser réutilisable côté API.
    '4': {
      class_type: 'HeroSaveText',
      inputs: {
        text: ['3', 2],
        filename_prefix: 'scene_od_caption',
      },
    },
  }
}

// ── Workflow A3 : Florence-2 CAPTION_TO_PHRASE_GROUNDING ────────────────
// Open-vocab : on lui donne un prompt avec une liste de noun phrases
// (`"pillow . cushion . lamp"`), Florence retourne bboxes par instance dans
// la caption STRING au format identique à dense_region : `phrase<loc_x><loc_y>...`

export interface BuildSceneFlorenceCTPGParams {
  image_filename: string
  florence_model?: 'base' | 'large'
  /** Prompt multi-objets, format ". " entre les classes : "pillow. cushion. lamp." */
  prompt_text: string
}

export function buildSceneFlorenceCTPGWorkflow(params: BuildSceneFlorenceCTPGParams): Record<string, unknown> {
  const { image_filename, florence_model = 'large', prompt_text } = params
  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
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
        task: 'caption_to_phrase_grounding',
        fill_mask: false,
        keep_model_loaded: true,
        max_new_tokens: 1024,
        num_beams: 3,
        do_sample: false,
        output_mask_select: '',
        seed: 1,
      },
    },
    '4': {
      class_type: 'HeroSaveText',
      inputs: { text: ['3', 2], filename_prefix: 'scene_ctpg_caption' },
    },
  }
}

// ── Workflow A5 : DINO + SAM 1 HQ combinés (storyicon) ────────────────────
// Reproduit exactement le pipeline d'ai-cut-playground :
// GroundingDINO trouve N bboxes (multi-instance), SAM 1 HQ les segmente
// avec des bords nets sur petits objets.
// Output : N images saved (1 par bbox détectée) via SaveImage batch.

export interface BuildSceneDinoSAM1Params {
  image_filename: string
  prompt: string
  threshold?: number
}

export function buildSceneDinoSAM1Workflow(params: BuildSceneDinoSAM1Params): Record<string, unknown> {
  const { image_filename, prompt, threshold = 0.30 } = params
  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
    '2': {
      class_type: 'GroundingDinoModelLoader (segment anything)',
      inputs: { model_name: 'GroundingDINO_SwinT_OGC (694MB)' },
    },
    '3': {
      class_type: 'SAMModelLoader (segment anything)',
      // SAM 1 HQ — bords nets sur petits objets, modèle utilisé par ai-cut-playground
      inputs: { model_name: 'sam_hq_vit_h (2.57GB)' },
    },
    '4': {
      class_type: 'GroundingDinoSAMSegment (segment anything)',
      inputs: {
        sam_model: ['3', 0],
        grounding_dino_model: ['2', 0],
        image: ['1', 0],
        prompt,
        threshold,
      },
    },
    // Le node retourne (IMAGE batch, MASK batch). On sauve les masks comme PNGs
    // séparés via SaveImage qui itère sur la dim batch.
    '5': { class_type: 'MaskToImage', inputs: { mask: ['4', 1] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'scene_dino_sam1' } },
  }
}

// ── Workflow A4 : DINO detect (bboxes only, multi-instance) ──────────────
// HeroDinoDetect retourne N bboxes (per-instance) pour 1 prompt class.
// On enchaîne avec HeroSaveText pour persister le JSON et que l'API le lise.

export interface BuildSceneDinoParams {
  image_filename: string
  /** 1 SEUL nom de classe par appel (ex: "pillow"). DINO supporte "a . b ."
   *  multi-class mais on n'aurait pas le label per-bbox côté output. */
  prompt: string
  /** Seuil DINO 0-1. 0.30 défaut. Plus bas = plus de candidats (faux positifs). */
  threshold?: number
}

export function buildSceneDinoWorkflow(params: BuildSceneDinoParams): Record<string, unknown> {
  const { image_filename, prompt, threshold = 0.30 } = params
  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
    '2': {
      class_type: 'GroundingDinoModelLoader (segment anything)',
      inputs: { model_name: 'GroundingDINO_SwinT_OGC (694MB)' },
    },
    '3': {
      class_type: 'HeroDinoDetect',
      inputs: {
        grounding_dino_model: ['2', 0],
        image: ['1', 0],
        prompt,
        threshold,
      },
    },
    '4': {
      class_type: 'HeroSaveText',
      inputs: { text: ['3', 0], filename_prefix: 'scene_dino_bboxes' },
    },
  }
}

// ── Workflow B : SAM 2 single bbox → 1 mask ────────────────────────────────

export interface BuildSceneSAMSingleBboxParams {
  image_filename: string
  bbox: [number, number, number, number]   // pixels (x1, y1, x2, y2)
}

// On passe la VRAIE bbox à Sam2Segmentation via HeroBboxFromJson.
// Un simple prompt-point au centre donnait des masks erratiques (segmente le
// fond ou un autre objet quand le centre tombe sur une zone vide).
export function buildSceneSAMSingleBboxWorkflow(params: BuildSceneSAMSingleBboxParams): Record<string, unknown> {
  const { image_filename, bbox } = params

  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
    '2': {
      class_type: 'DownloadAndLoadSAM2Model',
      inputs: {
        model: 'sam2_hiera_large.safetensors',
        segmentor: 'single_image',
        device: 'cuda',
        precision: 'fp16',
      },
    },
    '3': {
      class_type: 'HeroBboxFromJson',
      inputs: { bboxes_json: JSON.stringify([bbox]) },
    },
    '4': {
      class_type: 'Sam2Segmentation',
      inputs: {
        sam2_model: ['2', 0],
        image: ['1', 0],
        keep_model_loaded: true,
        bboxes: ['3', 0],
      },
    },
    '5': { class_type: 'MaskToImage', inputs: { mask: ['4', 0] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'scene_single_mask' } },
  }
}

// ── Workflow B'' : SAM 2 avec point prompt (pas bbox) ────────────────────
// Test de l'approche originale "centre de bbox Florence → SAM point" sur
// le scene-analyzer qui affiche maintenant les masks bruts proprement.
// On valide enfin honnêtement si SAM point-prompt sur le centre marche.

export interface BuildSceneSAMPointParams {
  image_filename: string
  point: [number, number]   // pixels (cx, cy)
}

export function buildSceneSAMPointWorkflow(params: BuildSceneSAMPointParams): Record<string, unknown> {
  const { image_filename, point } = params
  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
    '2': {
      class_type: 'DownloadAndLoadSAM2Model',
      inputs: {
        model: 'sam2_hiera_large.safetensors',
        segmentor: 'single_image',
        device: 'cuda',
        precision: 'fp16',
      },
    },
    '3': {
      class_type: 'Sam2Segmentation',
      inputs: {
        sam2_model: ['2', 0],
        image: ['1', 0],
        keep_model_loaded: true,
        coordinates_positive: JSON.stringify([{ x: point[0], y: point[1] }]),
      },
    },
    '4': { class_type: 'MaskToImage', inputs: { mask: ['3', 0] } },
    '5': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'scene_point_mask' } },
  }
}

// ── Workflow B''' : SAM 2 avec bbox + point combinés ─────────────────────
// Best of both : bbox contraint la zone, point identifie l'objet dominant
// dans cette zone. SAM 2 utilise les 2 signaux simultanément (predict_torch
// accepte point_coords + boxes ensemble).

export interface BuildSceneSAMBboxPointParams {
  image_filename: string
  bbox: [number, number, number, number]   // pixels
  point: [number, number]                  // pixels (cx, cy = centre de bbox)
}

export function buildSceneSAMBboxPointWorkflow(params: BuildSceneSAMBboxPointParams): Record<string, unknown> {
  const { image_filename, bbox, point } = params
  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
    '2': {
      class_type: 'DownloadAndLoadSAM2Model',
      inputs: {
        model: 'sam2_hiera_large.safetensors',
        segmentor: 'single_image',
        device: 'cuda',
        precision: 'fp16',
      },
    },
    '3': {
      class_type: 'HeroBboxFromJson',
      inputs: { bboxes_json: JSON.stringify([bbox]) },
    },
    '4': {
      class_type: 'Sam2Segmentation',
      inputs: {
        sam2_model: ['2', 0],
        image: ['1', 0],
        keep_model_loaded: true,
        bboxes: ['3', 0],
        coordinates_positive: JSON.stringify([{ x: point[0], y: point[1] }]),
      },
    },
    '5': { class_type: 'MaskToImage', inputs: { mask: ['4', 0] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'scene_bbox_point_mask' } },
  }
}

// ── Workflow B' : SAM 2 N bboxes → 1 mask agrégé ──────────────────────────
// Pour grouper les instances d'une même classe (ex: tous les pillows = 1 mask).
// Sam2Segmentation avec individual_objects=false retourne 1 mask union.

export interface BuildSceneSAMMultiBboxParams {
  image_filename: string
  bboxes: Array<[number, number, number, number]>   // pixels
}

export function buildSceneSAMMultiBboxWorkflow(params: BuildSceneSAMMultiBboxParams): Record<string, unknown> {
  const { image_filename, bboxes } = params

  return {
    '1': { class_type: 'LoadImage', inputs: { image: image_filename } },
    '2': {
      class_type: 'DownloadAndLoadSAM2Model',
      inputs: {
        model: 'sam2_hiera_large.safetensors',
        segmentor: 'single_image',
        device: 'cuda',
        precision: 'fp16',
      },
    },
    '3': {
      class_type: 'HeroBboxFromJson',
      inputs: { bboxes_json: JSON.stringify(bboxes) },
    },
    '4': {
      class_type: 'Sam2Segmentation',
      inputs: {
        sam2_model: ['2', 0],
        image: ['1', 0],
        keep_model_loaded: true,
        bboxes: ['3', 0],
        individual_objects: false,   // false = union de toutes les bboxes en 1 mask
      },
    },
    '5': { class_type: 'MaskToImage', inputs: { mask: ['4', 0] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'scene_grouped_mask' } },
  }
}
