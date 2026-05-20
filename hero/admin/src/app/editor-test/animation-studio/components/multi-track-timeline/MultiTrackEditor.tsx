'use client'
/**
 * MultiTrackEditor — orchestrateur library + timeline pour le AnimationStudio.
 *
 * Phase 1 V1 (2026-05-12) :
 *   - Lit `pellicules` depuis EditorStateContext, mappe en TimelineState
 *   - Affiche bibliothèque à gauche (Animations + Images peuplées depuis
 *     pellicules existantes + bankImages prop)
 *   - Affiche MultiTrackTimeline à droite avec drop handler
 *   - Au drop SFX/musique/text : crée un nouveau bloc dans state (V2 : persist
 *     via mapper inverse + PATCH plan)
 *
 *   ⏳ Phases 2-3 : peuplement Sons/Musique depuis banque livre, persist au save.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Plus as PlusIcon, ImagePlus as ImagePlusIcon } from 'lucide-react'
import { useEditorState, type AudioTrackData, type TextOverlayData } from '@/components/image-editor/EditorStateContext'
import MultiTrackTimeline, { type DragPayload } from './MultiTrackTimeline'
import TimelineLibrary, {
  type LibraryAnimation, type LibraryImage, type LibrarySfx, type LibraryMusic,
} from './TimelineLibrary'
import SfxGenerationModal, { type GeneratedSfx } from './SfxGenerationModal'
import TextBlockEditor from './TextBlockEditor'
import { pelliculesToTimelineState } from './mapper'
import type { TrackKind, TimelineBlock, TextBlock } from './types'
import './multi-track-timeline.css'

interface MultiTrackEditorProps {
  /** Banque d'images du livre (pour la section Images de la library). */
  bankImages?: Array<{ id: string; url: string; label?: string }>
  /** Banque de SFX persistée DB (Phase 2 future — pour V1 = vide, on
   *  accumule dans state local sessionSfxBank). */
  bankSfx?: LibrarySfx[]
  /** Banque de musique. */
  bankMusic?: LibraryMusic[]
  /** ID du livre courant — utilisé pour scoper l'upload Storage des SFX
   *  générés (Phase 2). */
  bookId?: string | null
  /** Click sur un bloc → délègue au parent (ex: ouvrir un panneau d'édition). */
  onSelectBlock?: (block: TimelineBlock) => void
  /** Callback drop depuis library — pour V1, juste log + délégation parent.
   *  En Phases 2/3, ce sera mutation du state via mapper inverse + PATCH. */
  onDropFromLibrary?: (track: TrackKind, payload: DragPayload, dropMs: number) => void
  /** Création / continuation / upload pellicule (Phase 1bis 2026-05-12 —
   *  réintégration des actions perdues au remplacement de AnimationStudioTimeline). */
  onAddPellicule?: () => void
  /** Création d'une pellicule image_static (Phase 1ter 2026-05-12). */
  onAddImageStatic?: () => void
  onContinueVideo?: () => void
  onUploadVideo?: (file: File) => void
  /** Bouton "Générer SFX" → ouvrira la modal ElevenLabs Sound Effects en Phase 2. */
  onGenerateSfx?: () => void
  /** Import audio (sfx/music) depuis fichier local — Phase 2. */
  onImportAudio?: (kind: 'sfx' | 'music', file: File) => void
  /** Suppression d'une pellicule depuis la library Animations (corbeille).
   *  Reçoit l'id de la library entry (= pelliculeId). Le caller orchestre
   *  DELETE storage + retire de section.images + removeAnimationPellicule. */
  onDeleteAnimation?: (animationId: string) => void
  /** Croix sur le BLOC timeline (refonte 2026-05-14) : retire seulement le
   *  bloc de la timeline (l'asset reste dans la banque). Si non fourni,
   *  fallback vers `onDeleteAnimation` (cascade complète, comportement
   *  legacy). Refonte 2026-05-14ay : reçoit le bloc complet (pas juste
   *  pelliculeId), car Studio Section V2 a besoin de block.id (= row.id)
   *  alors qu'AnimationStudio veut block.pelliculeId. */
  onDeleteBlock?: (block: import('./types').TimelineBlock) => void
  /** Édition d'une pellicule depuis la library Animations (crayon). */
  onEditAnimation?: (animationId: string) => void
  /** Renomme une pellicule via double-click sur son label dans la library
   *  Animations (refonte 2026-05-14ax). Reçoit l'id + nouveau label. */
  onRenameAnimation?: (animationId: string, newLabel: string) => void
  /** Click simple sur une tile (anim/image) → highlight sur la timeline.
   *  Refonte 2026-05-14ay. */
  onSelectAnimation?: (animationId: string) => void
  onSelectImage?: (imageId: string) => void
  /** Édition d'une image depuis la library Images (crayon). */
  onEditImage?: (imageId: string) => void
  /** Suppression d'une image depuis la library Images (corbeille). */
  onDeleteImage?: (imageId: string) => void
  /** Filtre les pistes affichées dans la timeline. Cf MultiTrackTimeline. */
  visibleTracks?: import('./types').TrackKind[]
  /** Filtre les sections de la library. Cf TimelineLibrary. */
  visibleSections?: Array<'animations' | 'images' | 'sfx' | 'music' | 'text'>
  /** Refonte 2026-05-14av — pass-through callbacks pour sync timeline ↔ preview. */
  onCursorPelliculeChange?: (pelliculeId: string | null) => void
  onPlayingChange?: (playing: boolean) => void
  /** Click sur ✨ Effets au hover d'un bloc video timeline. Refonte 2026-05-15ca. */
  onOpenEffects?: (pelliculeId: string) => void
  /** Click sur 📸 Capture au hover d'un bloc video timeline. Refonte 2026-05-15dq. */
  onOpenCapture?: (pelliculeId: string) => void
  /** Refonte 2026-05-16 — bouton "Modifier" sur chaque bloc timeline. */
  onEditBlock?: (pelliculeId: string, kind: 'video' | 'image_static') => void
}

export default function MultiTrackEditor({
  bankImages = [], bankSfx = [], bankMusic = [],
  bookId = null,
  onSelectBlock, onDropFromLibrary,
  onAddPellicule, onAddImageStatic, onContinueVideo, onUploadVideo,
  onGenerateSfx, onImportAudio, onDeleteAnimation, onDeleteBlock, onEditAnimation,
  onRenameAnimation, onSelectAnimation, onSelectImage,
  onEditImage, onDeleteImage,
  visibleTracks, visibleSections,
  onCursorPelliculeChange, onPlayingChange, onOpenEffects, onOpenCapture, onEditBlock,
}: MultiTrackEditorProps) {
  const {
    animationPellicules, updateAnimationPellicule, updateAnimationShot,
    animationSelectedPelliculeId, reorderAnimationPellicules,
  } = useEditorState()

  // Banques persistées DB (refonte 2026-05-12) : fetched depuis
  // /api/books/[id]/audio-bank au mount, mis à jour au handleSfxAdded /
  // handleImportAudio (= POST API + setState local pour feedback immédiat).
  // Combinées avec bankSfx/bankMusic (props depuis parent — V2 alternative).
  const [persistedSfxBank, setPersistedSfxBank] = useState<LibrarySfx[]>([])
  const [persistedMusicBank, setPersistedMusicBank] = useState<LibraryMusic[]>([])
  const [sfxModalOpen, setSfxModalOpen] = useState(false)

  // Hydrate la banque audio depuis la DB au mount (= persistance entre sessions).
  useEffect(() => {
    if (!bookId) return
    let aborted = false
    void (async () => {
      try {
        const res = await fetch(`/api/books/${bookId}/audio-bank`)
        if (!res.ok) return
        const data = await res.json() as {
          sfx?: Array<{ id: string; label: string; url: string; durationSec: number }>
          music?: Array<{ id: string; label: string; url: string; durationSec: number }>
        }
        if (aborted) return
        setPersistedSfxBank((data.sfx ?? []).map(e => ({
          id: e.id, label: e.label, url: e.url, durationSec: e.durationSec,
        })))
        setPersistedMusicBank((data.music ?? []).map(e => ({
          id: e.id, label: e.label, url: e.url, durationSec: e.durationSec,
        })))
      } catch (err) {
        console.warn('[MultiTrackEditor] audio-bank fetch failed:', err)
      }
    })()
    return () => { aborted = true }
  }, [bookId])

  /** Persiste une entrée audio dans la banque DB du livre (si bookId fourni).
   *  Failure = no-op silencieux + log (l'entrée reste en local pour la session). */
  async function persistAudioEntry(kind: 'sfx' | 'music', entry: LibrarySfx) {
    if (!bookId) return
    try {
      await fetch(`/api/books/${bookId}/audio-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          entry: {
            id: entry.id,
            label: entry.label,
            url: entry.url,
            durationSec: entry.durationSec,
            createdAt: Date.now(),
          },
        }),
      })
    } catch (err) {
      console.warn('[MultiTrackEditor] persist audio-bank failed:', err)
    }
  }

  // Édition d'un bloc texte sélectionné dans la timeline (Phase 3).
  const [editingTextBlock, setEditingTextBlock] = useState<TextBlock | null>(null)

  /** Import audio fichier local → upload Supabase + ajout banque session.
   *  V1ter 2026-05-12. La route attend data_url base64 → on convertit le File
   *  via FileReader. La durée est lue côté client via Audio() pour l'ajout
   *  banque (le backend ne la calcule pas). */
  async function handleImportAudio(kind: 'sfx' | 'music', file: File) {
    try {
      // 1. File → data URL base64
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('FileReader failed'))
        reader.readAsDataURL(file)
      })
      // 2. Upload via API existante (path scopé par-livre + kind)
      const ts = Date.now()
      const safe = file.name.replace(/[^\w.\-]+/g, '_')
      const path = bookId
        ? `books/${bookId}/${kind}/${ts}-${safe}`
        : `orphan/${kind}/${ts}-${safe}`
      const res = await fetch('/api/storage/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error ?? `HTTP ${res.status}`)
      // 3. Lit la durée via Audio() côté client (le backend ne calcule pas)
      const durationSec = await new Promise<number>((resolve) => {
        const audio = new Audio(data.url)
        audio.onloadedmetadata = () => resolve(audio.duration || 3)
        audio.onerror = () => resolve(3)  // fallback 3s si load fail
      })
      // 4. Ajout banque + persist DB
      const label = file.name.replace(/\.[^.]+$/, '')
      const id = `${kind}-${ts}-${Math.random().toString(36).slice(2, 6)}`
      const entry: LibrarySfx = { id, label, url: data.url!, durationSec }
      if (kind === 'sfx') {
        setPersistedSfxBank(prev => [entry, ...prev])
      } else {
        setPersistedMusicBank(prev => [entry, ...prev])
      }
      void persistAudioEntry(kind, entry)
      // Délègue aussi au parent si fourni (analytics)
      onImportAudio?.(kind, file)
    } catch (err) {
      console.error('[MultiTrackEditor] import audio failed:', err)
      alert(`Import audio échoué : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Handler génération SFX (open modal). Si onGenerateSfx parent fourni, on
  // le préfère (override possible) — sinon on ouvre notre modal interne.
  const effectiveOnGenerateSfx = onGenerateSfx ?? (() => setSfxModalOpen(true))

  function handleSfxAdded(sfx: GeneratedSfx) {
    const newSfx: LibrarySfx = {
      id: `sfx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: sfx.label,
      url: sfx.url,
      durationSec: sfx.durationSec ?? 3,
    }
    setPersistedSfxBank(prev => [newSfx, ...prev])
    void persistAudioEntry('sfx', newSfx)
  }

  // Mapping pellicules → TimelineState
  const state = useMemo(
    () => pelliculesToTimelineState(animationPellicules),
    [animationPellicules],
  )

  // Mapping pellicules → LibraryAnimation (chaque pellicule = 1 entrée).
  // A.2 fix 2026-05-13 : dédup contre les pellicules DÉJÀ placées sur la
  // timeline (= éviter le doublon library × timeline visible). Le label
  // utilise p.label si fourni (= renommée par l'auteur), sinon fallback.
  const placedPelliculeIds = useMemo(
    () => new Set(
      state.blocks
        .filter(b => b.kind === 'video' || b.kind === 'image_static')
        .map(b => 'pelliculeId' in b ? b.pelliculeId : null)
        .filter((id): id is string => !!id),
    ),
    [state.blocks],
  )
  // Refonte 2026-05-14 : on ne filtre PLUS les pellicules placées de la library.
  // Avant : `!placedPelliculeIds.has(p.id)` cachait la pellicule dès qu'elle
  // avait un bloc timeline → effet pervers : "Continuer la vidéo" disparaît
  // (canContinueVideo passe à false), folder Animations affiche (0) après
  // 1ère génération. Maintenant la library = banque visuelle complète des
  // pellicules (placées ou non) ; le bool `placedOnTimeline` permet d'afficher
  // un badge "déjà placée" côté UI tile (TimelineLibrary).
  const libraryAnimations: LibraryAnimation[] = useMemo(
    () => animationPellicules
      .filter(p => p.videoUrl != null)
      .map(p => {
        const totalSec = (p.shots ?? []).reduce((sum, s) => sum + (s.duration ?? 0), 0) || 4
        const firstShotId = p.shots?.[0]?.id ?? p.id
        return {
          id: p.id,
          label: p.label ?? `Pellicule ${p.id.slice(0, 4)}`,
          videoUrl: p.videoUrl,
          firstFrameUrl: p.firstFrameUrl,
          durationSec: totalSec,
          pelliculeId: p.id,
          shotId: firstShotId,
          placedOnTimeline: placedPelliculeIds.has(p.id),
        }
      }),
    [animationPellicules, placedPelliculeIds],
  )

  // Mapping bankImages → LibraryImage
  const libraryImages: LibraryImage[] = useMemo(
    () => bankImages.map(i => ({
      id: i.id,
      label: i.label ?? `Image ${i.id.slice(0, 4)}`,
      url: i.url,
    })),
    [bankImages],
  )

  // Refonte 2026-05-14bf — Phase 3 : suppression de TimelineLibrary sidebar
  // (banque V2 dans le drawer images du rail gauche). Les actions de création
  // (+ Pellicule, + Image fixe) migrent vers la toolbar centrale du header
  // timeline via trackActions. Upload + Continue déjà migrés (Phase 1+2).
  void libraryAnimations
  void libraryImages
  void persistedSfxBank
  void persistedMusicBank
  void bankSfx
  void bankMusic
  void onUploadVideo
  void effectiveOnGenerateSfx
  void handleImportAudio
  void onDeleteAnimation
  void onEditAnimation
  void onRenameAnimation
  void onSelectAnimation
  void onSelectImage
  void onEditImage
  void onDeleteImage
  void visibleSections
  void animationSelectedPelliculeId

  // trackActions pour le header timeline (= remplace les boutons de la
  // sidebar TimelineLibrary supprimée). Cf <MultiTrackTimeline> qui rend
  // ces actions dans sa toolbar centrale via mtt-toolbar-actions.
  const trackActions = {
    video_image: [
      ...(onAddPellicule ? [{
        icon: <PlusIcon size={14} />, label: 'Pellicule',
        title: 'Créer une nouvelle pellicule animation',
        onClick: onAddPellicule,
      }] : []),
      ...(onAddImageStatic ? [{
        icon: <ImagePlusIcon size={14} />, label: 'Image fixe',
        title: 'Créer une pellicule image fixe',
        onClick: onAddImageStatic,
      }] : []),
    ],
  }

  return (
    <div className="mtt-editor mtt-editor-no-library">
      <div className="mtt-editor-timeline">
        <MultiTrackTimeline
          state={state}
          visibleTracks={visibleTracks}
          selectedPelliculeId={animationSelectedPelliculeId}
          onCursorPelliculeChange={onCursorPelliculeChange}
          onPlayingChange={onPlayingChange}
          trackHeightsRem={{ video_image: 9 }}
          trackActions={trackActions}
          onContinueVideo={onContinueVideo}
          onOpenEffects={onOpenEffects}
          onOpenCapture={onOpenCapture}
          onEditBlock={onEditBlock}
          canContinueVideo={(() => {
            // Refonte 2026-05-14bv — Aligné avec handleContinueVideo :
            // actif s'il existe AU MOINS UNE pellicule animation générée
            // (peu importe la sélection courante). handleContinueVideo
            // fait `find(p => p.videoUrl)` côté caller, on suit la même règle
            // pour éviter l'inconsistance bouton actif → pellicule manquante.
            return animationPellicules.some(p => {
              const ext = p as typeof p & { type?: string }
              return !!p.videoUrl && ext.type !== 'image_static'
            })
          })()}
          onDeleteBlock={onDeleteBlock ?? (onDeleteAnimation
            ? (block) => {
                if (block.kind === 'video' || block.kind === 'image_static') {
                  onDeleteAnimation(block.pelliculeId)
                }
              }
            : undefined)}
          onMoveBlock={(blockId, newStartMs) => {
            // Refonte 2026-05-14bc — Réordonnancement des pellicules vidéo/image
            // par drag&drop sur la timeline. Format id : `${pelliculeId}__video`
            // ou `${pelliculeId}__static`. Les pellicules sont auto-positionnées
            // (offsets cumulés depuis le tableau animationPellicules), donc on
            // convertit newStartMs → index cible dans le tableau et on appelle
            // reorderAnimationPellicules(from, to).
            const pellMatch = blockId.match(/^([^_]+(?:_[^_]+)*)__(video|static)$/)
            if (pellMatch) {
              const pelliculeId = pellMatch[1]
              const fromIdx = animationPellicules.findIndex(p => p.id === pelliculeId)
              if (fromIdx < 0) return
              // Calcul de l'index cible : on accumule les durations dans l'ordre
              // courant et on trouve où newStartMs s'insère.
              let cursor = 0
              let toIdx = animationPellicules.length - 1  // par défaut à la fin
              for (let i = 0; i < animationPellicules.length; i++) {
                if (i === fromIdx) continue  // ignore le bloc qu'on déplace
                const p = animationPellicules[i]
                const durSec = (p.shots ?? []).reduce((sum, s) => sum + (s.duration ?? 0), 0)
                const durMs = (durSec || 4) * 1000
                const midpoint = cursor + durMs / 2
                if (newStartMs < midpoint) {
                  toIdx = i > fromIdx ? i - 1 : i  // ajuste si on remonte vs descend
                  break
                }
                cursor += durMs
                toIdx = i
              }
              if (toIdx !== fromIdx) {
                reorderAnimationPellicules(fromIdx, toIdx)
              }
              return
            }
            const audioMatch = blockId.match(/^([^_]+(?:_[^_]+)*)__audio_(.+)$/)
            if (audioMatch) {
              const pelliculeId = audioMatch[1]
              const audioId = audioMatch[2]
              const pell = animationPellicules.find(p => p.id === pelliculeId)
              if (!pell?.audioTracks) return
              const idx = pell.audioTracks.findIndex(a => a.id === audioId)
              if (idx < 0) return
              // newStartMs est absolu (timeline) → convertir en relatif à la
              // pellicule (qui démarre à un offset selon les pellicules avant).
              // V1 : pellicule[0] démarre à 0 → newStartMs déjà relatif.
              const next = [...pell.audioTracks]
              next[idx] = { ...next[idx], startMs: newStartMs }
              updateAnimationPellicule(pelliculeId, { audioTracks: next })
              return
            }
            const textMatch = blockId.match(/^([^_]+(?:_[^_]+)*)__text_(.+)$/)
            if (textMatch) {
              const pelliculeId = textMatch[1]
              const overlayId = textMatch[2]
              const pell = animationPellicules.find(p => p.id === pelliculeId)
              if (!pell) return
              // Trouve dans quel shot l'overlay vit + retrouve son shot pour
              // recalculer startSec relatif à ce shot. Pour V1, si le drop le
              // change de shot, on garde dans le shot d'origine et on adapte
              // startSec (peut être négatif ou >duration → c'est OK pour V1
              // mais le rendering ignorera les overlays out-of-bounds).
              let cursor = 0
              for (const shot of pell.shots ?? []) {
                const shotStart = cursor
                const shotEnd = cursor + (shot.duration ?? 4) * 1000
                const overlays = shot.textOverlays ?? []
                const idx = overlays.findIndex(o => o.id === overlayId)
                if (idx >= 0) {
                  // Trouvé. Garde dans ce shot, recalcule startSec.
                  const next = [...overlays]
                  next[idx] = { ...next[idx], startSec: (newStartMs - shotStart) / 1000 }
                  updateAnimationShot(pelliculeId, shot.id, { textOverlays: next })
                  return
                }
                cursor = shotEnd
              }
            }
          }}
          onSelectBlock={(block) => {
            // Click sur bloc texte → ouvre l'éditeur dédié.
            if (block.kind === 'text') {
              setEditingTextBlock(block)
              return
            }
            onSelectBlock?.(block)
          }}
          onResizeBlock={(blockId, newStartMs, newDurationMs) => {
            // V2bis 2026-05-12 : commit du resize bord. Mappe l'id encodé vers
            // le bon morceau du modèle (audio / text / image_static).
            // Pour audio, le startMs absolu doit être ramené au relatif pellicule.
            // Pour text, idem mais relatif au shot. Pour image_static, on
            // change la `duration` du shot porté par la pellicule (en sec).
            const audioMatch = blockId.match(/^([^_]+(?:_[^_]+)*)__audio_(.+)$/)
            if (audioMatch) {
              const pelliculeId = audioMatch[1]
              const audioId = audioMatch[2]
              const pell = animationPellicules.find(p => p.id === pelliculeId)
              if (!pell?.audioTracks) return
              const idx = pell.audioTracks.findIndex(a => a.id === audioId)
              if (idx < 0) return
              // V1 = pellicule[0] démarre à 0 → newStartMs déjà relatif.
              const next = [...pell.audioTracks]
              next[idx] = { ...next[idx], startMs: newStartMs, durationMs: newDurationMs }
              updateAnimationPellicule(pelliculeId, { audioTracks: next })
              return
            }
            const textMatch = blockId.match(/^([^_]+(?:_[^_]+)*)__text_(.+)$/)
            if (textMatch) {
              const pelliculeId = textMatch[1]
              const overlayId = textMatch[2]
              const pell = animationPellicules.find(p => p.id === pelliculeId)
              if (!pell) return
              let cursor = 0
              for (const shot of pell.shots ?? []) {
                const shotStart = cursor
                const shotEnd = cursor + (shot.duration ?? 4) * 1000
                const overlays = shot.textOverlays ?? []
                const idx = overlays.findIndex(o => o.id === overlayId)
                if (idx >= 0) {
                  const next = [...overlays]
                  next[idx] = {
                    ...next[idx],
                    startSec: (newStartMs - shotStart) / 1000,
                    durationSec: newDurationMs / 1000,
                  }
                  updateAnimationShot(pelliculeId, shot.id, { textOverlays: next })
                  return
                }
                cursor = shotEnd
              }
              return
            }
            // Image fixe : id = `${pelliculeId}__static`. Ajuste la duration du
            // shot unique (en sec). startMs ignoré — la pellicule reste à sa
            // position dans la séquence (les pellicules s'enchaînent).
            const staticMatch = blockId.match(/^(.+)__static$/)
            if (staticMatch) {
              const pelliculeId = staticMatch[1]
              const pell = animationPellicules.find(p => p.id === pelliculeId)
              if (!pell?.shots?.[0]) return
              const firstShot = pell.shots[0]
              updateAnimationShot(pelliculeId, firstShot.id, {
                duration: Math.max(0.2, newDurationMs / 1000),
              })
              return
            }
            // Shots vidéo (= `__shot_`) : pas resize en V1 (nécessite re-gen
            // ou trim côté ffmpeg côté renderer).
          }}
          onDropFromLibrary={(track, payload, dropMs) => {
            // Drop SFX/Music → rattache à la 1ère pellicule (= "audio du plan").
            if ((payload.blockKind === 'sfx' || payload.blockKind === 'music')
                && animationPellicules.length > 0) {
              const target = animationPellicules[0]
              const newTrack: AudioTrackData = {
                id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                kind: payload.blockKind,
                audioId: (payload.data.audioId as string) ?? '',
                audioUrl: (payload.data.audioUrl as string) ?? '',
                label: (payload.data.label as string) ?? 'Audio',
                startMs: dropMs,
                durationMs: payload.defaultDurationMs,
                volume: payload.blockKind === 'music' ? 0.4 : 0.7,
                fadeInMs: 200,
                fadeOutMs: 200,
                ...(payload.blockKind === 'music' && { loop: false }),
              }
              const next = [...(target.audioTracks ?? []), newTrack]
              updateAnimationPellicule(target.id, { audioTracks: next })
            }
            // Drop texte → trouve le shot contenant dropMs (ms absolu) et y
            // rattache un nouveau textOverlay avec startSec relatif au shot.
            // Phase 3 2026-05-12.
            if (payload.blockKind === 'text' && animationPellicules.length > 0) {
              let cursorMs = 0
              for (const p of animationPellicules) {
                for (const s of p.shots ?? []) {
                  const shotEnd = cursorMs + (s.duration ?? 4) * 1000
                  if (dropMs >= cursorMs && dropMs < shotEnd) {
                    const newOverlay: TextOverlayData = {
                      id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      text: (payload.data.text as string) ?? '',
                      template: (payload.data.template as TextOverlayData['template']) ?? 'fade',
                      position: (payload.data.position as TextOverlayData['position']) ?? 'center',
                      startSec: (dropMs - cursorMs) / 1000,
                      durationSec: payload.defaultDurationMs / 1000,
                      size: (payload.data.size as TextOverlayData['size']) ?? 'lg',
                    }
                    const nextOverlays = [...(s.textOverlays ?? []), newOverlay]
                    updateAnimationShot(p.id, s.id, { textOverlays: nextOverlays })
                    return
                  }
                  cursorMs = shotEnd
                }
              }
            }
            // Délègue aussi au parent
            onDropFromLibrary?.(track, payload, dropMs)
          }}
        />
      </div>
      {/* Modal génération SFX (interne — peut être overridée par onGenerateSfx prop) */}
      <SfxGenerationModal
        open={sfxModalOpen}
        onClose={() => setSfxModalOpen(false)}
        bookId={bookId}
        onAdd={handleSfxAdded}
      />
      {/* Éditeur de bloc texte (au click sur un bloc piste TEXT) */}
      <TextBlockEditor
        open={editingTextBlock !== null}
        onClose={() => setEditingTextBlock(null)}
        initial={editingTextBlock ? {
          text: editingTextBlock.text,
          template: editingTextBlock.template,
          position: editingTextBlock.position,
          startSec: editingTextBlock.startMs / 1000,
          durationSec: editingTextBlock.durationMs / 1000,
          size: editingTextBlock.size,
        } : null}
        onSave={(patch) => {
          if (!editingTextBlock) return
          // Le bloc id encode `${pelliculeId}__text_${overlayId}` — on retrouve.
          const m = editingTextBlock.id.match(/^([^_]+(?:_[^_]+)*)__text_(.+)$/)
          if (!m) return
          const pelliculeId = m[1]
          const overlayId = m[2]
          const pellicule = animationPellicules.find(p => p.id === pelliculeId)
          if (!pellicule) return
          // Trouve le shot qui contient cet overlay
          for (const shot of pellicule.shots ?? []) {
            const overlays = shot.textOverlays ?? []
            const idx = overlays.findIndex(o => o.id === overlayId)
            if (idx >= 0) {
              const newOverlays = [...overlays]
              newOverlays[idx] = { ...newOverlays[idx], ...patch }
              updateAnimationShot(pellicule.id, shot.id, { textOverlays: newOverlays })
              return
            }
          }
        }}
        onDelete={() => {
          if (!editingTextBlock) return
          const m = editingTextBlock.id.match(/^([^_]+(?:_[^_]+)*)__text_(.+)$/)
          if (!m) return
          const pelliculeId = m[1]
          const overlayId = m[2]
          const pellicule = animationPellicules.find(p => p.id === pelliculeId)
          if (!pellicule) return
          for (const shot of pellicule.shots ?? []) {
            const overlays = shot.textOverlays ?? []
            if (overlays.some(o => o.id === overlayId)) {
              updateAnimationShot(pellicule.id, shot.id, {
                textOverlays: overlays.filter(o => o.id !== overlayId),
              })
              return
            }
          }
        }}
      />
    </div>
  )
}
