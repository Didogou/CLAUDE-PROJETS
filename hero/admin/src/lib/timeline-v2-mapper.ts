/**
 * Mappers V2 — section_timeline rows + assets joints → TimelineState (= ce que
 * MultiTrackTimeline consomme).
 *
 * Refonte V2 2026-05-13.
 */

import type {
  TimelineState, TimelineBlock,
  VideoBlock, ImageStaticBlock, LayerBlock, SfxBlock, MusicBlock, TextBlock,
} from '@/app/editor-test/animation-studio/components/multi-track-timeline/types'
import type { PelliculeLayerRow } from '@/lib/pellicule-layers-types'

/** Row brut renvoyée par GET /api/sections/[id]/timeline (avec asset hydraté). */
export interface SectionTimelineRow {
  id: string
  section_id: string
  position_idx: number
  track: 'video_image' | 'sfx' | 'music' | 'text'
  asset_type: 'image' | 'animation' | 'audio' | 'text'
  asset_id: string
  start_ms: number
  duration_ms: number
  overrides: Record<string, unknown> | null
  asset: Record<string, unknown> | null
  /** Phase B keyframes 2026-05-18 — animation runtime pellicule (migration 089). */
  keyframes?: Array<{
    t: number
    props: Record<string, number | undefined>
    easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  }> | null
}

/** Asset asset_image joint. */
export interface ImageAsset {
  id: string
  url: string
  label?: string | null
  description?: string | null
}

/** Asset assets_animation joint. */
export interface AnimationAsset {
  id: string
  video_url?: string | null
  first_frame_url?: string | null
  last_frame_url?: string | null
  label?: string | null
  shots?: unknown[]
  character_ids?: string[]
}

/** Asset assets_audio joint. */
export interface AudioAsset {
  id: string
  audio_url: string
  kind: 'sfx' | 'music'
  label?: string | null
  duration_sec?: number | null
}

/** Asset assets_text joint. */
export interface TextAsset {
  id: string
  text: string
  template: 'fade' | 'typewriter' | 'slide_up'
  position: 'top' | 'center' | 'bottom'
  size: 'sm' | 'md' | 'lg' | 'xl'
}

/** Mapper rows section_timeline (avec assets hydratés) → TimelineState.
 *  Refonte Phase A bis 2026-05-18 : accepte optionnellement une map
 *  pellicule_layers (keyed by pellicule_id) pour injecter les LayerBlock
 *  sur la track 'layers'. */
export function timelineRowsToState(
  rows: SectionTimelineRow[],
  layersByPelliculeId?: Record<string, PelliculeLayerRow[]>,
): TimelineState {
  const blocks: TimelineBlock[] = []
  let totalDurationMs = 0

  // Pré-index : on a besoin de la pellicule parente pour calculer le startMs
  // global des layers (= parent.startMs + start_ms_rel).
  const parentsByPelliculeId = new Map<string, SectionTimelineRow>()
  for (const r of rows) {
    if (r.track === 'video_image') parentsByPelliculeId.set(r.id, r)
  }

  for (const row of rows) {
    const endMs = row.start_ms + row.duration_ms
    if (endMs > totalDurationMs) totalDurationMs = endMs

    if (row.track === 'video_image' && row.asset_type === 'animation') {
      const a = row.asset as AnimationAsset | null
      // Refonte 2026-05-15bj — VideoBlock requiert `shots[]` (refonte 2026-05-14as).
      // V2 (Studio Section) : on rebuild depuis a.shots si dispo, sinon un seul
      // shot synthétique qui couvre toute la durée du bloc.
      type AssetShot = {
        id: string; duration?: number; sceneAction?: string;
        perCharacter?: Record<string, { action?: string }>;
      }
      const assetShots = ((a as AnimationAsset & { shots?: AssetShot[] } | null)?.shots ?? []) as AssetShot[]
      const shotsMeta: Array<{ id: string; startMs: number; durationMs: number; prompt?: string }> = []
      if (assetShots.length > 0) {
        let cursor = 0
        for (const s of assetShots) {
          const durMs = (s.duration ?? 4) * 1000
          const parts: string[] = []
          if (s.sceneAction?.trim()) parts.push(s.sceneAction.trim())
          for (const [, data] of Object.entries(s.perCharacter ?? {})) {
            if (data.action?.trim()) parts.push(data.action.trim())
          }
          shotsMeta.push({
            id: s.id,
            startMs: cursor,
            durationMs: durMs,
            prompt: parts.join(' · ') || undefined,
          })
          cursor += durMs
        }
      } else {
        shotsMeta.push({ id: `${row.id}__shot0`, startMs: 0, durationMs: row.duration_ms })
      }
      blocks.push({
        id: row.id,
        kind: 'video',
        trackKind: 'video_image',
        pelliculeId: row.asset_id,
        startMs: row.start_ms,
        durationMs: row.duration_ms,
        videoUrl: a?.video_url ?? null,
        firstFrameUrl: a?.first_frame_url ?? null,
        // Refonte 2026-05-17 — fallback label stable basé sur asset.id (8 chars)
        // au lieu de position_idx (qui change au reorder → labels qui dansent).
        label: a?.label ?? `Animation ${row.asset_id.slice(0, 4)}`,
        shots: shotsMeta,
      } satisfies VideoBlock)
    }
    else if (row.track === 'video_image' && row.asset_type === 'image') {
      const a = row.asset as ImageAsset | null
      blocks.push({
        id: row.id,
        kind: 'image_static',
        trackKind: 'video_image',
        pelliculeId: row.asset_id,
        startMs: row.start_ms,
        durationMs: row.duration_ms,
        imageUrl: a?.url ?? '',
        label: a?.label ?? `Image ${row.asset_id.slice(0, 4)}`,
      } satisfies ImageStaticBlock)
    }
    else if (row.track === 'sfx' && row.asset_type === 'audio') {
      const a = row.asset as AudioAsset | null
      const ov = row.overrides ?? {}
      blocks.push({
        id: row.id,
        kind: 'sfx',
        trackKind: 'sfx',
        audioId: row.asset_id,
        audioUrl: a?.audio_url ?? '',
        label: a?.label ?? 'SFX',
        startMs: row.start_ms,
        durationMs: row.duration_ms,
        volume: typeof ov.volume === 'number' ? ov.volume : 0.7,
        fadeInMs: typeof ov.fadeInMs === 'number' ? ov.fadeInMs : 200,
        fadeOutMs: typeof ov.fadeOutMs === 'number' ? ov.fadeOutMs : 200,
      } satisfies SfxBlock)
    }
    else if (row.track === 'music' && row.asset_type === 'audio') {
      const a = row.asset as AudioAsset | null
      const ov = row.overrides ?? {}
      blocks.push({
        id: row.id,
        kind: 'music',
        trackKind: 'music',
        audioId: row.asset_id,
        audioUrl: a?.audio_url ?? '',
        label: a?.label ?? 'Musique',
        startMs: row.start_ms,
        durationMs: row.duration_ms,
        volume: typeof ov.volume === 'number' ? ov.volume : 0.4,
        fadeInMs: typeof ov.fadeInMs === 'number' ? ov.fadeInMs : 200,
        fadeOutMs: typeof ov.fadeOutMs === 'number' ? ov.fadeOutMs : 200,
        loop: typeof ov.loop === 'boolean' ? ov.loop : false,
      } satisfies MusicBlock)
    }
    else if (row.track === 'text' && row.asset_type === 'text') {
      const a = row.asset as TextAsset | null
      blocks.push({
        id: row.id,
        kind: 'text',
        trackKind: 'text',
        startMs: row.start_ms,
        durationMs: row.duration_ms,
        text: a?.text ?? '',
        template: a?.template ?? 'fade',
        position: a?.position ?? 'center',
        size: a?.size ?? 'lg',
      } satisfies TextBlock)
    }
  }

  // Phase A bis 2026-05-18 — injecte les calques en tant que LayerBlock sur la
  // nouvelle track 'layers'. startMs = parent.startMs + start_ms_rel.
  // durationMs = layer.duration_ms (si défini) sinon (parent.duration_ms - start_ms_rel).
  if (layersByPelliculeId) {
    for (const [pelliculeId, layers] of Object.entries(layersByPelliculeId)) {
      const parent = parentsByPelliculeId.get(pelliculeId)
      if (!parent) continue  // skip layers sans pellicule parente (= orphans)
      for (const l of layers) {
        const startGlobal = parent.start_ms + l.start_ms_rel
        const dur = l.duration_ms ?? Math.max(1, parent.duration_ms - l.start_ms_rel)
        blocks.push({
          id: l.id,
          kind: 'layer',
          trackKind: 'layers',
          layerId: l.id,
          parentPelliculeId: pelliculeId,
          layerType: l.type,
          mediaUrl: l.media_url,
          label: `${l.type} #${l.z_index}`,
          startMs: startGlobal,
          durationMs: dur,
          zIndex: l.z_index,
          visible: l.visible,
        } satisfies LayerBlock)
      }
    }
  }

  return { blocks, totalDurationMs }
}
