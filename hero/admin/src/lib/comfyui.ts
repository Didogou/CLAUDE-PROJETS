/**
 * ComfyUI API client — communicates with the local ComfyUI server.
 *
 * Endpoints used:
 *   POST /api/prompt         → queue a workflow
 *   GET  /api/history/{id}   → poll for results
 *   GET  /api/view?...       → fetch generated image
 *   POST /api/upload/image   → upload an image to ComfyUI input folder
 */

import { buildCinemagraphWorkflow } from './comfyui-cinemagraph'

import { deflateSync } from 'node:zlib'

const COMFYUI_URL = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComfyUIPromptResponse {
  prompt_id: string
  number: number
  node_errors: Record<string, unknown>
}

export interface ComfyUIImageOutput {
  filename: string
  subfolder: string
  type: string // 'output' | 'temp'
}

export interface ComfyUINodeOutput {
  images?: ComfyUIImageOutput[]
  gifs?: ComfyUIImageOutput[]
}

export interface ComfyUIHistoryEntry {
  status: { status_str: string; completed: boolean }
  outputs: Record<string, ComfyUINodeOutput>
}

export type WorkflowType = 'portrait' | 'scene_composition' | 'transition' | 'background' | 'animate' | 'wan_animate' | 'wan_camera' | 'latent_sync' | 'motion_brush' | 'cinemagraph' | 'tooncrafter' | 'liveportrait' | 'qwen_multiangle' | 'ltx_video' | 'qwen_image_edit' | 'flux_fill' | 'insert_anything' | 'ic_light_harmonize' | 'posed_ref_t2i' | 'controlnet_character_swap' | 'face_detailer_only' | 'flux_kontext' | 'instant_id' | 'z_image' | 'flux_dev' | 'ltx_2_3_dual'

/** Presets mappés sur les options EXACTES de WanCameraEmbedding (ComfyUI core).
 *  Liste officielle : Static, Pan Up/Down/Left/Right, Zoom In/Out,
 *  "Anti Clockwise (ACW)", "ClockWise (CW)". */
export const WAN_CAMERA_PRESETS: Record<string, string> = {
  static: 'Static',
  pan_left: 'Pan Left',
  pan_right: 'Pan Right',
  pan_up: 'Pan Up',
  pan_down: 'Pan Down',
  zoom_in: 'Zoom In',
  zoom_out: 'Zoom Out',
  // Mappings d'alias UI vers les presets natifs les plus proches
  orbit_left: 'Anti Clockwise (ACW)',
  orbit_right: 'ClockWise (CW)',
  dolly_in: 'Zoom In',
  dolly_out: 'Zoom Out',
  tilt_up: 'Pan Up',
  tilt_down: 'Pan Down',
}

export interface MaskPreset {
  type: 'left' | 'right' | 'left_third' | 'center_third' | 'right_third' | 'full' | 'custom'
  /** For custom masks: filename already uploaded to ComfyUI input folder */
  custom_filename?: string
}

export interface ComfyUIGenerateParams {
  workflow_type: WorkflowType
  prompt_positive: string
  prompt_negative?: string
  /** Background image filename (already uploaded to ComfyUI input folder) */
  background_image?: string
  /** Character references for IPAdapter FaceID, each with optional mask */
  characters?: Array<{
    /** Portrait filename (already uploaded to ComfyUI input folder) */
    portrait_filename: string
    mask: MaskPreset
    weight?: number // 0.7-0.85, default 0.8
  }>
  /** For transitions: source image filename (already uploaded to ComfyUI input folder) */
  source_image?: string
  /** For scene_composition variants : IPAdapter Plus style reference (full image, no mask).
   *  Filename déjà uploadé dans ComfyUI input. Transfère style/couleurs/lumière depuis cette image. */
  style_reference_image?: string
  /** Weight IPAdapter Plus pour style_reference_image (0-1). Défaut 0.6. */
  style_reference_weight?: number
  /** Generation parameters */
  steps?: number        // default 35
  cfg?: number          // default 7
  seed?: number         // -1 = random
  width?: number        // default 1360 (16:9)
  height?: number       // default 768
  denoise?: number      // default 1.0, lower for transitions (0.3-0.5)
  /** Style key from STYLE_SUFFIXES */
  style?: string
  /** Checkpoint override */
  checkpoint?: string
  /** Optional LoRA to apply (filename in models/loras/) */
  lora?: string
  /** LoRA strength (default 0.7) */
  lora_strength?: number
  /** For animate: number of frames (default 16) */
  frames?: number
  /** For animate: motion strength / fps (default 8) */
  motion_strength?: number
  /** For animate: frames per second for GIF (default 8) */
  fps?: number
  /** For wan_camera: motion preset key (e.g. 'pan_left', 'zoom_in', etc.) */
  camera_motion?: string
  /** For latent_sync: video file already uploaded to ComfyUI input folder */
  source_video?: string
  /** For latent_sync: audio file already uploaded to ComfyUI input folder */
  audio_filename?: string
  /** For latent_sync: lips expressivity (1.0-3.0, default 1.5) */
  lips_expression?: number
  /** For latent_sync: denoise steps (default 20) */
  inference_steps?: number
  /** For latent_sync: padding length mode ('normal' | 'pingpong' | 'loop_to_audio', default 'pingpong') */
  length_mode?: 'normal' | 'pingpong' | 'loop_to_audio'
  /** Mask image filename (PNG binaire noir/blanc) déjà uploadé à ComfyUI input.
   *  Usage selon workflow_type :
   *    - motion_brush : zone à animer (blanc = pixels animés)
   *    - qwen_image_edit : zone éditable (blanc = zone regénérée par inpaint
   *      via SetLatentNoiseMask, reste de l'image pixel-perfect)
   *  Le mask DOIT avoir les mêmes dimensions que source_image. */
  mask_image?: string
  /** For tooncrafter: end image filename (start = source_image) */
  end_image?: string
  /** For tooncrafter: cfg_scale (1-15, default 7.5) */
  cfg_scale?: number
  /** For tooncrafter: eta (0-15, default 1.0) */
  eta?: number
  /** For tooncrafter: vram opt (none | low) */
  vram_opt?: 'none' | 'low'
  /** For tooncrafter: frame_count (5-30, default 10) */
  frame_count?: number
  /** For qwen_image_edit: reference image filename (déjà uploadée à ComfyUI input).
   *  Optionnel — si fourni, ajouté comme image2 dans TextEncodeQwenImageEditPlus
   *  pour intégrer un objet/perso spécifique dans la scène. */
  reference_image?: string
  /** For qwen_image_edit: utiliser le Lightning 4-step LoRA pour ~6× plus rapide.
   *  Nécessite Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors dans loras/.
   *  Quand activé : steps=4, cfg=1.0 (cf doc Lightning). Default false. */
  use_lightning?: boolean
  /** For insert_anything: filename du PNG mask de la RÉFÉRENCE (silhouette du sujet
   *  à insérer). Typiquement = alpha du PNG transparent obtenu via rembg
   *  transparent. Indique au workflow où est le sujet dans l'image de référence. */
  reference_mask_image?: string
  /** For qwen_image_edit en mode mask : dilatation du mask en pixels avant inpaint.
   *  Default 48. À 0 = silhouette stricte du sujet détecté par Grounded-SAM.
   *  Critique car DINO retourne la silhouette pure (ex: "barrel" → contour du
   *  tonneau). Sans marge, pas de place pour le sujet inséré (chat sur dessus). */
  mask_grow?: number
  /** For qwen_image_edit en mode mask : adoucissement gaussien des bords du mask
   *  via MaskToImage → ImageBlur → ImageToMask. Default 8. À 0 = bords nets
   *  (transition visible). Recommandé pour scènes peintes (style painterly). */
  mask_blur?: number
  /** For controlnet_character_swap : weight IPAdapter (0-1, default 0.8).
   *  Plus haut = identité plus forte mais peut rigidifier la pose. */
  ipa_weight?: number
  /** For controlnet_character_swap : ControlNet OpenPose strength (0-1, default 1.0).
   *  Recommandé xinsir = 1.0. */
  controlnet_strength?: number
  /** For controlnet_character_swap : preset IPAdapterUnifiedLoader.
   *  - 'PLUS (high strength)' = universel (humain + non-humain) [default]
   *  - 'PLUS FACE (portraits)' = visages humains (identité visage + vêtements préservés mieux) */
  ipa_preset?: 'PLUS (high strength)' | 'PLUS FACE (portraits)' | 'STANDARD (medium strength)' | 'VIT-G (medium strength)'
  /** For controlnet_character_swap : weight_type IPAdapterAdvanced.
   *  - 'linear' = équilibré (default)
   *  - 'style transfer' = favorise transfert couleurs/vêtements
   *  - 'strong style transfer' = très strict sur le style
   *  - 'composition' = transfert de composition uniquement */
  ipa_weight_type?: 'linear' | 'style transfer' | 'strong style transfer' | 'composition' | 'strong middle' | 'ease in-out'

  /** For controlnet_character_swap : active FaceDetailer post-processing.
   *  Détecte le visage avec YOLO → crop 512×512 → régénère HD avec IPAdapter
   *  FaceID Plus v2 + même ref → blend back. Coût : +30-60s, +1-2 GB VRAM.
   *  Indispensable quand la face est petite dans la scène (40-60px). */
  enable_face_detailer?: boolean
  /** Poids IPAdapter FaceID dans le pass FaceDetailer. Default 1.0. */
  face_weight?: number
  /** Denoise du KSampler interne au FaceDetailer. Default 0.5.
   *  Plus haut (0.7-0.8) = visage plus régénéré, plus proche de la ref.
   *  Plus bas (0.3-0.4) = visage plus subtil, garde la structure de la 1ère passe. */
  face_denoise?: number

  /** For instant_id : poids InstantID model = force d'identité visage
   *  (0-1.5, default 0.8). Recommandation Cubiq : 0.7-0.8. */
  instantid_weight?: number
  /** For instant_id : poids ControlNet face landmarks = contrainte composition
   *  (0-1.5, default 0.8). Baisser à 0.2-0.3 pour FULLBODY (libère la position
   *  du visage, sinon il prend toute la largeur). Cubiq : "ControlNet
   *  influences composition about 75%, IP_weight only 25%". */
  instantid_cn_strength?: number
  /** For instant_id : start_at du KSampler (default 0 = applique InstantID
   *  dès le début). Augmenter pour donner plus de liberté à la composition. */
  instantid_start?: number
  /** For instant_id : end_at du KSampler (default 1 = applique InstantID
   *  jusqu'à la fin). 0.5 = identité injectée pendant 1ère moitié seulement. */
  instantid_end?: number
}

// ── SDXL Prompt rules ────────────────────────────────────────────────────────

export const STYLE_SUFFIXES: Record<string, string> = {
  realistic:    'cinematic lighting, rich colors, professional illustration',
  photo:        'cinematic photography, 35mm film, dramatic lighting, film grain',
  manga:        'manga art style, black and white screentones, expressive linework',
  bnw:          'black and white ink illustration, crosshatching, high contrast',
  watercolor:   'watercolor illustration, soft edges, transparent washes, painterly',
  comic:        'franco-belgian comic book style, clear line, bold colors, bande dessinée',
  dark_fantasy: 'dark fantasy art, dramatic shadows, gritty, oil painting style',
  pixel:        'pixel art, 16-bit retro game style, limited color palette, crisp pixels',
  sketch:       'pencil sketch, rough hand-drawn lines, graphite strokes, storyboard style',
}

export const DEFAULT_NEGATIVE_PROMPT = 'low quality, blurry, distorted, watermark, text, deformed hands'

// ── API helpers ──────────────────────────────────────────────────────────────

/**
 * Libère la VRAM de ComfyUI. Deux niveaux :
 *
 *  - `unload=false` (défaut) : juste `torch.cuda.empty_cache()` — libère les
 *    tensors intermédiaires (latents, activations) mais garde les checkpoints
 *    chargés. Rapide, bon pour les enchaînements d'un même workflow.
 *
 *  - `unload=true` : décharge AUSSI les modèles (SDXL, AnimateDiff, SAM…).
 *    VRAM 100% libre. Tradeoff : reload ~5-10s au prochain workflow.
 *    **Indispensable sur GPU ≤ 8 Go** quand on alterne entre workflows (SAM →
 *    motion_brush → inpaint → SAM auto…) car les modèles cumulent > 10 Go.
 *
 * Contrôlé via l'env var `COMFYUI_AGGRESSIVE_UNLOAD=true` (défaut) pour les
 * petites cartes. Mettre `false` sur cartes 24+ Go pour éviter les reloads.
 *
 * Fire-and-forget : les erreurs ne sont que loggées, jamais levées.
 */
export async function freeComfyVram(opts?: { unload?: boolean }): Promise<void> {
  const envAggressive = (process.env.COMFYUI_AGGRESSIVE_UNLOAD ?? 'true').toLowerCase() !== 'false'
  const unload = opts?.unload ?? envAggressive
  try {
    await fetch(`${COMFYUI_URL}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: unload, free_memory: true }),
    })
    if (unload) {
      console.log('[comfyui] VRAM libérée (modèles déchargés)')
    }
  } catch (err) {
    console.warn('[comfyui] /free a échoué (non-critique) :', err instanceof Error ? err.message : String(err))
  }
}

/** Queue a workflow on the ComfyUI server */
export async function queuePrompt(workflow: Record<string, unknown>): Promise<ComfyUIPromptResponse> {
  const res = await fetch(`${COMFYUI_URL}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ComfyUI queuePrompt failed (${res.status}): ${text}`)
  }
  return res.json()
}

/** Poll the history for a given prompt_id */
export async function getHistory(promptId: string): Promise<ComfyUIHistoryEntry | null> {
  const res = await fetch(`${COMFYUI_URL}/api/history/${promptId}`)
  if (!res.ok) return null
  const data = await res.json()
  return data[promptId] ?? null
}

/** Get the generated image as a Buffer */
export async function getImage(filename: string, subfolder: string, type: string): Promise<Buffer> {
  const params = new URLSearchParams({ filename, subfolder, type })
  const res = await fetch(`${COMFYUI_URL}/api/view?${params}`)
  if (!res.ok) throw new Error(`ComfyUI getImage failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/** Check if ComfyUI server is reachable */
export async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFYUI_URL}/api/system_stats`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Upload an image to ComfyUI's input folder.
 * Images must be uploaded before they can be used in LoadImage nodes.
 * Returns the filename that ComfyUI assigned to the uploaded image.
 */
export async function uploadImageToComfyUI(imageBuffer: Buffer, originalFilename: string): Promise<string> {
  const formData = new FormData()
  const blob = new Blob([imageBuffer], { type: 'image/png' })
  formData.append('image', blob, originalFilename)
  formData.append('overwrite', 'true')

  const res = await fetch(`${COMFYUI_URL}/api/upload/image`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ComfyUI uploadImage failed (${res.status}): ${text}`)
  }
  const data = await res.json() as { name: string; subfolder: string; type: string }
  return data.name
}

/**
 * Download an image from a URL and upload it to ComfyUI's input folder.
 * Returns the ComfyUI filename.
 */
export async function uploadUrlToComfyUI(imageUrl: string, nameHint: string): Promise<string> {
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`Failed to download image from ${imageUrl}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const ext = imageUrl.split('.').pop()?.split('?')[0] ?? 'png'
  return uploadImageToComfyUI(buffer, `${nameHint}.${ext}`)
}

/**
 * Generate a mask image as PNG buffer for ComfyUI.
 * White = IPAdapter applies, Black = IPAdapter does not apply.
 * Upload the result to ComfyUI input folder before using in workflow.
 */
export async function generateMaskPng(
  preset: MaskPreset['type'],
  width: number,
  height: number,
): Promise<Buffer> {
  // We generate a simple BMP-like raw image and convert to PNG via canvas-free approach
  // For simplicity, we create a raw RGBA buffer and encode as PNG manually
  // Using a minimal PNG encoder
  const pixels = new Uint8Array(width * height * 4)

  const regions: Record<string, { x1: number; x2: number }> = {
    full:          { x1: 0, x2: width },
    left:          { x1: 0, x2: Math.floor(width / 2) },
    right:         { x1: Math.floor(width / 2), x2: width },
    left_third:    { x1: 0, x2: Math.floor(width / 3) },
    center_third:  { x1: Math.floor(width / 3), x2: Math.floor(width * 2 / 3) },
    right_third:   { x1: Math.floor(width * 2 / 3), x2: width },
  }

  const region = regions[preset] ?? regions.full

  // Fill: black everywhere, white in the region
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const inRegion = x >= region.x1 && x < region.x2
      const val = inRegion ? 255 : 0
      pixels[idx] = val     // R
      pixels[idx + 1] = val // G
      pixels[idx + 2] = val // B
      pixels[idx + 3] = 255 // A
    }
  }

  return encodePng(pixels, width, height)
}

/** Minimal PNG encoder (no external deps) for mask generation */
function encodePng(pixels: Uint8Array, width: number, height: number): Buffer {
  // Build raw image data (filter byte + row pixels)
  const rowSize = width * 4
  const rawData = Buffer.alloc(height * (1 + rowSize))
  for (let y = 0; y < height; y++) {
    const offset = y * (1 + rowSize)
    rawData[offset] = 0 // No filter
    pixels.slice(y * rowSize, (y + 1) * rowSize).forEach((b, i) => {
      rawData[offset + 1 + i] = b
    })
  }

  const compressed = deflateSync(rawData)

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const ihdrChunk = buildPngChunk('IHDR', ihdr)
  const idatChunk = buildPngChunk('IDAT', compressed)
  const iendChunk = buildPngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk])
}

function buildPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeBuffer, data])
  const crc = crc32(crcData)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc, 0)
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ── Checkpoints SDXL disponibles ────────────────────────────────────────────
// Source unique consommée par toute la UI (page.tsx) ET les workflows ici.
// Pour ajouter un checkpoint : 1) télécharger dans ComfyUI/models/checkpoints/
//                              2) ajouter une entrée ci-dessous

export interface CheckpointDef {
  /** Clé interne (sauvegardée en DB sous cs.checkpoint) */
  key: string
  /** Label affiché dans le dropdown */
  label: string
  /** Nom du fichier .safetensors dans ComfyUI/models/checkpoints/ */
  filename: string
  /** Style (info pour l'utilisateur) */
  hint?: string
  /** LoRA optionnel à appliquer par-dessus (filename dans ComfyUI/models/loras/) */
  lora?: string
  /** Prompt prefix auto-injecté devant le prompt positif utilisateur (tags obligatoires du modèle) */
  promptPrefix?: string
  /** Prompt suffix auto-injecté après le prompt positif utilisateur (boost qualité) */
  promptSuffix?: string
  /** Negative prefix auto-injecté devant le prompt négatif utilisateur */
  negativePrefix?: string
}

export const CHECKPOINTS: CheckpointDef[] = [
  {
    key: 'juggernaut',
    label: 'Juggernaut XL v9',
    filename: 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors',
    hint: 'Réaliste — défaut',
  },
  {
    key: 'sdxl_base',
    label: 'SDXL Base',
    filename: 'sd_xl_base_1.0.safetensors',
    hint: 'Polyvalent neutre',
  },
  {
    key: 'animagine_xl_4',
    label: 'Animagine XL 4.0',
    filename: 'animagine-xl-4.0.safetensors',
    hint: 'Anime / manga coloré moderne',
    promptSuffix: 'masterpiece, best quality, very aesthetic, absurdres',
    negativePrefix: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
  },
  {
    key: 'pony_xl_v6',
    label: 'Pony Diffusion XL v6',
    filename: 'ponyDiffusionV6XL.safetensors',
    hint: 'Anime stylisé, écosystème LoRA énorme',
    promptPrefix: 'score_9, score_8_up, score_7_up, source_anime, rating_safe',
    negativePrefix: 'score_4, score_5, score_6, source_pony, source_furry, source_cartoon, worst quality, low quality, lowres, bad anatomy, bad hands, missing fingers, extra digits, blurry, signature, watermark',
  },
  {
    key: 'juggernaut+anime',
    label: 'Juggernaut + Anime LoRA',
    filename: 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors',
    lora: 'anime_sdxl.safetensors',
    hint: 'Réaliste teinté anime',
  },
  {
    key: 'juggernaut+concept',
    label: 'Juggernaut + Concept LoRA',
    filename: 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors',
    lora: 'concept_art_sdxl.safetensors',
    hint: 'Concept art / illustration',
  },
]

/** Récupère la def d'un checkpoint depuis sa clé OU son filename (pour retro-map via API route). */
export function findCheckpointDef(keyOrFilename: string | undefined): CheckpointDef | undefined {
  if (!keyOrFilename) return undefined
  return CHECKPOINTS.find(c => c.key === keyOrFilename || c.filename === keyOrFilename)
}

/** Applique les préfixes/suffixes du checkpoint sur les prompts. */
export function applyCheckpointPromptTemplate(
  checkpointKeyOrFilename: string | undefined,
  positive: string,
  negative: string | undefined,
): { positive: string; negative: string } {
  const def = findCheckpointDef(checkpointKeyOrFilename)
  if (!def) return { positive, negative: negative ?? '' }
  const parts: string[] = []
  if (def.promptPrefix) parts.push(def.promptPrefix)
  if (positive?.trim()) parts.push(positive.trim())
  if (def.promptSuffix) parts.push(def.promptSuffix)
  const combinedPositive = parts.join(', ')
  const combinedNegative = [def.negativePrefix, negative].filter(Boolean).join(', ')
  return { positive: combinedPositive, negative: combinedNegative }
}

/** Résout la clé UI → LoRA optionnel. */
export function resolveCheckpointLora(key: string | undefined): string | undefined {
  if (!key) return undefined
  return CHECKPOINTS.find(c => c.key === key)?.lora
}

/** Résout la clé UI → nom de fichier ComfyUI. Retourne undefined si clé inconnue. */
export function resolveCheckpointFilename(key: string | undefined): string | undefined {
  if (!key) return undefined
  return CHECKPOINTS.find(c => c.key === key)?.filename
}

// ── Workflow builders ────────────────────────────────────────────────────────

function buildCheckpointNode(checkpoint?: string) {
  return {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: checkpoint ?? 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors',
    },
  }
}

function buildClipTextEncode(text: string, clipRef: [string, number]) {
  return {
    class_type: 'CLIPTextEncode',
    inputs: { text, clip: clipRef },
  }
}

function buildKSampler(
  modelRef: [string, number],
  positiveRef: [string, number],
  negativeRef: [string, number],
  latentRef: [string, number],
  params: { steps: number; cfg: number; seed: number; denoise: number }
) {
  return {
    class_type: 'KSampler',
    inputs: {
      model: modelRef,
      positive: positiveRef,
      negative: negativeRef,
      latent_image: latentRef,
      seed: params.seed === -1 ? Math.floor(Math.random() * 2 ** 32) : params.seed,
      steps: params.steps,
      cfg: params.cfg,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: params.denoise,
    },
  }
}

function buildEmptyLatent(width: number, height: number) {
  return {
    class_type: 'EmptyLatentImage',
    inputs: { width, height, batch_size: 1 },
  }
}

function buildVAEDecode(samplesRef: [string, number], vaeRef: [string, number]) {
  return {
    class_type: 'VAEDecode',
    inputs: { samples: samplesRef, vae: vaeRef },
  }
}

function buildSaveImage(imagesRef: [string, number], prefix: string) {
  return {
    class_type: 'SaveImage',
    inputs: { images: imagesRef, filename_prefix: prefix },
  }
}

// ── Portrait workflow (text-to-image, no IPAdapter) ─────────────────────────

export function buildPortraitWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  const styleSuffix = STYLE_SUFFIXES[params.style ?? 'realistic'] ?? STYLE_SUFFIXES.realistic
  const positivePrompt = `${params.prompt_positive} BREAK ${styleSuffix}`
  const negativePrompt = params.prompt_negative ?? DEFAULT_NEGATIVE_PROMPT

  const workflow: Record<string, unknown> = {}

  // Checkpoint
  workflow['1'] = buildCheckpointNode(params.checkpoint)

  // Track model ref — changes if LoRA is applied
  let modelRef: [string, number] = ['1', 0]
  let clipRef: [string, number] = ['1', 1]

  // Optional LoRA
  if (params.lora) {
    workflow['8'] = {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip: ['1', 1],
        lora_name: params.lora,
        strength_model: params.lora_strength ?? 0.7,
        strength_clip: params.lora_strength ?? 0.7,
      },
    }
    modelRef = ['8', 0]
    clipRef = ['8', 1]
  }

  // CLIP encode (use clip from LoRA if loaded)
  workflow['2'] = buildClipTextEncode(positivePrompt, clipRef)
  workflow['3'] = buildClipTextEncode(negativePrompt, clipRef)

  workflow['4'] = buildEmptyLatent(params.width ?? 1024, params.height ?? 1024)
  workflow['5'] = buildKSampler(modelRef, ['2', 0], ['3', 0], ['4', 0], {
    steps: params.steps ?? 35,
    cfg: params.cfg ?? 7,
    seed: params.seed ?? -1,
    denoise: params.denoise ?? 1.0,
  })
  workflow['6'] = buildVAEDecode(['5', 0], ['1', 2])
  workflow['7'] = buildSaveImage(['6', 0], 'hero_portrait')

  return workflow
}

// ── Background workflow (text-to-image, no characters) ──────────────────────

export function buildBackgroundWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  const styleSuffix = STYLE_SUFFIXES[params.style ?? 'realistic'] ?? STYLE_SUFFIXES.realistic
  const positivePrompt = `${params.prompt_positive}, no people, no characters, empty scene BREAK ${styleSuffix}`
  const negativePrompt = params.prompt_negative ?? `${DEFAULT_NEGATIVE_PROMPT}, people, person, character, figure`

  return {
    '1': buildCheckpointNode(params.checkpoint),
    '2': buildClipTextEncode(positivePrompt, ['1', 1]),
    '3': buildClipTextEncode(negativePrompt, ['1', 1]),
    '4': buildEmptyLatent(params.width ?? 1360, params.height ?? 768),
    '5': buildKSampler(['1', 0], ['2', 0], ['3', 0], ['4', 0], {
      steps: params.steps ?? 35,
      cfg: params.cfg ?? 7,
      seed: params.seed ?? -1,
      denoise: 1.0,
    }),
    '6': buildVAEDecode(['5', 0], ['1', 2]),
    '7': buildSaveImage(['6', 0], 'hero_background'),
  }
}

// ── Scene composition workflow ──────────────────────────────────────────────
//
// ControlNet Depth (background) + IPAdapter FaceID × N (characters with masks)
//
// Node IDs:
//   1: CheckpointLoader
//   2: CLIPTextEncode (positive)
//   3: CLIPTextEncode (negative)
//   4: LoadImage (background)
//   5: DepthAnythingV2Preprocessor
//   6: ControlNetLoader
//   7: ControlNetApplyAdvanced → outputs (positive, negative)
//   8: IPAdapterUnifiedLoaderFaceID
//   10+: For each character: LoadImage portrait, LoadImage mask, IPAdapterAdvanced
//   90: EmptyLatent
//   95: KSampler
//   96: VAEDecode
//   97: SaveImage

export function buildSceneCompositionWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  const styleSuffix = STYLE_SUFFIXES[params.style ?? 'realistic'] ?? STYLE_SUFFIXES.realistic
  const positivePrompt = `${params.prompt_positive} BREAK ${styleSuffix}`
  const negativePrompt = params.prompt_negative ?? DEFAULT_NEGATIVE_PROMPT

  const workflow: Record<string, unknown> = {}

  // Checkpoint
  workflow['1'] = buildCheckpointNode(params.checkpoint)

  // CLIP encode
  workflow['2'] = buildClipTextEncode(positivePrompt, ['1', 1])
  workflow['3'] = buildClipTextEncode(negativePrompt, ['1', 1])

  // Track refs that change as we chain nodes
  let currentModelRef: [string, number] = ['1', 0]
  let currentPositiveRef: [string, number] = ['2', 0]
  let currentNegativeRef: [string, number] = ['3', 0]

  // ── ControlNet Depth (if background provided) ──
  if (params.background_image) {
    // LoadImage expects a filename in ComfyUI's input folder
    workflow['4'] = {
      class_type: 'LoadImage',
      inputs: { image: params.background_image },
    }
    // DepthAnything V2 preprocessor (model auto-downloads on first use)
    // NB : le node attend des .pth, pas .safetensors (les 4 variantes vitg/vitl/vitb/vits)
    workflow['5'] = {
      class_type: 'DepthAnythingV2Preprocessor',
      inputs: {
        image: ['4', 0],
        ckpt_name: 'depth_anything_v2_vitl.pth',
        resolution: 1024,
      },
    }
    workflow['6'] = {
      class_type: 'ControlNetLoader',
      inputs: {
        control_net_name: 'diffusion_pytorch_model.fp16.safetensors',
      },
    }
    // ControlNetApplyAdvanced returns (positive, negative) — NOT model
    workflow['7'] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: currentPositiveRef,
        negative: currentNegativeRef,
        control_net: ['6', 0],
        image: ['5', 0],
        strength: 0.7,
        start_percent: 0.0,
        end_percent: 0.8,
      },
    }
    currentPositiveRef = ['7', 0] // modified positive conditioning
    currentNegativeRef = ['7', 1] // modified negative conditioning
  }

  // ── IPAdapter FaceID chain (if characters provided) ──
  if (params.characters && params.characters.length > 0) {
    // Use IPAdapter Plus Face — works without InsightFace
    workflow['8'] = {
      class_type: 'IPAdapterUnifiedLoader',
      inputs: {
        model: currentModelRef,
        preset: 'PLUS FACE (portraits)',
      },
    }
    currentModelRef = ['8', 0]

    // Chain IPAdapter for each character
    params.characters.forEach((char, i) => {
      const baseId = 10 + i * 3 // 10,13,16,...
      const loadImgId = String(baseId)
      const maskImgId = String(baseId + 1)
      const ipaId = String(baseId + 2)

      // Load character portrait (filename in ComfyUI input folder)
      workflow[loadImgId] = {
        class_type: 'LoadImage',
        inputs: { image: char.portrait_filename },
      }

      // Load mask image (filename in ComfyUI input folder)
      // Masks are pre-generated PNGs uploaded before workflow execution
      workflow[maskImgId] = {
        class_type: 'LoadImage',
        inputs: {
          image: char.mask.type === 'custom'
            ? char.mask.custom_filename!
            : `mask_${char.mask.type}_${params.width ?? 1360}x${params.height ?? 768}.png`,
        },
      }

      // IPAdapter Advanced — chains model through
      workflow[ipaId] = {
        class_type: 'IPAdapterAdvanced',
        inputs: {
          model: currentModelRef,
          ipadapter: ['8', 1],
          image: [loadImgId, 0],
          weight: char.weight ?? 0.8,
          weight_type: 'linear',
          combine_embeds: 'average',
          embeds_scaling: 'V only',
          start_at: 0.0,
          end_at: 0.8,
          attn_mask: [maskImgId, 1], // LoadImage output 1 = MASK (not 0 = IMAGE)
        },
      }
      currentModelRef = [ipaId, 0]
    })
  }

  // ── IPAdapter Plus pour style reference (full image, no mask) ──
  // Utilisé pour "Image variante" : transfère style/couleurs/lumière depuis l'image principale
  // tout en gardant la structure (ControlNet Depth) + visages (FaceID).
  if (params.style_reference_image) {
    workflow['80'] = {
      class_type: 'IPAdapterUnifiedLoader',
      inputs: {
        model: currentModelRef,
        preset: 'PLUS (high strength)',
      },
    }
    currentModelRef = ['80', 0]
    workflow['81'] = {
      class_type: 'LoadImage',
      inputs: { image: params.style_reference_image },
    }
    workflow['82'] = {
      class_type: 'IPAdapterAdvanced',
      inputs: {
        model: currentModelRef,
        ipadapter: ['80', 1],
        image: ['81', 0],
        weight: params.style_reference_weight ?? 0.6,
        weight_type: 'linear',
        combine_embeds: 'average',
        embeds_scaling: 'V only',
        start_at: 0.0,
        end_at: 0.9,
        // pas d'attn_mask → applique sur TOUT le frame (style global)
      },
    }
    currentModelRef = ['82', 0]
  }

  // EmptyLatent
  workflow['90'] = buildEmptyLatent(params.width ?? 1360, params.height ?? 768)

  // KSampler — uses the chained model + conditioned positive/negative
  workflow['95'] = buildKSampler(currentModelRef, currentPositiveRef, currentNegativeRef, ['90', 0], {
    steps: params.steps ?? 35,
    cfg: params.cfg ?? 7,
    seed: params.seed ?? -1,
    denoise: params.denoise ?? 1.0,
  })

  // VAE Decode + Save
  workflow['96'] = buildVAEDecode(['95', 0], ['1', 2])
  workflow['97'] = buildSaveImage(['96', 0], 'hero_scene')

  return workflow
}

// ── Transition workflow (img2img with low denoise) ──────────────────────────

export function buildTransitionWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('transition workflow requires source_image')

  const styleSuffix = STYLE_SUFFIXES[params.style ?? 'realistic'] ?? STYLE_SUFFIXES.realistic
  const positivePrompt = `${params.prompt_positive} BREAK ${styleSuffix}`
  const negativePrompt = params.prompt_negative ?? DEFAULT_NEGATIVE_PROMPT

  return {
    '1': buildCheckpointNode(params.checkpoint),
    '2': buildClipTextEncode(positivePrompt, ['1', 1]),
    '3': buildClipTextEncode(negativePrompt, ['1', 1]),
    '4': {
      class_type: 'LoadImage',
      inputs: { image: params.source_image },
    },
    '5': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['4', 0], vae: ['1', 2] },
    },
    '6': buildKSampler(['1', 0], ['2', 0], ['3', 0], ['5', 0], {
      steps: params.steps ?? 25,
      cfg: params.cfg ?? 7,
      seed: params.seed ?? -1,
      denoise: params.denoise ?? 0.35,
    }),
    '7': buildVAEDecode(['6', 0], ['1', 2]),
    '8': buildSaveImage(['7', 0], 'hero_transition'),
  }
}

// ── Workflow dispatcher ─────────────────────────────────────────────────────

// ── Animate workflow (img2vid via AnimateDiff) ──────────────────────────────
//
// Takes a source image and animates it with subtle motion.
// Uses AnimateDiff Evolved + SDXL checkpoint.
//
// Node IDs:
//   1: CheckpointLoader
//   2: CLIPTextEncode (positive — motion description)
//   3: CLIPTextEncode (negative)
//   4: LoadImage (source image to animate)
//   5: VAEEncode (encode source image to latent)
//   6: ADE_AnimateDiffLoaderGen1 (load AnimateDiff motion model)
//   7: ADE_UseEvolvedSampling (apply AnimateDiff to model)
//   8: KSampler (generate animated latents)
//   9: VAEDecode (decode to images)
//  10: VHS_VideoCombine (combine to GIF/video)

export function buildAnimateWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('animate workflow requires source_image')

  const positivePrompt = params.prompt_positive || 'subtle motion, gentle wind, ambient movement'
  const negativePrompt = params.prompt_negative ?? 'static, still, frozen, blurry, morphing, distorted'
  const frames = params.frames ?? 16
  const denoise = params.denoise ?? 0.45

  return {
    '1': buildCheckpointNode(params.checkpoint),
    '2': buildClipTextEncode(positivePrompt, ['1', 1]),
    '3': buildClipTextEncode(negativePrompt, ['1', 1]),
    '4': {
      class_type: 'LoadImage',
      inputs: { image: params.source_image },
    },
    '5': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['4', 0], vae: ['1', 2] },
    },
    '11': {
      class_type: 'RepeatLatentBatch',
      inputs: { samples: ['5', 0], amount: frames },
    },
    '6': {
      class_type: 'ADE_AnimateDiffLoaderGen1',
      inputs: {
        model: ['1', 0],
        model_name: 'mm_sdxl_v10_beta.ckpt',
        beta_schedule: 'autoselect',
      },
    },
    '8': buildKSampler(['6', 0], ['2', 0], ['3', 0], ['11', 0], {
      steps: params.steps ?? 20,
      cfg: params.cfg ?? 6,
      seed: params.seed ?? -1,
      denoise,
    }),
    '9': buildVAEDecode(['8', 0], ['1', 2]),
    '10': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['9', 0],
        frame_rate: params.fps ?? 8,
        loop_count: 0,
        filename_prefix: 'hero_animate',
        format: 'image/gif',
        pingpong: false,
        save_output: true,
      },
    },
  }
}

// ── Wan 2.2 TI2V-5B animate workflow (image → video) ────────────────────────

// ── Wan 2.2 TI2V-5B animate workflow using NATIVE ComfyUI nodes ─────────────
//
// Based on official ComfyUI example: comfyanonymous.github.io/ComfyUI_examples/wan22/
// Uses standard nodes: UNETLoader, CLIPLoader, VAELoader, Wan22ImageToVideoLatent, KSampler
//
// Node IDs:
//   37: UNETLoader (diffusion model)
//   38: CLIPLoader (text encoder, type=wan)
//   39: VAELoader (wan2.2 vae)
//   48: ModelSamplingSD3 (shift parameter)
//   6:  CLIPTextEncode (positive)
//   7:  CLIPTextEncode (negative)
//   57: LoadImage (source image)
//   55: Wan22ImageToVideoLatent (image + vae → latent)
//   3:  KSampler
//   8:  VAEDecode
//   92: VHS_VideoCombine (export)

export function buildWanAnimateWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('wan_animate requires source_image')

  const positivePrompt = params.prompt_positive || 'gentle ambient motion, subtle wind, flickering light'
  const negativePrompt = params.prompt_negative ?? 'static, blurred, worst quality, low quality'
  const rawFrames = params.frames ?? 17
  // Wan frame count should be valid for the model
  const frames = Math.max(5, Math.round((rawFrames - 1) / 4) * 4 + 1)
  const steps = params.steps ?? 30
  const cfg = params.cfg ?? 5
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed

  return {
    // Load diffusion model
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: 'Wan2_2-TI2V-5B_fp8_e4m3fn_scaled_KJ.safetensors',
        weight_dtype: 'default',
      },
    },
    // Load CLIP (text encoder) — type=wan loads T5 for Wan
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
        type: 'wan',
      },
    },
    // Load VAE
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: 'wan2.2_vae.safetensors',
      },
    },
    // ModelSamplingSD3 — sets the shift parameter
    '48': {
      class_type: 'ModelSamplingSD3',
      inputs: {
        model: ['37', 0],
        shift: 8.0,
      },
    },
    // Positive prompt
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: positivePrompt,
        clip: ['38', 0],
      },
    },
    // Negative prompt
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: negativePrompt,
        clip: ['38', 0],
      },
    },
    // Load source image
    '57': {
      class_type: 'LoadImage',
      inputs: { image: params.source_image },
    },
    // Wan 2.2 Image to Video Latent — adapt resolution to source image aspect ratio
    '55': {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: {
        vae: ['39', 0],
        start_image: ['57', 0],
        // Width/height must be multiples of 32 and match source aspect ratio
        width: params.width ?? 640,
        height: params.height ?? 640,
        length: frames,
        batch_size: 1,
      },
    },
    // KSampler — uni_pc + simple scheduler for Wan 2.2
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['48', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['55', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'uni_pc',
        scheduler: 'simple',
        denoise: params.denoise ?? 1.0,
      },
    },
    // VAE Decode
    '8': buildVAEDecode(['3', 0], ['39', 0]),
    // Export video
    '92': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['8', 0],
        frame_rate: params.fps ?? 12,
        loop_count: 0,
        filename_prefix: 'hero_wan_animate',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
        pix_fmt: 'yuv420p',
        crf: 19,
        save_metadata: true,
        trim_to_audio: false,
      },
    },
  }
}

// ── Wan 2.2 Fun Camera Control (vrai travelling caméra prompted) ────────────
//
// Modèles requis (FP8 ~15 Go × 2) :
//   - wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors
//   - wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors
// Dépendances déjà présentes : umt5_xxl_fp8_e4m3fn_scaled.safetensors, wan2.2_vae.safetensors
// Nodes natifs ComfyUI core : WanCameraEmbedding + WanCameraImageToVideo
//   (nécessite ComfyUI à jour — `git pull` dans le dossier ComfyUI)

export function buildWanCameraWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('wan_camera requires source_image')

  // Le client passe le motion preset via params.style (réutilise le champ — pas idéal mais évite d'enrichir l'interface)
  // OU via params.cameraMotion (champ étendu)
  const motionKey = ((params as ComfyUIGenerateParams & { camera_motion?: string }).camera_motion ?? 'pan_left').toLowerCase()
  const motionPreset = WAN_CAMERA_PRESETS[motionKey] ?? 'Pan Left'

  const positivePrompt = params.prompt_positive || 'cinematic camera movement, characters static'
  const negativePrompt = params.prompt_negative ?? 'static, blurred, character moving'
  const rawFrames = params.frames ?? 25
  const frames = Math.max(9, Math.round((rawFrames - 1) / 4) * 4 + 1) // multiple de 4 + 1
  const steps = params.steps ?? 20
  const cfg = params.cfg ?? 3.5
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const stepSplit = Math.floor(steps / 2)

  // Résolution multiple de 32, calé sur l'aspect ratio du plan (idem Wan animate)
  const ar = params.width && params.height ? `${params.width}x${params.height}` : '16:9'
  const dimsByAr: Record<string, [number, number]> = {
    '16:9': [832, 480],
    '9:16': [480, 832],
    '1:1': [640, 640],
    '4:3': [704, 528],
    '3:4': [528, 704],
  }
  const [width, height] = dimsByAr[ar] ?? [params.width ?? 832, params.height ?? 480]

  return {
    // Modèles diffusion (high noise + low noise — passe en 2 phases du KSampler)
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors', weight_dtype: 'default' } },
    '3': { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8.0 } },
    '4': { class_type: 'ModelSamplingSD3', inputs: { model: ['2', 0], shift: 8.0 } },
    // Text encoder + VAE (Wan 2.1 VAE = 16 channels, requis par Fun Camera Control)
    '5': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan' } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
    // Conditioning
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['5', 0], text: positivePrompt } },
    '8': { class_type: 'CLIPTextEncode', inputs: { clip: ['5', 0], text: negativePrompt } },
    // Source image
    '9': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    // Camera embedding — preset + dimensions + length + speed (cx/cy/fx/fy laissés défaut 0.5)
    '10': {
      class_type: 'WanCameraEmbedding',
      inputs: {
        camera_pose: motionPreset,
        width,
        height,
        length: frames,
        speed: 1.0,
      },
    },
    // I2V avec embedding caméra
    '11': {
      class_type: 'WanCameraImageToVideo',
      inputs: {
        positive: ['7', 0],
        negative: ['8', 0],
        vae: ['6', 0],
        start_image: ['9', 0],
        camera_conditions: ['10', 0],
        width,
        height,
        length: frames,
        batch_size: 1,
      },
    },
    // KSampler pass 1 — high noise model, première moitié des steps
    '12': {
      class_type: 'KSamplerAdvanced',
      inputs: {
        model: ['3', 0],
        positive: ['11', 0],
        negative: ['11', 1],
        latent_image: ['11', 2],
        add_noise: 'enable',
        noise_seed: seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        start_at_step: 0,
        end_at_step: stepSplit,
        return_with_leftover_noise: 'enable',
      },
    },
    // KSampler pass 2 — low noise model, deuxième moitié
    '13': {
      class_type: 'KSamplerAdvanced',
      inputs: {
        model: ['4', 0],
        positive: ['11', 0],
        negative: ['11', 1],
        latent_image: ['12', 0],
        add_noise: 'disable',
        noise_seed: 0,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        start_at_step: stepSplit,
        end_at_step: 10000,
        return_with_leftover_noise: 'disable',
      },
    },
    // Decode + export MP4 via VHS_VideoCombine
    '14': buildVAEDecode(['13', 0], ['6', 0]),
    '92': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['14', 0],
        frame_rate: params.fps ?? 12,
        loop_count: 0,
        filename_prefix: 'hero_wan_camera',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
        pix_fmt: 'yuv420p',
        crf: 19,
        save_metadata: true,
        trim_to_audio: false,
      },
    },
  }
}

// ── ToonCrafter (interpolation cartoon entre 2 keyframes) ──────────────────
// Custom node : ComfyUI-ToonCrafter
// Modèle dans : custom_nodes/ComfyUI-ToonCrafter/ToonCrafter/checkpoints/tooncrafter_512_interp_v1/
// Optimisé 8 Go VRAM via vram_opt_strategy: 'low'

export function buildToonCrafterWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('tooncrafter requires source_image (start frame)')
  if (!params.end_image) throw new Error('tooncrafter requires end_image (end frame)')

  const prompt = params.prompt_positive || 'smooth animation, anime style, fluid motion'
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const steps = Math.max(1, Math.min(60, params.steps ?? 30))
  const cfg = Math.max(1, Math.min(15, params.cfg_scale ?? 7.5))
  const eta = Math.max(0, Math.min(15, params.eta ?? 1.0))
  const frameCount = Math.max(5, Math.min(30, params.frame_count ?? 10))
  const fps = Math.max(1, Math.min(60, params.fps ?? 8))
  const vramOpt = params.vram_opt ?? 'low'

  return {
    '1': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    '2': { class_type: 'LoadImage', inputs: { image: params.end_image } },
    '3': {
      class_type: 'ToonCrafterNode',
      inputs: {
        image: ['1', 0],
        image2: ['2', 0],
        // Checkpoint COMPLET requis (10 GB) — la version pruned-fp16 (~2.5 GB) n'a pas les
        // poids cond_stage_model + embedder et le custom node charge avec strict=True → erreur.
        ckpt_name: 'tooncrafter_512_interp_v1/tooncrafter_512_interp.ckpt',
        vram_opt_strategy: vramOpt,
        prompt,
        seed,
        eta,
        cfg_scale: cfg,
        steps,
        frame_count: frameCount,
        fps,
      },
    },
    '4': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['3', 0],
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: 'hero_tooncrafter',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
        pix_fmt: 'yuv420p',
        crf: 19,
      },
    },
  }
}

// ── Motion Brush (AnimateDiff + mask blend sur région spécifique) ──────────
//
// Utilise le workflow AnimateDiff existant (animate) pour générer des frames
// d'animation, puis compose chaque frame avec l'image source en utilisant un
// masque PNG (blanc = animé, noir = statique).
//
// Dépendances : AnimateDiff Evolved (déjà installé), motion module SDXL
// (mm_sdxl_v10_beta.ckpt), modèle SDXL de base (Juggernaut ou SDXL base).

export function buildMotionBrushWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('motion_brush requires source_image')
  if (!params.mask_image) throw new Error('motion_brush requires mask_image (PNG noir/blanc déjà uploadé)')

  const positivePrompt = params.prompt_positive || 'gentle motion in the marked area'
  const negativePrompt = params.prompt_negative ?? 'static, frozen, blurry, morphing, distorted'
  const frames = params.frames ?? 16
  const denoise = params.denoise ?? 0.5

  return {
    '1': buildCheckpointNode(params.checkpoint),
    '2': buildClipTextEncode(positivePrompt, ['1', 1]),
    '3': buildClipTextEncode(negativePrompt, ['1', 1]),
    // Source image
    '4': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    // Mask image (chargé comme image → extraction du canal alpha/luminance comme mask)
    '5': { class_type: 'LoadImage', inputs: { image: params.mask_image } },
    '6': { class_type: 'ImageToMask', inputs: { image: ['5', 0], channel: 'red' } },
    // VAE encode source
    '7': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } },
    // Répète le latent N fois pour avoir N frames
    '8': { class_type: 'RepeatLatentBatch', inputs: { samples: ['7', 0], amount: frames } },
    // AnimateDiff motion module
    '9': {
      class_type: 'ADE_AnimateDiffLoaderGen1',
      inputs: {
        model: ['1', 0],
        model_name: 'mm_sdxl_v10_beta.ckpt',
        beta_schedule: 'autoselect',
      },
    },
    // Sampler — override sampler_name/scheduler au lieu d'utiliser buildKSampler
    // (qui hardcode euler/normal, suboptimal pour AnimateDiff). La combinaison
    // `dpmpp_2m_sde_gpu` + `karras` donne la meilleure cohérence temporelle
    // sur mm_sdxl_v10_beta et réduit le color shift frame-à-frame.
    '10': {
      class_type: 'KSampler',
      inputs: {
        model: ['9', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['8', 0],
        seed: params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed,
        steps: params.steps ?? 25,
        cfg: params.cfg ?? 7,
        sampler_name: 'dpmpp_2m_sde_gpu',
        scheduler: 'karras',
        denoise,
      },
    },
    // VAEDecodeTiled au lieu de VAEDecode : décompose le batch en tuiles pour
    // éviter l'OOM sur GPU 8 Go avec 16 frames SDXL (~6 Go de tensors sinon).
    '11': {
      class_type: 'VAEDecodeTiled',
      inputs: {
        samples: ['10', 0],
        vae: ['1', 2],
        tile_size: 512,
        overlap: 64,
        temporal_size: 64,
        temporal_overlap: 8,
      },
    },
    // Répète l'image source N fois pour le blending
    '12': { class_type: 'RepeatImageBatch', inputs: { image: ['4', 0], amount: frames } },
    // Compose : dest = source statique ; src = frames animées ; mask applique l'animation seulement où mask=blanc
    '13': {
      class_type: 'ImageCompositeMasked',
      inputs: {
        destination: ['12', 0],
        source: ['11', 0],
        mask: ['6', 0],
        x: 0,
        y: 0,
        resize_source: false,
      },
    },
    // Export MP4
    '14': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['13', 0],
        frame_rate: params.fps ?? 8,
        loop_count: 0,
        filename_prefix: 'hero_motion_brush',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
        pix_fmt: 'yuv420p',
        crf: 19,
      },
    },
  }
}

// ── LatentSync (lip sync sur vidéo existante + audio) ──────────────────────
// Custom node : ComfyUI-LatentSyncWrapper
// Modèles dans : custom_nodes/ComfyUI-LatentSyncWrapper/checkpoints/
//   - latentsync_unet.pt (~5 Go)
//   - stable_syncnet.pt (~1.6 Go)
//   - whisper/tiny.pt
//   - vae/diffusion_pytorch_model.safetensors

export function buildLatentSyncWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_video) throw new Error('latent_sync requires source_video (filename déjà uploadé)')
  if (!params.audio_filename) throw new Error('latent_sync requires audio_filename (déjà uploadé)')

  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const lipsExpression = params.lips_expression ?? 1.5
  const inferenceSteps = params.inference_steps ?? 20
  const lengthMode = params.length_mode ?? 'pingpong'
  const fps = params.fps ?? 25

  return {
    // Charge la vidéo source (force 25 fps comme recommandé)
    '1': {
      class_type: 'VHS_LoadVideo',
      inputs: {
        video: params.source_video,
        force_rate: 25,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
        format: 'AnimateDiff',
      },
    },
    // Charge l'audio
    '2': {
      class_type: 'LoadAudio',
      inputs: { audio: params.audio_filename },
    },
    // Ajuste la longueur vidéo sur la durée de l'audio (mode pingpong = boucle A-B-A)
    '3': {
      class_type: 'VideoLengthAdjuster',
      inputs: {
        images: ['1', 0],
        audio: ['2', 0],
        mode: lengthMode,
        fps,
        silent_padding_sec: 0.5,
      },
    },
    // Lip sync
    '4': {
      class_type: 'LatentSyncNode',
      inputs: {
        images: ['3', 0],
        audio: ['3', 1],
        seed,
        lips_expression: lipsExpression,
        inference_steps: inferenceSteps,
      },
    },
    // Export MP4 avec audio
    '5': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['4', 0],
        audio: ['4', 1],
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: 'hero_latent_sync',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
        pix_fmt: 'yuv420p',
        crf: 19,
        save_metadata: true,
        trim_to_audio: false,
      },
    },
  }
}

// ── LivePortrait animate workflow (portrait face animation) ──────────────────

export function buildLivePortraitWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('liveportrait requires source_image')

  return {
    // Load source portrait
    '1': {
      class_type: 'LoadImage',
      inputs: { image: params.source_image },
    },
    // LivePortrait
    '2': {
      class_type: 'LivePortraitProcess',
      inputs: {
        source_image: ['1', 0],
        driving_video: null, // auto-animate mode
        dsize: 512,
        scale: 2.3,
        vx_ratio: 0,
        vy_ratio: -0.125,
        lip_zero: true,
        eye_retargeting: false,
        eyes_retargeting_multiplier: 1.0,
        lip_retargeting: false,
        lip_retargeting_multiplier: 1.0,
        stitching: true,
        relative: true,
        rotate_pitch: ['3', 0],
        rotate_yaw: ['4', 0],
        rotate_roll: ['5', 0],
      },
    },
    // Subtle head motion keyframes
    '3': {
      class_type: 'LivePortraitLoadExpCSV',
      inputs: {
        csv_text: '0,0\n8,-3\n16,2\n24,-1\n32,0',
        column: 'pitch',
        smoothing_factor: 0.8,
      },
    },
    '4': {
      class_type: 'LivePortraitLoadExpCSV',
      inputs: {
        csv_text: '0,0\n8,4\n16,-2\n24,3\n32,0',
        column: 'yaw',
        smoothing_factor: 0.8,
      },
    },
    '5': {
      class_type: 'LivePortraitLoadExpCSV',
      inputs: {
        csv_text: '0,0\n16,1\n32,0',
        column: 'roll',
        smoothing_factor: 0.9,
      },
    },
    // Export
    '6': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['2', 0],
        frame_rate: params.fps ?? 12,
        loop_count: 0,
        filename_prefix: 'hero_liveportrait',
        format: 'video/h264-mp4',
        pingpong: true,
        save_output: true,
      },
    },
  }
}

// ── Qwen Multiangle (camera angle control on a single image) ─────────────────
//
// Mirrors the prompt-formatting logic from ComfyUI-qwenmultiangle/nodes.py
// so we can drive the LoRA programmatically (loop 30 angles for a "travelling").
export function buildAnglePrompt(
  horizontal_angle: number,
  vertical_angle = 0,
  zoom = 5,
): string {
  const h = ((Math.round(horizontal_angle) % 360) + 360) % 360

  let h_dir: string
  if (h < 22.5 || h >= 337.5) h_dir = 'front view'
  else if (h < 67.5) h_dir = 'front-right quarter view'
  else if (h < 112.5) h_dir = 'right side view'
  else if (h < 157.5) h_dir = 'back-right quarter view'
  else if (h < 202.5) h_dir = 'back view'
  else if (h < 247.5) h_dir = 'back-left quarter view'
  else if (h < 292.5) h_dir = 'left side view'
  else h_dir = 'front-left quarter view'

  let v_dir: string
  if (vertical_angle < -15) v_dir = 'low-angle shot'
  else if (vertical_angle < 15) v_dir = 'eye-level shot'
  else if (vertical_angle < 45) v_dir = 'elevated shot'
  else v_dir = 'high-angle shot'

  let distance: string
  if (zoom < 2) distance = 'wide shot'
  else if (zoom < 6) distance = 'medium shot'
  else distance = 'close-up'

  return `<sks> ${h_dir} ${v_dir} ${distance}`
}

export function buildQwenMultiangleWorkflow(
  params: ComfyUIGenerateParams,
): Record<string, unknown> {
  if (!params.source_image) throw new Error('qwen_multiangle requires source_image')

  const positivePrompt = params.prompt_positive
  const seed =
    params.seed === -1 || params.seed == null
      ? Math.floor(Math.random() * 2 ** 32)
      : params.seed
  const steps = params.steps ?? 4 // Lightning LoRA: 4 steps
  const cfg = params.cfg ?? 1 // Lightning LoRA: CFG 1

  return {
    // Models
    '108': {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'qwen_image_edit_2511_fp8mixed.safetensors', weight_dtype: 'default' },
    },
    '107': {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['108', 0],
        lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
        strength_model: 1,
      },
    },
    '110': {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['107', 0],
        lora_name: 'qwen-image-edit-2511-multiple-angles-lora.safetensors',
        strength_model: 1,
      },
    },
    '93': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image' },
    },
    '95': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '94': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['110', 0], shift: 3.1 } },
    '98': { class_type: 'CFGNorm', inputs: { model: ['94', 0], strength: 1 } },

    // Source image
    '41': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    '106': { class_type: 'FluxKontextImageScale', inputs: { image: ['41', 0] } },

    // Positive: angle prompt + source image as reference
    '103': {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        clip: ['93', 0],
        vae: ['95', 0],
        image1: ['106', 0],
        prompt: positivePrompt,
      },
    },
    // Negative
    '100': {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        clip: ['93', 0],
        vae: ['95', 0],
        image1: ['106', 0],
        prompt: params.prompt_negative ?? '',
      },
    },

    // Flux Kontext multi-reference latent indexing
    '97': {
      class_type: 'FluxKontextMultiReferenceLatentMethod',
      inputs: { conditioning: ['103', 0], reference_latents_method: 'index_timestep_zero' },
    },
    '96': {
      class_type: 'FluxKontextMultiReferenceLatentMethod',
      inputs: { conditioning: ['100', 0], reference_latents_method: 'index_timestep_zero' },
    },

    // Encode source as starting latent
    '104': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['106', 0], vae: ['95', 0] },
    },

    // KSampler
    '105': {
      class_type: 'KSampler',
      inputs: {
        model: ['98', 0],
        positive: ['97', 0],
        negative: ['96', 0],
        latent_image: ['104', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },

    // Decode + save
    '102': buildVAEDecode(['105', 0], ['95', 0]),
    '9': buildSaveImage(['102', 0], 'hero_qwen_multiangle'),
  }
}

export function buildWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  switch (params.workflow_type) {
    case 'portrait':
      return buildPortraitWorkflow(params)
    case 'background':
      return buildBackgroundWorkflow(params)
    case 'scene_composition':
      return buildSceneCompositionWorkflow(params)
    case 'transition':
      return buildTransitionWorkflow(params)
    case 'animate':
      return buildAnimateWorkflow(params)
    case 'wan_animate':
      return buildWanAnimateWorkflow(params)
    case 'wan_camera':
      return buildWanCameraWorkflow(params)
    case 'latent_sync':
      return buildLatentSyncWorkflow(params)
    case 'motion_brush':
      return buildMotionBrushWorkflow(params)
    case 'cinemagraph':
      return buildCinemagraphWorkflow(params)
    case 'tooncrafter':
      return buildToonCrafterWorkflow(params)
    case 'liveportrait':
      return buildLivePortraitWorkflow(params)
    case 'qwen_multiangle':
      return buildQwenMultiangleWorkflow(params)
    case 'ltx_video':
      return buildLTXVideoWorkflow(params)
    case 'qwen_image_edit':
      return buildQwenImageEditWorkflow(params)
    case 'flux_fill':
      return buildFluxFillWorkflow(params)
    case 'insert_anything':
      return buildInsertAnythingWorkflow(params)
    case 'ic_light_harmonize':
      return buildIcLightHarmonizeWorkflow(params)
    case 'posed_ref_t2i':
      return buildPosedRefWorkflow(params)
    case 'controlnet_character_swap':
      return buildControlNetCharacterSwapWorkflow(params)
    case 'face_detailer_only':
      return buildFaceDetailerOnlyWorkflow(params)
    case 'flux_kontext':
      return buildFluxKontextWorkflow(params)
    case 'instant_id':
      return buildInstantIdWorkflow(params)
    case 'z_image':
      return buildZImageWorkflow(params)
    case 'flux_dev':
      return buildFluxDevWorkflow(params)
    case 'ltx_2_3_dual':
      return buildLtx23DualWorkflow(params)
  }
}

// ── Qwen-Image-Edit 2511 (Alibaba) — semantic image editing ────────────────
//
// Modèles requis :
//   - ComfyUI/models/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors (~10GB fp8)
//   - ComfyUI/models/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors (~9GB)
//   - ComfyUI/models/vae/qwen_image_vae.safetensors (~250MB)
//
// Capacités : édition par instruction texte + multi-image reference (jusqu'à 3
// images). Idéal pour insertion d'objet ("ajoute un chat sur le fût"), style
// transfer, character consistency cross-scenes.
//
// Architecture : utilise les nodes Qwen + FluxKontext (même infrastructure)
//   - TextEncodeQwenImageEditPlus : conditioning multi-modal (texte + 1-3 images)
//   - FluxKontextImageScale : auto-resize à résolution optimale Kontext
//   - ModelSamplingAuraFlow : architecture sampling AuraFlow
//
// Performance sur 8GB VRAM : ~60-90s sans LoRA, ~20-30s avec Lightning 4-step LoRA.
// Cf project_qwen_image_edit_setup.md pour params validés.

export function buildQwenImageEditWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('qwen_image_edit requires source_image')

  const positivePrompt = params.prompt_positive || 'edit the image as instructed'
  const negativePrompt = params.prompt_negative ?? ''
  const useLightning = params.use_lightning ?? false
  // Lightning LoRA → 4 steps + cfg 1.0 (officiel). Sinon 25 steps + cfg 4.
  const steps = params.steps ?? (useLightning ? 4 : 25)
  const cfg = params.cfg ?? (useLightning ? 1.0 : 4)
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const hasReference = !!params.reference_image
  const hasMask = !!params.mask_image
  const maskGrow = hasMask ? Math.max(0, Math.min(200, params.mask_grow ?? 48)) : 0
  const maskBlur = hasMask ? Math.max(0, Math.min(64, params.mask_blur ?? 8)) : 0
  // Détermine quel ID est la sortie finale du mask pour SetLatentNoiseMask :
  //   '15' = ImageToMask brut (silhouette stricte de Grounded-SAM)
  //   '16' = après GrowMask (silhouette dilatée)
  //   '19' = après ImageBlur (silhouette dilatée + adoucie)
  const finalMaskNodeId = maskBlur > 0 ? '19' : (maskGrow > 0 ? '16' : '15')

  // ── Stratégie ──
  // Mode TEXTE/RÉF (hasMask=false) : EmptyLatent → KSampler regénère TOUTE l'image,
  //   le conditioning porte la source comme référence. Risque de drift composition.
  // Mode MASK (hasMask=true) : on encode l'image source via VAE, on applique le mask
  //   en SetLatentNoiseMask, KSampler ne regénère QUE la zone blanche. Reste pixel-
  //   perfect. C'est l'inpaint masqué — la stratégie qui empêche le sujet inséré
  //   de surdimensionner ou recadrer la scène.
  // En mode MASK, on bypass FluxKontextImageScale pour garder l'alignement
  // pixel-à-pixel image↔mask (le mask vient de Grounded-SAM aux dims source).

  return {
    // ── Models ──
    '1': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: 'qwen_image_edit_2511_fp8mixed.safetensors',
        weight_dtype: 'default',
      },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
        type: 'qwen_image',
      },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'qwen_image_vae.safetensors' },
    },
    // Lightning LoRA optionnel : injecté entre UNETLoader et ModelSamplingAuraFlow
    // pour 6× speedup. La sortie du LoRA devient l'input du sampling.
    ...(useLightning ? {
      '5': {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          model: ['1', 0],
          lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
          strength_model: 1.0,
        },
      },
    } : {}),
    '4': {
      class_type: 'ModelSamplingAuraFlow',
      // Si Lightning : utilise '5' (LoRA-modified UNet). Sinon directement '1'.
      inputs: { model: useLightning ? ['5', 0] : ['1', 0], shift: 1.0 },
    },

    // ── Source image ──
    // En mode TEXTE : passe par FluxKontextImageScale (résolution Kontext optimale).
    // En mode MASK  : pas de scale, pour rester aligné pixel-pixel avec le mask.
    '10': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    ...(hasMask ? {} : {
      '11': { class_type: 'FluxKontextImageScale', inputs: { image: ['10', 0] } },
    }),

    // ── Reference image (optional, for object insertion from library) ──
    ...(hasReference ? {
      '12': { class_type: 'LoadImage', inputs: { image: params.reference_image! } },
      '13': { class_type: 'FluxKontextImageScale', inputs: { image: ['12', 0] } },
    } : {}),

    // ── Conditioning ──
    // Positif : prompt + image source + (optionnel) image référence.
    // image1 = sortie scaled en mode texte, raw en mode mask.
    '20': {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        clip: ['2', 0],
        prompt: positivePrompt,
        vae: ['3', 0],
        image1: hasMask ? ['10', 0] : ['11', 0],
        ...(hasReference ? { image2: ['13', 0] } : {}),
      },
    },
    // Négatif : prompt vide ou anti-pattern, sans images
    '21': {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        clip: ['2', 0],
        prompt: negativePrompt,
        vae: ['3', 0],
      },
    },

    // ── Latent ──
    // Mode MASK : encode source + applique mask. KSampler n'altère que zone blanche.
    //   Pipeline mask : LoadImage → ImageToMask → [GrowMask] → [Blur via image]
    //                   → SetLatentNoiseMask
    // Mode TEXTE : EmptyLatent classique.
    ...(hasMask ? {
      '14': { class_type: 'LoadImage', inputs: { image: params.mask_image! } },
      // PNG Grounded-SAM = binaire blanc/noir. On extrait le canal rouge.
      '15': {
        class_type: 'ImageToMask',
        inputs: { image: ['14', 0], channel: 'red' },
      },
      // Dilatation : étend la zone détectée pour laisser de la place au sujet
      // inséré. tapered_corners=true → coins arrondis (pas carrés agressifs).
      ...(maskGrow > 0 ? {
        '16': {
          class_type: 'GrowMask',
          inputs: { mask: ['15', 0], expand: maskGrow, tapered_corners: true },
        },
      } : {}),
      // Adoucissement : ComfyUI core n'a pas de blur direct sur MASK. On passe
      // par MaskToImage → ImageBlur → ImageToMask pour rester 100% core.
      ...(maskBlur > 0 ? {
        '17': {
          class_type: 'MaskToImage',
          inputs: { mask: maskGrow > 0 ? ['16', 0] : ['15', 0] },
        },
        '18': {
          class_type: 'ImageBlur',
          inputs: { image: ['17', 0], blur_radius: maskBlur, sigma: 1.0 },
        },
        '19': {
          class_type: 'ImageToMask',
          inputs: { image: ['18', 0], channel: 'red' },
        },
      } : {}),
      '30': {
        class_type: 'VAEEncode',
        inputs: { pixels: ['10', 0], vae: ['3', 0] },
      },
      '31': {
        class_type: 'SetLatentNoiseMask',
        inputs: { samples: ['30', 0], mask: [finalMaskNodeId, 0] },
      },
    } : {
      '30': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 1024, height: 1024, batch_size: 1 },
      },
    }),

    // ── Sampling ──
    '40': {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0],
        positive: ['20', 0],
        negative: ['21', 0],
        latent_image: hasMask ? ['31', 0] : ['30', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },

    // ── Decode + Save ──
    '50': buildVAEDecode(['40', 0], ['3', 0]),
    '60': buildSaveImage(['50', 0], 'hero_qwen_edit'),
  }
}

// ── LTX-Video 0.9.8 distilled fp8 (Lightricks) — image to video ────────────
//
// Custom node : ComfyUI-LTXVideo
// Modèles requis :
//   - ComfyUI/models/checkpoints/ltxv-2b-0.9.8-distilled-fp8.safetensors (~4.5GB)
//   - ComfyUI/models/text_encoders/t5xxl_fp16.safetensors (~9.5GB)
//
// On utilise LTX 0.9.8 distilled fp8 (modèle 2B latest, optimisé pour 8GB VRAM).
// La version 2.3 22B demande 36GB RAM+VRAM total, hors-zone pour 16GB+8GB.
// Distilled = moins de steps requis (4-8) pour qualité similaire au full.
//
// Spécificités LTX :
//   - Frames doivent être de la forme 8N+1 (9, 17, 25, 33, 41, 49…)
//   - CFG bas (3-4) — LTX préfère les CFG faibles vs SDXL (7+)
//   - Distilled fp8 : steps 4-8 suffisants (vs 30 pour full)
//   - Sampler `euler` + scheduler `simple` (defaults officiels du repo)
//   - Resolution multiples de 32, idéal 768×512 (ratio paysage)
//
// Node IDs :
//   1: CheckpointLoaderSimple → MODEL, CLIP, VAE (stocké tout-en-un)
//   2: CLIPLoader (T5 XXL fp16, type='ltxv')
//   3: LoadImage (image source)
//   4-5: CLIPTextEncode (positive / negative)
//   6: LTXVImgToVideo (image + vae → conditioning + latent)
//   7: KSampler (euler / simple / cfg=3 / denoise=1)
//   8: VAEDecode
//   9: VHS_VideoCombine (export MP4)

export function buildLTXVideoWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('ltx_video requires source_image')

  const positivePrompt = params.prompt_positive || 'gentle organic motion, smooth animation'
  const negativePrompt = params.prompt_negative ?? 'static, frozen, blurry, low quality, watermark'
  // LTX requires frames of form 8N+1. On ajuste si besoin.
  const requestedFrames = params.frames ?? 49
  const frames = Math.max(9, Math.min(257, Math.round((requestedFrames - 1) / 8) * 8 + 1))
  // Distilled 0.9.8 : 4-8 steps suffisent (vs 30 pour le full).
  // On clamp à max 12 même si user envoie + (compute inutile).
  const steps = Math.min(12, params.steps ?? 8)
  const cfg = params.cfg ?? 3       // LTX = CFG bas, contrairement SDXL
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const fps = params.fps ?? 24
  const width = params.width ?? 768
  const height = params.height ?? 512

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'ltxv-2b-0.9.8-distilled-fp8.safetensors' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: 't5xxl_fp16.safetensors',
        type: 'ltxv',
      },
    },
    '3': {
      class_type: 'LoadImage',
      inputs: { image: params.source_image },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positivePrompt, clip: ['2', 0] },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['2', 0] },
    },
    // Node clé : encode l'image source en latent pour LTX + prépare conditioning.
    // `strength` 0.0-1.0 = force du conditioning image (1.0 = image très respectée,
    // 0.5 = bcp de variation). Default 1.0.
    '6': {
      class_type: 'LTXVImgToVideo',
      inputs: {
        positive: ['4', 0],
        negative: ['5', 0],
        vae: ['1', 2],
        image: ['3', 0],
        width,
        height,
        length: frames,
        batch_size: 1,
        strength: 1.0,
      },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['6', 0],   // LTXVImgToVideo outputs (positive, negative, latent)
        negative: ['6', 1],
        latent_image: ['6', 2],
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    '8': buildVAEDecode(['7', 0], ['1', 2]),
    '9': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['8', 0],
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: 'hero_ltx',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
        pix_fmt: 'yuv420p',
        crf: 19,
      },
    },
  }
}

// ── Flux.1 Fill Dev (Black Forest Labs) — vrai inpaint local ──────────────
//
// Custom node requis : ComfyUI-GGUF (city96)
//   git clone https://github.com/city96/ComfyUI-GGUF
//   pip install --upgrade gguf
//
// Modèles requis (8 GB VRAM friendly, GGUF Q4) :
//   - ComfyUI/models/unet/flux1-fill-dev-fp16-Q4_0-GGUF.gguf (~6.8 GB)
//     SporkySporkness/FLUX.1-Fill-dev-GGUF (HF, non-gated)
//   - ComfyUI/models/text_encoders/t5xxl_fp16.safetensors (~9.5 GB, déjà chez Didier)
//     ou GGUF Q4 (city96/t5-v1_1-xxl-encoder-gguf) si VRAM serrée
//   - ComfyUI/models/text_encoders/clip_l.safetensors (~246 MB)
//     comfyanonymous/flux_text_encoders (HF, non-gated)
//   - ComfyUI/models/vae/ae.safetensors (~335 MB)
//     Comfy-Org/z_image_turbo (HF, non-gated mirror — black-forest-labs est gated)
//
// Spécificités Flux Fill :
//   - C'est un VRAI modèle inpaint (≠ Qwen Edit qui est édition globale).
//     Le node InpaintModelConditioning est conçu pour : il fait le bon mix
//     latent + mask + conditioning. Pas de hack SetLatentNoiseMask comme on
//     a tenté avec Qwen — c'est le pattern officiel BFL.
//   - CFG du KSampler = 1.0 (pas 7 SDXL ni 30 ! le 30 est la "guidance" Flux,
//     appliquée via FluxGuidance node, pas le CFG)
//   - guidance Flux = 30 (officiel BFL pour Fill, plus que les 3.5 de Flux Dev T2I)
//   - sampler euler / scheduler simple (defaults BFL)
//   - steps : 20 par défaut (Flux Fill est moins distillé que Schnell)
//
// Capacités : insertion d'objet locale, suppression (avec prompt vide),
// outpainting (mask les bords), modif locale par prompt + mask. La zone
// non-masquée est PIXEL-PERFECT préservée (vrai inpaint) — ce qu'on cherchait.

export function buildFluxFillWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('flux_fill requires source_image')
  if (!params.mask_image) throw new Error('flux_fill requires mask_image (inpaint zone)')

  const positivePrompt = params.prompt_positive || 'fill the masked area naturally'
  // Flux Fill ignore largement le négatif (CFG=1) mais on le garde pour cohérence
  const negativePrompt = params.prompt_negative ?? ''
  // Officiel BFL : steps=20-30 pour Fill. On laisse tweakable mais default 20.
  const steps = params.steps ?? 20
  // Flux : "guidance" interne (≠ CFG du sampler). 30 = officiel pour Fill.
  // On réutilise params.cfg comme la guidance Flux (sémantiquement c'est "force").
  const fluxGuidance = params.cfg ?? 30
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const maskGrow = Math.max(0, Math.min(200, params.mask_grow ?? 0))
  const maskBlur = Math.max(0, Math.min(64, params.mask_blur ?? 0))
  // ID final du mask pour InpaintModelConditioning
  const finalMaskNodeId = maskBlur > 0 ? '19' : (maskGrow > 0 ? '16' : '15')

  return {
    // ── Models ──
    '1': {
      class_type: 'UnetLoaderGGUF',
      inputs: { unet_name: 'flux1-fill-dev-fp16-Q4_0-GGUF.gguf' },
    },
    // DualCLIPLoaderGGUF accepte safetensors ET gguf en clip_name1/2.
    // type='flux' obligatoire pour Flux Fill.
    '2': {
      class_type: 'DualCLIPLoaderGGUF',
      inputs: {
        clip_name1: 't5xxl_fp16.safetensors',
        clip_name2: 'clip_l.safetensors',
        type: 'flux',
      },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'ae.safetensors' },
    },

    // ── Source + mask ──
    '10': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    '14': { class_type: 'LoadImage', inputs: { image: params.mask_image! } },
    '15': {
      class_type: 'ImageToMask',
      inputs: { image: ['14', 0], channel: 'red' },
    },
    ...(maskGrow > 0 ? {
      '16': {
        class_type: 'GrowMask',
        inputs: { mask: ['15', 0], expand: maskGrow, tapered_corners: true },
      },
    } : {}),
    ...(maskBlur > 0 ? {
      '17': {
        class_type: 'MaskToImage',
        inputs: { mask: maskGrow > 0 ? ['16', 0] : ['15', 0] },
      },
      '18': {
        class_type: 'ImageBlur',
        inputs: { image: ['17', 0], blur_radius: maskBlur, sigma: 1.0 },
      },
      '19': {
        class_type: 'ImageToMask',
        inputs: { image: ['18', 0], channel: 'red' },
      },
    } : {}),

    // ── Conditioning ──
    '20': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positivePrompt, clip: ['2', 0] },
    },
    '21': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['2', 0] },
    },
    // FluxGuidance : applique la "guidance" Flux (≠ CFG sampler) sur le positif
    '22': {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['20', 0], guidance: fluxGuidance },
    },
    // InpaintModelConditioning : node ComfyUI core conçu pour Flux Fill / SDXL Inpaint.
    // Output : (positive, negative, latent) avec mask + image source proprement encodés.
    '30': {
      class_type: 'InpaintModelConditioning',
      inputs: {
        positive: ['22', 0],
        negative: ['21', 0],
        vae: ['3', 0],
        pixels: ['10', 0],
        mask: [finalMaskNodeId, 0],
        // noise_mask=true → SetLatentNoiseMask en interne. La zone non-masquée
        // est strictement préservée pendant le sampling.
        noise_mask: true,
      },
    },

    // ── Sampling ──
    '40': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['30', 0],
        negative: ['30', 1],
        latent_image: ['30', 2],
        seed,
        steps,
        // CFG sampler = 1.0 pour Flux. La vraie "force" est dans FluxGuidance ci-dessus.
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },

    // ── Decode + Save ──
    '50': buildVAEDecode(['40', 0], ['3', 0]),
    '60': buildSaveImage(['50', 0], 'hero_flux_fill'),
  }
}

// ── Flux Kontext Dev — édition d'image par instruction texte ───────────────
//
// "Remove the necklace" / "Change the color of the pull to blue" / "Add a hat"
// — édition sémantique de l'image source guidée par instruction.
//
// Différences vs Flux Fill :
//   - PAS de mask : opère sur toute l'image
//   - Instruction-based (pas inpainting)
//   - Utilise ReferenceLatent pour conditionner sur l'image source
//   - guidance Flux = 2.5 (officiel BFL Kontext, vs 30 pour Fill)
//
// VRAM : ~10 GB nécessaires (modèle GGUF Q4_K_S 6.8 GB + activations).
// Sur 8 GB : NÉCESSITE NVIDIA Sysmem Fallback activé. Sinon OOM.
// Performance attendue : 3-7 min/run (vs 30-90s en VRAM pure).
//
// Custom node requis : ComfyUI-GGUF (city96, déjà installé pour Flux Fill).
//
// Modèles requis :
//   - models/unet/flux1-kontext-dev-Q4_K_S.gguf (~6.8 GB) ← à download
//   - models/text_encoders/t5xxl_fp16.safetensors (déjà là)
//   - models/text_encoders/clip_l.safetensors (déjà là)
//   - models/vae/ae.safetensors (déjà là)
//
// Inputs :
//   - source_image : l'image source à éditer ("first image" dans le prompt)
//   - reference_image (optionnel) : 2e image, ex perso à insérer dans la scène.
//                                   Si fournie → mode multi-image, prompt référence
//                                   "the second image" / "from the second image".
//   - prompt_positive : instruction d'édition en anglais
//                       (BFL recommande l'anglais, qualité dégrade en autres)
//   - cfg : optionnel, sera utilisé comme FluxGuidance (default 2.5)
export function buildFluxKontextWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('flux_kontext requires source_image')
  if (!params.prompt_positive) throw new Error('flux_kontext requires prompt_positive (edit instruction)')

  const positivePrompt = params.prompt_positive
  const negativePrompt = params.prompt_negative ?? ''
  const steps = params.steps ?? 20
  const fluxGuidance = params.cfg ?? 2.5
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const hasReference = !!params.reference_image

  // Base workflow (single-image)
  const wf: Record<string, unknown> = {
    // ── Models ──
    '1': {
      class_type: 'UnetLoaderGGUF',
      inputs: { unet_name: 'flux1-kontext-dev-Q4_K_S.gguf' },
    },
    '2': {
      class_type: 'DualCLIPLoaderGGUF',
      inputs: {
        clip_name1: 't5xxl_fp16.safetensors',
        clip_name2: 'clip_l.safetensors',
        type: 'flux',
      },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'ae.safetensors' },
    },

    // ── Image 1 (scène / source) ──
    '10': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    '11': { class_type: 'FluxKontextImageScale', inputs: { image: ['10', 0] } },
    '12': { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['3', 0] } },

    // ── Conditioning text ──
    '20': { class_type: 'CLIPTextEncode', inputs: { text: positivePrompt, clip: ['2', 0] } },
    '21': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['2', 0] } },

    // ── ReferenceLatent A : injecte l'image 1 dans le conditioning ──
    '30': {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: ['20', 0], latent: ['12', 0] },
    },
  }

  // Multi-image : ajoute image 2 + ReferenceLatent B chaîné après A
  // Pattern multi-image officiel : 2 ReferenceLatent en série, le second
  // prend le conditioning du premier comme entrée → Flux "connaît" les 2 images.
  // Prompt doit référencer "the first image" / "the second image" (ou "from
  // the second image / in the first image") pour que le modèle sache lequel
  // est lequel.
  let conditioningForGuidance: [string, number] = ['30', 0]
  if (hasReference) {
    wf['13'] = { class_type: 'LoadImage', inputs: { image: params.reference_image! } }
    wf['14'] = { class_type: 'FluxKontextImageScale', inputs: { image: ['13', 0] } }
    wf['15'] = { class_type: 'VAEEncode', inputs: { pixels: ['14', 0], vae: ['3', 0] } }
    wf['31'] = {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: ['30', 0], latent: ['15', 0] },
    }
    conditioningForGuidance = ['31', 0]
  }

  // ── FluxGuidance : applique la "force" Flux sur le conditioning final ──
  wf['32'] = {
    class_type: 'FluxGuidance',
    inputs: { conditioning: conditioningForGuidance, guidance: fluxGuidance },
  }

  // ── Sampling ──
  // On part du latent de la SCÈNE (image 1 déjà scalée Kontext-friendly + encodée
  // VAE en node '12'). Avec denoise=1.0 le contenu est totalement régénéré, mais
  // les DIMENSIONS du latent (donc de l'image de sortie) matchent la scène.
  // Sans ça, EmptyLatentImage hardcodé 1024×1024 forçait une sortie carrée
  // même quand la scène était 16:9 (1360×768) → distorsion + perso surdimensionné.
  wf['50'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0],
      positive: ['32', 0],
      negative: ['21', 0],
      latent_image: ['12', 0],   // latent de la scène scalée → dimensions préservées
      seed,
      steps,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
  }

  // ── Decode + Save ──
  wf['60'] = buildVAEDecode(['50', 0], ['3', 0])
  wf['70'] = buildSaveImage(['60', 0], 'hero_flux_kontext')

  return wf
}

// ── Insert Anything (song-wensong/insert-anything) — preservation d'identite ──
//
// Principe : insertion d'objet/sujet depuis une image de reference dans une
// scene cible, en preservant l'identite. Architecture diptych :
//   1. ReduxProcess prepare la reference (crop, pad, resize 768x768)
//   2. CLIPVisionEncode + Flux Redux StyleModel injecte l'identite dans le conditioning
//   3. FillProcess concatene reference + scene en diptych 1536x768 + mask
//      (la reference occupe la moitie gauche, la cible la moitie droite)
//   4. KSampler regenere uniquement la zone masquee de la moitie droite,
//      en s'inspirant de la reference visible a gauche
//   5. CropBack recolle le resultat dans l'image originale a la bonne taille
//
// Avantage vs Flux Fill seul : l'identite du sujet de reference est conservee
// (pas une approximation par texte). Avantage vs IPAdapter : marche pour TOUT
// (objet, animal, perso non-humain), pas seulement les visages humains.
//
// Custom node requis : mo230761/InsertAnything-ComfyUI-official
//   git clone https://github.com/mo230761/InsertAnything-ComfyUI-official
//   (dans ComfyUI/custom_nodes/, pas de pip install necessaire)
//
// Modeles requis (chez Didier au 2026-04-30) :
//   - models/unet/flux1-fill-dev-fp16-Q4_0-GGUF.gguf (deja la, partage avec flux_fill)
//   - models/loras/insert-anything_lora_rank_64-bf16.safetensors (~585 MB)
//     [aha2023/insert-anything-lora-for-nunchaku]
//   - models/style_models/flux1-redux-dev.safetensors (~124 MB)
//     [second-state/FLUX.1-Redux-dev-GGUF mirror non-gated]
//   - models/clip_vision/sigclip_vision_patch14_384.safetensors (~817 MB)
//     [Comfy-Org/sigclip_vision_384]
//   - models/text_encoders/t5xxl_fp16.safetensors (deja la)
//   - models/text_encoders/clip_l.safetensors (deja la)
//   - models/vae/ae.safetensors (deja la)
//
// Inputs requis :
//   - source_image : la scene cible (PNG)
//   - mask_image   : ou placer le sujet dans la scene (PNG binaire, blanc = zone)
//   - reference_image : l'image de reference du sujet a inserer
//   - reference_mask_image : silhouette du sujet dans la reference
//                          (typiquement = alpha d'un PNG transparent rembg)

export function buildInsertAnythingWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('insert_anything requires source_image')
  if (!params.mask_image) throw new Error('insert_anything requires mask_image (zone in target scene)')
  if (!params.reference_image) throw new Error('insert_anything requires reference_image')
  if (!params.reference_mask_image) throw new Error('insert_anything requires reference_mask_image (subject silhouette)')

  // KSampler params (defaults du workflow officiel InsertAnything.json)
  const steps = params.steps ?? 28
  const fluxGuidance = params.cfg ?? 30  // Flux guidance (≠ CFG sampler)
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  // Iterations FillProcess : etend le mask source par dilatation (kernel 7x7).
  // Chaque iteration ajoute ~3 pixels au mask. 2 = default officiel (~6px).
  // Conversion : iterations = round(px / 3). Clamp à 50 pour eviter d'exploser
  // (et FillProcess applique ensuite expand_bbox 1.2x puis 2x donc l'effet
  // multiplicatif arrive ensuite, pas la peine d'aller au-dela).
  const iterations = params.mask_grow != null
    ? Math.max(1, Math.min(50, Math.round(params.mask_grow / 3)))
    : 2

  return {
    // ── Source + Reference + Masks (LoadImage standard, mask = LoadImage.1) ──
    '10': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    '11': { class_type: 'LoadImage', inputs: { image: params.mask_image } },
    '12': { class_type: 'ImageToMask', inputs: { image: ['11', 0], channel: 'red' } },
    '13': { class_type: 'LoadImage', inputs: { image: params.reference_image } },
    '14': { class_type: 'LoadImage', inputs: { image: params.reference_mask_image } },
    '15': { class_type: 'ImageToMask', inputs: { image: ['14', 0], channel: 'red' } },

    // ── Models ──
    // UnetLoaderGGUF (city96) au lieu de UNETLoader → on reutilise le Flux Fill
    // GGUF Q4 deja telecharge pour la POC flux_fill. ~6.4 GB, fits 8 GB VRAM.
    '20': {
      class_type: 'UnetLoaderGGUF',
      inputs: { unet_name: 'flux1-fill-dev-fp16-Q4_0-GGUF.gguf' },
    },
    // Insert Anything LoRA (rank 64, version legere ~585 MB)
    '21': {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['20', 0],
        lora_name: 'insert-anything_lora_rank_64-bf16.safetensors',
        strength_model: 1.0,
      },
    },
    '22': {
      class_type: 'DualCLIPLoaderGGUF',
      inputs: {
        clip_name1: 't5xxl_fp16.safetensors',
        clip_name2: 'clip_l.safetensors',
        type: 'flux',
      },
    },
    '23': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    '24': {
      class_type: 'CLIPVisionLoader',
      inputs: { clip_name: 'sigclip_vision_patch14_384.safetensors' },
    },
    '25': {
      class_type: 'StyleModelLoader',
      inputs: { style_model_name: 'flux1-redux-dev.safetensors' },
    },

    // ── ReduxProcess : prepare la reference (crop sujet, pad square, resize 768) ──
    // Nodes custom du repo InsertAnything-ComfyUI-official
    '30': {
      class_type: 'ReduxProcess',
      inputs: { ref_image: ['13', 0], ref_mask: ['15', 0] },
    },

    // ── CLIP Vision : encode la reference traitee par Redux ──
    '31': {
      class_type: 'CLIPVisionEncode',
      inputs: { clip_vision: ['24', 0], image: ['30', 0], crop: 'center' },
    },

    // ── Text encoding : prompt vide (Redux fait le job d'identite) ──
    '32': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['22', 0], text: '' },
    },
    // Flux guidance applique sur le positive
    '33': {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['32', 0], guidance: fluxGuidance },
    },
    // Style model apply : injecte l'identite Redux sur le conditioning
    '34': {
      class_type: 'StyleModelApply',
      inputs: {
        conditioning: ['33', 0],
        style_model: ['25', 0],
        clip_vision_output: ['31', 0],
        strength: 1.0,
        strength_type: 'multiply',
      },
    },
    // Negative = positive zero-out
    '35': {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['32', 0] },
    },

    // ── FillProcess : cree le diptyque [reference | scene] + mask diptyque ──
    // Outputs : (image_diptych, mask_diptych, old_tar_image, tar_box_yyxx_crop,
    //           crop_params, preview_image)
    '40': {
      class_type: 'FillProcess',
      inputs: {
        source_image: ['10', 0],
        ref_image: ['13', 0],
        source_mask: ['12', 0],
        ref_mask: ['15', 0],
        iterations,
      },
    },

    // ── InpaintModelConditioning : applique image+mask au conditioning ──
    // noise_mask=true : la zone non-masquee reste pixel-perfect preservee
    '41': {
      class_type: 'InpaintModelConditioning',
      inputs: {
        positive: ['34', 0],
        negative: ['35', 0],
        vae: ['23', 0],
        pixels: ['40', 0],
        mask: ['40', 1],
        noise_mask: true,
      },
    },

    // ── KSampler ──
    '50': {
      class_type: 'KSampler',
      inputs: {
        model: ['21', 0],
        positive: ['41', 0],
        negative: ['41', 1],
        latent_image: ['41', 2],
        seed,
        steps,
        cfg: 1.0,           // Flux : CFG=1, la guidance est dans FluxGuidance
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0,
      },
    },

    // ── VAE Decode ──
    '60': buildVAEDecode(['50', 0], ['23', 0]),

    // ── CropBack : recolle la moitie droite du diptyque dans l'image originale ──
    '70': {
      class_type: 'CropBack',
      inputs: {
        raw_image: ['60', 0],
        old_tar_image: ['40', 2],
        tar_box_yyxx_crop: ['40', 3],
        crop_params: ['40', 4],
      },
    },

    // ── Save ──
    '80': buildSaveImage(['70', 0], 'hero_insert_anything'),
  }
}

// ── IC-Light Harmonize (lllyasviel) — relighting + ombres post Insert Anything ──
//
// Principe : reprend le résultat d'Insert Anything (sujet collé sans ombres ni
// lumière harmonisée) et le passe dans IC-Light V2 mode "fbc"
// (background-conditioned). IC-Light analyse le background (= la scène
// originale) et relight le foreground (= scène avec sujet inséré) pour
// harmoniser éclairage + générer ombres au sol.
//
// DetailTransfer en post-traitement préserve les détails fins du sujet
// (visage, vêtements) que IC-Light pourrait altérer.
//
// Custom node : kijai/ComfyUI-IC-Light (déjà cloné chez Didier)
//
// Modèles requis :
//   - models/checkpoints/Realistic_Vision_V6.0_NV_B1_fp16.safetensors (déjà là, SD 1.5)
//   - models/unet/IC-Light/iclight_sd15_fbc.safetensors (1.7 GB, téléchargé 2026-04-30)
//
// Inputs :
//   - source_image     : résultat Insert Anything (scène + sujet collé)
//   - background_image : scène ORIGINALE (avant Insert Anything) — pour FBC
//   - prompt_positive  : description de l'éclairage cible (default = harmonisation)

export function buildIcLightHarmonizeWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('ic_light_harmonize requires source_image (Insert Anything result)')
  if (!params.background_image) throw new Error('ic_light_harmonize requires background_image (original scene)')

  const positivePrompt = params.prompt_positive ||
    'seamless integration, realistic shadows on the ground, ambient occlusion, ' +
    'harmonized lighting matching the environment, soft natural light, painterly style'
  const negativePrompt = params.prompt_negative ?? 'artifacts, blurry, distorted, harsh edges, glitchy lighting'
  // IC-Light : CFG bas (1-2.5 typique), pas comme Flux (30) ou SDXL (7)
  const cfg = params.cfg ?? 2.0
  // 25 steps officiel
  const steps = params.steps ?? 25
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed

  return {
    // ── Models ──
    // Realistic Vision V6.0 = SD 1.5 (IC-Light est SD 1.5 only)
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'Realistic_Vision_V6.0_NV_B1_fp16.safetensors' },
    },
    // IC-Light FBC : UNet patcher qui modifie le SD 1.5 pour relighting BG-conditionné
    // model_path : forward slash pour cross-platform (Windows accepte / aussi)
    '2': {
      class_type: 'LoadAndApplyICLightUnet',
      inputs: {
        model: ['1', 0],
        model_path: 'IC-Light/iclight_sd15_fbc.safetensors',
      },
    },

    // ── Source images ──
    // foreground = résultat Insert Anything (scène avec sujet à harmoniser)
    '10': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    // background = scène originale (avant Insert Anything) → guide la lumière
    '11': { class_type: 'LoadImage', inputs: { image: params.background_image! } },

    // ── VAE encode des 2 images en latent ──
    '20': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['10', 0], vae: ['1', 2] },
    },
    '21': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['11', 0], vae: ['1', 2] },
    },

    // ── Conditioning text ──
    '30': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positivePrompt, clip: ['1', 1] },
    },
    '31': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['1', 1] },
    },

    // ── ICLightConditioning : prépare le conditioning pour IC-Light ──
    // Inputs : positive, negative, vae, foreground (latent), opt_background (latent pour FBC)
    // Outputs : positive, negative, empty_latent
    '40': {
      class_type: 'ICLightConditioning',
      inputs: {
        positive: ['30', 0],
        negative: ['31', 0],
        vae: ['1', 2],
        foreground: ['20', 0],
        multiplier: 0.18215,
        opt_background: ['21', 0],
      },
    },

    // ── KSampler (IC-Light FBC) ──
    '50': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['40', 0],
        negative: ['40', 1],
        latent_image: ['40', 2],
        seed,
        steps,
        cfg,
        sampler_name: 'dpmpp_2m_sde_gpu',
        scheduler: 'karras',
        denoise: 1.0,
      },
    },

    // ── Decode + DetailTransfer ──
    '60': buildVAEDecode(['50', 0], ['1', 2]),
    // DetailTransfer préserve les détails fins du sujet original (visage, vêtements)
    // qui pourraient être altérés par le relighting d'IC-Light.
    // mode='add' + blur_sigma=1.0 + blend_factor=1.0 = défauts qui marchent.
    '70': {
      class_type: 'DetailTransfer',
      inputs: {
        target: ['60', 0],
        source: ['10', 0],
        mode: 'add',
        blur_sigma: 1.0,
        blend_factor: 1.0,
      },
    },

    // ── Save ──
    '80': buildSaveImage(['70', 0], 'hero_ic_light_harmonize'),
  }
}

// ── Posed Reference T2I — génère une image avec ControlNet OpenPose ────────
//
// Pour les sujets HUMAINS uniquement : extrait le squelette OpenPose du sujet
// source (crop) et l'impose à la génération de la référence via ControlNet.
// Garantit que la pose géométrique de la référence matche EXACTEMENT celle
// du sujet à remplacer (résout les ambiguïtés du pipeline texte Qwen VL+T2I).
//
// Custom node : Fannovel16/comfyui_controlnet_aux (déjà installé chez Didier)
//
// Modèle ControlNet : xinsir/controlnet-openpose-sdxl-1.0
//   ComfyUI/models/controlnet/openpose_sdxl_xinsir.safetensors (~2.4 GB)
//
// Inputs :
//   - source_image    : crop du sujet source (image dont on extrait le squelette)
//   - prompt_positive : description du sujet cible (texte enrichi)
//   - checkpoint      : SDXL (Juggernaut XL ou défaut)

export function buildPosedRefWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('posed_ref_t2i requires source_image (crop of subject for pose extraction)')

  const styleSuffix = STYLE_SUFFIXES[params.style ?? 'realistic'] ?? STYLE_SUFFIXES.realistic
  const positivePrompt = `${params.prompt_positive} BREAK ${styleSuffix}`
  const negativePrompt = params.prompt_negative ?? DEFAULT_NEGATIVE_PROMPT
  const steps = params.steps ?? 30
  const cfg = params.cfg ?? 7
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const width = params.width ?? 1024
  const height = params.height ?? 1024

  return {
    // ── Models ──
    '1': buildCheckpointNode(params.checkpoint),
    // ControlNet OpenPose SDXL (xinsir version, supporte scale_stick activation)
    '2': {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: 'openpose_sdxl_xinsir.safetensors' },
    },

    // ── Image source pour extraction de pose ──
    '10': { class_type: 'LoadImage', inputs: { image: params.source_image } },
    // OpenPose preprocessor : extrait le squelette du sujet
    // class_type officiel = 'OpenposePreprocessor' (cf NODE_CLASS_MAPPINGS de comfyui_controlnet_aux)
    // scale_stick_for_xinsr_cn=enable : aligne avec le ControlNet xinsir
    '11': {
      class_type: 'OpenposePreprocessor',
      inputs: {
        image: ['10', 0],
        detect_hand: 'enable',
        detect_body: 'enable',
        detect_face: 'enable',
        resolution: 1024,
        scale_stick_for_xinsr_cn: 'enable',
      },
    },

    // ── Conditioning text ──
    '20': buildClipTextEncode(positivePrompt, ['1', 1]),
    '21': buildClipTextEncode(negativePrompt, ['1', 1]),

    // ── Application ControlNet (squelette → guide la génération) ──
    // strength 1.0 + end_percent 1.0 = défauts officiels xinsir (cf doc HF)
    // Le ControlNet xinsir est entraîné pour conditioning_scale=1.0
    '30': {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['20', 0],
        negative: ['21', 0],
        control_net: ['2', 0],
        image: ['11', 0],
        strength: 1.0,
        start_percent: 0.0,
        end_percent: 1.0,
      },
    },

    // ── Latent + sampling ──
    // Sampler officiel xinsir : EulerAncestralDiscreteScheduler.
    // On ne peut pas utiliser buildKSampler (qui force 'euler' simple).
    '40': buildEmptyLatent(width, height),
    '50': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['30', 0],
        negative: ['30', 1],
        latent_image: ['40', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'euler_ancestral',
        scheduler: 'normal',
        denoise: 1.0,
      },
    },

    // ── Decode + save ──
    '60': buildVAEDecode(['50', 0], ['1', 2]),
    '70': buildSaveImage(['60', 0], 'hero_posed_ref'),
  }
}

// ── ControlNet Character Swap — pattern STANDARD 2025 ─────────────────────
//
// Remplace un perso dans une scène par un autre perso (depuis image-ref) en
// préservant identité + pose. Pattern direct sans cascade :
//
//   SDXL (Juggernaut) + ControlNet OpenPose (pose) + IPAdapter Plus (identité)
//   + Inpainting natif (mask Grounded-SAM) → résultat dans la scène
//
// Avantages vs pipeline 10 étapes (Insert Anything + IC-Light) :
//   - 1 SEUL modèle SDXL chargé (vs 5 modèles à swapper)
//   - Pas de cascade, pas de mémoire à vider entre étapes
//   - Inpainting natif gère ombres + harmonisation
//   - ~3-5 min par run (vs 8-15 min)
//
// Custom nodes (déjà installés) :
//   - ComfyUI_IPAdapter_plus (cubiq)
//   - comfyui_controlnet_aux (Fannovel16)
//
// Modèles (déjà installés) :
//   - models/checkpoints/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors (SDXL)
//   - models/controlnet/openpose_sdxl_xinsir.safetensors (xinsir, 2.4 GB)
//   - models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors (universel)
//   - + CLIP Vision SigLIP / ViT-H (auto-loaded par IPAdapterUnifiedLoader)
//
// Inputs :
//   - source_image     : la scène entière (sera modifiée par inpainting)
//   - mask_image       : zone du perso à remplacer (mask blanc/noir Grounded-SAM)
//   - reference_image  : image du nouveau perso (identité à transférer)
//   - prompt_positive  : description courte (style, ambiance ; IPAdapter porte l'identité)

export function buildControlNetCharacterSwapWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('controlnet_character_swap requires source_image (the scene)')
  if (!params.mask_image) throw new Error('controlnet_character_swap requires mask_image (zone of subject to replace)')
  if (!params.reference_image) throw new Error('controlnet_character_swap requires reference_image (new subject)')

  const styleSuffix = STYLE_SUFFIXES[params.style ?? 'realistic'] ?? STYLE_SUFFIXES.realistic
  const positivePrompt = `${params.prompt_positive ?? ''} BREAK ${styleSuffix}`
  const negativePrompt = params.prompt_negative ?? DEFAULT_NEGATIVE_PROMPT
  // Defaults : 30 steps, pas de mask processing → setup simple validé.
  // Les sliders sont là pour tweaker au cas par cas, mais defaults = simple qui marche.
  const steps = params.steps ?? 30
  const cfg = params.cfg ?? 7
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const ipaWeight = params.ipa_weight ?? 0.8
  const controlnetStrength = params.controlnet_strength ?? 1.0
  const ipaPreset = params.ipa_preset ?? 'PLUS (high strength)'
  const ipaWeightType = params.ipa_weight_type ?? 'linear'
  // Mask processing désactivé par défaut (silhouette stricte = bon résultat
  // observé). Activer dilation/blur seulement si écho/débordement visibles.
  const maskGrow = Math.max(0, Math.min(200, params.mask_grow ?? 0))
  const maskBlur = Math.max(0, Math.min(64, params.mask_blur ?? 0))
  const finalMaskNodeId = maskBlur > 0 ? '17' : (maskGrow > 0 ? '14' : '13')
  // Denoise 1.0 = default pour CHARACTER SWAP (régénère totalement la zone
  // masquée → le perso original disparaît, remplacé par la ref).
  // <1.0 = features du perso original "fuitent" via le latent → contamine
  // l'identité de la ref. À utiliser seulement pour preserve color/style
  // (cas img2img stylisation, PAS swap de sujet).
  const denoise = Math.max(0.5, Math.min(1.0, params.denoise ?? 1.0))
  // FaceDetailer extrait dans un workflow séparé `face_detailer_only` (chaîné
  // côté client) — sinon SDXL + IPAdapter Plus + ControlNet + IPAdapter FaceID
  // + InsightFace + SAM + YOLO chargés simultanément = OOM sur 8 GB.

  return {
    // ── Models ──
    '1': buildCheckpointNode(params.checkpoint),  // SDXL Juggernaut

    // ── IPAdapter UnifiedLoader : preset configurable ──
    // PLUS = universel (ip-adapter-plus_sdxl_vit-h)
    // PLUS FACE = visages humains (ip-adapter-plus-face_sdxl_vit-h, meilleur portraits)
    '2': {
      class_type: 'IPAdapterUnifiedLoader',
      inputs: { model: ['1', 0], preset: ipaPreset },
    },

    // ── ControlNet OpenPose (xinsir SDXL) ──
    '3': {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: 'openpose_sdxl_xinsir.safetensors' },
    },

    // ── Source images ──
    '10': { class_type: 'LoadImage', inputs: { image: params.source_image } },           // scène
    '11': { class_type: 'LoadImage', inputs: { image: params.reference_image! } },       // ref perso
    '12': { class_type: 'LoadImage', inputs: { image: params.mask_image! } },            // mask zone
    '13': { class_type: 'ImageToMask', inputs: { image: ['12', 0], channel: 'red' } },

    // ── Mask processing : GrowMask + Blur (anti-écho, anti-bord net) ──
    // Pipeline : '13' (ImageToMask) → '14' (GrowMask si maskGrow>0)
    //          → '15' (MaskToImage) → '16' (ImageBlur si maskBlur>0)
    //          → '17' (ImageToMask)
    // finalMaskNodeId pointe vers le dernier node selon les options activées
    ...(maskGrow > 0 ? {
      '14': {
        class_type: 'GrowMask',
        inputs: { mask: ['13', 0], expand: maskGrow, tapered_corners: true },
      },
    } : {}),
    ...(maskBlur > 0 ? {
      '15': {
        class_type: 'MaskToImage',
        inputs: { mask: maskGrow > 0 ? ['14', 0] : ['13', 0] },
      },
      '16': {
        class_type: 'ImageBlur',
        inputs: { image: ['15', 0], blur_radius: maskBlur, sigma: 1.0 },
      },
      '17': { class_type: 'ImageToMask', inputs: { image: ['16', 0], channel: 'red' } },
    } : {}),

    // ── OpenPose preprocessor sur la SCÈNE (extrait squelette du perso source) ──
    // scale_stick_for_xinsr_cn=enable : nécessaire pour xinsir SDXL (sticks plus épais)
    '20': {
      class_type: 'OpenposePreprocessor',
      inputs: {
        image: ['10', 0],
        detect_hand: 'enable',
        detect_body: 'enable',
        detect_face: 'enable',
        resolution: 1024,
        scale_stick_for_xinsr_cn: 'enable',
      },
    },

    // ── IPAdapterAdvanced : injecte l'identité de la ref dans le MODEL ──
    // attn_mask = mask source → IPAdapter applique l'identité UNIQUEMENT sur la zone
    // weight_type configurable : linear / style transfer / strong / etc.
    '30': {
      class_type: 'IPAdapterAdvanced',
      inputs: {
        model: ['2', 0],            // MODEL after UnifiedLoader
        ipadapter: ['2', 1],        // IPADAPTER from UnifiedLoader
        image: ['11', 0],           // ref perso
        weight: ipaWeight,
        weight_type: ipaWeightType,
        combine_embeds: 'concat',
        start_at: 0.0,
        end_at: 1.0,
        embeds_scaling: 'V only',
        attn_mask: [finalMaskNodeId, 0], // mask processé (grow + blur si activés)
      },
    },

    // ── Conditioning text ──
    '40': buildClipTextEncode(positivePrompt, ['1', 1]),
    '41': buildClipTextEncode(negativePrompt, ['1', 1]),

    // ── ControlNetApplyAdvanced : impose la pose squelette ──
    '50': {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['40', 0],
        negative: ['41', 0],
        control_net: ['3', 0],
        image: ['20', 0],           // squelette OpenPose
        strength: controlnetStrength,
        start_percent: 0.0,
        end_percent: 1.0,
      },
    },

    // ── Inpaint : encode la scène en latent + applique le mask ──
    // Le KSampler ne modifiera QUE la zone masquée, le reste pixel-perfect préservé
    '60': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['10', 0], vae: ['1', 2] },
    },
    '61': {
      class_type: 'SetLatentNoiseMask',
      inputs: { samples: ['60', 0], mask: [finalMaskNodeId, 0] },
    },

    // ── KSampler ──
    // euler_ancestral + scheduler normal = combo qui a donné le bon résultat
    // observé sur le test elfe (identité préservée, pose assise correcte).
    // dpmpp + karras testé mais a dégradé le résultat sur ce cas.
    '70': {
      class_type: 'KSampler',
      inputs: {
        model: ['30', 0],           // MODEL avec IPAdapter (identité injectée)
        positive: ['50', 0],        // CONDITIONING avec ControlNet (pose imposée)
        negative: ['50', 1],
        latent_image: ['61', 0],    // latent inpaint avec mask
        seed,
        steps,
        cfg,
        sampler_name: 'euler_ancestral',
        scheduler: 'normal',
        denoise,
      },
    },

    // ── Decode + save ──
    '80': buildVAEDecode(['70', 0], ['1', 2]),
    '90': buildSaveImage(['80', 0], 'hero_controlnet_swap'),
  }
}

/** Workflow `face_detailer_only` : régénère uniquement le visage à haute résolution.
 *  À chaîner après `controlnet_character_swap` quand on veut un visage net.
 *  Charge SDXL + IPAdapter FaceID Plus v2 + InsightFace + YOLO + SAM (sans
 *  IPAdapter Plus body ni ControlNet → tient en 8 GB).
 *  Inputs requis :
 *    - source_image : l'image issue du body swap (file uploadé dans ComfyUI input)
 *    - reference_image : la ref du nouveau perso (pour IPAdapter FaceID)
 *    - prompt_positive / prompt_negative : guidance texte pour la régen
 *    - face_weight (0-2, default 1.0) : poids IPAdapter FaceID
 *    - face_denoise (0.3-0.8, default 0.5) : intensité régénération face */
export function buildFaceDetailerOnlyWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('face_detailer_only requires source_image (the swap result)')
  if (!params.reference_image) throw new Error('face_detailer_only requires reference_image (for IPAdapter FaceID)')

  const styleSuffix = STYLE_SUFFIXES[params.style ?? 'realistic'] ?? STYLE_SUFFIXES.realistic
  const positivePrompt = `${params.prompt_positive ?? ''} BREAK ${styleSuffix}`
  const negativePrompt = params.prompt_negative ?? DEFAULT_NEGATIVE_PROMPT
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const faceDenoise = Math.max(0.3, Math.min(0.8, params.face_denoise ?? 0.5))
  const faceWeight = Math.max(0, Math.min(2, params.face_weight ?? 1.0))

  return {
    '1': buildCheckpointNode(params.checkpoint),

    // ── IPAdapter FaceID Plus v2 chain ──
    '2': {
      class_type: 'IPAdapterUnifiedLoaderFaceID',
      inputs: { model: ['1', 0], preset: 'FACEID PLUS V2', lora_strength: 0.6, provider: 'CUDA' },
    },
    '3': {
      class_type: 'IPAdapterFaceID',
      inputs: {
        model: ['2', 0],
        ipadapter: ['2', 1],
        image: ['11', 0],
        weight: faceWeight,
        weight_faceidv2: faceWeight,
        weight_type: 'linear',
        combine_embeds: 'concat',
        start_at: 0.0,
        end_at: 1.0,
        embeds_scaling: 'V only',
      },
    },

    // ── Detectors ──
    // Note : SAM (sam_vit_h ~2.5 GB) supprimé — OOM sur 8 GB quand SDXL +
    // IPAdapter FaceID + InsightFace + CLIP Vision sont déjà chargés.
    // FaceDetailer fonctionne sans SAM : bbox YOLO directe → crop rectangulaire.
    // Sur un visage humain c'est suffisant (la bbox YOLO est déjà tight autour
    // de la tête). Le raffinement SAM n'apporte rien pour ce use case.
    '4': { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: 'bbox/face_yolov8m.pt' } },

    // ── Sources ──
    '10': { class_type: 'LoadImage', inputs: { image: params.source_image } },     // body swap result
    '11': { class_type: 'LoadImage', inputs: { image: params.reference_image! } }, // ref pour FaceID

    // ── Conditioning ──
    '20': buildClipTextEncode(positivePrompt, ['1', 1]),
    '21': buildClipTextEncode(negativePrompt, ['1', 1]),

    // ── FaceDetailer ──
    '30': {
      class_type: 'FaceDetailer',
      inputs: {
        image: ['10', 0],
        model: ['3', 0],          // model avec IPAdapter FaceID
        clip: ['1', 1],
        vae: ['1', 2],
        guide_size: 512,
        guide_size_for: true,
        max_size: 1024,
        seed,
        steps: 30,
        cfg: 7,
        sampler_name: 'euler_ancestral',
        scheduler: 'normal',
        positive: ['20', 0],
        negative: ['21', 0],
        denoise: faceDenoise,
        feather: 5,
        noise_mask: true,
        force_inpaint: true,
        bbox_threshold: 0.5,
        bbox_dilation: 10,
        bbox_crop_factor: 3.0,
        sam_detection_hint: 'center-1',
        sam_dilation: 0,
        sam_threshold: 0.93,
        sam_bbox_expansion: 0,
        sam_mask_hint_threshold: 0.7,
        sam_mask_hint_use_negative: 'False',
        drop_size: 10,
        bbox_detector: ['4', 0],
        wildcard: '',
        cycle: 1,
        // sam_model_opt non connecté — voir note plus haut sur l'OOM 8 GB
      },
    },
    '40': buildSaveImage(['30', 0], 'hero_face_detail'),
  }
}

// ── InstantID workflow (Tencent, 2026) — consistent character from face ref ──
//
// Génération SDXL avec identité PRÉSERVÉE depuis 1 image de visage de référence.
// Stack : SDXL checkpoint + InstantID model (ip-adapter.bin) + InstantID
// ControlNet (face landmarks) + InsightFace antelopev2 (embedding visage).
//
// Modèles requis :
//   - models/instantid/ip-adapter.bin (~1.6 GB)
//   - models/controlnet/instantid_controlnet.safetensors (~2.5 GB)
//   - models/insightface/models/antelopev2/*.onnx (~382 MB)
//
// Recommandations Cubiq (auteur du custom node) :
//   - Résolution PAS exactement 1024×1024 (watermark dans le training data) —
//     défaut 1016×1016, ou rectangle (768×1360 pour fullbody)
//   - CFG bas (4-5) pour éviter le "burn"
//   - Sampler ddpm + scheduler karras donnent les meilleurs résultats
//   - InstantID weight 0.7-0.8 (plus haut = burn ; plus bas = identité faible)
//
// Usage Hero : créer un perso (1 portrait T2I) puis générer toutes les vues
// suivantes (plein pied, scènes, etc.) avec InstantID + ce portrait en ref →
// identité préservée à travers toutes les générations.
export function buildInstantIdWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.reference_image) {
    throw new Error('instant_id requires reference_image (the face portrait)')
  }

  const styleSuffix = STYLE_SUFFIXES[params.style ?? 'realistic'] ?? STYLE_SUFFIXES.realistic
  const positivePrompt = `${params.prompt_positive ?? ''} BREAK ${styleSuffix}`
  const negativePrompt = params.prompt_negative ?? DEFAULT_NEGATIVE_PROMPT
  // 1016 par défaut (évite watermark 1024×1024 du training data)
  const width = params.width ?? 1016
  const height = params.height ?? 1016
  const steps = params.steps ?? 30
  const cfg = params.cfg ?? 4.5
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  const instantidWeight = params.instantid_weight ?? 0.8
  // cn_strength séparé du weight (Advanced node) — défaut = même valeur que
  // weight (back-compat avec l'ancien comportement). Pour FULLBODY, baisser
  // à 0.2-0.3 pour libérer la composition.
  const instantidCnStrength = params.instantid_cn_strength ?? instantidWeight
  const instantidStart = params.instantid_start ?? 0
  const instantidEnd = params.instantid_end ?? 1

  return {
    // ── SDXL checkpoint (Juggernaut par défaut) ──
    '1': buildCheckpointNode(params.checkpoint),

    // ── InstantID models ──
    '2': {
      class_type: 'InstantIDModelLoader',
      inputs: { instantid_file: 'ip-adapter.bin' },
    },
    '3': {
      class_type: 'InstantIDFaceAnalysis',
      // 'CUDA' tente d'utiliser GPU mais bascule sur CPU si pas dispo. CPU
      // est en pratique aussi rapide pour antelopev2 (petits modèles ONNX).
      inputs: { provider: 'CPU' },
    },
    '4': {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: 'instantid_controlnet.safetensors' },
    },

    // ── Reference image (le visage à préserver) ──
    '5': { class_type: 'LoadImage', inputs: { image: params.reference_image } },

    // ── Prompts (CLIP encode via le checkpoint) ──
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: positivePrompt },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: negativePrompt },
    },

    // ── Empty latent (résolution cible) ──
    '8': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },

    // ── Apply InstantID Advanced : sépare ip_weight (identité face) et
    // cn_strength (contrainte composition via ControlNet face landmarks).
    // Critique pour fullbody : baisser cn_strength libère la position du visage.
    '9': {
      class_type: 'ApplyInstantIDAdvanced',
      inputs: {
        instantid: ['2', 0],
        insightface: ['3', 0],
        control_net: ['4', 0],
        image: ['5', 0],
        model: ['1', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        ip_weight: instantidWeight,
        cn_strength: instantidCnStrength,
        start_at: instantidStart,
        end_at: instantidEnd,
        noise: 0,
        combine_embeds: 'average',
      },
    },

    // ── KSampler (ddpm + karras recommandés par Cubiq) ──
    '10': {
      class_type: 'KSampler',
      inputs: {
        model: ['9', 0],
        positive: ['9', 1],
        negative: ['9', 2],
        latent_image: ['8', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'ddpm',
        scheduler: 'karras',
        denoise: 1,
      },
    },

    // ── Decode + Save ──
    '11': {
      class_type: 'VAEDecode',
      inputs: { samples: ['10', 0], vae: ['1', 2] },
    },
    '12': buildSaveImage(['11', 0], 'hero_instant_id'),
  }
}

// ── Z-Image Turbo (Alibaba/Tongyi, 2026) — 6B distilled T2I, 8 steps ──────
//
// Distilled turbo model qui tient confortable sur 8 GB VRAM (NVFP4 ~4.5 GB).
// Excellent instruction-following (mieux que Flux.2 Dev sur tests indé).
// Anime + réaliste dans un seul backbone, contrôlé par le prompt
// (`anime style, ...` vs `photorealistic, ...`).
//
// Modèles requis :
//   - models/diffusion_models/z_image_turbo_nvfp4.safetensors (~4.5 GB, NVFP4 — Blackwell only)
//     OU z_image_turbo_bf16.safetensors (~12.3 GB, fp16 — fallback lowvram)
//   - models/text_encoders/qwen_3_4b_fp8_mixed.safetensors (~5.6 GB) — text encoder
//   - models/vae/ae.safetensors (~340 MB, Flux 1 VAE) — déjà installé
//
// Notes critiques (sources : doc officielle ComfyUI, Comfy-Org workflow_templates) :
//   - CLIPLoader type = 'lumina2' (pas 'qwen_image' ni 'qwen3' — Z-Image
//     réutilise le pipeline d'encodage texte de Lumina 2)
//   - Latent : EmptySD3LatentImage (16 channels, comme Flux/SD3)
//   - ModelSamplingAuraFlow shift=3 OBLIGATOIRE (sinon qualité dégradée)
//   - Sampler : res_multistep + scheduler simple (récents — git pull si absent)
//   - CFG = 1.0 strict (modèle distillé, pas de classifier-free guidance)
//   - 8 steps (parfois 9)
export function buildZImageWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  const positivePrompt = params.prompt_positive ?? ''
  // Z-Image turbo distillé : pas de prompt négatif efficace (CFG=1).
  // On garde la possibilité d'en passer un, mais il aura peu d'effet.
  const negativePrompt = params.prompt_negative ?? ''
  const width = params.width ?? 1024
  const height = params.height ?? 1024
  const steps = params.steps ?? 8
  const cfg = params.cfg ?? 1.0
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  // Choix du fichier diffusion : NVFP4 par défaut (Blackwell RTX 50, 4.5 GB).
  // Pour fallback lowvram sur GPU non-Blackwell, utiliser z_image_turbo_bf16.safetensors.
  const diffusionFile = params.checkpoint ?? 'z_image_turbo_nvfp4.safetensors'

  return {
    // ── Diffusion model ──
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: diffusionFile, weight_dtype: 'default' },
    },

    // ── ModelSamplingAuraFlow (shift=3 obligatoire) ──
    '2': {
      class_type: 'ModelSamplingAuraFlow',
      inputs: { model: ['1', 0], shift: 3 },
    },

    // ── Text encoder Qwen 3 4B (via CLIPLoader type 'lumina2') ──
    '3': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: 'qwen_3_4b_fp8_mixed.safetensors',
        type: 'lumina2',
        device: 'default',
      },
    },

    // ── Prompts ──
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['3', 0], text: positivePrompt },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['3', 0], text: negativePrompt },
    },

    // ── Empty latent (16 channels SD3-style) ──
    '6': {
      class_type: 'EmptySD3LatentImage',
      inputs: { width, height, batch_size: 1 },
    },

    // ── KSampler avec res_multistep + simple scheduler ──
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'res_multistep',
        scheduler: 'simple',
        denoise: 1,
      },
    },

    // ── VAE Flux 1 ──
    '8': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'ae.safetensors' },
    },

    // ── Decode + Save ──
    '9': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['8', 0] },
    },
    '10': buildSaveImage(['9', 0], 'hero_z_image'),
  }
}

// ── Flux.1 Dev T2I (BFL, 2024) — pure text-to-image avec excellente variance ──
//
// Modèle non-distillé (vraie variance entre seeds, à l'inverse de Z-Image
// Turbo qui produit des faces très similaires). Plus lent (20-30 steps) mais
// rendu plus diversifié et plus "premium".
//
// Modèles requis :
//   - models/unet/flux1-dev-Q5_K_S.gguf (~8 GB, GGUF Q5_K_S — meilleur compromis 8 GB)
//   - models/text_encoders/t5xxl_fp16.safetensors (~9 GB) — déjà installé
//   - models/clip/clip_l.safetensors (~250 MB) — déjà installé
//   - models/vae/ae.safetensors (~340 MB, Flux 1 VAE) — déjà installé
//
// Custom node requis : ComfyUI-GGUF (city96, déjà installé pour Flux Fill/Kontext).
//
// VRAM 8 GB : passe avec ComfyUI Sysmem Fallback ON (Q5_K_S 8 GB + activations
// + encoders en RAM CPU). Vitesse attendue : 60-90s/portrait.
//
// Paramètres officiels BFL pour Flux Dev T2I :
//   - guidance Flux : 3.5 (vs 30 pour Fill, 2.5 pour Kontext)
//   - sampler : euler / scheduler : simple
//   - cfg KSampler : 1.0 (Flux ignore le CFG sampler, la vraie force est dans FluxGuidance)
//   - steps : 20-30 (20 = qualité acceptable, 30 = officiel)
//   - resolution : 1024×1024 ou autre, multiple de 64
export function buildFluxDevWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  const positivePrompt = params.prompt_positive ?? ''
  // Flux Dev ne fait quasiment pas usage du negative (CFG=1 sampler).
  // On garde la possibilité de le passer mais il aura peu d'effet.
  const negativePrompt = params.prompt_negative ?? ''
  const width = params.width ?? 1024
  const height = params.height ?? 1024
  const steps = params.steps ?? 25
  // params.cfg → utilisé comme guidance Flux (≠ CFG sampler qui reste 1.0).
  const fluxGuidance = params.cfg ?? 3.5
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed
  // Filename overridable (pour switch Q5_K_S → Q4_K_S si besoin).
  const unetFile = params.checkpoint ?? 'flux1-dev-Q5_K_S.gguf'

  return {
    // ── Models ──
    '1': {
      class_type: 'UnetLoaderGGUF',
      inputs: { unet_name: unetFile },
    },
    '2': {
      class_type: 'DualCLIPLoaderGGUF',
      inputs: {
        clip_name1: 't5xxl_fp16.safetensors',
        clip_name2: 'clip_l.safetensors',
        type: 'flux',
      },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'ae.safetensors' },
    },

    // ── Conditioning ──
    '10': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['2', 0], text: positivePrompt },
    },
    '11': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['2', 0], text: negativePrompt },
    },
    // FluxGuidance : applique la "guidance" Flux sur le positif
    '12': {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['10', 0], guidance: fluxGuidance },
    },

    // ── Empty latent (16 channels Flux/SD3) ──
    '20': {
      class_type: 'EmptySD3LatentImage',
      inputs: { width, height, batch_size: 1 },
    },

    // ── Sampling ──
    '30': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['12', 0],
        negative: ['11', 0],
        latent_image: ['20', 0],
        seed,
        steps,
        // CFG sampler = 1.0 pour Flux. La vraie "force" est dans FluxGuidance.
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },

    // ── Decode + Save ──
    '40': buildVAEDecode(['30', 0], ['3', 0]),
    '50': buildSaveImage(['40', 0], 'hero_flux_dev'),
  }
}

// ── LTX 2.3 + IC LoRA Dual Characters (Lightricks 2026 + MaqueAI) ─────────
//
// POC dialogue cinématique multi-perso. Stack ultra-lourde sur 8 GB :
//   - models/diffusion_models/ltx-2.3-22b-distilled-1.1-Q4_K_M.gguf (14 GB)
//   - models/loras/ltxv/ltx2/ltx-2.3-22b-distilled-lora-384-1.1.safetensors (7.6 GB)
//   - models/loras/LTX2.3-IC-LORA-Dual-Character.safetensors (312 MB) ← Civitai MaqueAI
//   - models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors (9.45 GB)
//   - models/vae/ltx-2.3-22b-distilled_video_vae.safetensors (1.45 GB)
//
// NÉCESSITE start_comfyui_lowvram.bat + sysmem fallback ON.
//
// ⚠ JSON template à embarquer. Le workflow officiel `LTX-2.3_ICLoRA_Motion_Track_Distilled.json`
// (du custom node ComfyUI-LTXVideo) fait 3000+ lignes en GUI format → impossible
// à transcrire à la main en TS. Pipeline temporaire :
//   1. User exporte API format depuis ComfyUI (Settings → Dev Mode → "Save (API Format)")
//      après avoir configuré modèles + IC LoRA Dual + image source dans le wf
//   2. JSON exporté → bake dans `src/lib/workflows/ltx_2_3_dual.api.json`
//   3. Ce builder load le template + substitue les valeurs (image, prompts, seed)
//
// Pour l'instant : retourne une erreur explicite tant que le JSON template
// n'est pas embarqué.
export function buildLtx23DualWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('ltx_2_3_dual requires source_image')
  if (!params.prompt_positive) throw new Error('ltx_2_3_dual requires prompt_positive')

  // Tentative de load du template JSON (à venir une fois exporté)
  let template: Record<string, unknown>
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    template = require('./workflows/ltx_2_3_dual.api.json') as Record<string, unknown>
  } catch {
    throw new Error(
      '[ltx_2_3_dual] Workflow JSON template manquant. ' +
      'Action requise : exporter le workflow depuis ComfyUI en API Format ' +
      'puis le placer dans src/lib/workflows/ltx_2_3_dual.api.json. ' +
      'Voir page POC `/editor-test/ltx-dual-characters` pour les instructions.'
    )
  }

  // Deep clone pour éviter de muter le template entre les requêtes
  const wf = JSON.parse(JSON.stringify(template)) as Record<string, Record<string, unknown>>

  // Substitution des valeurs paramétriques
  // On parcourt les nodes pour trouver ceux à patcher selon leur class_type
  for (const [_nodeId, node] of Object.entries(wf)) {
    const classType = node.class_type as string | undefined
    const inputs = node.inputs as Record<string, unknown> | undefined
    if (!classType || !inputs) continue

    // LoadImage → image source
    if (classType === 'LoadImage' && 'image' in inputs) {
      inputs.image = params.source_image
    }

    // CLIPTextEncode positif vs négatif : heuristique simple = on met le
    // positif partout (comme la plupart des wf n'ont qu'un seul prompt
    // utilisateur). Pour distinguer pos/neg, le user devra m'indiquer
    // les node IDs dans le JSON exporté → je l'ajusterai en hardcode.
    // TODO : identifier les 2 nodes CLIPTextEncode et les patcher différemment
    // une fois qu'on aura le JSON exporté.
    if (classType === 'CLIPTextEncode' && 'text' in inputs) {
      // Stratégie temporaire : on détecte par l'ancien texte du widget
      const currentText = inputs.text as string
      if (currentText && currentText.toLowerCase().includes('ugly')) {
        // Probablement le négatif (contient des mots négatifs)
        inputs.text = params.prompt_negative ?? currentText
      } else {
        // Probablement le positif
        inputs.text = params.prompt_positive
      }
    }

    // KSampler / random seed → on injecte un seed aléatoire si demandé
    if (classType.includes('Sampler') && 'seed' in inputs) {
      const seed = params.seed === -1 || params.seed == null
        ? Math.floor(Math.random() * 2 ** 32)
        : params.seed
      inputs.seed = seed
    }
  }

  return wf
}


