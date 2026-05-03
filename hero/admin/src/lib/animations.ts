/**
 * Modèle unifié des animations d'un plan.
 * Remplace les anciens champs `cs.derivations` / `cs.qwen_travelling_urls` /
 * `cs.animation_url` par une liste ordonnée `cs.animations: AnimationInstance[]`.
 */

export type AnimationKind =
  | 'derivation'
  | 'travelling'
  | 'video_wan'
  | 'wan_camera'      // Wan 2.2 Fun Camera Control : vrai travelling caméra prompted
  | 'latent_sync'     // LatentSync : lip sync sur image/vidéo + audio
  | 'motion_brush'    // AnimateDiff Motion Brush : animer une zone précise via mask
  | 'extra_image'     // Image supplémentaire : reprend params de l'image principale + référence/perso optionnels
  | 'tooncrafter'     // ToonCrafter : interpolation cartoon/anime entre 2 keyframes

export type AnimationSource =
  | { mode: 'main' }
  | { mode: 'prev'; anim_id: string }
  | { mode: 'upload'; url: string }

// ── Params spécifiques par kind ────────────────────────────────────────────

export interface DerivationParams {
  count?: number      // default 20
  denoise?: number    // default 0.4
  steps?: number      // default 35
  cfg?: number        // default 7
}

export interface TravellingParams {
  start_angle?: number    // default -15
  end_angle?: number      // default 15
  vertical_angle?: number // default 0
  zoom?: number           // default 5
  frame_count?: number    // default 30
  prompt_template?: string // override (utilise {angle})
  negative_prompt?: string
}

export interface VideoWanParams {
  prompt_positive?: string
  prompt_negative?: string
  steps?: number   // default 30
  cfg?: number     // default 7
  fps?: number     // default 12
  frames?: number  // default 17
  denoise?: number // default 0.7
}

// ── Wan 2.2 Fun Camera Control ─────────────────────────────────────────────
export type WanCameraMotion =
  | 'static' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down'
  | 'zoom_in' | 'zoom_out' | 'orbit_left' | 'orbit_right'
  | 'dolly_in' | 'dolly_out' | 'tilt_up' | 'tilt_down'
export interface WanCameraParams {
  motion?: WanCameraMotion         // default 'pan_left'
  intensity?: number               // 0..1, default 0.5
  prompt_positive?: string
  prompt_negative?: string
  frames?: number                  // default 25
  fps?: number                     // default 12
  steps?: number                   // default 30
  cfg?: number                     // default 7
}

// ── LatentSync (lip sync) ──────────────────────────────────────────────────
export interface LatentSyncParams {
  audio_url?: string               // URL audio TTS ou upload
  inference_steps?: number         // default 20
  guidance_scale?: number          // default 1.5
  seed?: number                    // -1 = random
}

// ── Motion Brush (AnimateDiff sur zone) ─────────────────────────────────────
export type MotionBrushDirection = 'up' | 'down' | 'left' | 'right' | 'rotate_cw' | 'rotate_ccw' | 'zoom_in' | 'zoom_out'
export interface MotionBrushParams {
  /** URL du masque (PNG noir/blanc) — la zone blanche est animée */
  mask_url?: string
  direction?: MotionBrushDirection   // default 'left'
  intensity?: number                  // 0..1, default 0.4
  prompt_positive?: string            // ex: "wind blowing", "torch flickering"
  prompt_negative?: string
  frames?: number                     // default 16
  fps?: number                        // default 8
  steps?: number                      // default 25
  cfg?: number                        // default 7
}

// ── ToonCrafter (interpolation cartoon/anime entre 2 keyframes) ────────────
export interface ToonCrafterParams {
  /** Image de fin (URL Supabase) — la 1ère vient de la source standard */
  end_image_url?: string
  prompt?: string                 // ex: "smooth animation, anime style"
  frame_count?: number            // 5-30, default 10
  fps?: number                    // 1-60, default 8
  steps?: number                  // 1-60, default 30 (50 par défaut côté node — réduit pour vitesse)
  cfg_scale?: number              // 1-15, default 7.5
  eta?: number                    // 0-15, default 1.0
  seed?: number                   // -1 = random
  vram_opt?: 'none' | 'low'       // 'low' obligatoire pour 8 Go VRAM
}

// ── Extra Image (génération d'une image supplémentaire avec ref ou perso) ──
export interface ExtraImageParams {
  /** Override du prompt (par défaut = prompt_en de l'image principale du plan) */
  prompt_override?: string
  /** Negative override (par défaut = negative de l'image principale) */
  negative_override?: string
  /** URL image de référence optionnelle (IPAdapter Plus) */
  reference_url?: string
  /** Poids de l'image de référence (0-1) */
  reference_weight?: number
  /** NPC à inclure via IPAdapter FaceID (id) */
  npc_id?: string
  /** Position du perso sur la scène */
  npc_mask?: 'left' | 'right' | 'center_third' | 'left_third' | 'right_third' | 'full'
  /** Poids du perso IPAdapter */
  npc_weight?: number
  /** Hérite du style de l'image principale si undefined */
  style_override?: string
}

export type AnimationParams =
  | DerivationParams
  | TravellingParams
  | VideoWanParams
  | WanCameraParams
  | LatentSyncParams
  | MotionBrushParams
  | ExtraImageParams
  | ToonCrafterParams

export interface AnimationOutput {
  /** Pour séquences (derivation/travelling) — joué frame-by-frame */
  urls?: string[]
  /** Pour vidéo Wan (URL Supabase persistante) */
  url?: string
  /** Snapshot de la dernière frame, utilisable comme source par une animation suivante */
  last_frame_url?: string
  generated_at?: number
}

export interface AnimationInstance {
  id: string
  name: string
  kind: AnimationKind
  source: AnimationSource
  params: AnimationParams
  output?: AnimationOutput
  status?: 'idle' | 'generating' | 'done' | 'error'
  status_progress?: string
  error?: string
  created_at: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function newAnimationId(): string {
  return `anim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function defaultAnimationName(kind: AnimationKind, idx: number): string {
  const label =
    kind === 'derivation' ? 'Dérivation' :
    kind === 'travelling' ? 'Travelling' :
    kind === 'video_wan' ? 'Vidéo Wan' :
    kind === 'wan_camera' ? 'Caméra Wan' :
    kind === 'latent_sync' ? 'Lip sync' :
    kind === 'motion_brush' ? 'Motion Brush' :
    kind === 'extra_image' ? 'Image variante' :
    'ToonCrafter'
  return `Animation ${idx} (${label})`
}

export function defaultParamsForKind(kind: AnimationKind): AnimationParams {
  switch (kind) {
    case 'derivation':
      return { count: 20, denoise: 0.4, steps: 35, cfg: 7 }
    case 'travelling':
      return { start_angle: -15, end_angle: 15, vertical_angle: 0, zoom: 5, frame_count: 30 }
    case 'video_wan':
      return {
        prompt_positive: 'subtle ambient motion, gentle wind',
        prompt_negative: 'static, blurred, worst quality, color bleeding, glitch, artifacts',
        steps: 30, cfg: 7, fps: 12, frames: 17, denoise: 0.7,
      }
    case 'wan_camera':
      return {
        motion: 'pan_left', intensity: 0.5,
        prompt_positive: 'cinematic camera movement, characters static',
        prompt_negative: 'static, blurred, character moving',
        frames: 25, fps: 12, steps: 30, cfg: 7,
      }
    case 'latent_sync':
      return { inference_steps: 20, guidance_scale: 1.5, seed: -1 }
    case 'motion_brush':
      return {
        direction: 'left', intensity: 0.6,
        prompt_positive: 'gentle motion in the marked area',
        prompt_negative: 'static, full scene change, frozen, identical, no motion',
        frames: 16, fps: 8, steps: 25, cfg: 7,
      }
    case 'extra_image':
      return { reference_weight: 0.7, npc_weight: 0.8, npc_mask: 'full' }
    case 'tooncrafter':
      return {
        prompt: 'smooth animation, anime style, fluid motion',
        frame_count: 10, fps: 8, steps: 30, cfg_scale: 7.5, eta: 1.0,
        seed: -1, vram_opt: 'low',
      }
  }
}

/**
 * Résout l'URL de l'image source à utiliser pour la génération.
 * - mode 'main' → URL de l'image principale du plan
 * - mode 'upload' → URL fournie
 * - mode 'prev' → cherche l'animation référencée et retourne sa dernière image
 */
export function resolveAnimationSourceUrl(
  source: AnimationSource,
  mainImageUrl: string | undefined,
  animations: AnimationInstance[],
): string | undefined {
  if (source.mode === 'main') return mainImageUrl
  if (source.mode === 'upload') return source.url
  // mode 'prev' : on cherche la dernière image de l'animation référencée
  const prev = animations.find(a => a.id === source.anim_id)
  if (!prev?.output) return undefined
  if (prev.output.last_frame_url) return prev.output.last_frame_url
  if (prev.output.urls && prev.output.urls.length > 0) {
    return prev.output.urls[prev.output.urls.length - 1]
  }
  // Pour vidéo sans snapshot last_frame_url → undefined (l'utilisateur doit générer le snapshot)
  return undefined
}

/** Renvoie l'URL principale d'affichage d'une animation (pour palette/preview). */
export function previewUrlOfAnimation(anim: AnimationInstance): string | undefined {
  if (!anim.output) return undefined
  if (anim.output.urls && anim.output.urls.length > 0) return anim.output.urls[0]
  if (anim.output.url) return anim.output.url
  return undefined
}

/** Pour la timeline : durée par défaut quand on drag une animation sur la timeline. */
export function defaultDurationMsForAnimation(anim: AnimationInstance): number {
  if (anim.kind === 'video_wan' || anim.kind === 'wan_camera' || anim.kind === 'motion_brush' || anim.kind === 'latent_sync' || anim.kind === 'tooncrafter') {
    const p = anim.params as VideoWanParams | WanCameraParams | MotionBrushParams | LatentSyncParams | ToonCrafterParams
    const frames = (p as any).frames ?? (p as any).frame_count ?? 17
    const fps = (p as any).fps ?? 12
    return Math.max(500, Math.round((frames / fps) * 1000))
  }
  if (anim.kind === 'derivation') {
    const n = anim.output?.urls?.length ?? (anim.params as DerivationParams).count ?? 20
    return Math.max(500, n * 150)
  }
  if (anim.kind === 'travelling') {
    const n = anim.output?.urls?.length ?? (anim.params as TravellingParams).frame_count ?? 30
    return Math.max(500, n * 100)
  }
  if (anim.kind === 'extra_image') return 3000 // image fixe 3s
  return 3000
}
