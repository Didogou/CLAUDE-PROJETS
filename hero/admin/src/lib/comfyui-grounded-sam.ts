/**
 * Workflow Grounded-SAM pour ComfyUI.
 *
 * Combine :
 *   - GroundingDINO  → texte "sofa" → bbox(es) candidates avec scores
 *   - SAM 2 (kijai)  → bbox → mask précis
 *
 * Installation côté ComfyUI (à faire une seule fois) :
 *   cd ComfyUI/custom_nodes
 *   git clone https://github.com/storyicon/comfyui_segment_anything
 *   pip install -r comfyui_segment_anything/requirements.txt
 *   # Modèles téléchargés au 1er run depuis HuggingFace :
 *   #   - GroundingDINO-T (~700MB) → ComfyUI/models/grounding-dino/
 *   #   - GroundingDINO-B (~1GB)
 *
 * Note : SAM 2 (kijai) reste indépendant pour le mode point-prompt manuel.
 * GroundingDINO par contre nécessite ce node-là spécifiquement.
 *
 * Sortie attendue : array de N candidats { bbox, maskUrl, confidence, label }
 * triés par confiance descendante.
 */

export interface BuildGroundedSAMWorkflowParams {
  /** Filename de l'image dans ComfyUI input folder (déjà uploadée). */
  image_filename: string
  /** Prompt textuel (anglais) — peut contenir plusieurs objets séparés par "."
   *  Ex: "sofa . armchair . table" → DINO retourne bboxes pour les 3 classes. */
  prompt_text: string
  /** Seuil de confiance DINO (0-1). Default 0.30 — équilibre rappel/précision.
   *  Plus bas = plus de candidats (parfois faux positifs).
   *  Plus haut = moins de bruit mais risque de rater l'objet. */
  threshold?: number
}

/**
 * Workflow : image + texte → DINO bboxes → SAM masks → preview composite + masks.
 *
 * Le node `GroundingDinoSAMSegment (segment anything)` du repo storyicon
 * orchestre déjà DINO + SAM en interne. On lui passe l'image + le prompt
 * texte, il sort une IMAGE composite (preview) + un MASK stacké (multi-objets).
 *
 * Pour récupérer les bboxes individuelles, il faut un workflow plus séparé :
 *   1. GroundingDinoModelLoader   → charge DINO
 *   2. SAMModelLoader             → charge SAM (HQ)
 *   3. GroundingDinoSAMSegment    → retourne (image, mask) combinés
 *   4. SaveImage + SaveMask       → on récupère via API
 *
 * Comme le node combine tout, on ne récupère pas les bboxes individuelles
 * directement. V1 : on traite la sortie comme un mask agrégé qui marche pour
 * "le canapé" (1 instance détectée). Pour multi-instances ("tous les coussins"),
 * V2 utilisera un workflow custom avec node intermédiaire qui expose les bboxes.
 */
export function buildGroundedSAMWorkflow(params: BuildGroundedSAMWorkflowParams): Record<string, unknown> {
  const { image_filename, prompt_text, threshold = 0.30 } = params

  return {
    '1': {
      class_type: 'GroundingDinoModelLoader (segment anything)',
      inputs: {
        // Modèle DINO. 'GroundingDINO_SwinT_OGC (694MB)' = défaut storyicon.
        // Variantes plus précises : 'GroundingDINO_SwinB (938MB)'.
        model_name: 'GroundingDINO_SwinT_OGC (694MB)',
      },
    },
    '2': {
      class_type: 'SAMModelLoader (segment anything)',
      inputs: {
        // SAM 1 HQ — celui packaged avec storyicon. SAM 2 standalone est
        // fourni par kijai mais n'est pas le même node.
        model_name: 'sam_vit_h (2.56GB)',
      },
    },
    '3': {
      class_type: 'LoadImage',
      inputs: { image: image_filename },
    },
    '4': {
      class_type: 'GroundingDinoSAMSegment (segment anything)',
      inputs: {
        sam_model: ['2', 0],
        grounding_dino_model: ['1', 0],
        image: ['3', 0],
        prompt: prompt_text,
        threshold,
      },
    },
    // Sortie : (IMAGE, MASK) — l'image composite a le sujet sur fond transparent,
    // le MASK est binaire (zones détectées en blanc).
    '5': {
      class_type: 'MaskToImage',
      inputs: { mask: ['4', 1] },
    },
    '6': {
      class_type: 'SaveImage',
      inputs: { images: ['5', 0], filename_prefix: 'hero_grounded_mask' },
    },
  }
}
