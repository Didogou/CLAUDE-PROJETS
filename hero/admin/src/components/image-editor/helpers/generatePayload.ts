/**
 * Helper pour construire le payload ComfyUI en fonction du type d'image demandé.
 *
 * Chaque EditorImageType correspond à un workflow ComfyUI spécifique et peut
 * injecter des tags de prompt / negative par défaut (ex : "single isolated
 * object" pour les objets, "full body shot" pour les pleins-pieds).
 *
 * Les dimensions d'image par défaut dépendent aussi du type :
 *   - Portrait      : 1024×1024 (carré, visage centré)
 *   - Plein-pied    : 768×1360 (vertical pour voir la hauteur)
 *   - Objet         : 1024×1024 (carré neutre)
 *   - Plan standard : dépend du format utilisateur
 *   - Panorama 360° : 2048×1024 (ratio 2:1 équirectangulaire)
 */
import type { EditorImageType } from '../types'

export interface PayloadBuildParams {
  /** Prompt EN déjà composé avec cadrage/angle. */
  promptEn: string
  /** Negative prompt EN. */
  negativeEn: string
  /** Type d'image à produire. */
  type: EditorImageType
  /** Format utilisateur (1:1, 16:9, 3:2, 9:16). Ignoré si le type impose un format. */
  format?: string
  /** Style (key de STYLE_SUFFIXES). */
  style?: string
  /** Checkpoint filename. */
  checkpoint: string
  /** Steps / cfg / seed optionnels. */
  steps?: number
  cfg?: number
  seed?: number
}

export interface PayloadResult {
  /** Endpoint API à appeler : '/api/comfyui' pour les workflows standard,
   *  '/api/comfyui/panorama360' pour les panoramas. */
  endpoint: string
  /** Body JSON à envoyer. */
  body: Record<string, unknown>
}

/**
 * Construit le payload adapté au type d'image + format.
 *
 * NOTE : panorama_360 utilise un endpoint distinct qui charge le LoRA 360Redmond
 * et SeamlessTile automatiquement. Pour le POC de Phase 1, on supporte les 4
 * autres types via /api/comfyui workflow 'background'. Le 360° sera branché
 * en Phase 2 en même temps que l'UI 3D.
 */
export function buildGeneratePayload(p: PayloadBuildParams): PayloadResult {
  const { promptEn, negativeEn, type, format, style, checkpoint, steps, cfg, seed } = p

  // Panorama 360° → endpoint dédié (Phase 2)
  if (type === 'panorama_360') {
    return {
      endpoint: '/api/comfyui/panorama360',
      body: {
        prompt_positive: promptEn,
        prompt_negative: negativeEn,
        checkpoint,
        style: style ?? 'realistic',
        steps: steps ?? 35,
        cfg: cfg ?? 7,
        seed: seed ?? -1,
        use_circular_vae: false, // par défaut off pour Blackwell (cf memory Blackwell)
      },
    }
  }

  // Dimensions selon type + format
  const { width, height, promptAddon, negativeAddon, workflowType } = typeDimensionsAndTags(type, format)

  return {
    endpoint: '/api/comfyui',
    body: {
      workflow_type: workflowType,
      prompt_positive: promptAddon ? `${promptEn}, ${promptAddon}` : promptEn,
      prompt_negative: negativeAddon ? `${negativeEn}, ${negativeAddon}` : negativeEn,
      style: style ?? 'realistic',
      width,
      height,
      steps: steps ?? 35,
      cfg: cfg ?? 7,
      seed: seed ?? -1,
      checkpoint,
    },
  }
}

/**
 * Retourne les dimensions + tags de prompt spécifiques pour un type d'image.
 */
function typeDimensionsAndTags(
  type: EditorImageType,
  format?: string,
): {
  width: number
  height: number
  promptAddon: string
  negativeAddon: string
  workflowType: 'portrait' | 'background'
} {
  switch (type) {
    case 'portrait':
      return {
        width: 1024, height: 1024,
        promptAddon: 'portrait shot, head and shoulders, face centered, neutral gray background',
        negativeAddon: 'full body, legs visible, complex background, multiple people',
        workflowType: 'portrait',
      }

    case 'fullbody':
      return {
        width: 768, height: 1360,
        promptAddon: 'full body shot, head to toes visible, standing pose, neutral background',
        negativeAddon: 'cropped, close-up, partial body, multiple people',
        workflowType: 'portrait', // on réutilise le workflow portrait qui a IPAdapter si besoin
      }

    case 'object':
      return {
        width: 1024, height: 1024,
        promptAddon: 'single isolated object centered, neutral background, no people',
        negativeAddon: 'people, person, human, character, face, hands, figure, crowd, landscape scene',
        workflowType: 'background',
      }

    case 'plan_standard':
    default: {
      const [w, h] = parseFormat(format)
      return {
        width: w, height: h,
        promptAddon: '',
        negativeAddon: '',
        workflowType: 'background',
      }
    }
  }
}

/**
 * Convertit un format utilisateur ('1:1', '16:9', etc.) en dimensions pixels.
 * Toutes les résolutions sont "SDXL-compliant" (total pixels ~1 MP, bords
 * multiples de 8).
 */
function parseFormat(format?: string): [number, number] {
  switch (format) {
    case '1:1':       return [1024, 1024]
    case '9:16':      return [768, 1360]       // téléphone vertical
    case '3:2':       return [1216, 832]       // photo classique
    case '4:3':       return [1152, 864]       // tablette iPad
    case '2:1 pano':  return [1536, 768]       // pano light (le vrai 360 passe par l'autre endpoint)
    case '16:9':
    default:          return [1360, 768]       // cinéma
  }
}
