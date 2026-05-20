/**
 * Types TS pour les calques runtime de pellicules (migration 088).
 *
 * Phase A du chantier "Activer Option C+ runtime + Keyframes" (2026-05-18).
 * Un calque = un overlay (image/video/gif) posé au-dessus d'une pellicule au
 * runtime. Lié à 1 row section_timeline via pellicule_id.
 *
 * Le schéma DB autorise un type extensible (`text NOT NULL`), donc on est
 * libre d'ajouter weather/composition/animation en Phase B/D sans migration.
 */

/** Types de calques V1 (Phase A). Extensible côté DB. */
export type PelliculeLayerType = 'image' | 'video' | 'gif'

/** Modes de fusion CSS (mix-blend-mode). Subset utile pour gamebook. */
export type LayerBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'soft-light'
  | 'hard-light'
  | 'difference'

/** Mask clip-path (Phase A — rect + polygon).
 *  Points en % du canvas pellicule. Rect = 4 points TL/TR/BR/BL. */
export interface PelliculeLayerMask {
  shape: 'rect' | 'polygon'
  points: Array<[number, number]>
}

/** Effets visuels CSS (Phase A — glow, shadow, blur).
 *  Tous optionnels. Appliqués via CSS filter au runtime. */
export interface PelliculeLayerEffects {
  /** Halo lumineux autour de la silhouette (suit l'alpha via drop-shadow). */
  glow?: {
    color: string       // ex: '#ffffff'
    intensity: number   // 0 → 1 (alpha du halo)
    spread: number      // rem — rayon de diffusion
  }
  /** Ombre portée derrière (drop-shadow décalée). */
  shadow?: {
    color: string
    intensity: number   // 0 → 1
    offsetX: number     // rem
    offsetY: number     // rem
    blur: number        // rem
  }
  /** Flou global du calque (filter: blur). */
  blur?: {
    amount: number      // rem — 0 = pas de blur
  }
}

/** Row pellicule_layers en DB (snake_case côté SQL, mappé tel quel côté TS). */
export interface PelliculeLayerRow {
  id: string
  pellicule_id: string
  type: PelliculeLayerType

  media_url: string | null

  // Transform
  position_x: number       // % canvas (0-100), 50 = centre
  position_y: number       // % canvas (0-100), 50 = centre
  scale: number            // > 0, 1.0 = taille naturelle
  rotation: number         // degrés, -180 → 180
  opacity: number          // 0 → 1
  blend: LayerBlendMode
  z_index: number          // ordre stacking (plus haut = au-dessus)
  visible: boolean

  // Phase A bis 2026-05-18 — timing in/out RELATIF au début de la pellicule parente.
  // Permet d'animer l'entrée/sortie d'un calque dans le temps.
  start_ms_rel: number     // >= 0, default 0 (= visible dès début pellicule)
  duration_ms: number | null  // null = visible jusqu'à la fin pellicule parente

  // Mask + effets (JSONB, parsés)
  mask: PelliculeLayerMask | null
  effects: PelliculeLayerEffects | null

  // Params spécifiques au type (V1 = null pour image/video/gif)
  params: Record<string, unknown> | null

  created_at: string
  updated_at: string
}

/** Payload pour créer un calque (POST). Tous les champs avec defaults peuvent
 *  être omis. */
export interface PelliculeLayerCreate {
  type: PelliculeLayerType
  media_url?: string | null
  position_x?: number
  position_y?: number
  scale?: number
  rotation?: number
  opacity?: number
  blend?: LayerBlendMode
  z_index?: number
  visible?: boolean
  mask?: PelliculeLayerMask | null
  effects?: PelliculeLayerEffects | null
  params?: Record<string, unknown> | null
  // Phase A bis — timing
  start_ms_rel?: number
  duration_ms?: number | null
}

/** Payload pour update partiel (PATCH). Tous les champs optionnels. */
export type PelliculeLayerPatch = Partial<Omit<PelliculeLayerCreate, 'type'>>

/** Defaults appliqués côté API si non fournis au POST.
 *  En sync avec les DEFAULT de la migration 088. */
export const PELLICULE_LAYER_DEFAULTS = {
  position_x: 50,
  position_y: 50,
  scale: 1.0,
  rotation: 0,
  opacity: 1.0,
  blend: 'normal' as LayerBlendMode,
  z_index: 0,
  visible: true,
  start_ms_rel: 0,
  duration_ms: null as number | null,
} as const
