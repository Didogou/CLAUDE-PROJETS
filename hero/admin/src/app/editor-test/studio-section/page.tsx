'use client'
/**
 * Studio Section — page V2 (refonte 2026-05-13).
 *
 * Plus de section.images[] JSONB. Consomme les nouvelles routes V2 :
 *   - GET /api/sections/[id]/timeline → blocs ordonnés + assets joints
 *   - GET /api/assets/[type]?bookId=X → banque library filtrée
 *   - POST /api/assets/[type] + POST /api/sections/[id]/timeline → création
 *   - DELETE /api/sections/[id]/timeline?blockId=X → retire bloc (asset reste)
 *   - DELETE /api/assets/[type]/[id] → supprime asset (cascade timeline)
 *
 * Architecture :
 *   - State local timelineState + bankAnimations/Images/Sfx/Music
 *   - Refetch après chaque mutation (= simple, pas optimistic UI V1)
 *   - SectionTimelineEditorV2 stateless reçoit state + bankAssets + handlers
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import StudioSectionLayout, { type SectionTab } from '@/components/studio-section/StudioSectionLayout'
import SectionTimelineEditorV2 from '@/components/studio-section/SectionTimelineEditorV2'
import PreviewModal from '@/components/preview-modal/PreviewModal'
import type { PelliculePersisted } from '@/types'
import type { PelliculeLayerRow } from '@/lib/pellicule-layers-types'
import type { PelliculeKeyframe } from '@/lib/pellicule-keyframes'
import { extractFramesFromVideo } from '@/lib/extract-frames'
import { useThemePreference } from '@/lib/use-theme-preference'
import { timelineRowsToState, type SectionTimelineRow } from '@/lib/timeline-v2-mapper'
import type { TimelineBlock } from '@/app/editor-test/animation-studio/components/multi-track-timeline/types'
import type { AnimationPellicule } from '@/components/image-editor/EditorStateContext'
import type {
  LibraryAnimation, LibraryImage, LibrarySfx, LibraryMusic,
} from '@/app/editor-test/animation-studio/components/multi-track-timeline/TimelineLibrary'
// Refonte 2026-05-17 — Effets / Capture sur vignettes timeline (parité Studio
// Animation). Même modale EffectsModal qu'AnimationStudioInner, ciblée sur
// l'asset_animation correspondant à la vignette pellicule.
import EffectsModal from '@/components/image-editor/designer/effects/EffectsModal'
// Refonte 2026-05-19 — banques Persos + Objets dans le rail Studio Section.
// Réutilise BookNpcsBank (Studio Creator) tel quel ; adaptation par contexte.
import BookNpcsBank from '@/components/studio-creator/BookNpcsBank'
import BookItemsBank from '@/components/studio-creator/BookItemsBank'
import BookNpcCreatorModal from '@/components/studio-creator/BookNpcCreatorModal'
import ItemCreatorModal from '@/components/image-editor/designer/ItemCreatorModal'
import VideoCutModal, { type VideoCutResult } from '@/components/studio-section/VideoCutModal'
import '@/components/studio-section/video-cut-modal.css'
import Toaster, { useToasts } from '@/components/studio-section/Toaster'
// BookNpcCreatorModal (utilisé par BookNpcsBank) embarque CharacterCreatorModal
// qui dépend de CharacterStoreProvider → on wrap toute la page côté Studio
// Section (comme déjà fait dans Studio Creator/Animation Studio).
import { CharacterStoreProvider } from '@/lib/character-store'
import {
  migrateLegacyEffectsParams,
  type ComposedEffectsState,
} from '@/lib/video-effects/looks-catalog'

type EffectsModalTarget = {
  assetId: string
  videoUrl: string | null
  firstFrameUrl: string | null
  label: string | null
  effects_params: Record<string, unknown> | null
}

/** Mesure la durée d'une vidéo (en ms) via un HTMLVideoElement temporaire.
 *  Refonte 2026-05-19 — feature Couper : après cut/split, on a besoin de la
 *  nouvelle durée pour update section_timeline.duration_ms. */
function measureVideoDurationMs(src: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const cleanup = () => { try { URL.revokeObjectURL(src) } catch { /* noop */ } }
    v.onloadedmetadata = () => {
      const ms = Math.round((v.duration || 0) * 1000)
      cleanup()
      resolve(ms)
    }
    v.onerror = () => { cleanup(); resolve(0) }
    v.src = src
  })
}

export default function StudioSectionTestPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', color: '#888' }}>Chargement…</div>}>
      {/* CharacterStoreProvider requis par BookNpcCreatorModal (chaîne
       *  Studio Section → BookNpcsBank → BookNpcCreatorModal → CharacterCreatorModal
       *  qui consomme useCharacterStore). */}
      <CharacterStoreProvider>
        <StudioSectionInner />
      </CharacterStoreProvider>
    </Suspense>
  )
}

function StudioSectionInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sectionId = searchParams?.get('sectionId') ?? null

  // ── State ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SectionTab>('storyboard')
  const { theme, toggleTheme } = useThemePreference()
  // Refonte 2026-05-20 — toasts pour feedback inline (frame supprimée, split, etc).
  const [toasts, addToast, dismissToast] = useToasts()
  // Refonte 2026-05-20 — undo stack pour Ctrl+Z. V1 : seul "delete-frame" undoable
  // (le revert d'un split nécessite delete asset partB + delete timeline row + reshift,
  // plus complexe — V2). Chaque entrée = snapshot de l'état avant l'op.
  type UndoAction = {
    type: 'delete-frame'
    assetId: string
    rowId: string
    prevVideoUrl: string
    prevDurationMs: number
    /** Rows suivantes shiftées, on garde leurs start_ms d'origine pour revert. */
    shiftedRows: Array<{ id: string; prevStartMs: number }>
    /** Pour le toast d'undo. */
    label: string
  }
  const [undoStack, setUndoStack] = useState<UndoAction[]>([])
  // Refonte 2026-05-20 — flag global pendant cut/split ffmpeg (figure UI).
  const [cutProcessing, setCutProcessing] = useState(false)

  const [loading, setLoading] = useState<boolean>(!!sectionId)
  const [error, setError] = useState<string | null>(null)

  // Section + book metadata
  const [bookId, setBookId] = useState<string | null>(null)
  const [bookTitle, setBookTitle] = useState<string>('Sans livre')
  const [sectionNumber, setSectionNumber] = useState<number>(0)
  const [sectionTitle, setSectionTitle] = useState<string>('Section')

  // Timeline V2
  const [timelineRows, setTimelineRows] = useState<SectionTimelineRow[]>([])

  // Banks V2 — assets visibles dans le scope livre+section
  const [bankAnimations, setBankAnimations] = useState<LibraryAnimation[]>([])
  const [bankImages, setBankImages] = useState<LibraryImage[]>([])
  const [bankSfx, setBankSfx] = useState<LibrarySfx[]>([])
  const [bankMusic, setBankMusic] = useState<LibraryMusic[]>([])

  // E.1 : protection double-clic
  const [creating, setCreating] = useState<'animation' | 'image' | null>(null)
  // Chantier 1 refinement (2026-05-16) — toggle banque animations+images.
  // Ouverte par défaut, fermable via croix interne ou mini-rail.
  // Refonte 2026-05-19 — banque fermée par défaut au load (était true). Auteur
  // l'ouvre explicitement via le rail de gauche s'il veut ajouter des assets.
  const [bankPanelOpen, setBankPanelOpen] = useState(false)
  // Refonte 2026-05-19 — scope de la banque : null = libre (2 tabs visibles,
  // ouverture via rail), 'animations'/'images' = lock sur 1 tab (ouverture via
  // toolbar Animation ou Image dans SectionTimelineEditorV2).
  const [bankLockedTab, setBankLockedTab] = useState<'animations' | 'images' | null>(null)
  // Refonte 2026-05-19 — modaux NPC + Item au niveau page (create + edit) pour
  // que les tiles "+ Créer / ✎ Édit" de la banque slide-open puissent les
  // déclencher SANS naviguer vers les tabs rail. Distinct des modaux internes
  // de BookNpcsBank / BookItemsBank (tabs rail). Save → bump refreshKey banque.
  type NpcRow = import('@/components/studio-creator/BookNpcCreatorModal').NpcRow
  type ItemFormData = import('@/components/image-editor/designer/ItemCreatorModal').ItemFormData
  const [npcModalOpen, setNpcModalOpen] = useState(false)
  const [npcModalEditingRow, setNpcModalEditingRow] = useState<NpcRow | null>(null)
  const [itemModalOpen, setItemModalOpen] = useState(false)
  const [itemModalEditingRow, setItemModalEditingRow] = useState<ItemFormData | null>(null)
  // Counter pour forcer la banque slide-open à refetch (après save/delete).
  const [bankRefreshKey, setBankRefreshKey] = useState(0)
  // Refonte 2026-05-19 — modale Couper (cut/split). Stocke l'asset_id +
  // videoUrl + title du pellicule en cours d'édition pour ffmpeg.wasm.
  const [videoCutModalState, setVideoCutModalState] = useState<{
    assetId: string
    videoUrl: string
    title: string
  } | null>(null)
  // Refonte 2026-05-17 — PreviewModal unifié (cf project_preview_modal_unified).
  // Remplace l'ancien sidebar AnimationStudioPreview à droite de la timeline.
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  // Refonte 2026-05-17 — sync timeline ↔ preview bidirectionnelle.
  // sharedIsPlaying : true/false synchro entre les 2. null = pas de control
  // externe (mode standalone preview, après que le modal soit fermé).
  const [sharedIsPlaying, setSharedIsPlaying] = useState<boolean | null>(null)
  // Cursor global ms partagé : MAJ par PreviewModal pendant lecture, transmis
  // à MultiTrackTimeline pour seek. Et inverse au drag.
  const [sharedCursorMs, setSharedCursorMs] = useState<number | null>(null)
  // Bloc timeline sélectionné (refonte 2026-05-14s) : drive l'expansion
  // d'une action de la toolbar avec ses subTools (Continuer/Régénérer pour
  // animation, Modifier/Animer pour image).
  const [selectedBlock, setSelectedBlock] = useState<{
    id: string; kind: 'video' | 'image_static'; assetId: string
  } | null>(null)

  // Refonte 2026-05-17 — Effets / Capture (parité Studio Animation).
  // Modales ouvertes via le bandeau bas des vignettes pellicule.
  const [effectsModalTarget, setEffectsModalTarget] = useState<EffectsModalTarget | null>(null)
  const [captureModalTarget, setCaptureModalTarget] = useState<EffectsModalTarget | null>(null)
  const effectsPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Phase A.4 keyframes 2026-05-18 — map pelliculeId → layers, alimentée par
  // PelliculeLayersPanel via onLayersChange. Passée au PreviewModal embedded
  // pour rendu live des calques au-dessus de la pellicule en cours.
  const [layersByPelliculeId, setLayersByPelliculeId] = useState<Record<string, PelliculeLayerRow[]>>({})
  // Phase A.5 keyframes 2026-05-18 — mask draft state (overlay drawing en
  // cours). null = pas de dessin. Quand non-null, le PreviewModal embedded
  // rend un overlay capture-clicks sur la pellicule correspondante.
  const [maskDraft, setMaskDraft] = useState<{
    pelliculeId: string
    layerId: string
    shape: 'rect' | 'polygon'
    points: Array<[number, number]>
  } | null>(null)
  // Phase A bis bonus 2026-05-18 — contexte preview quand un calque est sélectionné.
  // Drive : seek auto sur la pellicule parente + open preview pause + badge
  // contextuel + scope playback (stop à la fin de cette pellicule).
  const [previewLayerContext, setPreviewLayerContext] = useState<{
    parentPelliculeId: string
    layerLabel: string
    parentLabel: string
    stopAtGlobalMs: number
  } | null>(null)
  // Phase B keyframes 2026-05-18 — keyframes pellicule (= section_timeline.keyframes
  // JSONB, migration 089). Stocké en map locale pour live preview + persisté via
  // PATCH /api/sections/[id]/timeline (extension du whitelist).
  const pelliculeKeyframesById = useMemo<Record<string, PelliculeKeyframe[]>>(() => {
    const m: Record<string, PelliculeKeyframe[]> = {}
    for (const r of timelineRows) {
      if (r.track === 'video_image' && r.keyframes && r.keyframes.length > 0) {
        m[r.id] = r.keyframes as PelliculeKeyframe[]
      }
    }
    return m
  }, [timelineRows])

  // ── Fetch all V2 ────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (sId: string) => {
    setError(null)
    try {
      // 1. Section + book metadata
      const secRes = await fetch(`/api/sections/${sId}`)
      if (!secRes.ok) throw new Error(`section HTTP ${secRes.status}`)
      const { section } = await secRes.json() as {
        section: { number: number; summary?: string | null; book_id: string }
      }
      setSectionNumber(section.number)
      setSectionTitle(section.summary ?? `Section ${section.number}`)
      setBookId(section.book_id)
      const bId = section.book_id

      const bookRes = await fetch(`/api/books/${bId}`)
      if (bookRes.ok) {
        const { book } = await bookRes.json() as { book: { title?: string } }
        setBookTitle(book.title ?? `Livre ${bId}`)
      }

      // 2. Timeline blocks
      const tlRes = await fetch(`/api/sections/${sId}/timeline`)
      if (!tlRes.ok) throw new Error(`timeline HTTP ${tlRes.status}`)
      const { blocks } = await tlRes.json() as { blocks: SectionTimelineRow[] }
      setTimelineRows(blocks)

      // Phase A bis 2026-05-18 — pré-fetch tous les calques des pellicules
      // video_image pour les afficher d'emblée sur la track Calques (sans
      // attendre que l'auteur ouvre le panel d'édition).
      const videoBlockIds = blocks
        .filter(b => b.track === 'video_image')
        .map(b => b.id)
      if (videoBlockIds.length > 0) {
        const layersResults = await Promise.all(
          videoBlockIds.map(id =>
            fetch(`/api/pellicules/${id}/layers`)
              .then(r => r.ok ? r.json() : { layers: [] })
              .catch(() => ({ layers: [] }))
          )
        )
        const map: Record<string, PelliculeLayerRow[]> = {}
        videoBlockIds.forEach((id, i) => {
          const ls = (layersResults[i] as { layers?: PelliculeLayerRow[] }).layers ?? []
          if (ls.length > 0) map[id] = ls
        })
        setLayersByPelliculeId(map)
      }

      // 3. Banks — fetch en parallèle par type, scope bookId
      const [animRes, imgRes, audioRes] = await Promise.all([
        fetch(`/api/assets/animation?bookId=${bId}`),
        fetch(`/api/assets/image?bookId=${bId}`),
        fetch(`/api/assets/audio?bookId=${bId}`),
      ])
      if (animRes.ok) {
        const { assets } = await animRes.json() as { assets: Array<{
          id: string; label?: string; first_frame_url?: string; video_url?: string;
          shots?: Array<{ duration?: number }>
        }> }
        setBankAnimations(assets.map(a => ({
          id: a.id,
          label: a.label ?? `Animation ${a.id.slice(0, 4)}`,
          videoUrl: a.video_url ?? null,
          firstFrameUrl: a.first_frame_url ?? null,
          durationSec: (a.shots ?? []).reduce((s, sh) => s + (sh.duration ?? 4), 0) || 4,
          pelliculeId: a.id,
          shotId: a.id,
        })))
      }
      if (imgRes.ok) {
        const { assets } = await imgRes.json() as { assets: Array<{
          id: string; label?: string; url: string
        }> }
        setBankImages(assets.map(a => ({
          id: a.id,
          label: a.label ?? `Image ${a.id.slice(0, 4)}`,
          url: a.url,
        })))
      }
      if (audioRes.ok) {
        const { assets } = await audioRes.json() as { assets: Array<{
          id: string; label?: string; audio_url: string; kind: 'sfx' | 'music'; duration_sec?: number
        }> }
        const sfx = assets.filter(a => a.kind === 'sfx')
        const music = assets.filter(a => a.kind === 'music')
        setBankSfx(sfx.map(a => ({
          id: a.id, label: a.label ?? 'SFX', url: a.audio_url, durationSec: a.duration_sec ?? 3,
        })))
        setBankMusic(music.map(a => ({
          id: a.id, label: a.label ?? 'Musique', url: a.audio_url, durationSec: a.duration_sec ?? 30,
        })))
      }

      setLoading(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[StudioSection V2] load failed:', msg)
      setError(msg)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!sectionId) {
      setLoading(false)
      return
    }
    void fetchAll(sectionId)
  }, [sectionId, fetchAll])

  // Refonte 2026-05-17 — auto-probe durations vidéos au chargement.
  // Fix les blocs déjà en DB qui ont une duration hardcoded à 4000ms (legacy
  // avant le fix du POST timeline). Probe via <video> HTML5 metadata, PATCH
  // si écart > 200ms. Update local state immédiat. Idempotent (ne re-probe
  // pas si déjà fait via fingerprint).
  const probedRowsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!sectionId || timelineRows.length === 0) return
    let cancelled = false
    void (async () => {
      const updates: Array<{ id: string; duration_ms: number }> = []
      for (const r of timelineRows) {
        if (cancelled) return
        if (r.track !== 'video_image' || r.asset_type !== 'animation') continue
        if (probedRowsRef.current.has(r.id)) continue
        const a = (r.asset ?? {}) as Record<string, unknown>
        const videoUrl = (a.video_url as string | undefined) ?? null
        if (!videoUrl) continue
        try {
          const probedMs = await new Promise<number>((resolve, reject) => {
            const v = document.createElement('video')
            v.preload = 'metadata'
            v.src = videoUrl
            v.onloadedmetadata = () => {
              if (isFinite(v.duration) && v.duration > 0) resolve(Math.round(v.duration * 1000))
              else reject(new Error('invalid duration'))
            }
            v.onerror = () => reject(new Error('video load error'))
            setTimeout(() => reject(new Error('probe timeout')), 5000)
          })
          probedRowsRef.current.add(r.id)
          if (Math.abs(probedMs - r.duration_ms) > 200) {
            updates.push({ id: r.id, duration_ms: probedMs })
            console.log(`[probe] bloc ${r.id.slice(0,8)} : ${r.duration_ms}ms → ${probedMs}ms`)
          }
        } catch (err) {
          console.warn(`[probe] failed for ${r.id.slice(0,8)}:`, err)
        }
      }
      if (cancelled || updates.length === 0) return
      // Recompact start_ms après changement de durations
      const updatedMap = new Map(updates.map(u => [u.id, u.duration_ms]))
      const trackRows = timelineRows
        .filter(r => r.track === 'video_image')
        .slice()
        .sort((a, b) => a.start_ms - b.start_ms)
      const otherTrackRows = timelineRows.filter(r => r.track !== 'video_image')
      let cursor = 0
      const compactedTrack = trackRows.map((r, idx) => {
        const newDur = updatedMap.get(r.id) ?? r.duration_ms
        const nr = { ...r, start_ms: cursor, duration_ms: newDur, position_idx: idx }
        cursor += newDur
        return nr
      })
      setTimelineRows([...otherTrackRows, ...compactedTrack])
      // PATCH bulk DB : duration_ms + start_ms recompactés. 2-phase pour position_idx.
      const changed: { id: string; start_ms: number; duration_ms: number; position_idx: number }[] = []
      for (const r of compactedTrack) {
        const prev = timelineRows.find(p => p.id === r.id)
        if (!prev) continue
        if (prev.start_ms !== r.start_ms || prev.duration_ms !== r.duration_ms || prev.position_idx !== r.position_idx) {
          changed.push({ id: r.id, start_ms: r.start_ms, duration_ms: r.duration_ms, position_idx: r.position_idx })
        }
      }
      if (changed.length === 0) return
      try {
        const TEMP_OFFSET = 100000
        const phase1 = changed.map(b => ({ id: b.id, position_idx: TEMP_OFFSET + b.position_idx }))
        await fetch(`/api/sections/${sectionId}/timeline`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: phase1 }),
        })
        await fetch(`/api/sections/${sectionId}/timeline`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: changed }),
        })
      } catch (err) {
        console.warn('[probe] PATCH bulk failed:', err)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineRows.length, sectionId])

  // ── Compute TimelineState depuis rows + injection des calques ──────────
  // Phase A bis 2026-05-18 — passe layersByPelliculeId au mapper pour qu'il
  // injecte les LayerBlock sur la nouvelle track 'layers'.
  const timelineState = useMemo(
    () => timelineRowsToState(timelineRows, layersByPelliculeId),
    [timelineRows, layersByPelliculeId],
  )

  // ── Compute pellicules synthétiques pour preview phone ──────────────────
  const previewPellicules = useMemo<AnimationPellicule[]>(() => {
    return timelineRows
      .filter(r => r.track === 'video_image')
      .map((r, idx) => {
        const a = (r.asset ?? {}) as Record<string, unknown>
        const videoUrl = (a.video_url as string | undefined) ?? null
        const firstFrameUrl = (a.first_frame_url as string | undefined)
          ?? (a.url as string | undefined) ?? null
        return {
          id: r.id,
          type: r.asset_type === 'image' ? 'image_static' : 'animation',
          characterIds: [],
          // Phase A bis bonus 2026-05-18 — label de la pellicule (label asset ou fallback)
          // pour afficher dans la preview pendant la lecture (bas-gauche du canvas).
          // Refonte 2026-05-19 — robust fallback : si a.label est vide (""), undefined, ou null,
          // on use "Pellicule N". Utilise `||` (pas `??`) pour catch les strings vides.
          label: ((a.label as string | undefined) || `Pellicule ${idx + 1}`),
          shots: [{
            id: `synth-${idx}`,
            shot: 'medium' as const,
            camera: 'static' as const,
            duration: r.duration_ms / 1000,
            characterIds: [],
            speakerId: null,
            perCharacter: {},
          }],
          videoUrl,
          firstFrameUrl,
          lastFrameUrl: (a.last_frame_url as string | undefined) ?? null,
          scene_visible: null,
          scene_offscreen: null,
          characters_appearance: null,
        } satisfies AnimationPellicule
      })
  }, [timelineRows])

  // 1ère URL trouvée pour le fond preview
  const previewBaseImageUrl = useMemo(
    () => previewPellicules.find(p => p.firstFrameUrl)?.firstFrameUrl ?? null,
    [previewPellicules],
  )

  // Refonte 2026-05-17 — Effets / Capture : construit le target depuis l'asset
  // d'une vignette pellicule (= bloc video sur la timeline). On lit la row
  // timelineRows pour récupérer asset.video_url / first_frame_url / etc.
  const buildTargetFromAssetId = useCallback((assetId: string): EffectsModalTarget | null => {
    const row = timelineRows.find(r => r.asset_id === assetId && r.asset_type === 'animation')
    if (!row) return null
    const a = (row.asset ?? {}) as Record<string, unknown>
    return {
      assetId,
      videoUrl: (a.video_url as string | undefined) ?? null,
      firstFrameUrl: (a.first_frame_url as string | undefined) ?? null,
      label: (a.label as string | undefined) ?? null,
      effects_params: (a.effects_params as Record<string, unknown> | null) ?? null,
    }
  }, [timelineRows])

  // ── Handlers ────────────────────────────────────────────────────────────

  /** Lazy-create 2026-05-13 (image+animation) : ouvre l'éditeur en MODE DRAFT.
   *  RIEN en DB (ni asset, ni bloc timeline). L'asset + le bloc sont créés
   *  côté éditeur au moment du commit (image: bouton "Commencer l'édition" ;
   *  animation: première vidéo générée). Quitte sans finaliser → 0 orphelin. */
  const handleAddPlan = useCallback((kind: 'image' | 'animation') => {
    if (creating) return
    if (!sectionId || !bookId) {
      alert('Création impossible — pas de section/livre.')
      return
    }
    setCreating(kind)
    const draftId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const params = new URLSearchParams({
      draftAssetId: draftId,
      draftKind: kind,
      sectionId,
      returnSectionId: sectionId,
    })
    const target = kind === 'animation'
      ? '/editor-test/animation-studio'
      : '/editor-test/new-layout'
    router.push(`${target}?${params.toString()}`)
  }, [creating, sectionId, bookId, router])

  /** Click sur un bloc timeline (refonte 2026-05-14s) : déclenche l'expansion
   *  d'une action toolbar avec ses subTools. Plus de router.push direct —
   *  l'auteur choisit l'action depuis le drawer (Continuer/Régénérer pour
   *  animation, Modifier/Animer pour image). */
  const handleSelectBlock = useCallback((block: TimelineBlock) => {
    if (block.kind === 'video' || block.kind === 'image_static') {
      setSelectedBlock({ id: block.id, kind: block.kind, assetId: block.pelliculeId })
      // Refonte 2026-05-19 v2 — UX uniforme : click pellicule = PAUSE + seek
      // au début + clear scope. La barre EST l'indicateur du preview (qui
      // affiche la 1ère frame en pause). User clique Play pour démarrer.
      setSharedIsPlaying(false)
      setSharedCursorMs(block.startMs)
      setPreviewLayerContext(null)
    } else {
      setSelectedBlock(null)
    }
  }, [])

  /** Refonte 2026-05-20 — opération inline cut/split au cursor (remplace
   *  l'ancienne modale Couper). Exécute ffmpeg dans le browser, upload, PATCH
   *  l'asset + la timeline, sync local state. Couvre 2 modes :
   *    - 'delete-frame' : cutRange [cursor, cursor + 1 frame] sur la pellicule
   *    - 'split'        : splitAt(cursor) → partA (current) + partB (nouveau asset).
   *      partB n'est PAS auto-inséré dans la timeline V1 (visible en banque).
   */
  const FRAME_MS_30FPS = 1000 / 30
  const runInlineVideoCut = useCallback(async (
    assetId: string,
    mode: 'delete-frame' | 'split',
    cursorOffsetMs: number,
  ) => {
    if (!sectionId || !bookId) return
    const row = timelineRows.find(r => r.asset_id === assetId)
    const asset = row?.asset as { video_url?: string; label?: string } | null
    const videoUrl = asset?.video_url
    if (!row || !videoUrl) {
      addToast({ message: 'Pellicule sans vidéo générée.', type: 'info' })
      return
    }
    // Toast immédiat "en cours" : ffmpeg.wasm peut prendre 5-15s (cold start
    // 1ère fois ~5s pour load core + 3-10s pour le cut/split). Sans feedback
    // user pense que le click n'a rien fait. Le toast suivant (success/error)
    // viendra remplacer / s'empiler.
    const processingMsg = mode === 'delete-frame'
      ? 'Suppression de la frame en cours…'
      : 'Split de la pellicule en cours…'
    // Refonte 2026-05-20 — capture l'id du toast "en cours" pour le dismiss
    // explicitement au finally (sinon il restait 30s et empilait à chaque cut).
    const processingToastId = addToast({ message: processingMsg, type: 'info', durationMs: 30000 })
    setCutProcessing(true)
    // Refonte 2026-05-20 — si une lecture est en cours, force pause AVANT le
    // cut (sinon le cursor continuait d'avancer en background pendant ffmpeg).
    setSharedIsPlaying(false)
    try {
      // Import dynamique pour pas charger ffmpeg au mount.
      const { cutRange, splitAt } = await import('@/lib/video-cut')
      const uploadBlob = async (blob: Blob, label: string): Promise<string> => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result))
          r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
          r.readAsDataURL(blob)
        })
        const path = `videos/cut/${bookId}/${assetId}_${label}_${Date.now()}.mp4`
        const res = await fetch('/api/storage/upload-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_url: dataUrl, path }),
        })
        if (!res.ok) {
          const eb = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(eb.error ?? `Upload HTTP ${res.status}`)
        }
        const data = await res.json() as { url?: string; error?: string }
        if (!data.url) throw new Error(data.error ?? 'Upload sans URL')
        return data.url
      }
      const patchTimelineDuration = async (newDurationMs: number, newVideoUrl: string) => {
        const deltaMs = newDurationMs - row.duration_ms
        const sameTrackAfter = timelineRows.filter(r =>
          r.track === row.track && r.position_idx > row.position_idx)
        const blocksPatch = [
          { id: row.id, duration_ms: newDurationMs },
          ...sameTrackAfter.map(r => ({ id: r.id, start_ms: r.start_ms + deltaMs })),
        ]
        await fetch(`/api/sections/${sectionId}/timeline`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: blocksPatch }),
        })
        setTimelineRows(prev => prev.map(r => {
          if (r.id === row.id) return { ...r, duration_ms: newDurationMs, asset: { ...(r.asset ?? {}), video_url: newVideoUrl } }
          if (r.track === row.track && r.position_idx > row.position_idx) {
            return { ...r, start_ms: r.start_ms + deltaMs }
          }
          return r
        }))
      }

      if (mode === 'delete-frame') {
        const startSec = cursorOffsetMs / 1000
        const endSec = Math.min(row.duration_ms / 1000, startSec + FRAME_MS_30FPS / 1000)
        if (endSec - startSec < 0.01) {
          addToast({ message: 'Atteint la fin de la pellicule, aucune frame à supprimer.', type: 'info' })
          return
        }
        // Snapshot pour undo AVANT l'op.
        const sameTrackAfterSnap = timelineRows.filter(r =>
          r.track === row.track && r.position_idx > row.position_idx)
        const undoEntry: UndoAction = {
          type: 'delete-frame',
          assetId,
          rowId: row.id,
          prevVideoUrl: videoUrl,
          prevDurationMs: row.duration_ms,
          shiftedRows: sameTrackAfterSnap.map(r => ({ id: r.id, prevStartMs: r.start_ms })),
          label: asset?.label ?? 'Pellicule',
        }
        const blob = await cutRange(videoUrl, startSec, endSec)
        const newUrl = await uploadBlob(blob, 'delframe')
        await fetch(`/api/assets/animation/${assetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_url: newUrl }),
        })
        const newDurationMs = await measureVideoDurationMs(URL.createObjectURL(blob))
        if (newDurationMs > 0) await patchTimelineDuration(newDurationMs, newUrl)
        // Push undo APRÈS succès. Cap à 20 entrées pour pas exploser mémoire.
        setUndoStack(prev => [...prev.slice(-19), undoEntry])
        // Le cursor reste à la même position visuelle MAIS visualisera la
        // frame suivante (le contenu après le cut commence ici). On notifie.
        addToast({ message: '1 frame supprimée (≈33 ms) · Ctrl+Z pour annuler', type: 'success' })
        setBankRefreshKey(k => k + 1)
      } else {
        // SPLIT au cursor → partA replace courant, partB inséré juste après
        // dans la timeline + nouveau asset banque "label_2".
        const splitSec = cursorOffsetMs / 1000
        if (splitSec < 0.05 || splitSec > row.duration_ms / 1000 - 0.05) {
          addToast({
            message: 'Place le curseur au moins 50 ms à l\'intérieur de la pellicule.',
            type: 'info',
          })
          return
        }
        const [partA, partB] = await splitAt(videoUrl, splitSec)
        const [urlA, urlB] = await Promise.all([
          uploadBlob(partA, 'splitA'),
          uploadBlob(partB, 'splitB'),
        ])
        // PATCH partA = pellicule courante shortened.
        await fetch(`/api/assets/animation/${assetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_url: urlA }),
        })
        const newDurationAMs = await measureVideoDurationMs(URL.createObjectURL(partA))
        const newDurationBMs = await measureVideoDurationMs(URL.createObjectURL(partB))
        // patchTimelineDuration calcule deltaMs = newA - oldDuration. Ce delta
        // sera négatif (partA shorter). On shift TOUS les blocks suivants
        // par ce delta, PUIS on insère partB qui prendra leur ancienne place +
        // décale encore de partBDuration. Ordre : shift -|deltaA|, INSERT partB
        // à (start+newDurationA), shift+partBDuration les rows après.
        if (newDurationAMs > 0) await patchTimelineDuration(newDurationAMs, urlA)

        // POST nouvel asset partB avec label = originalLabel + "_2".
        const originalLabel = asset?.label ?? 'Vidéo'
        const partBLabel = `${originalLabel}_2`
        const newAssetRes = await fetch('/api/assets/animation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId, sectionId, video_url: urlB, label: partBLabel }),
        })
        if (!newAssetRes.ok) {
          const eb = await newAssetRes.json().catch(() => ({})) as { error?: string }
          throw new Error(eb.error ?? `POST asset partB HTTP ${newAssetRes.status}`)
        }
        const newAssetData = await newAssetRes.json() as { asset?: { id: string }; id?: string }
        const newAssetId = newAssetData.asset?.id ?? newAssetData.id
        if (!newAssetId) throw new Error('Nouveau asset partB sans id retourné')

        // Insertion timeline : shift position_idx + start_ms des rows suivantes,
        // puis insert nouvelle row à position_idx = current + 1.
        // Récupère le state à jour APRÈS patchTimelineDuration (qui a déjà shifté).
        const currentRowAfter = { ...row, duration_ms: newDurationAMs }
        const sameTrackAfter = timelineRows.filter(r =>
          r.track === row.track && r.position_idx > row.position_idx)
        // Phase 1 : bumper position_idx +1 et start_ms += partBDuration en 2-phase
        // commit pour éviter UNIQUE collision sur position_idx.
        const TEMP_OFFSET = 100000
        if (sameTrackAfter.length > 0) {
          const phase1 = sameTrackAfter.map(r => ({ id: r.id, position_idx: TEMP_OFFSET + r.position_idx + 1 }))
          await fetch(`/api/sections/${sectionId}/timeline`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks: phase1 }),
          })
        }
        // POST partB en position_idx = current + 1, start_ms = currentRow.start_ms + newDurationA.
        const postRowRes = await fetch(`/api/sections/${sectionId}/timeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            track: 'video_image',
            asset_type: 'animation',
            asset_id: newAssetId,
            start_ms: currentRowAfter.start_ms + newDurationAMs,
            duration_ms: newDurationBMs,
            position_idx: currentRowAfter.position_idx + 1,
          }),
        })
        if (!postRowRes.ok) {
          const eb = await postRowRes.json().catch(() => ({})) as { error?: string }
          throw new Error(eb.error ?? `POST timeline partB HTTP ${postRowRes.status}`)
        }
        const postRowData = await postRowRes.json() as { block?: SectionTimelineRow }
        const newRow = postRowData.block
        // Phase 2 : remet les position_idx et shift start_ms par +partBDuration.
        if (sameTrackAfter.length > 0) {
          const phase2 = sameTrackAfter.map(r => ({
            id: r.id,
            position_idx: r.position_idx + 1,
            start_ms: r.start_ms + newDurationBMs,
          }))
          await fetch(`/api/sections/${sectionId}/timeline`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks: phase2 }),
          })
        }
        // Sync local : injecter le nouveau row + shifter les suivants. Mise à
        // jour de currentRow déjà faite par patchTimelineDuration au-dessus.
        if (newRow) {
          setTimelineRows(prev => {
            const shifted = prev.map(r => {
              if (r.track === row.track && r.position_idx > row.position_idx) {
                return { ...r, position_idx: r.position_idx + 1, start_ms: r.start_ms + newDurationBMs }
              }
              return r
            })
            return [...shifted, newRow]
          })
        }
        setBankRefreshKey(k => k + 1)
        addToast({
          message: `Pellicule splitée. Partie 2 "${partBLabel}" insérée dans la timeline.`,
          type: 'success',
          durationMs: 5000,
        })
      }
      // Refonte 2026-05-20 — resync complet après cut/split : bankAnimations
      // local cache contenait l'ancienne videoUrl + durationSec → un re-drag
      // de l'asset coupé créait un bloc timeline avec l'ANCIENNE durée. fetchAll
      // re-récupère assets + timeline depuis la DB pour cohérence totale.
      if (sectionId) {
        await fetchAll(sectionId)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[runInlineVideoCut] failed:', msg)
      addToast({ message: `Échec : ${msg}`, type: 'error', durationMs: 6000 })
    } finally {
      // Dismiss le toast "en cours…" (qu'on ait succès OU erreur).
      dismissToast(processingToastId)
      setCutProcessing(false)
    }
  }, [sectionId, bookId, timelineRows, addToast, dismissToast, fetchAll])

  /** Refonte 2026-05-20 — Undo (Ctrl+Z) — pop la dernière action et revert :
   *  PATCH back asset video_url + duration_ms + reshift suivants vers leurs
   *  start_ms d'origine. */
  const undoLastAction = useCallback(async () => {
    if (undoStack.length === 0 || !sectionId) {
      addToast({ message: 'Rien à annuler.', type: 'info', durationMs: 1500 })
      return
    }
    const action = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    if (action.type !== 'delete-frame') {
      addToast({ message: 'Cette action ne peut pas être annulée (V1 limite delete-frame).', type: 'info' })
      return
    }
    try {
      // 1. PATCH back l'asset video_url à la version précédente.
      await fetch(`/api/assets/animation/${action.assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: action.prevVideoUrl }),
      })
      // 2. PATCH back duration_ms + start_ms des suivants à leurs valeurs originales.
      const blocksPatch = [
        { id: action.rowId, duration_ms: action.prevDurationMs },
        ...action.shiftedRows.map(s => ({ id: s.id, start_ms: s.prevStartMs })),
      ]
      await fetch(`/api/sections/${sectionId}/timeline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: blocksPatch }),
      })
      // 3. Sync local : rétablir asset.video_url + duration + starts.
      setTimelineRows(prev => prev.map(r => {
        if (r.id === action.rowId) {
          return {
            ...r,
            duration_ms: action.prevDurationMs,
            asset: { ...(r.asset ?? {}), video_url: action.prevVideoUrl },
          }
        }
        const shifted = action.shiftedRows.find(s => s.id === r.id)
        if (shifted) return { ...r, start_ms: shifted.prevStartMs }
        return r
      }))
      setBankRefreshKey(k => k + 1)
      addToast({ message: `Frame restaurée sur "${action.label}".`, type: 'success' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[undoLastAction] failed:', msg)
      addToast({ message: `Annulation échouée : ${msg}`, type: 'error', durationMs: 5000 })
    }
  }, [undoStack, sectionId, addToast])

  /** Listener clavier global Ctrl+Z / Cmd+Z. Skip si focus sur input/textarea
   *  (= don't steal undo de l'OS pour les zones de texte). */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')
      if (isUndo) {
        e.preventDefault()
        void undoLastAction()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoLastAction])

  /** Retire UN bloc de la timeline + RECOMPACTE les blocs suivants de la même
   *  track (= les pellicules d'après comblent le trou). Refonte 2026-05-17.
   *  Cycle 4 (2026-05-16) : bump updated_at de l'asset après retrait.
   *  Cycle compact : 2-phase commit position_idx pour éviter UNIQUE collision. */
  const handleDeleteBlock = useCallback(async (blockId: string) => {
    if (!sectionId) return
    const prevRows = timelineRows
    const removedRow = prevRows.find(r => r.id === blockId)
    if (!removedRow) return

    // Compute compact state local après suppression
    const trackOf = removedRow.track
    const afterDelete = prevRows.filter(r => r.id !== blockId)
    const sortedTrack = afterDelete
      .filter(r => r.track === trackOf)
      .slice()
      .sort((a, b) => a.start_ms - b.start_ms)
    let cursor = 0
    const compactedTrack = sortedTrack.map((r, idx) => {
      const nr = { ...r, start_ms: cursor, position_idx: idx }
      cursor += r.duration_ms
      return nr
    })
    const otherTrackRows = afterDelete.filter(r => r.track !== trackOf)
    const finalRows = [...otherTrackRows, ...compactedTrack]
    setTimelineRows(finalRows)

    // Refonte 2026-05-20 — reset cursor si le timeline devient vide OU si le
    // cursor était au-delà du nouveau total. Évite que la barre rouge reste
    // figée à 13s avec timeline vide ou raccourcie.
    if (finalRows.length === 0) {
      setSharedCursorMs(0)
      setSharedIsPlaying(false)
    } else {
      const newMaxMs = finalRows.reduce((max, r) =>
        Math.max(max, r.start_ms + r.duration_ms), 0)
      if ((sharedCursorMs ?? 0) > newMaxMs) {
        setSharedCursorMs(Math.max(0, newMaxMs - 1))
      }
    }

    try {
      // 1. DELETE le bloc retiré
      const res = await fetch(`/api/sections/${sectionId}/timeline?blockId=${blockId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`DELETE HTTP ${res.status}`)

      // 2. PATCH bulk pour recompact (start_ms + position_idx) des blocs
      //    déplacés. 2-phase commit pour éviter conflit UNIQUE position_idx.
      const changedBlocks: { id: string; start_ms: number; position_idx: number }[] = []
      for (const newRow of compactedTrack) {
        const prev = prevRows.find(p => p.id === newRow.id)
        if (!prev || prev.start_ms !== newRow.start_ms || prev.position_idx !== newRow.position_idx) {
          changedBlocks.push({
            id: newRow.id,
            start_ms: newRow.start_ms,
            position_idx: newRow.position_idx,
          })
        }
      }
      if (changedBlocks.length > 0) {
        const TEMP_OFFSET = 100000
        const phase1 = changedBlocks.map(b => ({ id: b.id, position_idx: TEMP_OFFSET + b.position_idx }))
        await fetch(`/api/sections/${sectionId}/timeline`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: phase1 }),
        })
        await fetch(`/api/sections/${sectionId}/timeline`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: changedBlocks }),
        })
      }

      // 3. Bump updated_at de l'asset retiré (chantier 4) — best-effort.
      if (removedRow.asset_type && removedRow.asset_id) {
        void fetch(
          `/api/assets/${removedRow.asset_type}/${removedRow.asset_id}/touch`,
          { method: 'POST' },
        ).catch(err => console.warn('[handleDeleteBlock] touch asset failed:', err))
      }
    } catch (err) {
      setTimelineRows(prevRows)
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Suppression bloc échouée : ${msg}`)
    }
  }, [sectionId, timelineRows, sharedCursorMs])

  /** Retire un asset du livre courant (audit V3 HAUTE — DELETE scopé bookId).
   *  Appelle le RPC `delete_asset_scoped` côté DB → atomique. L'asset row
   *  n'est libéré que si plus aucune ref restante. Optimistic UI : retire
   *  immédiatement l'asset des banques locales puis refetch en background. */
  const handleDeleteAsset = useCallback(async (
    assetId: string,
    assetType: 'image' | 'animation' | 'audio' | 'text',
  ) => {
    if (!sectionId) return
    if (!bookId) {
      addToast({ message: 'Suppression impossible : bookId manquant', type: 'error' })
      return
    }
    // Refonte 2026-05-20 — feedback inline (toast) au lieu d'alert + cleanup
    // Storage explicit (le RPC scoped supprime DB rows seulement, pas les
    // fichiers MP4 / images orphelins dans le bucket).
    const processingToastId = addToast({
      message: 'Suppression en cours…',
      type: 'info',
      durationMs: 30000,
    })

    // 1. Pré-fetch URLs + label à supprimer du Storage (si asset_fully_deleted).
    const urlsToDelete: string[] = []
    let assetLabel: string | null = null
    try {
      const r = await fetch(`/api/assets/${assetType}/${assetId}`, { cache: 'no-store' })
      if (r.ok) {
        const { asset } = await r.json() as { asset?: Record<string, unknown> }
        for (const key of ['video_url', 'first_frame_url', 'last_frame_url', 'url', 'audio_url']) {
          const v = asset?.[key]
          if (typeof v === 'string' && v) urlsToDelete.push(v)
        }
        if (typeof asset?.label === 'string') assetLabel = asset.label
      }
    } catch {/* best-effort */}
    const typeLabel = assetType === 'animation' ? 'Animation'
      : assetType === 'image' ? 'Image'
      : assetType === 'audio' ? 'Audio'
      : 'Asset'
    const nameLabel = assetLabel ?? assetId.slice(0, 8)

    // Optimistic UI : retire l'asset des banques + ses blocs timeline
    const prevAnims = bankAnimations
    const prevImages = bankImages
    const prevSfx = bankSfx
    const prevMusic = bankMusic
    const prevRows = timelineRows
    if (assetType === 'animation') setBankAnimations(prev => prev.filter(a => a.id !== assetId))
    if (assetType === 'image')     setBankImages(prev => prev.filter(a => a.id !== assetId))
    if (assetType === 'audio') {
      setBankSfx(prev => prev.filter(a => a.id !== assetId))
      setBankMusic(prev => prev.filter(a => a.id !== assetId))
    }
    setTimelineRows(prev => prev.filter(r => !(r.asset_type === assetType && r.asset_id === assetId)))

    try {
      // 2. DELETE asset (RPC scoped : supprime asset_usage + section_timeline,
      //    et l'asset row si plus aucune ref).
      const res = await fetch(
        `/api/assets/${assetType}/${assetId}?bookId=${bookId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(`DELETE asset HTTP ${res.status}`)
      const result = await res.json().catch(() => ({})) as { asset_fully_deleted?: boolean }

      // 3. Si l'asset est complètement supprimé (plus de refs) → cleanup Storage.
      if (result.asset_fully_deleted && urlsToDelete.length > 0) {
        try {
          await fetch('/api/storage/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: urlsToDelete }),
          })
        } catch (storageErr) {
          console.warn('[handleDeleteAsset] storage cleanup failed (asset DB row deleted OK):', storageErr)
        }
      }

      addToast({
        message: result.asset_fully_deleted
          ? `${typeLabel} « ${nameLabel} » supprimée`
          : `${typeLabel} « ${nameLabel} » retirée du livre (encore référencée ailleurs)`,
        type: 'success',
      })
      // Refonte 2026-05-20 — bump le refreshKey pour que la banque slide-open
      // (AnimationStudioBankPanel) refetch ses listes locales et masque l'asset.
      setBankRefreshKey(k => k + 1)
      void fetchAll(sectionId)
    } catch (err) {
      // Rollback optimistic UI
      setBankAnimations(prevAnims)
      setBankImages(prevImages)
      setBankSfx(prevSfx)
      setBankMusic(prevMusic)
      setTimelineRows(prevRows)
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[handleDeleteAsset] failed:', msg)
      addToast({ message: `Suppression échouée : ${msg}`, type: 'error', durationMs: 6000 })
    } finally {
      dismissToast(processingToastId)
    }
  }, [sectionId, bookId, bankAnimations, bankImages, bankSfx, bankMusic, timelineRows, fetchAll, addToast, dismissToast])

  /** Édition asset → route vers l'éditeur.
   *  Chantier 3 (2026-05-16) : ajout argument `source` ('recents' | 'section')
   *  pour décider standalone vs contextuel (option C, cf memory
   *  project_hero_studios_architecture).
   *  - source='recents' (ou absent) : standalone, pas de sectionId
   *  - source='section'              : contextuel, sectionId fourni
   *  - returnSectionId TOUJOURS fourni pour le bouton "Retour Studio Section" */
  const handleEditAsset = useCallback((
    assetId: string,
    assetType: 'image' | 'animation',
    source?: 'recents' | 'section',
  ) => {
    if (!sectionId) return
    const target = assetType === 'animation'
      ? '/editor-test/animation-studio'
      : '/editor-test/new-layout'
    // Param `assetId` pour animations, `imageAssetId` pour images (le Designer
    // attendra ce param V2 cf chantier 2). On garde `assetId` aussi pour le
    // Designer existant (pre-standalone) en backward-compat.
    const params = new URLSearchParams()
    if (assetType === 'animation') params.set('assetId', assetId)
    else { params.set('imageAssetId', assetId); params.set('assetId', assetId) }
    if (source === 'section') params.set('sectionId', sectionId)
    params.set('returnSectionId', sectionId)
    router.push(`${target}?${params.toString()}`)
  }, [sectionId, router])

  /** Chantier 3 (2026-05-16) — Créer animation/image vide depuis la banque.
   *  Reroute via handleAddPlan qui fait déjà le draft asset + navigate. */
  const handleCreateAnimation = useCallback(() => {
    void handleAddPlan('animation')
  }, [handleAddPlan])
  const handleCreateImage = useCallback(() => {
    void handleAddPlan('image')
  }, [handleAddPlan])

  /** Resize bloc (drag bord) → PATCH 1 bloc. */
  const handleResizeBlock = useCallback(async (
    blockId: string,
    newStartMs: number,
    newDurationMs: number,
  ) => {
    if (!sectionId) return
    // Phase A bis.5 — détecte les blocks LAYER (= ID dans layersByPelliculeId).
    // Pour eux, on PATCH pellicule_layers (start_ms_rel / duration_ms relatifs
    // au parent), pas section_timeline (start_ms / duration_ms globaux).
    for (const [parentId, layers] of Object.entries(layersByPelliculeId)) {
      const found = layers.find(l => l.id === blockId)
      if (found) {
        const parentRow = timelineRows.find(r => r.id === parentId)
        if (!parentRow) return
        const startRel = Math.max(0, newStartMs - parentRow.start_ms)
        const durMs = Math.max(100, newDurationMs)
        try {
          await fetch(`/api/pellicules/${parentId}/layers`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              layers: [{ id: blockId, start_ms_rel: startRel, duration_ms: durMs }],
            }),
          })
          setLayersByPelliculeId(prev => ({
            ...prev,
            [parentId]: (prev[parentId] ?? []).map(l =>
              l.id === blockId ? { ...l, start_ms_rel: startRel, duration_ms: durMs } : l,
            ),
          }))
        } catch (err) {
          console.warn('[StudioSection] layer resize failed:', err)
        }
        return
      }
    }
    // Pellicule classique (video/image_static/sfx/music/text)
    try {
      await fetch(`/api/sections/${sectionId}/timeline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [{ id: blockId, start_ms: newStartMs, duration_ms: newDurationMs }],
        }),
      })
      await fetchAll(sectionId)
    } catch (err) {
      console.warn('[StudioSection V2] resize failed:', err)
    }
  }, [sectionId, fetchAll, layersByPelliculeId, timelineRows])

  /** Move bloc (drag) → reorder par index midpoint + compact + PATCH bulk.
   *  Refonte 2026-05-17 — algo aligné Studio Animation (cf MultiTrackEditor
   *  onMoveBlock) :
   *  1. Trouve l'index cible via comparaison newStartMs vs midpoint de
   *     chaque voisin (ordre courant de la timeline)
   *  2. Reorder par index (splice from → to)
   *  3. Recompacte tous les start_ms (cumul des durées dans l'ordre logique)
   *  Évite les bugs liés au tri par start_ms quand les valeurs sont proches. */
  const handleMoveBlock = useCallback(async (
    blockId: string,
    newStartMs: number,
  ) => {
    if (!sectionId) return
    // Phase A bis.5 — détecte les blocks LAYER (= ID dans layersByPelliculeId).
    // Move horizontal d'un layer = update start_ms_rel relatif au parent
    // (contraint dans [0, parent.duration_ms - layer.duration_ms]).
    for (const [parentId, layers] of Object.entries(layersByPelliculeId)) {
      const found = layers.find(l => l.id === blockId)
      if (found) {
        const parentRow = timelineRows.find(r => r.id === parentId)
        if (!parentRow) return
        const rawRel = Math.max(0, newStartMs - parentRow.start_ms)
        const dur = found.duration_ms ?? (parentRow.duration_ms - found.start_ms_rel)
        const maxRel = Math.max(0, parentRow.duration_ms - dur)
        const clampedRel = Math.min(maxRel, rawRel)
        try {
          await fetch(`/api/pellicules/${parentId}/layers`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              layers: [{ id: blockId, start_ms_rel: clampedRel }],
            }),
          })
          setLayersByPelliculeId(prev => ({
            ...prev,
            [parentId]: (prev[parentId] ?? []).map(l =>
              l.id === blockId ? { ...l, start_ms_rel: clampedRel } : l,
            ),
          }))
        } catch (err) {
          console.warn('[StudioSection] layer move failed:', err)
        }
        return
      }
    }
    const prevRows = timelineRows
    // 1. Isoler la track concernée + garder l'ordre courant (= start_ms asc)
    const movedRow = prevRows.find(r => r.id === blockId)
    if (!movedRow) return
    const trackRows = prevRows
      .filter(r => r.track === movedRow.track)
      .slice()
      .sort((a, b) => a.start_ms - b.start_ms)
    const otherTrackRows = prevRows.filter(r => r.track !== movedRow.track)
    const fromIdx = trackRows.findIndex(r => r.id === blockId)
    if (fromIdx < 0) return

    // 2. Calcul de l'index cible via midpoint (algo Studio Animation)
    let cursor = 0
    let toIdx = trackRows.length - 1  // default = fin
    for (let i = 0; i < trackRows.length; i++) {
      if (i === fromIdx) continue
      const r = trackRows[i]
      const mid = cursor + r.duration_ms / 2
      if (newStartMs < mid) {
        toIdx = i > fromIdx ? i - 1 : i
        break
      }
      cursor += r.duration_ms
      toIdx = i
    }
    if (toIdx === fromIdx) return  // pas de changement

    // 3. Reorder par index
    const reordered = [...trackRows]
    const [removed] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, removed)

    // 4. Recompacter (start_ms = cumul des durées) + recalculer position_idx.
    //    IMPORTANT : la route GET trie par position_idx, donc si on ne met
    //    que start_ms à jour, l'ordre se reset au prochain fetch. Fix
    //    2026-05-17 — update position_idx aussi.
    let s = 0
    const compactedTrack = reordered.map((r, idx) => {
      const nr = { ...r, start_ms: s, position_idx: idx }
      s += r.duration_ms
      return nr
    })

    // 5. Optimistic UI
    setTimelineRows([...otherTrackRows, ...compactedTrack])

    // 6. PATCH bulk — rows dont start_ms OU position_idx ont changé.
    //    Attention contrainte UNIQUE (section_id, track, position_idx) :
    //    on transit par des position_idx temporaires (offset très grand)
    //    pour éviter le conflit pendant les N updates en série.
    const TEMP_OFFSET = 100000
    const changedBlocks: { id: string; start_ms: number; position_idx: number }[] = []
    for (const newRow of compactedTrack) {
      const prev = prevRows.find(p => p.id === newRow.id)
      if (!prev || prev.start_ms !== newRow.start_ms || prev.position_idx !== newRow.position_idx) {
        changedBlocks.push({
          id: newRow.id,
          start_ms: newRow.start_ms,
          position_idx: newRow.position_idx,
        })
      }
    }
    if (changedBlocks.length === 0) return
    try {
      // Phase 1 : pousse tous les position_idx dans la zone temporaire
      // (libère les position_idx finaux pour éviter conflit UNIQUE).
      const phase1 = changedBlocks.map(b => ({
        id: b.id,
        position_idx: TEMP_OFFSET + b.position_idx,
      }))
      await fetch(`/api/sections/${sectionId}/timeline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: phase1 }),
      })
      // Phase 2 : set les position_idx finaux + start_ms
      const res = await fetch(`/api/sections/${sectionId}/timeline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: changedBlocks }),
      })
      if (!res.ok) throw new Error(`PATCH HTTP ${res.status}`)
    } catch (err) {
      setTimelineRows(prevRows)
      console.warn('[StudioSection V2] move failed:', err)
    }
  }, [sectionId, timelineRows, layersByPelliculeId])

  /** "Animer cette image" depuis un bloc image_static (refonte 2026-05-14).
   *  Flow : DELETE le bloc image timeline (asset image reste dans la banque)
   *  + push vers AnimationStudio en draft animation avec firstFrameUrl
   *  pré-rempli depuis l'image source (LTX I2V partira de cette image). */
  const handleAnimateImageBlock = useCallback((imageAssetId: string) => {
    if (!sectionId) return
    const img = bankImages.find(i => i.id === imageAssetId)
    if (!img?.url) {
      alert('Image introuvable dans la banque — impossible d\'animer.')
      return
    }
    // Optimistic UI : retire le bloc image de la timeline immédiatement.
    const prevRows = timelineRows
    setTimelineRows(prev => prev.filter(r => !(r.asset_type === 'image' && r.asset_id === imageAssetId)))
    // DELETE row timeline en arrière-plan (asset reste). Best-effort.
    void fetch(
      `/api/sections/${sectionId}/timeline?assetType=image&assetId=${imageAssetId}`,
      { method: 'DELETE' },
    ).catch(err => {
      console.warn('[StudioSection V2] DELETE image block failed:', err)
      setTimelineRows(prevRows)  // rollback si erreur
    })
    // Navigate vers AnimationStudio en draft animation avec firstFrameUrl
    const draftId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const params = new URLSearchParams({
      draftAssetId: draftId,
      draftKind: 'animation',
      sectionId,
      returnSectionId: sectionId,
      firstFrameUrl: img.url,
    })
    router.push(`/editor-test/animation-studio?${params.toString()}`)
  }, [sectionId, bankImages, timelineRows, router])

  /** "Continuer" depuis un bloc animation (refonte 2026-05-14at).
   *  Navigate AnimationStudio avec ?continueFromAssetId=X. AnimationStudio
   *  hydrate l'asset, attend que la pellicule soit chargée, puis auto-call
   *  handleContinueVideo (= V2V Extend pré-rempli avec lastFrame). */
  const handleContinueAnimationBlock = useCallback((animationAssetId: string) => {
    if (!sectionId) return
    const params = new URLSearchParams({
      assetId: animationAssetId,
      sectionId,
      returnSectionId: sectionId,
      continueFromAssetId: animationAssetId,
    })
    // Refonte 2026-05-17 — route vers le studio mono (single-pellicule + tuile
    // source). La page d'origine /animation-studio reste figée comme référence.
    router.push(`/editor-test/animation-studio-mono?${params.toString()}`)
  }, [sectionId, router])

  /** "Ajouter" (sub-tool Animation) — refonte 2026-05-17 : crée une NOUVELLE
   *  pellicule (draft) en I2V à partir de la lastFrame de l'animation
   *  sélectionnée. Différent de "Continuer" qui étend la même pellicule.
   *  Fetch /api/assets/animation/[id] pour récupérer last_frame_url (pas
   *  exposé via LibraryAnimation côté banque). */
  const handleAddPelliculeFromAnimation = useCallback(async (animationAssetId: string) => {
    if (!sectionId) return
    let lastFrameUrl: string | null = null
    try {
      const res = await fetch(`/api/assets/animation/${animationAssetId}`)
      if (res.ok) {
        const json = await res.json() as { asset?: { last_frame_url?: string; first_frame_url?: string } }
        lastFrameUrl = json.asset?.last_frame_url ?? json.asset?.first_frame_url ?? null
      }
    } catch (err) {
      console.warn('[handleAddPelliculeFromAnimation] fetch asset failed:', err)
    }
    // Fallback : firstFrameUrl depuis la bank cache (pas idéal mais évite blocage)
    if (!lastFrameUrl) {
      const anim = bankAnimations.find(a => a.id === animationAssetId)
      lastFrameUrl = anim?.firstFrameUrl ?? null
    }
    if (!lastFrameUrl) {
      alert('Dernière frame introuvable pour cette animation.')
      return
    }
    const draftId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const params = new URLSearchParams({
      draftAssetId: draftId,
      draftKind: 'animation',
      sectionId,
      returnSectionId: sectionId,
      firstFrameUrl: lastFrameUrl,
      addedFromAssetId: animationAssetId,  // contexte = tuile source affichée
    })
    // Refonte 2026-05-17 — route vers le studio mono (single-pellicule + tuile
    // source image = lastFrame de l'animation source).
    router.push(`/editor-test/animation-studio-mono?${params.toString()}`)
  }, [sectionId, bankAnimations, router])

  /** Drop d'un asset depuis library → POST nouveau bloc. */
  const handleDropAssetOnTrack = useCallback(async (
    track: 'video_image' | 'sfx' | 'music' | 'text',
    assetType: 'image' | 'animation' | 'audio' | 'text',
    assetId: string,
    dropMs: number,
  ) => {
    if (!sectionId) return
    try {
      void dropMs
      console.log('[StudioSection V2] POST timeline:', { track, assetType, assetId })
      // Refonte 2026-05-17 — probe la vraie durée du fichier vidéo via HTML5
      // pour que la timeline reflète exactement la durée réelle (avant : 4000ms
      // hardcodé = barre rouge désynchronisée de la vidéo). Pour les images,
      // 3000ms reste un default arbitraire (éditable par l'auteur ensuite).
      let durationMs = assetType === 'image' ? 3000 : 4000
      if (assetType === 'animation') {
        // Refonte 2026-05-20 — fetch direct DB (bypass bankAnimations cache).
        // Évite le cas où l'asset a été cut/split et video_url updaté mais
        // bankAnimations local pas encore resync → probe lit l'ancien fichier.
        let videoUrl: string | null = null
        try {
          const assetRes = await fetch(`/api/assets/animation/${assetId}`, { cache: 'no-store' })
          if (assetRes.ok) {
            const { asset } = await assetRes.json() as { asset?: { video_url?: string | null } }
            videoUrl = asset?.video_url ?? null
          }
        } catch (err) {
          console.warn('[StudioSection V2] fetch asset direct failed, fallback bank cache:', err)
          videoUrl = bankAnimations.find(a => a.id === assetId)?.videoUrl ?? null
        }
        if (videoUrl) {
          try {
            const fresh = videoUrl
            const probed = await new Promise<number>((resolve, reject) => {
              const v = document.createElement('video')
              v.preload = 'metadata'
              v.src = fresh
              v.onloadedmetadata = () => {
                if (isFinite(v.duration) && v.duration > 0) resolve(Math.round(v.duration * 1000))
                else reject(new Error('invalid duration'))
              }
              v.onerror = () => reject(new Error('video load error'))
              setTimeout(() => reject(new Error('probe timeout')), 5000)
            })
            durationMs = probed
            console.log('[StudioSection V2] probed duration_ms =', probed, 'from url =', fresh)
          } catch (err) {
            console.warn('[StudioSection V2] probe video duration failed, fallback 4000ms:', err)
          }
        } else {
          console.warn('[StudioSection V2] no videoUrl found for asset', assetId)
        }
      }
      const res = await fetch(`/api/sections/${sectionId}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track,
          asset_type: assetType,
          asset_id: assetId,
          duration_ms: durationMs,
        }),
      })
      let newRowId: string | null = null
      let parsedBody: unknown = null
      try { parsedBody = await res.json() } catch { /* ignore parse */ }
      if (!res.ok) {
        console.error('[StudioSection V2] POST timeline failed', res.status, parsedBody)
        return
      }
      newRowId = (parsedBody as { block?: { id: string } } | null)?.block?.id ?? null
      console.log('[StudioSection V2] POST OK, newRowId =', newRowId)
      await fetchAll(sectionId)
      // Refonte 2026-05-20 — bump bankRefreshKey pour que la banque slide-open
      // re-fetch ses usages (le timeline POST a upserté un asset_usage(section_id)
      // que la bank a besoin de voir pour afficher l'asset dans l'accordion Section).
      setBankRefreshKey(k => k + 1)
      if (newRowId) {
        const kind = assetType === 'image' ? 'image_static' : 'video'
        if (kind === 'video' || kind === 'image_static') {
          setSelectedBlock({ id: newRowId, kind, assetId })
        }
      }
    } catch (err) {
      console.warn('[StudioSection V2] drop failed:', err)
    }
  }, [sectionId, fetchAll])

  const badges: Partial<Record<SectionTab, number>> = {
    storyboard: timelineRows.length,
  }

  return (
    <StudioSectionLayout
      bookTitle={bookTitle}
      sectionNumber={sectionNumber}
      sectionTitle={sectionTitle}
      badges={badges}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onActiveTabReclick={(tab) => {
        // Chantier 1 refinement (2026-05-16) — click sur le tab Storyboard
        // déjà actif = toggle de la banque animations+images.
        // Refonte 2026-05-19 — ouvrir la banque ferme le preview (fade-out CSS)
        // ET met la lecture en pause. Si on ouvre via le rail, on est en mode
        // libre (lockedTab=null = 2 tabs visibles).
        if (tab === 'storyboard') {
          setBankPanelOpen(o => {
            const next = !o
            if (next) {
              setPreviewModalOpen(false)
              setSharedIsPlaying(false)
              setBankLockedTab(null)
            }
            return next
          })
        }
      }}
      saveStatus={error ? `⚠ Erreur : ${error}` : "Sauvegardé · à l'instant"}
      onPreview={() => setPreviewModalOpen(true)}
      onPublish={() => alert('TODO : Publier')}
      theme={theme}
      onToggleTheme={toggleTheme}
      onBackToBookList={() => {
        router.push(bookId
          ? `/editor-test/studio-creator/${bookId}`
          : '/editor-test/library')
      }}
    >
      {activeTab === 'storyboard' && (
        <div className="ss-storyboard-fullwidth">
          <div className="ss-sb-header">
            <h1 className="ss-sb-title">
              <span className="ss-sb-title-section">
                Section {sectionNumber}
                {/* Retire le préfixe "[Original §X] narratif/dialogue/..." de la
                 *  summary pour alléger l'affichage (refonte 2026-05-14). */}
                {(() => {
                  const cleaned = sectionTitle.replace(/^\[Original §\d+\]\s+\w+\s*—\s*/i, '').trim()
                  return cleaned ? ` — ${cleaned}` : ''
                })()}
              </span>
            </h1>
          </div>

          <SectionTimelineEditorV2
            loading={loading}
            error={error}
            state={timelineState}
            bankAnimations={bankAnimations}
            bankImages={bankImages}
            bankSfx={bankSfx}
            bankMusic={bankMusic}
            previewPellicules={previewPellicules}
            previewBaseImageUrl={previewBaseImageUrl}
            onSelectBlock={handleSelectBlock}
            onAddAnimation={() => void handleAddPlan('animation')}
            onAddImage={() => void handleAddPlan('image')}
            creating={creating}
            onDeleteBlock={(id) => void handleDeleteBlock(id)}
            onDeleteAsset={(id, type) => void handleDeleteAsset(id, type)}
            onEditAsset={handleEditAsset}
            onCreateAnimation={handleCreateAnimation}
            onCreateImage={handleCreateImage}
            onCreateCharacter={() => {
              // Refonte 2026-05-19 — ouvre directement le modal de création perso
              // (= même modale que Studio Designer / BookNpcsBank rail). Pas de nav.
              setNpcModalEditingRow(null)
              setNpcModalOpen(true)
            }}
            onCreateItem={() => {
              setItemModalEditingRow(null)
              setItemModalOpen(true)
            }}
            onEditCharacter={(npc) => {
              setNpcModalEditingRow(npc)
              setNpcModalOpen(true)
            }}
            onDeleteCharacter={async (npc) => {
              const res = await fetch(`/api/npcs/${npc.id}`, { method: 'DELETE' })
              if (!res.ok) {
                const eb = await res.json().catch(() => ({})) as { error?: string }
                throw new Error(eb.error ?? `HTTP ${res.status}`)
              }
              setBankRefreshKey(k => k + 1)
            }}
            onEditItem={(item) => {
              // item est ItemTile (subset) ; on cast vers ItemFormData (champs compatibles).
              setItemModalEditingRow({
                id: item.id,
                name: item.name,
                item_type: 'outil',
                category: (item.category ?? 'consommable') as ItemFormData['category'],
                illustration_url: item.illustration_url ?? null,
              })
              setItemModalOpen(true)
            }}
            onDeleteItem={async (item) => {
              const res = await fetch(`/api/books/${bookId}/items?item_id=${item.id}`, { method: 'DELETE' })
              if (!res.ok) {
                const eb = await res.json().catch(() => ({})) as { error?: string }
                throw new Error(eb.error ?? `HTTP ${res.status}`)
              }
              setBankRefreshKey(k => k + 1)
            }}
            bankRefreshKey={bankRefreshKey}
            bankPanelOpen={bankPanelOpen}
            onToggleBankPanel={() => {
              // Refonte 2026-05-19 — ouvrir la banque déclenche fade-out preview
              // ET pause la lecture. Reset du lockedTab à la fermeture (pour
              // qu'un re-open via rail montre les 2 tabs).
              setBankPanelOpen(o => {
                const next = !o
                if (next) {
                  setPreviewModalOpen(false)
                  setSharedIsPlaying(false)
                } else {
                  setBankLockedTab(null)
                }
                return next
              })
            }}
            bankLockedTab={bankLockedTab}
            onBankLockedTabChange={setBankLockedTab}
            onResizeBlock={(id, s, d) => void handleResizeBlock(id, s, d)}
            onMoveBlock={(id, s) => void handleMoveBlock(id, s)}
            onAnimateImageBlock={handleAnimateImageBlock}
            onContinueAnimationBlock={handleContinueAnimationBlock}
            onAddPelliculeFromAnimation={handleAddPelliculeFromAnimation}
            onPlayRequested={() => {
              // Refonte 2026-05-17 — Click Play timeline = slide doux ferme
              // banque + slide doux ouvre PreviewModal (qui autoplay au mount).
              // PAS de reset cursor ici : le cursor doit rester là où l'utilisateur
              // l'a laissé (drag ruler, dernière pause). MTT.play() auto-reset à 0
              // s'il était à totalDurationMs.
              setBankPanelOpen(false)
              setPreviewModalOpen(true)
              setSharedIsPlaying(true)
            }}
            sharedIsPlaying={sharedIsPlaying}
            onSharedPlayingChange={setSharedIsPlaying}
            sharedCursorMs={sharedCursorMs}
            onSharedCursorChange={setSharedCursorMs}
            onOpenEffects={(assetId) => {
              const t = buildTargetFromAssetId(assetId)
              if (t) setEffectsModalTarget(t)
            }}
            onOpenCapture={(assetId) => {
              const t = buildTargetFromAssetId(assetId)
              if (t) setCaptureModalTarget(t)
            }}
            onDeleteFrameAtCursor={async (assetId, cursorOffsetMs) => {
              // Refonte 2026-05-20 — supprime ~1 frame (33ms) au cursor.
              await runInlineVideoCut(assetId, 'delete-frame', cursorOffsetMs)
            }}
            onCutAtCursor={async (assetId, cursorOffsetMs) => {
              // Refonte 2026-05-20 — splitte la pellicule au cursor en 2.
              await runInlineVideoCut(assetId, 'split', cursorOffsetMs)
            }}
            cutProcessing={cutProcessing}
            onUploadVideo={async (file) => {
              // Refonte 2026-05-20 — upload vidéo PC → Supabase Storage → POST asset.
              if (!bookId) throw new Error('bookId requis pour upload')
              const toastId = addToast({ message: `Upload de "${file.name}"…`, type: 'info', durationMs: 60000 })
              try {
                // 1. File → data URL base64
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const r = new FileReader()
                  r.onload = () => resolve(String(r.result))
                  r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
                  r.readAsDataURL(file)
                })
                // 2. Upload Storage
                const upRes = await fetch('/api/storage/upload-video', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    data_url: dataUrl,
                    path: `videos/upload/${bookId}/${Date.now()}_${file.name.replace(/[^a-z0-9_.-]+/gi, '_')}`,
                  }),
                })
                if (!upRes.ok) throw new Error(`upload HTTP ${upRes.status}`)
                const { url } = await upRes.json() as { url: string }
                // 3. POST asset_animation avec label = nom du fichier
                const label = file.name.replace(/\.[^.]+$/, '')
                const assetRes = await fetch('/api/assets/animation', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    bookId, sectionId,
                    video_url: url, label, source: 'upload',
                  }),
                })
                if (!assetRes.ok) {
                  const eb = await assetRes.json().catch(() => ({})) as { error?: string }
                  throw new Error(eb.error ?? `POST asset HTTP ${assetRes.status}`)
                }
                const { asset } = await assetRes.json() as { asset: { id: string; label?: string; video_url?: string } }
                // Refonte 2026-05-20 — extract first+last frame en background pour
                // que la vignette timeline + thumb banque s'affichent au repos
                // (sinon block vide jusqu'au hover qui play la vidéo).
                let firstFrameUrl: string | null = null
                try {
                  const frames = await extractFramesFromVideo({
                    videoUrl: url,
                    storagePathPrefix: `videos/upload/${bookId}/frames`,
                  })
                  firstFrameUrl = frames.first_frame_url
                  // PATCH l'asset avec les frames extraites
                  await fetch(`/api/assets/animation/${asset.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      first_frame_url: frames.first_frame_url,
                      last_frame_url: frames.last_frame_url,
                    }),
                  })
                } catch (frameErr) {
                  console.warn('[onUploadVideo] frame extraction failed (non-bloquant):', frameErr)
                }
                addToast({ message: `Vidéo « ${label} » importée`, type: 'success' })
                setBankRefreshKey(k => k + 1)
                if (sectionId) void fetchAll(sectionId)
                return {
                  id: asset.id,
                  url: null,
                  label: asset.label ?? label,
                  video_url: asset.video_url ?? url,
                  first_frame_url: firstFrameUrl,
                  type: 'animation',
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                console.error('[onUploadVideo] failed:', msg)
                addToast({ message: `Upload échoué : ${msg}`, type: 'error', durationMs: 6000 })
                throw err
              } finally {
                dismissToast(toastId)
              }
            }}
            onUploadImage={async (file) => {
              if (!bookId) throw new Error('bookId requis pour upload')
              const toastId = addToast({ message: `Upload de "${file.name}"…`, type: 'info', durationMs: 60000 })
              try {
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const r = new FileReader()
                  r.onload = () => resolve(String(r.result))
                  r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
                  r.readAsDataURL(file)
                })
                const upRes = await fetch('/api/storage/upload-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    data_url: dataUrl,
                    path: `images/upload/${bookId}/${Date.now()}_${file.name.replace(/[^a-z0-9_.-]+/gi, '_')}`,
                  }),
                })
                if (!upRes.ok) throw new Error(`upload HTTP ${upRes.status}`)
                const { url } = await upRes.json() as { url: string }
                const label = file.name.replace(/\.[^.]+$/, '')
                const assetRes = await fetch('/api/assets/image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    bookId, sectionId,
                    url, label, source_type: 'upload',
                  }),
                })
                if (!assetRes.ok) {
                  const eb = await assetRes.json().catch(() => ({})) as { error?: string }
                  throw new Error(eb.error ?? `POST asset HTTP ${assetRes.status}`)
                }
                const { asset } = await assetRes.json() as { asset: { id: string; label?: string; url?: string } }
                addToast({ message: `Image « ${label} » importée`, type: 'success' })
                setBankRefreshKey(k => k + 1)
                if (sectionId) void fetchAll(sectionId)
                return {
                  id: asset.id,
                  url: asset.url ?? url,
                  label: asset.label ?? label,
                  type: 'image_static',
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                console.error('[onUploadImage] failed:', msg)
                addToast({ message: `Upload échoué : ${msg}`, type: 'error', durationMs: 6000 })
                throw err
              } finally {
                dismissToast(toastId)
              }
            }}
            onUserScrubAction={() => {
              // Refonte 2026-05-20 — step user (boutons/clavier) :
              //   - Ferme la banque slide-open (focus sur le preview)
              //   - Ouvre le PreviewModal en pause sur la frame ciblée
              setBankPanelOpen(false)
              setBankLockedTab(null)
              setSharedIsPlaying(false)
              setPreviewModalOpen(true)
            }}
            onLayersChange={(pelliculeId, layers) => {
              setLayersByPelliculeId(prev => ({ ...prev, [pelliculeId]: layers }))
            }}
            pelliculeKeyframesById={pelliculeKeyframesById}
            onPelliculeKeyframesChange={(pelliculeId, kfs) => {
              // Optimistic update local + PATCH DB
              setTimelineRows(prev => prev.map(r =>
                r.id === pelliculeId ? { ...r, keyframes: kfs as SectionTimelineRow['keyframes'] } : r,
              ))
              if (!sectionId) return
              void fetch(`/api/sections/${sectionId}/timeline`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blocks: [{ id: pelliculeId, keyframes: kfs }] }),
              }).catch(err => console.warn('[keyframes PATCH] failed', err))
            }}
            sharedCursorMsForKfs={sharedCursorMs ?? 0}
            pelliculeLayersFinder={(parentId, layerId) =>
              layersByPelliculeId[parentId]?.find(l => l.id === layerId) ?? null
            }
            onLayerMutated={(parentId, updated) => {
              setLayersByPelliculeId(prev => {
                const list = prev[parentId] ?? []
                return { ...prev, [parentId]: list.map(l => l.id === updated.id ? updated : l) }
              })
            }}
            onLayerDeleted={(parentId, layerId) => {
              setLayersByPelliculeId(prev => {
                const list = prev[parentId] ?? []
                return { ...prev, [parentId]: list.filter(l => l.id !== layerId) }
              })
            }}
            onLayerSelected={(info) => {
              // Refonte 2026-05-19 v2 — UX uniforme avec click pellicule :
              // 1. Open preview (= seeks à la pellicule parente)
              // 2. Seek cursor au début de la pellicule parente
              // 3. PAUSE → preview affiche la 1ère frame. User clique Play
              //    pour démarrer ; la lecture s'arrêtera à la fin de l'anim
              //    parente via playUntilGlobalMs (scope conservé).
              setPreviewModalOpen(true)
              setSharedCursorMs(info.parentStartMs)
              setSharedIsPlaying(false)
              setPreviewLayerContext({
                parentPelliculeId: info.parentPelliculeId,
                layerLabel: info.layerLabel,
                parentLabel: info.parentLabel,
                stopAtGlobalMs: info.parentStartMs + info.parentDurationMs,
              })
            }}
            onAddLayerToPellicule={(parentPelliculeId) => {
              // Phase A bis.7 — file picker → upload → POST layer.
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'  // image+gif V1 (vidéo couvert via banque later)
              input.onchange = async () => {
                const file = input.files?.[0]
                if (!file) return
                try {
                  // Upload via /api/storage/upload-image (data_url)
                  const dataUrl = await new Promise<string>((resolve, reject) => {
                    const r = new FileReader()
                    r.onload = () => resolve(String(r.result))
                    r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
                    r.readAsDataURL(file)
                  })
                  const upRes = await fetch('/api/storage/upload-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      data_url: dataUrl,
                      path: `layers/layer_${Date.now()}_${file.name.replace(/[^a-z0-9_.-]+/gi, '_')}`,
                    }),
                  })
                  if (!upRes.ok) throw new Error(`upload HTTP ${upRes.status}`)
                  const { url } = await upRes.json() as { url: string }
                  // Type heuristique : gif si extension, sinon image
                  const isGif = /\.gif$/i.test(file.name)
                  const layerType = isGif ? 'gif' : 'image'
                  // POST layer
                  const layerRes = await fetch(`/api/pellicules/${parentPelliculeId}/layers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: layerType, media_url: url }),
                  })
                  if (!layerRes.ok) {
                    const eb = await layerRes.json().catch(() => ({})) as { error?: string }
                    throw new Error(eb.error ?? `POST layer HTTP ${layerRes.status}`)
                  }
                  const { layer } = await layerRes.json() as { layer: PelliculeLayerRow }
                  setLayersByPelliculeId(prev => ({
                    ...prev,
                    [parentPelliculeId]: [...(prev[parentPelliculeId] ?? []), layer],
                  }))
                } catch (err) {
                  alert(`Ajout calque échoué : ${err instanceof Error ? err.message : String(err)}`)
                }
              }
              input.click()
            }}
            onStartMaskEdit={(pelliculeId, layerId, shape) => {
              // Force-ouvre la preview pour que l'auteur voie l'overlay drawing
              setPreviewModalOpen(true)
              // Auto-seek à la pellicule éditée pour que les clicks soient
              // capturés sur la bonne (l'overlay ne rend QUE si maskDraft.pelliculeId
              // matche la currentPellicule du PreviewModal). On calcule la position
              // cumulée en ms = somme des durées des pellicules précédentes.
              let cumulMs = 0
              for (const p of previewPellicules) {
                if (p.id === pelliculeId) break
                cumulMs += (p.shots ?? []).reduce((s, sh) => s + (sh.duration ?? 4), 0) * 1000
              }
              setSharedCursorMs(cumulMs)
              setSharedIsPlaying(false)  // pause pour que l'auteur clique sur image fixe
              setMaskDraft({ pelliculeId, layerId, shape, points: [] })
            }}
            onCancelMaskEdit={() => setMaskDraft(null)}
            maskDraftPoints={maskDraft?.points}
            maskDraftShape={maskDraft?.shape ?? null}
            maskDraftLayerId={maskDraft?.layerId ?? null}
            onLayerUpload={async (file: File) => {
              // V1 — upload image/gif via /api/storage/upload-image (data_url).
              // Vidéo non supportée pour l'instant (existe sur upload-video mais
              // signature différente — à câbler en A.5/A.6 si demand auteur).
              const dataUrl = await new Promise<string>((resolve, reject) => {
                const r = new FileReader()
                r.onload = () => resolve(String(r.result))
                r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
                r.readAsDataURL(file)
              })
              const res = await fetch('/api/storage/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  data_url: dataUrl,
                  path: `layers/layer_${Date.now()}_${file.name.replace(/[^a-z0-9_.-]+/gi, '_')}`,
                }),
              })
              if (!res.ok) {
                const errBody = await res.json().catch(() => ({})) as { error?: string }
                throw new Error(errBody.error ?? `Upload HTTP ${res.status}`)
              }
              const { url } = await res.json() as { url: string }
              return url
            }}
            selectedBlock={selectedBlock}
            onClearSelection={() => setSelectedBlock(null)}
            onDropAssetOnTrack={(track, type, id, dropMs) =>
              void handleDropAssetOnTrack(track, type, id, dropMs)}
            bookId={bookId}
            sectionId={sectionId}
            onImportSuccess={() => sectionId && void fetchAll(sectionId)}
          />
        </div>
      )}

      {activeTab === 'texte' && <PlaceholderTab title="📝 Texte narratif" lines={['Éditeur de texte riche']} />}
      {activeTab === 'choix' && <PlaceholderTab title="⚖ Choix & Trial" lines={['Liste des choix']} />}
      {activeTab === 'companions' && (
        bookId
          ? <div className="ss-tab-body"><BookNpcsBank bookId={bookId} /></div>
          : <PlaceholderTab title="👥 Companions" lines={['Chargement du livre…']} />
      )}
      {activeTab === 'objets' && (
        bookId
          ? <div className="ss-tab-body"><BookItemsBank bookId={bookId} /></div>
          : <PlaceholderTab title="🎒 Objets" lines={['Chargement du livre…']} />
      )}
      {activeTab === 'settings' && <PlaceholderTab title="⚙ Settings" lines={['reading_time / decision_time']} />}

      {/* Refonte 2026-05-19 — modaux NPC + Item au niveau page, déclenchés
       *  depuis la banque slide-open (tiles + Créer / ✎ Édit). Distincts de
       *  ceux dans BookNpcsBank / BookItemsBank (tabs rail). */}
      {bookId && (
        <BookNpcCreatorModal
          open={npcModalOpen}
          onClose={() => setNpcModalOpen(false)}
          bookId={bookId}
          editingNpc={npcModalEditingRow}
          onSaved={() => {
            setNpcModalOpen(false)
            setNpcModalEditingRow(null)
            setBankRefreshKey(k => k + 1)
          }}
        />
      )}
      {bookId && (
        <ItemCreatorModal
          open={itemModalOpen}
          onClose={() => setItemModalOpen(false)}
          bookId={bookId}
          editingItem={itemModalEditingRow}
          storagePathPrefix={`books/${bookId}/items`}
          onSaved={() => {
            setItemModalOpen(false)
            setItemModalEditingRow(null)
            setBankRefreshKey(k => k + 1)
          }}
        />
      )}

      {/* Refonte 2026-05-19 — Modale Couper vidéo (cut range / split en 2).
       *  Cut : PATCH videoUrl du pellicule courant avec le résultat.
       *  Split : PATCH videoUrl=partA + POST nouveau asset pour partB (visible
       *  ensuite dans la banque, à drag-drop sur la timeline manuellement V1). */}
      <VideoCutModal
        open={videoCutModalState !== null}
        videoUrl={videoCutModalState?.videoUrl ?? null}
        title={videoCutModalState?.title}
        onClose={() => setVideoCutModalState(null)}
        onApply={async (result: VideoCutResult) => {
          if (!videoCutModalState || !bookId) return
          const { assetId } = videoCutModalState
          try {
            // Helper local : upload un Blob vidéo en Supabase Storage.
            const uploadBlob = async (blob: Blob, label: string): Promise<string> => {
              const dataUrl = await new Promise<string>((resolve, reject) => {
                const r = new FileReader()
                r.onload = () => resolve(String(r.result))
                r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
                r.readAsDataURL(blob)
              })
              const path = `videos/cut/${bookId}/${assetId}_${label}_${Date.now()}.mp4`
              const res = await fetch('/api/storage/upload-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data_url: dataUrl, path }),
              })
              if (!res.ok) {
                const eb = await res.json().catch(() => ({})) as { error?: string }
                throw new Error(eb.error ?? `Upload HTTP ${res.status}`)
              }
              const data = await res.json() as { url?: string; error?: string }
              if (!data.url) throw new Error(data.error ?? 'Upload sans URL retournée')
              return data.url
            }

            if (result.mode === 'cut') {
              // PATCH videoUrl du pellicule courant.
              const newUrl = await uploadBlob(result.blob, 'cut')
              const pr = await fetch(`/api/assets/animation/${assetId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_url: newUrl }),
              })
              if (!pr.ok) {
                const eb = await pr.json().catch(() => ({})) as { error?: string }
                throw new Error(eb.error ?? `PATCH HTTP ${pr.status}`)
              }
              // Mesure la nouvelle durée du blob via HTMLVideoElement temporaire.
              const newDurationMs = await measureVideoDurationMs(URL.createObjectURL(result.blob))
              // PATCH section_timeline : update duration_ms + shift start_ms des
              // rows suivantes sur la même track.
              if (sectionId && newDurationMs > 0) {
                const currentRow = timelineRows.find(r => r.asset_id === assetId)
                if (currentRow) {
                  const oldDurationMs = currentRow.duration_ms
                  const deltaMs = newDurationMs - oldDurationMs
                  const sameTrackAfter = timelineRows.filter(r =>
                    r.track === currentRow.track && r.position_idx > currentRow.position_idx)
                  const blocksPatch = [
                    { id: currentRow.id, duration_ms: newDurationMs },
                    ...sameTrackAfter.map(r => ({ id: r.id, start_ms: r.start_ms + deltaMs })),
                  ]
                  await fetch(`/api/sections/${sectionId}/timeline`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ blocks: blocksPatch }),
                  })
                  // Sync state local en cohérence.
                  setTimelineRows(prev => prev.map(r => {
                    if (r.id === currentRow.id) return { ...r, duration_ms: newDurationMs, asset: { ...(r.asset ?? {}), video_url: newUrl } }
                    if (r.track === currentRow.track && r.position_idx > currentRow.position_idx) {
                      return { ...r, start_ms: r.start_ms + deltaMs }
                    }
                    return r
                  }))
                } else {
                  // Fallback : pas de row trouvée, juste update l'asset.
                  setTimelineRows(prev => prev.map(r => r.asset_id === assetId
                    ? { ...r, asset: { ...(r.asset ?? {}), video_url: newUrl } }
                    : r))
                }
              }
              setBankRefreshKey(k => k + 1)
              alert('Vidéo coupée avec succès. Pellicule mise à jour.')
            } else {
              // SPLIT : partA → PATCH videoUrl. partB → POST nouveau asset.
              const [urlA, urlB] = await Promise.all([
                uploadBlob(result.partA, 'splitA'),
                uploadBlob(result.partB, 'splitB'),
              ])
              const prA = await fetch(`/api/assets/animation/${assetId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_url: urlA }),
              })
              if (!prA.ok) {
                const eb = await prA.json().catch(() => ({})) as { error?: string }
                throw new Error(eb.error ?? `PATCH partA HTTP ${prA.status}`)
              }
              const currentRow = timelineRows.find(r => r.asset_id === assetId)
              const currentAsset = currentRow?.asset as { label?: string } | null
              const partBLabel = currentAsset?.label ? `${currentAsset.label} (partie B)` : 'Partie B'
              const prB = await fetch('/api/assets/animation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  bookId,
                  sectionId,
                  video_url: urlB,
                  label: partBLabel,
                }),
              })
              if (!prB.ok) {
                const eb = await prB.json().catch(() => ({})) as { error?: string }
                throw new Error(eb.error ?? `POST partB HTTP ${prB.status}`)
              }
              // Mesure de la nouvelle durée partie A → PATCH timeline.
              const newDurationMs = await measureVideoDurationMs(URL.createObjectURL(result.partA))
              if (sectionId && newDurationMs > 0 && currentRow) {
                const oldDurationMs = currentRow.duration_ms
                const deltaMs = newDurationMs - oldDurationMs
                const sameTrackAfter = timelineRows.filter(r =>
                  r.track === currentRow.track && r.position_idx > currentRow.position_idx)
                const blocksPatch = [
                  { id: currentRow.id, duration_ms: newDurationMs },
                  ...sameTrackAfter.map(r => ({ id: r.id, start_ms: r.start_ms + deltaMs })),
                ]
                await fetch(`/api/sections/${sectionId}/timeline`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ blocks: blocksPatch }),
                })
                setTimelineRows(prev => prev.map(r => {
                  if (r.id === currentRow.id) return { ...r, duration_ms: newDurationMs, asset: { ...(r.asset ?? {}), video_url: urlA } }
                  if (r.track === currentRow.track && r.position_idx > currentRow.position_idx) {
                    return { ...r, start_ms: r.start_ms + deltaMs }
                  }
                  return r
                }))
              } else {
                setTimelineRows(prev => prev.map(r => r.asset_id === assetId
                  ? { ...r, asset: { ...(r.asset ?? {}), video_url: urlA } }
                  : r))
              }
              setBankRefreshKey(k => k + 1)
              alert(`Split effectué.\n\nPartie A : pellicule courante mise à jour (timeline ajustée).\nPartie B : nouvelle pellicule créée (visible dans la banque, à drag-drop dans la timeline).`)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error('[VideoCutModal] apply failed:', msg)
            alert(`Échec : ${msg}`)
            throw err  // re-throw pour que la modale affiche l'erreur
          }
        }}
      />

      {/* PreviewModal unifié (refonte 2026-05-17 — cf memory
       *  project_preview_modal_unified). Floating window non-modale,
       *  draggable, repliable. Joue la séquence des pellicules de la section. */}
      <PreviewModal
        open={previewModalOpen}
        onClose={() => {
          setPreviewModalOpen(false)
          setSharedIsPlaying(false)
          setSharedCursorMs(null)  // reset pour ne pas snap au prochain open
          setPreviewLayerContext(null)  // clear le badge/scope contextuel
        }}
        pellicules={previewPellicules as unknown as PelliculePersisted[]}
        title={`Section ${sectionNumber} • ${previewPellicules.length} pellicule${previewPellicules.length > 1 ? 's' : ''}`}
        controlledIsPlaying={sharedIsPlaying}
        onPlayingChange={setSharedIsPlaying}
        externalCursorMs={sharedCursorMs}
        onCursorChange={setSharedCursorMs}
        layersByPelliculeId={layersByPelliculeId}
        pelliculeKeyframesById={pelliculeKeyframesById}
        contextBadge={previewLayerContext ? {
          layerLabel: previewLayerContext.layerLabel,
          parentLabel: previewLayerContext.parentLabel,
        } : null}
        playUntilGlobalMs={previewLayerContext?.stopAtGlobalMs ?? null}
        maskDraft={maskDraft ? {
          pelliculeId: maskDraft.pelliculeId,
          shape: maskDraft.shape,
          points: maskDraft.points,
          onAddPoint: (point) => {
            setMaskDraft(prev => {
              if (!prev) return null
              // Pour rect, ne JAMAIS dépasser 2 points (les clicks suivants
              // remplacent le 2e — l'auteur peut ajuster le coin opposé en
              // recliquant). Pour polygon, on accumule librement.
              if (prev.shape === 'rect' && prev.points.length >= 2) {
                return { ...prev, points: [prev.points[0], point] }
              }
              return { ...prev, points: [...prev.points, point] }
            })
          },
        } : null}
      />

      {/* Modale Effets — refonte 2026-05-17. Parité Studio Animation. Ouverte
       *  par le bouton ✨ Effets du bandeau bas des vignettes pellicule.
       *  Autosave PATCH /api/assets/animation/[id] {effects_params} debouncé. */}
      <EffectsModal
        open={!!effectsModalTarget}
        videoUrl={effectsModalTarget?.videoUrl ?? null}
        fallbackImageUrl={effectsModalTarget?.firstFrameUrl ?? null}
        bookId={bookId}
        sectionId={sectionId}
        onCaptureSaved={() => sectionId && void fetchAll(sectionId)}
        initialState={migrateLegacyEffectsParams(
          effectsModalTarget?.effects_params as ComposedEffectsState | null,
        )}
        pelliculeLabel={effectsModalTarget?.label ?? undefined}
        onChange={(next) => {
          const assetId = effectsModalTarget?.assetId
          if (!assetId || !bookId) return
          if (effectsPatchTimerRef.current) clearTimeout(effectsPatchTimerRef.current)
          effectsPatchTimerRef.current = setTimeout(() => {
            void fetch(`/api/assets/animation/${assetId}?bookId=${bookId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ effects_params: next }),
            })
              .then(() => sectionId && void fetchAll(sectionId))
              .catch(err => console.warn('[StudioSection] effects PATCH failed:', err))
          }, 400)
        }}
        onClose={() => setEffectsModalTarget(null)}
      />

      {/* Modale Capture (mode='capture') — refonte 2026-05-17. Parité Studio
       *  Animation : scrub + save vers banque d'images, ou capture + trim
       *  vidéo (raccourcit shots[] au timestamp). */}
      <EffectsModal
        mode="capture"
        open={!!captureModalTarget}
        videoUrl={captureModalTarget?.videoUrl ?? null}
        fallbackImageUrl={captureModalTarget?.firstFrameUrl ?? null}
        bookId={bookId}
        sectionId={sectionId}
        onCaptureSaved={() => sectionId && void fetchAll(sectionId)}
        initialState={migrateLegacyEffectsParams(
          captureModalTarget?.effects_params as ComposedEffectsState | null,
        )}
        pelliculeLabel={captureModalTarget?.label ?? undefined}
        onCaptureAndTrim={async ({ dataUrl, label, timestamp }) => {
          if (!captureModalTarget || !bookId) return
          const targetAssetId = captureModalTarget.assetId
          // 1. Upload image vers Supabase + create asset_image
          const upRes = await fetch('/api/storage/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data_url: dataUrl,
              path: `captures/cap_trim_${Date.now()}.jpg`,
            }),
          })
          const upData = await upRes.json() as { url?: string }
          if (!upRes.ok || !upData.url) throw new Error('upload image failed')
          const assetRes = await fetch('/api/assets/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookId,
              sectionId: sectionId ?? undefined,
              url: upData.url,
              label,
              source_type: 'capture_trim',
            }),
          })
          if (!assetRes.ok) throw new Error('create asset_image failed')
          // 2. Trim pellicule : PATCH duration sur le bloc timeline (raccourcit
          //    la durée totale au timestamp). On garde le simple côté Studio
          //    Section : pas de manipulation shots[] détaillée (V1).
          const trimMs = Math.max(100, Math.round(timestamp * 1000))
          const block = timelineRows.find(r => r.asset_id === targetAssetId && r.asset_type === 'animation')
          if (block && sectionId) {
            await fetch(`/api/sections/${sectionId}/timeline`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ blocks: [{ id: block.id, duration_ms: trimMs }] }),
            }).catch(() => {})
          }
          // 3. Refresh + close
          if (sectionId) void fetchAll(sectionId)
          setCaptureModalTarget(null)
        }}
        onClose={() => setCaptureModalTarget(null)}
      />
      {/* Refonte 2026-05-20 — Toaster bottom-center pour feedback inline
       *  (frame supprimée, split effectué, etc.). Auto-dismiss 3-5s. */}
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </StudioSectionLayout>
  )
}

function PlaceholderTab({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="ss-placeholder">
      <div className="ss-placeholder-title">{title}</div>
      <div>Tab placeholder — sera implémentée dans une phase ultérieure.</div>
      <ul className="ss-placeholder-list">
        {lines.map((l, i) => <li key={i}>• {l}</li>)}
      </ul>
    </div>
  )
}

