/**
 * MultiTrackTimeline — mapper bidirectionnel Pellicule ↔ TimelineState.
 *
 * Le modèle Hero stocke la séquence comme `pellicules[]` (chaque pellicule a
 * ses shots[], audioTracks[], textOverlays[]). La UI multi-pistes la voit
 * comme `TimelineState` plat (blocs avec startMs absolu, par piste).
 *
 * Mapper.toTimeline : pellicules → TimelineState (lecture, hydratation UI).
 * Mapper.toPellicules : TimelineState → pellicules (sauvegarde, persist DB).
 *
 * IMPORTANT : on n'invente pas de structure DB. Le mapper se contente de
 * projeter / dé-projeter. Les nouveaux champs `audioTracks` et `textOverlays`
 * sont stockés sur chaque pellicule et seront persistés dans le JSONB existant.
 *
 * Refonte 2026-05-12.
 */

import type { AnimationPellicule, AudioTrackData, Shot, TextOverlayData } from '@/components/image-editor/EditorStateContext'
import type {
  TimelineState, TimelineBlock,
  VideoBlock, ImageStaticBlock, SfxBlock, MusicBlock, TextBlock,
} from './types'
import { computeTotalDurationMs } from './helpers'

// ── Extensions optionnelles (cadré 2026-05-12) ────────────────────────────
// AudioTrackData et TextOverlayData sont désormais des types first-class :
// AnimationPellicule.audioTracks et Shot.textOverlays.

/** Type étendu pellicule avec `type` (Phase E existant) + label optionnel
 *  (= ce que l'auteur a renommé via input crayon, refonte 2026-05-14aw). */
type ExtendedPellicule = AnimationPellicule & {
  type?: 'animation' | 'image_static' | 'conversation'
  label?: string
}

// ── pellicules → TimelineState ────────────────────────────────────────────

/** Calcule le startMs absolu de chaque pellicule selon son ordre + durée
 *  cumulée des précédentes. Note : pour un plan animation typique, les
 *  pellicules s'enchaînent linéairement (pas d'overlap entre pellicules).
 *  Les blocs DANS une pellicule (audioTracks, textOverlays) ont des
 *  `startMs/startSec` relatifs à CETTE pellicule. */
function computePelliculeOffsetsMs(pellicules: ExtendedPellicule[]): Map<string, number> {
  const offsets = new Map<string, number>()
  let cursor = 0
  for (const p of pellicules) {
    offsets.set(p.id, cursor)
    const durSec = (p.shots ?? []).reduce((sum, s) => sum + (s.duration ?? 0), 0)
    cursor += durSec * 1000
  }
  return offsets
}

export function pelliculesToTimelineState(pellicules: AnimationPellicule[]): TimelineState {
  const ext = pellicules as ExtendedPellicule[]
  const offsets = computePelliculeOffsetsMs(ext)
  const blocks: TimelineBlock[] = []

  for (const p of ext) {
    const pelliculeStartMs = offsets.get(p.id) ?? 0
    const isImageStatic = p.type === 'image_static'

    // ── Piste vidéo/image : 1 bloc par shot (animation) ou 1 bloc image_static
    if (isImageStatic) {
      const totalDurSec = (p.shots ?? []).reduce((sum, s) => sum + (s.duration ?? 0), 0) || 3
      blocks.push({
        id: `${p.id}__static`,
        kind: 'image_static',
        trackKind: 'video_image',
        pelliculeId: p.id,
        startMs: pelliculeStartMs,
        durationMs: totalDurSec * 1000,
        imageUrl: p.firstFrameUrl ?? '',
        label: (p as ExtendedPellicule).label ?? `Image ${p.id.slice(0, 4)}`,
      } satisfies ImageStaticBlock)
    } else {
      // Refonte 2026-05-14as : 1 bloc par pellicule (= 1 vidéo MP4 LTX),
      // avec shots[] = sous-divisions visuelles (lignes verticales + sélection).
      const shotsMeta: Array<{ id: string; startMs: number; durationMs: number; prompt?: string }> = []
      let shotCursor = 0  // relatif au début du bloc, pas à la timeline
      for (const s of p.shots ?? []) {
        const durMs = (s.duration ?? 4) * 1000
        // Refonte 2026-05-15bh — synthèse lisible du contenu shot (sceneAction
        // + actions perso) pour affichage à droite du bloc timeline.
        const promptParts: string[] = []
        if (s.sceneAction?.trim()) promptParts.push(s.sceneAction.trim())
        for (const [, data] of Object.entries(s.perCharacter ?? {})) {
          if (data.action?.trim()) promptParts.push(data.action.trim())
        }
        const prompt = promptParts.join(' · ') || undefined
        shotsMeta.push({ id: s.id, startMs: shotCursor, durationMs: durMs, prompt })
        // Text overlays projetés sur la timeline (track 'text')
        for (const t of s.textOverlays ?? []) {
          blocks.push({
            id: `${p.id}__text_${t.id}`,
            kind: 'text',
            trackKind: 'text',
            startMs: pelliculeStartMs + shotCursor + t.startSec * 1000,
            durationMs: t.durationSec * 1000,
            text: t.text,
            template: t.template,
            position: t.position,
            size: t.size,
          } satisfies TextBlock)
        }
        shotCursor += durMs
      }
      const totalDurMs = shotCursor || 4000
      blocks.push({
        id: `${p.id}__video`,
        kind: 'video',
        trackKind: 'video_image',
        pelliculeId: p.id,
        startMs: pelliculeStartMs,
        durationMs: totalDurMs,
        videoUrl: p.videoUrl ?? null,
        firstFrameUrl: p.firstFrameUrl ?? null,
        label: (() => {
          // Refonte 2026-05-14aw — utilise le label de la pellicule (= ce que
          // l'auteur a renommé) en priorité. Fallback : court id slice + suffix
          // multi-shots si applicable. "Pellicule a94f" lisible vs "Pellicule" générique.
          const base = (p as ExtendedPellicule).label
            ?? `Pellicule ${p.id.slice(0, 4)}`
          return shotsMeta.length > 1 ? `${base} · ${shotsMeta.length} shots` : base
        })(),
        shots: shotsMeta,
      } satisfies VideoBlock)
    }

    // ── Piste SFX / MUSIC : projeter les audioTracks de la pellicule ──
    for (const a of p.audioTracks ?? []) {
      const baseBlock = {
        id: `${p.id}__audio_${a.id}`,
        startMs: pelliculeStartMs + a.startMs,
        durationMs: a.durationMs,
        audioId: a.audioId,
        audioUrl: a.audioUrl,
        label: a.label,
        volume: a.volume,
        fadeInMs: a.fadeInMs,
        fadeOutMs: a.fadeOutMs,
      }
      if (a.kind === 'sfx') {
        blocks.push({ ...baseBlock, kind: 'sfx', trackKind: 'sfx' } satisfies SfxBlock)
      } else {
        blocks.push({ ...baseBlock, kind: 'music', trackKind: 'music', loop: a.loop ?? false } satisfies MusicBlock)
      }
    }
  }

  return {
    blocks,
    totalDurationMs: computeTotalDurationMs(blocks),
  }
}

// ── TimelineState → pellicules ────────────────────────────────────────────

/** Re-construit la liste de pellicules depuis le state timeline. Pour V1
 *  simple : les modifs côté multi-pistes touchent surtout audioTracks et
 *  textOverlays — les shots vidéo restent gérés par l'éditeur de pellicule
 *  classique. Le mapper inverse fusionne les nouveaux audioTracks/textOverlays
 *  dans les pellicules existantes (ne crée/supprime PAS de pellicule). */
export function applyTimelineToPellicules(
  state: TimelineState,
  basePellicules: AnimationPellicule[],
): AnimationPellicule[] {
  const ext = basePellicules as ExtendedPellicule[]

  return ext.map(p => {
    // Reconstruit audioTracks de cette pellicule depuis les blocs SFX/MUSIC
    // qui appartiennent à cette pellicule (id préfixe `${p.id}__audio_`).
    const myAudioBlocks = state.blocks.filter(b =>
      (b.kind === 'sfx' || b.kind === 'music') && b.id.startsWith(`${p.id}__audio_`),
    )
    const pelliculeStartMs = computePelliculeOffsetsMs(ext).get(p.id) ?? 0
    const audioTracks: AudioTrackData[] = myAudioBlocks.map(b => {
      const audioBlock = b as SfxBlock | MusicBlock
      return {
        id: b.id.replace(`${p.id}__audio_`, ''),
        kind: audioBlock.kind === 'sfx' ? 'sfx' : 'music',
        audioId: audioBlock.audioId,
        audioUrl: audioBlock.audioUrl,
        label: audioBlock.label,
        startMs: b.startMs - pelliculeStartMs,  // ramène au relatif pellicule
        durationMs: b.durationMs,
        volume: audioBlock.volume,
        fadeInMs: audioBlock.fadeInMs,
        fadeOutMs: audioBlock.fadeOutMs,
        ...(audioBlock.kind === 'music' && { loop: audioBlock.loop }),
      }
    })

    // Reconstruit textOverlays par shot. Préfixe id : `${p.id}__text_`.
    // On les rattache au shot dans lequel leur startMs tombe (= shot dont
    // la fenêtre temporelle [shotStart, shotEnd] contient block.startMs).
    const myTextBlocks = state.blocks.filter(b =>
      b.kind === 'text' && b.id.startsWith(`${p.id}__text_`),
    )
    const updatedShots = (p.shots ?? []).map(shot => {
      const shotIdx = (p.shots ?? []).findIndex(s => s.id === shot.id)
      const shotStartMs = pelliculeStartMs + (p.shots ?? []).slice(0, shotIdx)
        .reduce((sum, s) => sum + (s.duration ?? 0) * 1000, 0)
      const shotEndMs = shotStartMs + (shot.duration ?? 4) * 1000
      const overlaysInShot: TextOverlayData[] = myTextBlocks
        .filter(b => b.startMs >= shotStartMs && b.startMs < shotEndMs)
        .map(b => {
          const tb = b as TextBlock
          return {
            id: b.id.replace(`${p.id}__text_`, ''),
            text: tb.text,
            template: tb.template,
            position: tb.position,
            startSec: (b.startMs - shotStartMs) / 1000,
            durationSec: b.durationMs / 1000,
            size: tb.size,
          }
        })
      return overlaysInShot.length > 0
        ? { ...shot, textOverlays: overlaysInShot }
        : shot
    })

    const updated: ExtendedPellicule = {
      ...p,
      shots: updatedShots,
      ...(audioTracks.length > 0 && { audioTracks }),
    }
    return updated as AnimationPellicule
  })
}
