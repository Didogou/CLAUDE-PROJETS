/**
 * Workflow Cinemagraph — port du tutoriel ltdrdata (ComfyUI-Impact-Pack +
 * ComfyUI-Inspire-Pack).
 *
 * Principe : crée un "cinemagraph" (image vivante) où seule la zone masquée
 * s'anime, le reste reste pixel-parfait. Contrairement à notre motion_brush
 * qui utilise ImageCompositeMasked en fin de workflow (peut dériver sur les
 * bords), cette approche utilise **SEGSDetailerForAnimateDiff** qui redessine
 * UNIQUEMENT la zone des SEGS sur les N frames, puis colle via `SEGSPaste`
 * avec feather doux → transition motion/static invisible.
 *
 * Flow :
 *   1. Checkpoint loader + CLIP encode pos/neg
 *   2. AnimateDiff loader wrappe le MODEL
 *   3. ToBasicPipe → BASIC_PIPE (model, clip, vae, pos, neg)
 *   4. ChangeImageBatchSize (Inspire) → image unique → N frames batchées
 *   5. MaskToSEGS_for_AnimateDiff (Impact) → mask → SEGS avec crop_factor
 *   6. SEGSDetailerForAnimateDiff (Impact) → redraws les SEGS sur N frames
 *      via AnimateDiff avec noise_mask_feather pour bords doux
 *   7. SEGSPaste (Impact) → colle les SEGS modifiés sur le batch original
 *   8. VHS_VideoCombine pingpong=true → MP4 loop seamless
 *
 * Packs requis (doivent être installés dans ComfyUI/custom_nodes/) :
 *   - ComfyUI-Impact-Pack (ltdrdata)
 *   - ComfyUI-Inspire-Pack (ltdrdata)
 *   - ComfyUI-AnimateDiff-Evolved (Kosinkadink) — déjà utilisé par motion_brush
 *   - ComfyUI-VideoHelperSuite — déjà utilisé
 */

import type { ComfyUIGenerateParams } from './comfyui'

/**
 * Checkpoint SD 1.5 par défaut pour cinemagraph (requis par `mm_sd_v14.ckpt`).
 * Le checkpoint envoyé par le client (Juggernaut XL par défaut) serait
 * incompatible → on force Realistic Vision V6.0 fp16.
 *
 * À télécharger une fois dans ComfyUI/models/checkpoints/ :
 *   https://huggingface.co/SG161222/Realistic_Vision_V6.0_B1_noVAE/resolve/main/Realistic_Vision_V6.0_NV_B1_fp16.safetensors
 */
const SD15_DEFAULT_CHECKPOINT = 'Realistic_Vision_V6.0_NV_B1_fp16.safetensors'

export function buildCinemagraphWorkflow(params: ComfyUIGenerateParams): Record<string, unknown> {
  if (!params.source_image) throw new Error('cinemagraph requires source_image')
  if (!params.mask_image) throw new Error('cinemagraph requires mask_image (PNG noir/blanc déjà uploadé)')

  const positivePrompt = params.prompt_positive || 'gentle natural motion in the marked area'
  const negativePrompt = params.prompt_negative ?? 'static, frozen, distorted, morphing, blurry'
  const frames = params.frames ?? 16
  const denoise = params.denoise ?? 0.5
  const steps = params.steps ?? 20
  const cfg = params.cfg ?? 7
  // SEGSDetailerForAnimateDiff exige seed >= 0 (pas de convention -1 = random
  // comme KSampler standard). On convertit -1 / undefined en random explicite.
  const seed = (params.seed === undefined || params.seed < 0)
    ? Math.floor(Math.random() * 1e15)
    : params.seed

  // Force SD 1.5 checkpoint car `mm_sd_v14.ckpt` n'est pas compatible SDXL.
  // Le checkpoint envoyé par le client est ignoré pour cinemagraph.
  const checkpoint = SD15_DEFAULT_CHECKPOINT

  return {
    // ── 1. Checkpoint + CLIP encode ─────────────────────────────────────
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positivePrompt, clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['1', 1] },
    },

    // ── 2. AnimateDiff sur le MODEL (SD 1.5 + v14) ─────────────────────
    // Port fidèle du tuto ltdrdata : `mm_sd_v14.ckpt` (motion module SD 1.5,
    // tuning communauté mature, moins de color shift que SDXL beta) avec
    // `sqrt_linear (AnimateDiff)` beta_schedule spécifique v14.
    '4': {
      class_type: 'ADE_AnimateDiffLoaderGen1',
      inputs: {
        model: ['1', 0],
        model_name: 'mm_sd_v14.ckpt',
        beta_schedule: 'sqrt_linear (AnimateDiff)',
      },
    },

    // ── 3. Bundle basic_pipe pour le detailer ───────────────────────────
    '5': {
      class_type: 'ToBasicPipe',
      inputs: {
        model: ['4', 0],     // model avec AnimateDiff appliqué
        clip: ['1', 1],
        vae: ['1', 2],
        positive: ['2', 0],
        negative: ['3', 0],
      },
    },

    // ── 4. Source image → batch de N frames répétées ────────────────────
    '6': {
      class_type: 'LoadImage',
      inputs: { image: params.source_image },
    },
    // Note : Inspire Pack utilise un suffix "//Inspire" dans NODE_CLASS_MAPPINGS
    // pour éviter les collisions avec d'autres packs — le class_type exact est
    // "ChangeImageBatchSize //Inspire" (voir inspire/image_util.py:493).
    '7': {
      class_type: 'ChangeImageBatchSize //Inspire',
      inputs: { image: ['6', 0], batch_size: frames, mode: 'simple' },
    },

    // ── 5. Mask → SEGS pour AnimateDiff ─────────────────────────────────
    '8': {
      class_type: 'LoadImage',
      inputs: { image: params.mask_image },
    },
    '9': {
      class_type: 'ImageToMask',
      inputs: { image: ['8', 0], channel: 'red' },
    },
    '10': {
      class_type: 'MaskToSEGS_for_AnimateDiff',
      inputs: {
        mask: ['9', 0],
        combined: false,
        crop_factor: 3.0,    // zoom ×3 sur la zone pour traitement HD local
        bbox_fill: false,
        drop_size: 10,
        contour_fill: false,
      },
    },

    // ── 6. Detailer : redraw les SEGS sur les N frames avec AnimateDiff ─
    '11': {
      class_type: 'SEGSDetailerForAnimateDiff',
      inputs: {
        image_frames: ['7', 0],
        segs: ['10', 0],
        guide_size: 512,
        guide_size_for: true,    // bbox-based
        max_size: 768,
        seed,
        steps,
        cfg,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise,
        basic_pipe: ['5', 0],
        // refiner_ratio = 0 : on n'a pas de refiner_basic_pipe connecté, donc
        // laisser > 0 est silently ignoré (Impact-Pack) → à 0 pour éviter
        // toute confusion / warning log côté ComfyUI.
        refiner_ratio: 0,
        noise_mask_feather: 20,  // feather du mask → transition motion/static fluide
      },
    },

    // ── 7. Paste : colle les SEGS modifiés sur les N frames originales ──
    '12': {
      class_type: 'SEGSPaste',
      inputs: {
        image: ['7', 0],         // les N frames originales (batch)
        segs: ['11', 0],         // les SEGS modifiés par le detailer
        feather: 5,              // feather du paste (bord doux)
        alpha: 255,
      },
    },

    // ── 8. Export MP4 avec pingpong loop seamless ───────────────────────
    '13': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['12', 0],
        frame_rate: params.fps ?? 8,
        loop_count: 0,
        filename_prefix: 'hero_cinemagraph',
        format: 'video/h264-mp4',
        pingpong: true,            // joue avant → arrière → loop sans cut visible
        save_output: true,
        pix_fmt: 'yuv420p',
        crf: 19,
      },
    },
  }
}
