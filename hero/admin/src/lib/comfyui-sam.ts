/**
 * Workflow SAM 2 (Segment Anything Model v2) pour ComfyUI.
 *
 * Utilise les nodes de ComfyUI-segment-anything-2 (kijai) :
 *   - DownloadAndLoadSAM2Model  (charge sam2_hiera_large.safetensors ou variant)
 *   - Sam2Segmentation          (applique le modèle sur une image + points)
 *
 * Installation (à faire une seule fois côté ComfyUI) :
 *   cd ComfyUI/custom_nodes
 *   git clone https://github.com/kijai/ComfyUI-segment-anything-2
 *   # Redémarrer ComfyUI — pas de pip install, dépendances bundlées
 *   # (le package `sam2` est embarqué dans le repo)
 *   # Les modèles sont téléchargés à la première utilisation du node
 *   # depuis https://huggingface.co/Kijai/sam2-safetensors
 *   # vers ComfyUI/models/sam2
 *
 * Si les nodes ne sont pas installés, le workflow sera rejeté par ComfyUI
 * avec une erreur "NodeClass not found" ; l'API route /api/comfyui/segment
 * capture ça et renvoie un message explicite à l'utilisateur.
 *
 * Entrée du workflow :
 *   - image (filename dans ComfyUI input folder, déjà uploadé)
 *   - points (tableau de { x, y, positive } en coords naturelles)
 *
 * Sortie : un PNG dans ComfyUI output avec le mask (blanc = perso, noir = fond).
 */

export interface SAMPoint { x: number; y: number; positive: boolean }

export interface BuildSAM2WorkflowParams {
  /** Filename de l'image dans ComfyUI input folder (déjà uploadée). */
  image_filename: string
  /** Points en coordonnées naturelles de l'image (pas display). */
  points: SAMPoint[]
  /** Variante du modèle SAM 2. 'large' (défaut) = meilleur mask, 'base' = plus rapide. */
  model?: 'large' | 'base_plus' | 'small' | 'tiny'
  /** Seuil de binarisation du mask (0-1). 0 = défaut (seuil de SAM). */
  mask_threshold?: number
}

const MODEL_FILES: Record<NonNullable<BuildSAM2WorkflowParams['model']>, string> = {
  large: 'sam2_hiera_large.safetensors',
  base_plus: 'sam2_hiera_base_plus.safetensors',
  small: 'sam2_hiera_small.safetensors',
  tiny: 'sam2_hiera_tiny.safetensors',
}

// ── Auto-segmentation (baguette magique) ─────────────────────────────────────

export interface BuildSAM2AutoWorkflowParams {
  image_filename: string
  model?: 'large' | 'base_plus' | 'small' | 'tiny'
  /** Densité d'échantillonnage (points_per_side). 32 = défaut SAM. */
  points_per_side?: number
  /** Seuil IoU pour conserver un mask. 0.8 = défaut SAM, baisser pour plus de candidats. */
  pred_iou_thresh?: number
  /** Seuil de stabilité. 0.95 = défaut SAM, exigeant. */
  stability_score_thresh?: number
  /** Aire min d'un mask (pixels, coerced). 0 = pas de post-processing. */
  min_mask_region_area?: number
  /** Nb de couches de crop pour multi-scale (0 = full image seule, 1 = + 2×2 crops). Plus de couches = détecte plus de sous-objets mais plus lent. */
  crop_n_layers?: number
  /** NMS IoU (0-1). Plus bas = plus agressif (supprime duplicates), plus haut = garde plus de candidats. */
  box_nms_thresh?: number
}

/**
 * Workflow SAM 2 auto-segmentation : découpe l'image entière en candidats objets
 * (~10-30 masks typiquement). Sortie :
 *   - MASK   : tenseur [N, H, W] stacké, sauvé en N PNGs par SaveImage
 *   - IMAGE  : image composée avec les masks colorés (debug / preview)
 *   - BBOX   : liste de bounding boxes (pas directement consommée par SaveImage)
 *
 * Côté API, on récupère les N PNGs du MASK et le preview coloré pour debug.
 */
export function buildSAM2AutoWorkflow(params: BuildSAM2AutoWorkflowParams): Record<string, unknown> {
  const {
    image_filename,
    model = 'large',
    // 32 = défaut SAM, le plus fiable pour la diversité. 16-24 peut rater des
    // sous-objets sur certaines scènes.
    points_per_side = 32,
    // 0.6 (vs défaut 0.8) : très lenient → plus de candidats acceptés.
    // Évite le cas "SAM ne sort qu'1 seul gros mask" sur portraits/scènes simples.
    pred_iou_thresh = 0.6,
    // 0.85 (vs défaut 0.95) : lenient aussi pour plus de diversité.
    stability_score_thresh = 0.85,
    // 0 : post-processing "remove small regions" désactivé. Évite le cas
    // pathologique où ça supprime TOUS les masks.
    min_mask_region_area = 0,
    // 0 : pas de multi-scale. crop_n_layers=1 déclenche des IndexError internes
    // dans SAM2 sur certaines images (bug kijai/meta). La diversité repose donc
    // uniquement sur points_per_side + thresholds lenient.
    crop_n_layers = 0,
    // 0.7 = défaut SAM. Valeurs plus hautes (0.85) peuvent aussi déclencher
    // des IndexErrors quand couplées avec certains crops.
    box_nms_thresh = 0.7,
  } = params

  return {
    '1': {
      class_type: 'DownloadAndLoadSAM2Model',
      inputs: {
        model: MODEL_FILES[model],
        // ⚠ 'automaskgenerator' charge le modèle avec la bonne config pour auto-seg
        segmentor: 'automaskgenerator',
        device: 'cuda',
        precision: 'fp16',
      },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: image_filename },
    },
    '3': {
      // Node custom maison : contrairement à Sam2AutoSegmentation de kijai qui
      // combine tous les masks en 1 via logical_or, celui-ci renvoie un tenseur
      // MASK [N, H, W] (N masks individuels triés par aire décroissante).
      // Installation : dropper HeroSAM2Individual/__init__.py dans ComfyUI/custom_nodes/.
      class_type: 'HeroSam2AutoIndividual',
      inputs: {
        sam2_model: ['1', 0],
        image: ['2', 0],
        points_per_side,
        pred_iou_thresh,
        stability_score_thresh,
        min_mask_region_area,
        max_masks: 50,
      },
    },
    // Convertit le tenseur MASK [N,H,W] en IMAGE [N,H,W,3] puis sauve N PNGs
    '4': {
      class_type: 'MaskToImage',
      inputs: { mask: ['3', 0] },
    },
    '5': {
      class_type: 'SaveImage',
      inputs: { images: ['4', 0], filename_prefix: 'hero_sam_auto' },
    },
  }
}

export function buildSAM2Workflow(params: BuildSAM2WorkflowParams): Record<string, unknown> {
  const { image_filename, points, model = 'large', mask_threshold = 0.0 } = params

  // Sépare points positifs / négatifs et formate en JSON string attendu par le node kijai.
  // Format exigé : [{"x": 100, "y": 200}] (objets x/y, pas des tuples).
  // Cf. nodes.py : coordinates = [(coord['x'], coord['y']) for coord in json.loads(...)]
  //
  // ⚠ Edge case : si `coordinates_negative` vaut `"[]"` (empty list après parse),
  // le node fait `np.concatenate(positives, np.array([]))` qui plante
  // ("all input arrays must have same number of dimensions"). On N'envoie DONC
  // PAS la clé du tout quand il n'y a pas de négatifs.
  const positives = points.filter(p => p.positive).map(p => ({ x: p.x, y: p.y }))
  const negatives = points.filter(p => !p.positive).map(p => ({ x: p.x, y: p.y }))

  const samInputs: Record<string, unknown> = {
    sam2_model: ['1', 0],
    image: ['2', 0],
    keep_model_loaded: true,
    coordinates_positive: JSON.stringify(positives),
    individual_objects: false,
    mask_threshold,
  }
  if (negatives.length > 0) {
    samInputs.coordinates_negative = JSON.stringify(negatives)
  }

  return {
    '1': {
      class_type: 'DownloadAndLoadSAM2Model',
      inputs: {
        model: MODEL_FILES[model],
        segmentor: 'single_image',
        device: 'cuda',
        precision: 'fp16',
      },
    },
    '2': {
      class_type: 'LoadImage',
      inputs: { image: image_filename },
    },
    '3': {
      class_type: 'Sam2Segmentation',
      inputs: samInputs,
    },
    // Sam2Segmentation output : ("mask",) — un seul MASK à l'index 0.
    '4': {
      class_type: 'MaskToImage',
      inputs: { mask: ['3', 0] },
    },
    '5': {
      class_type: 'SaveImage',
      inputs: { images: ['4', 0], filename_prefix: 'hero_sam_mask' },
    },
  }
}
