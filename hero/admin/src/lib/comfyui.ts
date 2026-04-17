/**
 * ComfyUI API client — communicates with the local ComfyUI server.
 *
 * Endpoints used:
 *   POST /api/prompt         → queue a workflow
 *   GET  /api/history/{id}   → poll for results
 *   GET  /api/view?...       → fetch generated image
 *   POST /api/upload/image   → upload an image to ComfyUI input folder
 */

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

export type WorkflowType = 'portrait' | 'scene_composition' | 'transition' | 'background' | 'animate' | 'wan_animate' | 'liveportrait'

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
    workflow['5'] = {
      class_type: 'DepthAnythingV2Preprocessor',
      inputs: {
        image: ['4', 0],
        ckpt_name: 'depth_anything_v2_vitl.safetensors',
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

export function buildWanAnimateWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('wan_animate requires source_image')

  const positivePrompt = params.prompt_positive || 'gentle ambient motion, subtle wind, flickering light'
  const negativePrompt = params.prompt_negative ?? 'static, blurred, worst quality, low quality, subtitles'
  const frames = params.frames ?? 21
  const steps = params.steps ?? 30
  const cfg = params.cfg ?? 5
  const seed = params.seed === -1 || params.seed == null ? Math.floor(Math.random() * 2 ** 32) : params.seed

  return {
    // Text encoder (T5)
    '11': {
      class_type: 'LoadWanVideoT5TextEncoder',
      inputs: {
        model_name: 'umt5-xxl-enc-fp8_e4m3fn.safetensors',
        precision: 'bf16',
        load_device: 'offload_device',
        compile: 'disabled',
      },
    },
    // CLIP Vision
    '48': {
      class_type: 'CLIPVisionLoader',
      inputs: {
        clip_name: 'open-clip-xlm-roberta-large-vit-huge-14_visual_fp16.safetensors',
      },
    },
    // Text encode
    '16': {
      class_type: 'WanVideoTextEncode',
      inputs: {
        positive_prompt: positivePrompt,
        negative_prompt: negativePrompt,
        force_offload: true,
        t5: ['11', 0],
      },
    },
    // Model loader — fp8_scaled model uses bf16 base + fp8_e4m3fn_scaled quantization
    '22': {
      class_type: 'WanVideoModelLoader',
      inputs: {
        model: 'Wan2_2-TI2V-5B_fp8_e4m3fn_scaled_KJ.safetensors',
        base_precision: 'bf16',
        quantization: 'fp8_e4m3fn_scaled',
        load_device: 'offload_device',
      },
    },
    // VAE — uses model_name (not vae)
    '38': {
      class_type: 'WanVideoVAELoader',
      inputs: {
        model_name: 'Wan2_2_VAE_bf16.safetensors',
        precision: 'bf16',
      },
    },
    // Load source image
    '58': {
      class_type: 'LoadImage',
      inputs: { image: params.source_image },
    },
    // CLIP Vision encode the source image
    '61': {
      class_type: 'WanVideoClipVisionEncode',
      inputs: {
        clip_vision: ['48', 0],
        image_1: ['58', 0],
        strength_1: 1.0,
        strength_2: 1.0,
        crop: 'center',
        combine_embeds: 'average',
        force_offload: true,
      },
    },
    // Encode image for I2V
    '70': {
      class_type: 'WanVideoImageToVideoEncode',
      inputs: {
        width: params.width ?? 512,
        height: params.height ?? 288,
        num_frames: frames,
        noise_aug_strength: 0.0,
        start_latent_strength: 1.0,
        end_latent_strength: 1.0,
        force_offload: true,
        vae: ['38', 0],
        clip_embeds: ['61', 0],
        start_image: ['58', 0],
      },
    },
    // Sampler
    '27': {
      class_type: 'WanVideoSampler',
      inputs: {
        model: ['22', 0],
        image_embeds: ['70', 0],
        steps,
        cfg,
        shift: 5.0,
        seed,
        force_offload: true,
        scheduler: 'unipc',
        riflex_freq_index: 0,
        text_embeds: ['16', 0],
        denoise_strength: params.denoise ?? 1.0,
      },
    },
    // Decode
    '28': {
      class_type: 'WanVideoDecode',
      inputs: {
        vae: ['38', 0],
        samples: ['27', 0],
        enable_vae_tiling: true,
        tile_x: 272,
        tile_y: 272,
        tile_stride_x: 144,
        tile_stride_y: 128,
      },
    },
    // Export video
    '92': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['28', 0],
        frame_rate: params.fps ?? 8,
        loop_count: 0,
        filename_prefix: 'hero_wan_animate',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
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
    case 'liveportrait':
      return buildLivePortraitWorkflow(params)
  }
}
