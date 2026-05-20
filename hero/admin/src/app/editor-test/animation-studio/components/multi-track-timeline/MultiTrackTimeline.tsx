'use client'
/**
 * MultiTrackTimeline — éditeur multi-pistes pour les séquences cinématiques.
 *
 * UX style CapCut/Premiere : 4 pistes (vidéo/image · SFX · musique · texte),
 * blocs drag-droppés depuis la bibliothèque, curseur de lecture 60Hz, pas
 * d'overlap par piste.
 *
 * Phase 1 V1 (2026-05-12) :
 *   ✅ Affichage 4 pistes avec ruler temporel (px/sec configurable)
 *   ✅ Curseur de lecture sync rAF (sans re-render parent via cursorMsRef)
 *   ✅ Drop depuis bibliothèque (mimetype text/x-hero-block)
 *   ✅ Click bloc = onSelectBlock callback
 *   ✅ Snap au bord du bloc voisin lors du drop
 *   ⏳ Drag de blocs déjà placés (= V2)
 *   ⏳ Resize bord d'un bloc (= V2)
 *
 * Pas de logique métier ici — l'orchestration (mapper bidir, persist, save)
 * vit dans le parent (AnimationStudioInner ou wrapper dédié).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import { Play, Pause, Film, Volume2, Music, Type, Loader2, FastForward, Layers, ChevronLeft, ChevronRight, Scissors, Columns2 } from 'lucide-react'
import type { TimelineState, TrackKind, TimelineBlock } from './types'
import { TRACK_LABELS, TRACK_ORDER, blocksOfTrack } from './types'

// Refonte 2026-05-14 : icônes par piste pour remplacer les labels en majuscules.
// Tooltip natif via title pour identifier sans clic.
const TRACK_ICONS: Record<TrackKind, React.ReactNode> = {
  video_image: <Film size={16} />,
  layers:      <Layers size={16} />,  // Phase A bis 2026-05-18 — track Calques
  sfx:         <Volume2 size={16} />,
  music:       <Music size={16} />,
  text:        <Type size={16} />,
}

// Variants framer-motion pour le drawer subTools (refonte 2026-05-14s,
// pattern repris de DesignerActionsToolbar).
const drawerContainerVariants: Variants = {
  closed: { opacity: 0, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } },
  open: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.08, when: 'beforeChildren' },
  },
}
const drawerItemVariants: Variants = {
  closed: { opacity: 0, x: -16, scale: 0.85, transition: { duration: 0.12 } },
  open:   { opacity: 1, x: 0,   scale: 1,   transition: { type: 'spring', stiffness: 380, damping: 28 } },
}
import { msToPx, pxToMs, formatDurationMsCompact, snapToNeighborOrGrid, findFreeSlot } from './helpers'
import { useCursorRaf } from './use-cursor-raf'
import { useAudioMixer } from './use-audio-mixer'

// MIME type pour le drag-drop depuis la bibliothèque (= identifie un payload Hero).
export const TIMELINE_DRAG_MIME = 'application/x-hero-timeline-block'
/** MIME type spécifique au déplacement d'un bloc DÉJÀ placé dans la timeline.
 *  Différencie un drag "ajout depuis library" d'un drag "repositionnement". */
export const TIMELINE_MOVE_MIME = 'application/x-hero-timeline-move'

/** Refonte 2026-05-14bb — Ref module-level qui retient les infos du drag
 *  en cours, écrites au DragStart et lues pendant onDragOver. Contourne la
 *  limitation HTML5 (dataTransfer.getData() unreadable hors onDrop) pour
 *  permettre la réorganisation visuelle des blocs voisins (translateX) en
 *  temps réel pendant le drag.
 *  - blockId : id du bloc dragged si "move existing", null si "add from library"
 *  - durationMs : durée du bloc dragged (pour calcul offset visuel) */
export const currentDragInfoRef: { current: { blockId: string | null; durationMs: number } | null } = { current: null }

/** Payload sérialisé dans le dataTransfer du drag depuis la bibliothèque.
 *  Le composant <TimelineLibrary> serialize ça à `dragstart`, le drop handler
 *  d'ici parse au `drop`. */
export interface DragPayload {
  blockKind: TimelineBlock['kind']
  /** Données spécifiques au kind, suffisantes pour construire le bloc via
   *  un callback parent (qui crée la pellicule/audio sous-jacent). */
  data: Record<string, unknown>
  /** Durée par défaut (ms) du bloc créé. */
  defaultDurationMs: number
}

/** Payload sérialisé pour un drag de repositionnement (V2 2026-05-12). */
export interface MovePayload {
  blockId: string
  trackKind: TimelineBlock['trackKind']
  /** Offset en ms entre le startMs du bloc et la position curseur au pointer-down.
   *  Permet de reconstituer la position exacte du bloc au drop. */
  grabOffsetMs: number
}

interface MultiTrackTimelineProps {
  state: TimelineState
  /** Largeur d'une seconde en pixels. Drive le zoom horizontal. Default 80. */
  pxPerSec?: number
  /** Hauteur d'une piste en rem. Default 3rem. */
  trackHeightRem?: number
  /** Hauteurs custom par track (refonte 2026-05-14x). Override
   *  trackHeightRem pour les tracks listées. Utile p.ex. pour mettre la
   *  track video_image plus grande que les autres. */
  trackHeightsRem?: Partial<Record<TrackKind, number>>
  /** Click sur un bloc → callback. */
  onSelectBlock?: (block: TimelineBlock) => void
  /** Drop d'un payload de la bibliothèque sur une piste à une position donnée.
   *  Le parent traduit ça en mutation du modèle Hero (mapper inverse). */
  onDropFromLibrary?: (track: TrackKind, payload: DragPayload, dropMs: number) => void
  /** Repositionnement d'un bloc déjà placé (V2 2026-05-12). Le caller mute
   *  le startMs du bloc identifié par blockId. */
  onMoveBlock?: (blockId: string, newStartMs: number) => void
  /** Resize d'un bloc (drag du bord gauche ou droit, V2bis 2026-05-12).
   *  Le caller mute startMs (si edge='left') ou durationMs (si edge='right').
   *  Pour edge='left' : newStartMs change ET newDurationMs s'ajuste pour
   *  maintenir endMs constant. Pour edge='right' : newStartMs reste, seul
   *  newDurationMs change. */
  onResizeBlock?: (blockId: string, newStartMs: number, newDurationMs: number) => void
  /** Filtre quelles pistes afficher. Default = toutes (TRACK_ORDER). Utile
   *  pour /animation-studio qui n'affiche que la piste vidéo (les audio/texte
   *  sont gérés au niveau Studio Section). Refonte 2026-05-13. */
  visibleTracks?: TrackKind[]
  /** Bouton ✕ sur les blocs video/image_static. Reçoit le bloc complet.
   *  Refonte 2026-05-14ay : avant on envoyait `pelliculeId`, mais Studio
   *  Section V2 a besoin de `block.id` (= row.id PK section_timeline) pour
   *  son DELETE — pas de l'asset_id (= pelliculeId). Le caller pioche l'ID
   *  qui lui convient (block.id pour V2 row, block.pelliculeId pour legacy
   *  AnimationStudio qui passe à removeAnimationPellicule). */
  onDeleteBlock?: (block: TimelineBlock) => void
  /** Bouton ▶ "Animer" affiché uniquement sur les blocs image_static
   *  (refonte 2026-05-14). Crée une animation à partir de cette image
   *  (caller : DELETE bloc image + push AnimationStudio en draft animation
   *  avec firstFrameUrl pré-rempli). Reçoit le pelliculeId (= imageAssetId). */
  onAnimateBlock?: (pelliculeId: string) => void
  /** ID du bloc sélectionné — applique le highlight visuel (border accent
   *  + box-shadow) sur le bloc correspondant. Refonte 2026-05-14t. */
  selectedBlockId?: string | null
  /** ID de la pellicule sélectionnée — highlight TOUS les blocs avec ce
   *  pelliculeId (= shots multiples d'une même pellicule). Refonte 2026-05-14ai. */
  selectedPelliculeId?: string | null
  /** Actions de création par track (refonte 2026-05-14). Rendues dans la
   *  toolbar centrée au-dessus de la timeline avec icône + label visible. */
  trackActions?: Partial<Record<TrackKind, Array<ToolbarAction>>>
  /** Action "active" = drawer ouvert (refonte 2026-05-14s, pattern
   *  DesignerActionsToolbar). Quand set : l'icône principale glisse à
   *  gauche, ses subTools sortent à droite avec stagger, et les autres
   *  actions de la toolbar disparaissent en fade. Drivé par le caller
   *  (= Studio Section qui détecte la sélection d'un bloc et active
   *  l'action correspondante). */
  activeAction?: { track: TrackKind; index: number } | null
  onActiveActionChange?: (next: { track: TrackKind; index: number } | null) => void
  /** Refonte 2026-05-14av — Sync lecture timeline → preview.
   *  Notifie le parent quand le cursor entre dans une nouvelle pellicule
   *  (= block.kind video/image_static avec pelliculeId distinct). Le parent
   *  peut alors highlight la pellicule + faire suivre le preview. */
  onCursorPelliculeChange?: (pelliculeId: string | null) => void
  /** Notifie le parent quand l'état Play/Pause change (clic ▷ Play /
   *  Pause / Stop). Permet de synchroniser le preview qui doit jouer
   *  la vidéo de la pellicule courante. */
  onPlayingChange?: (playing: boolean) => void
  /** Refonte 2026-05-14be — Bouton "Continuer" dans le header timeline.
   *  Actif uniquement quand une pellicule animation avec videoUrl est
   *  sélectionnée. Au clic, déclenche V2V Extend (= handleContinueVideo). */
  onContinueVideo?: () => void
  canContinueVideo?: boolean
  /** Refonte 2026-05-20 — feature Couper inline (remplace ancienne modale).
   *  Suppr frame courante au cursor (ffmpeg cutRange [cursor, cursor+1frame]).
   *  Le caller reçoit le pelliculeId sous le cursor + offset relatif (ms). */
  onDeleteFrameAtCursor?: (pelliculeId: string, cursorOffsetMs: number) => void | Promise<void>
  /** Split la pellicule sous le cursor en 2 (avant + après). Insert partB
   *  comme nouvelle row immédiatement après. */
  onCutAtCursor?: (pelliculeId: string, cursorOffsetMs: number) => void | Promise<void>
  /** Refonte 2026-05-20 — émis quand l'user fait un scrub manuel (step ±frame
   *  via bouton OU clavier OU drag ruler/cursor). Le parent peut ouvrir le
   *  preview en pause + fermer la banque pour donner du feedback visuel. */
  onUserScrubAction?: () => void
  /** Refonte 2026-05-20 — si true, désactive Play + step + Supprimer + Couper
   *  (pendant un ffmpeg en cours). Évite double-click pendant le traitement. */
  cutProcessing?: boolean
  /** Bouton ✨ Effets au hover des blocs video. Click = ouvre la modale
   *  Bibliothèque d'effets sur la pellicule. Refonte 2026-05-15ca. */
  onOpenEffects?: (pelliculeId: string) => void
  /** Refonte 2026-05-15dq — bouton Capture séparé. */
  onOpenCapture?: (pelliculeId: string) => void
  /** Refonte 2026-05-16 — bouton "Modifier" sur chaque bloc timeline.
   *  Click → ouvre Studio Animation (video) ou Designer (image_static). */
  onEditBlock?: (pelliculeId: string, kind: 'video' | 'image_static') => void
  /** Refonte 2026-05-17 — mode "compact sequence" (Studio Section). Si true,
   *  les drops ne passent PAS par snap/findFreeSlot (qui force append à la
   *  fin quand la track est saturée). Le caller reçoit raw target ms et fait
   *  son propre reorder + compact côté state. */
  compactMode?: boolean
  /** Refonte 2026-05-17 — control externe play/pause (sync avec PreviewModal).
   *  Si défini, override le state interne du hook useCursorRaf. */
  externalIsPlaying?: boolean | null
  /** Cursor externe (sync depuis PreviewModal). Si change, seek interne. */
  externalCursorMs?: number | null
  /** Notifié quand l'utilisateur fait un seek manuel via la ruler (drag/click).
   *  Permet au parent (Studio Section) de sync le PreviewModal. */
  onUserSeek?: (cursorMs: number) => void
}

export interface ToolbarAction {
  icon: React.ReactNode
  onClick?: () => void
  label: string
  title?: string
  disabled?: boolean
  busy?: boolean
  /** Si fourni : action expand-able (drawer subTools). Au clic, ouvre le
   *  drawer au lieu d'appeler onClick. */
  subTools?: Array<{
    icon: React.ReactNode
    label: string
    title?: string
    onClick?: () => void
    disabled?: boolean
    /** Refonte 2026-05-18 — si true, le folder NE se ferme PAS automatiquement
     *  après le click (= activeAction stays active). Utile pour les sub-tools
     *  qui ouvrent un panneau d'édition persistant (ex: Calques) où l'auteur
     *  veut garder la pellicule sélectionnée pendant l'édition. Default false
     *  (= comportement standard : folder collapse + onActiveActionChange(null)). */
    keepActiveOnClick?: boolean
  }>
}

export default function MultiTrackTimeline({
  state, pxPerSec = 40, trackHeightRem = 3, trackHeightsRem,
  onSelectBlock, onDropFromLibrary, onMoveBlock, onResizeBlock,
  visibleTracks, onDeleteBlock, onAnimateBlock, trackActions,
  activeAction, onActiveActionChange, selectedBlockId, selectedPelliculeId,
  onCursorPelliculeChange, onPlayingChange,
  onContinueVideo, canContinueVideo, onDeleteFrameAtCursor, onCutAtCursor,
  onUserScrubAction, cutProcessing, onOpenEffects, onOpenCapture, onEditBlock, compactMode,
  externalIsPlaying, externalCursorMs, onUserSeek,
}: MultiTrackTimelineProps) {
  const tracksToRender = visibleTracks ?? TRACK_ORDER
  // Total = max(totalDurationMs, 10s) pour qu'une timeline vide ait un ruler
  // visible. À +5s à droite pour donner de l'espace pour drop/append.
  const visibleDurationMs = useMemo(
    () => Math.max(state.totalDurationMs + 5000, 15000),
    [state.totalDurationMs],
  )
  const totalWidthPx = msToPx(visibleDurationMs, pxPerSec)

  const { cursorMsRef, isPlaying, play, pause, seek } = useCursorRaf({
    totalDurationMs: state.totalDurationMs,
  })

  // Refonte 2026-05-17 — sync play/pause RÉINTRODUITE avec guard strict.
  // Deps minimales (uniquement externalIsPlaying via ref, pas play/pause
  // qui changeraient à chaque render). Évite la boucle "Maximum update depth".
  const lastSyncedExtPlayRef = useRef<boolean | null>(null)
  const playRef = useRef(play)
  const pauseRef = useRef(pause)
  useEffect(() => { playRef.current = play }, [play])
  useEffect(() => { pauseRef.current = pause }, [pause])
  useEffect(() => {
    if (externalIsPlaying == null) return
    if (externalIsPlaying === lastSyncedExtPlayRef.current) return
    lastSyncedExtPlayRef.current = externalIsPlaying
    if (externalIsPlaying) playRef.current()
    else {
      pauseRef.current()
      // Refonte 2026-05-19 — au pause externe, force snap au cursor externe
      // courant (= la position de stop émise par Preview, ex: fin pellicule
      // sur playUntilGlobalMs). Sans ça, MTT.rAF avait avancé de quelques ms
      // au-delà de la boundary → bar visible au-delà de la fin réelle.
      if (externalCursorMs != null) {
        const { minMs, maxMs } = seekBoundsRef.current
        cursorMsRef.current = Math.max(minMs, Math.min(maxMs, externalCursorMs))
      }
    }
  }, [externalIsPlaying, externalCursorMs, cursorMsRef, state.totalDurationMs])

  // Refonte 2026-05-17 — sync externalCursorMs : applique le cursor sans
  // jamais appeler play() ici (le play/pause est géré exclusivement par
  // l'useEffect externalIsPlaying juste au-dessus). Évite la boucle.
  // Deps minimales (uniquement externalCursorMs) ; les autres valeurs sont
  // lues via refs ou via state direct (pas d'objet identité changeante).
  const lastSyncedExtCursorRef = useRef<number | null>(null)
  const totalDurationMsRef = useRef(state.totalDurationMs)
  useEffect(() => { totalDurationMsRef.current = state.totalDurationMs }, [state.totalDurationMs])

  // Refonte 2026-05-19 — clamp curseur entre 1ère et dernière frame
  // (video/image_static). La barre ne doit jamais aller sur la colonne d'icônes
  // sticky à gauche, ni au-delà de la fin de la dernière pellicule à droite.
  // Fallback [0, totalDurationMs] si aucune frame.
  const seekBoundsRef = useRef<{ minMs: number; maxMs: number }>({ minMs: 0, maxMs: state.totalDurationMs })
  useEffect(() => {
    const visual = state.blocks.filter(b => b.kind === 'video' || b.kind === 'image_static')
    if (visual.length === 0) {
      seekBoundsRef.current = { minMs: 0, maxMs: state.totalDurationMs }
      return
    }
    let minMs = Infinity
    let maxMs = 0
    for (const b of visual) {
      if (b.startMs < minMs) minMs = b.startMs
      const end = b.startMs + b.durationMs
      if (end > maxMs) maxMs = end
    }
    seekBoundsRef.current = { minMs, maxMs }
  }, [state.blocks, state.totalDurationMs])

  useEffect(() => {
    if (externalCursorMs == null) return
    if (externalCursorMs === lastSyncedExtCursorRef.current) return
    lastSyncedExtCursorRef.current = externalCursorMs
    const { minMs, maxMs } = seekBoundsRef.current
    const clampedMs = Math.max(minMs, Math.min(maxMs, externalCursorMs))
    // Refonte 2026-05-19 — Tolérance bumpée 250ms → 800ms pour éviter les
    // saccades visuelles du curseur quand Preview emit asynchrone arrive en
    // léger décalage temporel par rapport à la rAF interne MTT. Au-dessus on
    // snap (= cas drag ruler ou re-positionnement explicite).
    if (Math.abs(clampedMs - cursorMsRef.current) > 800) {
      cursorMsRef.current = clampedMs
    }
  }, [externalCursorMs, cursorMsRef])

  // Refonte 2026-05-14ai — quand selectedPelliculeId change, seek la barre
  // de lecture au début du 1er bloc de cette pellicule. Permet à l'auteur
  // de voir la barre rouge se positionner sur la nouvelle pellicule
  // (= après "Continuer" / sélection manuelle).
  useEffect(() => {
    if (!selectedPelliculeId) return
    const firstBlock = state.blocks.find(b =>
      (b.kind === 'video' || b.kind === 'image_static')
      && b.pelliculeId === selectedPelliculeId)
    if (firstBlock) seek(firstBlock.startMs)
  }, [selectedPelliculeId, state.blocks, seek])

  // Refonte 2026-05-15bk — seek aussi sur selectedBlockId (cas Studio Section
  // V2 où plusieurs blocs partagent le même assetId, on doit cibler le row
  // exact). Précédence : selectedBlockId > selectedPelliculeId.
  useEffect(() => {
    if (!selectedBlockId) return
    const exact = state.blocks.find(b => b.id === selectedBlockId)
    if (exact) seek(exact.startMs)
  }, [selectedBlockId, state.blocks, seek])

  // Filtre les blocs audio (SFX + musique) pour le mixer
  const audioBlocks = useMemo(
    () => state.blocks.filter(b => b.kind === 'sfx' || b.kind === 'music'),
    [state.blocks],
  )
  useAudioMixer({ audioBlocks, cursorMsRef, isPlaying })

  // Refonte 2026-05-14av — Notifie le parent quand isPlaying change.
  // Le parent (AnimationStudioInner) propage au Preview pour sync lecture.
  // Refonte 2026-05-17 — onPlayingChange via ref pour ne PAS retrigger l'effet
  // à chaque re-render du parent (callback identity churn = boucle infinie).
  const onPlayingChangeRef = useRef(onPlayingChange)
  useEffect(() => { onPlayingChangeRef.current = onPlayingChange }, [onPlayingChange])
  useEffect(() => {
    onPlayingChangeRef.current?.(isPlaying)
  }, [isPlaying])

  // Refonte 2026-05-14av — rAF tick qui détermine quelle pellicule contient
  // le cursor courant. Notifie le parent UNIQUEMENT quand la pellicule
  // change (= cursor traverse un changement de bloc). Évite les notifs
  // 60Hz parasites. Le parent peut alors highlight + faire suivre le preview.
  const lastNotifiedPelliculeRef = useRef<string | null>(null)
  // Refonte 2026-05-19 — state local `playingBlockId` = bloc video/image
  // SOUS le cursor. Utilisé pour highlight automatique de la pellicule en
  // lecture (= rose se déplace quand le cursor traverse les pellicules).
  // Update à 5Hz via setInterval pour limiter le re-render storm.
  const [playingBlockId, setPlayingBlockId] = useState<string | null>(null)
  useEffect(() => {
    const id = setInterval(() => {
      const ms = cursorMsRef.current
      const block = state.blocks.find(b =>
        (b.kind === 'video' || b.kind === 'image_static')
        && ms >= b.startMs && ms < b.startMs + b.durationMs)
      const nextId = block ? block.id : null
      setPlayingBlockId(prev => prev === nextId ? prev : nextId)
    }, 200)
    return () => clearInterval(id)
  }, [cursorMsRef, state.blocks])
  useEffect(() => {
    if (!onCursorPelliculeChange) return
    let raf = 0
    function tick() {
      const ms = cursorMsRef.current
      const block = state.blocks.find(b =>
        (b.kind === 'video' || b.kind === 'image_static')
        && ms >= b.startMs && ms < b.startMs + b.durationMs)
      const pelliculeId = block && (block.kind === 'video' || block.kind === 'image_static')
        ? block.pelliculeId
        : null
      if (pelliculeId !== lastNotifiedPelliculeRef.current) {
        lastNotifiedPelliculeRef.current = pelliculeId
        onCursorPelliculeChange?.(pelliculeId)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cursorMsRef, state.blocks, onCursorPelliculeChange])

  // Curseur visuel — référencé par rAF interne pour fluidité 60Hz sans
  // re-render. On poll cursorMsRef et on transform le DIV.
  const cursorVisualRef = useRef<HTMLDivElement | null>(null)
  // Refonte 2026-05-17 — auto-scroll throttlé + smooth (anti-saccade).
  // Évite scroll à chaque frame qui fait "sauter" la barre visuelle.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  // Refonte 2026-05-19 — scrollbar du HAUT, synced bidir avec mtt-scroll.
  const scrollTopRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const top = scrollTopRef.current
    const main = scrollContainerRef.current
    if (!top || !main) return
    let syncing = false
    const onTopScroll = () => {
      if (syncing) return
      syncing = true
      main.scrollLeft = top.scrollLeft
      requestAnimationFrame(() => { syncing = false })
    }
    const onMainScroll = () => {
      if (syncing) return
      syncing = true
      top.scrollLeft = main.scrollLeft
      requestAnimationFrame(() => { syncing = false })
    }
    top.addEventListener('scroll', onTopScroll, { passive: true })
    main.addEventListener('scroll', onMainScroll, { passive: true })
    return () => {
      top.removeEventListener('scroll', onTopScroll)
      main.removeEventListener('scroll', onMainScroll)
    }
  }, [])

  // Refonte 2026-05-20 — raccourcis clavier globaux : flèches ←/→ = step
  // cursor ±1 frame (~33ms à 30fps). Bloqué si focus sur input/textarea pour
  // ne pas voler la navigation texte au user.
  useEffect(() => {
    const FRAME_MS = 1000 / 30
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Refonte 2026-05-20 — figé pendant cut/split en cours.
        if (cutProcessingRef.current) return
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        const next = Math.max(0, Math.min(totalDurationMsRef.current, cursorMsRef.current + dir * FRAME_MS))
        seek(next)
        onUserSeek?.(next)
        // Refonte 2026-05-20 — signal au parent (idem boutons step).
        onUserScrubAction?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seek, onUserSeek, onUserScrubAction])
  // Ref pour cutProcessing (lu dans le keyboard handler qui a deps stables).
  const cutProcessingRef = useRef(cutProcessing)
  useEffect(() => { cutProcessingRef.current = !!cutProcessing }, [cutProcessing])
  const lastScrollCheckTsRef = useRef<number>(0)
  useEffect(() => {
    let raf = 0
    function tick() {
      const ms = cursorMsRef.current
      const cursorPx = msToPx(ms, pxPerSec)
      if (cursorVisualRef.current) {
        cursorVisualRef.current.style.transform = `translateX(${cursorPx}px)`
      }
      // Auto-scroll check throttlé.
      // Refonte 2026-05-19 — détection obstacle PreviewModal :
      // la barre rouge ne doit PAS disparaître derrière la fenêtre flottante
      // du Preview (à droite de l'écran en Studio Section). On query le DOM
      // `.preview-modal-window:not(.is-embedded)` et on utilise son edge gauche
      // comme limite droite effective. Si pas d'obstacle, fallback = viewRight.
      const scroll = scrollContainerRef.current
      if (scroll && isPlaying) {
        const now = performance.now()
        if (now - lastScrollCheckTsRef.current > 250) {
          const cursorVisualPx = cursorPx + TRACK_LABEL_PX
          const viewLeft = scroll.scrollLeft
          const viewportClientWidth = scroll.clientWidth
          let effectiveRightPx = viewLeft + viewportClientWidth
          const obstacle = document.querySelector<HTMLElement>('.preview-modal-window:not(.is-embedded)')
          if (obstacle) {
            const scrollRect = scroll.getBoundingClientRect()
            const obstacleRect = obstacle.getBoundingClientRect()
            // Si l'obstacle chevauche horizontalement le viewport scroll, on
            // ramène effectiveRightPx à sa edge gauche (en stage-coords).
            if (obstacleRect.left < scrollRect.right && obstacleRect.right > scrollRect.left) {
              const obstacleLeftInScroll = obstacleRect.left - scrollRect.left + viewLeft
              if (obstacleLeftInScroll < effectiveRightPx) {
                effectiveRightPx = obstacleLeftInScroll
              }
            }
          }
          const margin = 150
          if (cursorVisualPx > effectiveRightPx - margin || cursorVisualPx < viewLeft + margin) {
            lastScrollCheckTsRef.current = now
            // Scroll smooth : ramène le cursor à 1/4 de l'espace visible
            // [viewLeft, effectiveRightPx] pour laisser ~75% de marge avant
            // que le cursor n'atteigne à nouveau l'obstacle/le bord droit.
            const usableWidth = Math.max(100, effectiveRightPx - viewLeft)
            const target = Math.max(0, cursorVisualPx - usableWidth / 4)
            scroll.scrollTo({ left: target, behavior: 'smooth' })
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cursorMsRef, pxPerSec, isPlaying])

  // Refonte 2026-05-14ap — Scrubber drag : pointerdown seek + suit la souris
  // jusqu'au pointerup. Track-label sticky = 2.25rem (36px à 1rem=16px).
  const TRACK_LABEL_PX = 36
  function handleRulerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Refonte 2026-05-20 — figer le scrub pendant cut/split en cours.
    if (cutProcessing) return
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const rect = target.getBoundingClientRect()
    const apply = (clientX: number) => {
      const px = Math.max(0, clientX - rect.left - TRACK_LABEL_PX)
      const rawMs = pxToMs(px, pxPerSec)
      // Refonte 2026-05-19 — clamp [1ère frame, dernière frame]
      const { minMs, maxMs } = seekBoundsRef.current
      const ms = Math.max(minMs, Math.min(maxMs, rawMs))
      seek(ms)
      onUserSeek?.(ms)
    }
    apply(e.clientX)
    const onMove = (ev: PointerEvent) => { ev.preventDefault(); apply(ev.clientX) }
    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId) } catch { /* noop */ }
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  // Drop handler par piste. Différencie 'add from library' vs 'move existing'.
  // Snap au voisin/grille dans les 2 cas.
  function handleDrop(track: TrackKind) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragInsertState(null)  // refonte 2026-05-14az : clear indicator
      setDragInsertState(null)  // refonte 2026-05-14az : clear indicator
      const rect = e.currentTarget.getBoundingClientRect()
      const dropPx = Math.max(0, e.clientX - rect.left - TRACK_LABEL_PX)
      const rawMs = pxToMs(dropPx, pxPerSec)
      // 1. Repositionnement d'un bloc existant ?
      const moveRaw = e.dataTransfer.getData(TIMELINE_MOVE_MIME)
      if (moveRaw) {
        try {
          const move = JSON.parse(moveRaw) as MovePayload
          // Garde-fou : ne permet le déplacement QUE sur la même piste (pour
          // V2 — les blocs ne peuvent pas changer de track car leur kind les y
          // associe). Cross-track move = no-op silencieux.
          if (move.trackKind !== track) return
          // Trouve le bloc pour récupérer sa durée + ignore-self au snap
          const block = state.blocks.find(b => b.id === move.blockId)
          if (!block) return
          // Position cible = position curseur - offset capté au grab
          const targetMs = Math.max(0, rawMs - move.grabOffsetMs)
          // Refonte 2026-05-17 — mode compact : on bypass snap/findFreeSlot
          // qui forçaient append-à-la-fin quand la track était saturée. Le
          // caller reçoit le raw target et fait son reorder côté state.
          if (compactMode) {
            onMoveBlock?.(move.blockId, targetMs)
            return
          }
          const snapped = snapToNeighborOrGrid(state, track, targetMs)
          // Use findFreeSlot avec excludeBlockId pour pas matcher le bloc lui-même
          // Pour rester simple V1, on appelle wouldOverlap directement.
          const finalMs = wouldOverlapExclude(state, track, snapped, block.durationMs, block.id)
            ? findFreeSlot(state, track, snapped, block.durationMs)
            : snapped
          onMoveBlock?.(move.blockId, finalMs)
          return
        } catch { return }
      }
      // 2. Ajout depuis library ?
      const raw = e.dataTransfer.getData(TIMELINE_DRAG_MIME)
      if (!raw) return
      let payload: DragPayload
      try {
        payload = JSON.parse(raw) as DragPayload
      } catch {
        return
      }
      const snappedMs = snapToNeighborOrGrid(state, track, rawMs)
      const finalMs = findFreeSlot(state, track, snappedMs, payload.defaultDurationMs)
      onDropFromLibrary?.(track, payload, finalMs)
    }
  }

  function allowDrop(e: React.DragEvent<HTMLDivElement>) {
    const types = Array.from(e.dataTransfer.types)
    if (types.includes(TIMELINE_DRAG_MIME) || types.includes(TIMELINE_MOVE_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = types.includes(TIMELINE_MOVE_MIME) ? 'move' : 'copy'
    }
  }

  // Refonte 2026-05-14az — Insertion indicator pendant le drag.
  // Affiche une ligne verticale rose à l'endroit où le bloc va atterrir
  // (snap aux voisins/grille). Limitation HTML5 : on ne connaît pas la
  // duration du bloc dragged pendant onDragOver (dataTransfer values
  // unreadable hors onDrop). Donc indicator = ligne, pas placeholder.
  const [dragInsertState, setDragInsertState] = useState<{ track: TrackKind; px: number; insertMs: number; durationMs: number; draggedBlockId: string | null } | null>(null)
  function handleDragOverWithIndicator(track: TrackKind) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      allowDrop(e)
      const types = Array.from(e.dataTransfer.types)
      if (!types.includes(TIMELINE_DRAG_MIME) && !types.includes(TIMELINE_MOVE_MIME)) return
      const rect = e.currentTarget.getBoundingClientRect()
      const dropPx = Math.max(0, e.clientX - rect.left - TRACK_LABEL_PX)
      const rawMs = pxToMs(dropPx, pxPerSec)
      const snappedMs = snapToNeighborOrGrid(state, track, rawMs)
      const snappedPx = msToPx(snappedMs, pxPerSec) + TRACK_LABEL_PX
      // Refonte 2026-05-14bb — Lit le ref module-level pour connaître la
      // duration du bloc dragged (HTML5 dataTransfer values pas lisibles ici).
      // Default 4000ms si jamais le ref n'a pas été set (fallback safe).
      const info = currentDragInfoRef.current
      setDragInsertState({
        track,
        px: snappedPx,
        insertMs: snappedMs,
        durationMs: info?.durationMs ?? 4000,
        draggedBlockId: info?.blockId ?? null,
      })
    }
  }
  function handleDragLeave() {
    setDragInsertState(null)
  }

  // Helper local : comme wouldOverlap mais en excluant un bloc précis (pour
  // ne pas que le bloc en cours de move se voie comme overlapping avec
  // lui-même au moment du recalcul).
  function wouldOverlapExclude(
    s: TimelineState, track: TrackKind, startMs: number, durationMs: number,
    excludeId: string,
  ): boolean {
    const endMs = startMs + durationMs
    for (const b of s.blocks) {
      if (b.trackKind !== track || b.id === excludeId) continue
      const bEnd = b.startMs + b.durationMs
      if (startMs < bEnd && endMs > b.startMs) return true
    }
    return false
  }

  return (
    <div className="mtt-root">
      {/* Toolbar de lecture — au-dessus de la timeline. Ruler + tracks scroll
       *  ensemble si overflow. */}
      <div className="mtt-toolbar">
        <button
          type="button"
          className="mtt-btn"
          onClick={isPlaying ? pause : play}
          disabled={state.totalDurationMs === 0 || cutProcessing}
          aria-label={isPlaying ? 'Pause' : 'Lecture'}
          title={cutProcessing
            ? 'Traitement en cours…'
            : (isPlaying ? 'Pause (Espace)' : 'Lecture (Espace)')}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        {/* Refonte 2026-05-20 — Step ±1 frame (~33ms à 30fps) + actions
         *  destructives au cursor (supprimer la frame, couper ici).
         *  Le cursor est la source de vérité — pas de modale. */}
        {(() => {
          const FRAME_MS = 1000 / 30
          const blocksAtCursor = (() => {
            const ms = cursorMsRef.current
            return state.blocks.find(b =>
              b.kind === 'video' && ms >= b.startMs && ms < b.startMs + b.durationMs)
          })()
          const stepFrame = (dir: -1 | 1) => {
            const next = cursorMsRef.current + dir * FRAME_MS
            const clamped = Math.max(0, Math.min(state.totalDurationMs, next))
            seek(clamped)
            onUserSeek?.(clamped)
            // Refonte 2026-05-20 — signal au parent : feedback preview pause.
            onUserScrubAction?.()
          }
          const hasVideoAtCursor = !!blocksAtCursor
          return (
            <>
              <button
                type="button"
                className="mtt-btn"
                onClick={() => stepFrame(-1)}
                disabled={state.totalDurationMs === 0 || cutProcessing}
                aria-label="Frame précédente"
                title={cutProcessing ? 'Traitement en cours…' : 'Frame précédente (←)'}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="mtt-btn"
                onClick={() => stepFrame(1)}
                disabled={state.totalDurationMs === 0 || cutProcessing}
                aria-label="Frame suivante"
                title={cutProcessing ? 'Traitement en cours…' : 'Frame suivante (→)'}
              >
                <ChevronRight size={14} />
              </button>
              {(onDeleteFrameAtCursor || onCutAtCursor) && (
                <span className="mtt-toolbar-sep" aria-hidden />
              )}
              {onDeleteFrameAtCursor && (
                <button
                  type="button"
                  className="mtt-btn mtt-btn-danger"
                  onClick={() => {
                    // Refonte 2026-05-20 v2 — compute FRESH au click (le ref
                    // cursorMsRef ne trigger pas re-render, donc le blocksAtCursor
                    // calculé au render pouvait être stale après scrub).
                    const ms = cursorMsRef.current
                    const block = state.blocks.find(b =>
                      b.kind === 'video' && ms >= b.startMs && ms < b.startMs + b.durationMs)
                    if (!block || block.kind !== 'video') return
                    const offset = ms - block.startMs
                    void onDeleteFrameAtCursor(block.pelliculeId, offset)
                  }}
                  disabled={state.totalDurationMs === 0 || cutProcessing}
                  aria-label="Supprimer la frame"
                  title={cutProcessing
                    ? 'Traitement en cours…'
                    : 'Supprimer ~1 frame (33ms) à la position du curseur'}
                >
                  {cutProcessing
                    ? <Loader2 size={14} className="mtt-spin" />
                    : <Scissors size={14} />}
                </button>
              )}
              {onCutAtCursor && (
                <button
                  type="button"
                  className="mtt-btn"
                  onClick={() => {
                    const ms = cursorMsRef.current
                    const block = state.blocks.find(b =>
                      b.kind === 'video' && ms >= b.startMs && ms < b.startMs + b.durationMs)
                    if (!block || block.kind !== 'video') return
                    const offset = ms - block.startMs
                    void onCutAtCursor(block.pelliculeId, offset)
                  }}
                  disabled={state.totalDurationMs === 0 || cutProcessing}
                  aria-label="Couper à partir d'ici"
                  title={cutProcessing
                    ? 'Traitement en cours…'
                    : 'Splitter la pellicule en 2 à la position du curseur'}
                >
                  {cutProcessing
                    ? <Loader2 size={14} className="mtt-spin" />
                    : <Columns2 size={14} />}
                </button>
              )}
            </>
          )
        })()}
        {/* Refonte 2026-05-17 — bouton Stop retiré. Pause + retour au début
         *  passent par le PreviewModal (qui s'ouvre au Play). */}
        {/* Refonte 2026-05-14be — Continuer (V2V Extend). Actif uniquement
         *  quand une pellicule animation avec videoUrl est sélectionnée. */}
        {onContinueVideo && (
          <button
            type="button"
            className="mtt-btn mtt-btn-continue"
            onClick={onContinueVideo}
            disabled={!canContinueVideo}
            aria-label="Continuer la vidéo"
            title={canContinueVideo
              ? 'Continuer la vidéo (V2V Extend depuis la pellicule sélectionnée)'
              : 'Sélectionne une pellicule animation générée pour continuer'}
          >
            <FastForward size={14} />
          </button>
        )}
        {/* Actions de création centrées (refonte 2026-05-14s) — pattern
         *  DesignerActionsToolbar : si une action a `subTools` ET est active
         *  (matched par activeAction), elle reste visible + révèle ses
         *  subTools à droite avec stagger. Les autres actions disparaissent
         *  en fade. */}
        <div className="mtt-toolbar-actions">
          {(() => {
            const allEntries = tracksToRender.flatMap(track =>
              (trackActions?.[track] ?? []).map((action, i) => ({ track, i, action })))
            const activeEntry = activeAction
              ? allEntries.find(e => e.track === activeAction.track && e.i === activeAction.index) ?? null
              : null
            // Refonte 2026-05-17 — garder TOUTES les actions visibles même
            // quand une est expanded (avant : visibleEntries = [activeEntry] →
            // les autres disparaissaient en fade). Les entries du même track
            // que l'active sont marquées disabled (= grisées, non cliquables).
            // Les autres tracks (sfx, music, text) restent pleinement cliquables.
            const visibleEntries = allEntries
            return (
              <motion.div className="mtt-toolbar-actions-row" layout
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
                {/* Refonte 2026-05-17 — sub-tools INTÉGRÉS dans le flow : ils
                 *  s'insèrent juste après le folder actif (ex: Animation expand
                 *  → Animation | Continuer | Ajouter | Image | Son | …). */}
                <AnimatePresence mode="popLayout">
                  {visibleEntries.flatMap(({ track, i, action }) => {
                    const tooltip = action.title ?? action.label
                    const isActiveExpand = activeEntry !== null && activeEntry.track === track && activeEntry.i === i
                    const isSiblingDisabled = activeEntry !== null
                      && activeEntry.track === track
                      && activeEntry.i !== i
                    const isFolderOnly = !action.onClick && !!action.subTools
                    // Refonte 2026-05-17 — folder-only est cliquable QUAND
                    // actif (= permet de toggle off). Sinon non cliquable.
                    const folderOnlyBlocking = isFolderOnly && !isActiveExpand
                    const effectivelyDisabled = action.disabled || action.busy || isSiblingDisabled || folderOnlyBlocking
                    const handleClick = () => {
                      if (effectivelyDisabled) return
                      // Toggle off si déjà actif (clear selectedBlock côté parent).
                      if (isActiveExpand) {
                        onActiveActionChange?.(null)
                        return
                      }
                      action.onClick?.()
                    }
                    const nodes: React.ReactNode[] = [
                      <motion.button
                        key={`${track}-${i}`}
                        type="button"
                        layout
                        className={`mtt-toolbar-action${isActiveExpand ? ' is-active' : ''}${isSiblingDisabled ? ' is-sibling-disabled' : ''}${isFolderOnly ? ' is-folder-only' : ''}`}
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        onClick={handleClick}
                        disabled={effectivelyDisabled}
                        title={action.busy ? `${tooltip}…` : tooltip}
                        aria-label={tooltip}
                        aria-pressed={isActiveExpand}
                      >
                        <span className="mtt-toolbar-action-icon">
                          {action.busy ? <Loader2 size={14} className="mtt-spin" /> : action.icon}
                        </span>
                        <span className="mtt-toolbar-action-label">{action.label}</span>
                      </motion.button>,
                    ]
                    // Si actif ET a des subTools : les insérer juste après
                    if (isActiveExpand && action.subTools) {
                      for (const [k, sub] of action.subTools.entries()) {
                        nodes.push(
                          <motion.button
                            key={`${track}-${i}-sub-${k}`}
                            type="button"
                            layout
                            className="mtt-toolbar-subtool"
                            initial={{ opacity: 0, x: -10, scale: 0.85 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -10, scale: 0.85 }}
                            transition={{ duration: 0.18, delay: k * 0.05, ease: [0.16, 1, 0.3, 1] }}
                            onClick={() => {
                              sub.onClick?.()
                              // Refonte 2026-05-18 — opt-out de l'auto-collapse via keepActiveOnClick.
                              if (!sub.keepActiveOnClick) onActiveActionChange?.(null)
                            }}
                            disabled={sub.disabled}
                            title={sub.title ?? sub.label}
                            aria-label={sub.label}
                          >
                            <span className="mtt-toolbar-subtool-icon">{sub.icon}</span>
                            <span className="mtt-toolbar-subtool-label">{sub.label}</span>
                          </motion.button>,
                        )
                      }
                    }
                    return nodes
                  })}
                </AnimatePresence>
              </motion.div>
            )
          })()}
        </div>
        <span className="mtt-time">
          {formatDurationMsCompact(cursorMsRef.current)} / {formatDurationMsCompact(state.totalDurationMs)}
        </span>
      </div>

      {/* Refonte 2026-05-19 — Scrollbar du HAUT (synced avec mtt-scroll).
       *  Toujours visible, au-dessus de la ruler, pour éviter le clipping
       *  potentiel en bas de la timeline (Studio Section hauteur fixe). */}
      <div className="mtt-scroll-top" ref={scrollTopRef}>
        <div className="mtt-scroll-top-spacer" style={{ width: `${totalWidthPx}px` }} />
      </div>

      {/* Conteneur scrollable (horizontal si la séquence dépasse la largeur écran) */}
      <div className="mtt-scroll" ref={scrollContainerRef}>
        <div className="mtt-stage" style={{ width: `${totalWidthPx}px` }}>
          {/* Ruler temporel — graduations toutes les secondes. Click pour seek. */}
          <div
            className="mtt-ruler"
            onPointerDown={handleRulerPointerDown}
            role="slider"
            aria-label="Position de lecture"
          >
            {/* Refonte 2026-05-19 — coin sticky qui masque le curseur (z=3)
             *  quand sa pointe (rond + ligne) traverse visuellement la colonne
             *  d'icônes sticky des tracks. Sans ce coin, le rond du curseur en
             *  haut (au-dessus de la ruler) restait visible par-dessus la
             *  zone vide à gauche du ruler. */}
            <div className="mtt-ruler-corner" aria-hidden />
            {/* Refonte 2026-05-17 — label à chaque seconde (revert). */}
            {Array.from({ length: Math.floor(visibleDurationMs / 1000) + 1 }, (_, sec) => (
              <div
                key={sec}
                className="mtt-ruler-tick"
                style={{ left: `${msToPx(sec * 1000, pxPerSec)}px` }}
              >
                <span className="mtt-ruler-label">{sec}s</span>
              </div>
            ))}
          </div>

          {/* 4 pistes empilées verticalement. Chaque piste = drop target. */}
          <div className="mtt-tracks">
            {tracksToRender.map(track => (
              <div
                key={track}
                className={`mtt-track mtt-track-${track}`}
                style={{ height: `${trackHeightsRem?.[track] ?? trackHeightRem}rem` }}
                onDragOver={handleDragOverWithIndicator(track)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(track)}
              >
                <div className="mtt-track-label" aria-label={TRACK_LABELS[track]}>
                  <span className="mtt-track-icon" title={TRACK_LABELS[track]}>
                    {TRACK_ICONS[track]}
                  </span>
                </div>
                <div className="mtt-track-area">
                  {blocksOfTrack(state, track).map(block => {
                    // Refonte 2026-05-14bb — calcul des décalages drag :
                    // - draggingSelf : ce bloc est celui qu'on déplace → fade
                    // - shiftPx : pour les blocs sur la même track, à droite
                    //   du point d'insertion, décaler de +durationMs en px
                    //   (= laisse la place pour le drop). Smooth via CSS.
                    const isDragTarget = dragInsertState?.track === track
                    const draggingSelf = isDragTarget && dragInsertState.draggedBlockId === block.id
                    let shiftPx = 0
                    if (isDragTarget && !draggingSelf && block.startMs >= dragInsertState.insertMs) {
                      shiftPx = msToPx(dragInsertState.durationMs, pxPerSec)
                    }
                    return (
                      <BlockView
                        key={block.id}
                        block={block}
                        pxPerSec={pxPerSec}
                        selected={(() => {
                          // Refonte 2026-05-19 v2 — un SEUL highlight rose à la
                          // fois. Priorité :
                          //  1. Si lecture active (playingBlockId set), SEUL
                          //     le bloc sous le cursor highlight (= le rose
                          //     suit la barre).
                          //  2. Sinon, le bloc cliqué (selectedBlockId) ou la
                          //     pellicule matchant selectedPelliculeId.
                          if (playingBlockId != null) {
                            return playingBlockId === block.id
                          }
                          return selectedBlockId === block.id
                            || (!!selectedPelliculeId
                                && (block.kind === 'video' || block.kind === 'image_static')
                                && block.pelliculeId === selectedPelliculeId)
                        })()}
                        onClick={() => onSelectBlock?.(block)}
                        onResize={onResizeBlock ? (newStart, newDur) => onResizeBlock(block.id, newStart, newDur) : undefined}
                        onDelete={onDeleteBlock && (block.kind === 'video' || block.kind === 'image_static')
                          ? () => onDeleteBlock(block)
                          : undefined}
                        onAnimate={onAnimateBlock && block.kind === 'image_static'
                          ? () => onAnimateBlock(block.pelliculeId)
                          : undefined}
                        onOpenEffects={onOpenEffects && block.kind === 'video'
                          ? () => onOpenEffects(block.pelliculeId)
                          : undefined}
                        onOpenCapture={onOpenCapture && block.kind === 'video'
                          ? () => onOpenCapture(block.pelliculeId)
                          : undefined}
                        onEdit={onEditBlock && (block.kind === 'video' || block.kind === 'image_static')
                          ? () => onEditBlock(block.pelliculeId, block.kind)
                          : undefined}
                        shiftPx={shiftPx}
                        draggingSelf={draggingSelf}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Refonte 2026-05-14az — Insertion indicator pendant le drag.
           *  Ligne verticale rose snappée au point de drop. Visible
           *  uniquement quand un drag est en cours (state set par
           *  handleDragOverWithIndicator, clear par drop/leave). */}
          {dragInsertState && (
            <div
              className="mtt-insert-indicator"
              style={{ left: `${dragInsertState.px}px` }}
              aria-hidden
            />
          )}

          {/* Curseur de lecture — overlay vertical animé via rAF + drag pour scrub. */}
          <div
            ref={cursorVisualRef}
            className="mtt-cursor"
            aria-hidden
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              // Refonte 2026-05-20 — figer le scrub du cursor pendant cut/split.
              if (cutProcessing) return
              e.preventDefault()
              e.stopPropagation()
              const target = e.currentTarget
              target.setPointerCapture(e.pointerId)
              const stage = target.parentElement
              if (!stage) return
              const rect = stage.getBoundingClientRect()
              const apply = (clientX: number) => {
                const px = Math.max(0, clientX - rect.left - TRACK_LABEL_PX)
                const rawMs = pxToMs(px, pxPerSec)
                // Refonte 2026-05-19 — clamp [1ère frame, dernière frame]
                const { minMs, maxMs } = seekBoundsRef.current
                const ms = Math.max(minMs, Math.min(maxMs, rawMs))
                seek(ms)
                // Refonte 2026-05-17 — sync preview pendant le drag de la
                // barre rouge (avant : seek interne sans notif → preview
                // pas synchronisé). Maintenant chaque move émet onUserSeek.
                onUserSeek?.(ms)
              }
              apply(e.clientX)
              const onMove = (ev: PointerEvent) => { ev.preventDefault(); apply(ev.clientX) }
              const onUp = (ev: PointerEvent) => {
                try { target.releasePointerCapture(ev.pointerId) } catch { /* noop */ }
                target.removeEventListener('pointermove', onMove)
                target.removeEventListener('pointerup', onUp)
                target.removeEventListener('pointercancel', onUp)
              }
              target.addEventListener('pointermove', onMove)
              target.addEventListener('pointerup', onUp)
              target.addEventListener('pointercancel', onUp)
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Composant bloc ──────────────────────────────────────────────────────

interface BlockViewProps {
  block: TimelineBlock
  pxPerSec: number
  /** Highlight visuel quand sélectionné (refonte 2026-05-14t). */
  selected?: boolean
  onClick?: () => void
  onResize?: (newStartMs: number, newDurationMs: number) => void
  /** Bouton ✕ au top-right du bloc (refonte 2026-05-13).
   *  V2 : retire le bloc seulement, l'asset reste dans la banque. */
  onDelete?: () => void
  /** Bouton ▶ "Animer" sur les blocs image_static uniquement (refonte
   *  2026-05-14). Crée une animation à partir de cette image. */
  onAnimate?: () => void
  /** Bouton ✨ "Effets" au hover des blocs video uniquement (refonte
   *  2026-05-15ca). Ouvre la modale Bibliothèque d'effets pour la pellicule. */
  onOpenEffects?: () => void
  /** Refonte 2026-05-15dq — bouton Capture séparé. */
  onOpenCapture?: () => void
  /** Refonte 2026-05-16 — bouton "Modifier" : ouvre Studio Animation (bloc
   *  video) ou Designer (bloc image_static). */
  onEdit?: () => void
  /** Refonte 2026-05-14bb — Décalage visuel pendant un drag voisin.
   *  Si > 0, le bloc est translaté à droite pour libérer la place du bloc
   *  en cours d'insertion. Animé via CSS transition. */
  shiftPx?: number
  /** Si true, ce bloc est celui en cours de drag — on l'efface visuellement
   *  (placeholder) pour bien voir où il va atterrir. */
  draggingSelf?: boolean
}

/** Zone prompt à droite du bloc (refonte 2026-05-15bh).
 *  - Bloc large (≥22rem ≈ 352px à 16px/rem) : affiche le prompt en clair (clamp 3 lignes)
 *  - Bloc étroit : affiche un bouton "P" qui toggle un popover avec le prompt
 *    copiable (clic sur le texte du popover = copy clipboard, clic dehors ferme). */
function BlockPromptArea({ promptText, blockWidthPx }: { promptText: string; blockWidthPx: number }) {
  const [popOpen, setPopOpen] = React.useState(false)
  const NARROW_PX = 22 * 16  // 22rem en pixels (= bloc env. 22s à 16px/sec)
  const isNarrow = blockWidthPx < NARROW_PX
  React.useEffect(() => {
    if (!popOpen) return
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.mtt-block-prompt-pop') && !target.closest('.mtt-block-prompt-btn')) {
        setPopOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [popOpen])
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    void navigator.clipboard.writeText(promptText).catch(() => { /* no-op */ })
  }
  if (isNarrow) {
    return (
      <>
        <button
          type="button"
          className="mtt-block-prompt-btn"
          draggable={false}
          onClick={(e) => { e.stopPropagation(); setPopOpen(p => !p) }}
          title="Voir le prompt du shot 1"
        >P</button>
        {popOpen && (
          <div className="mtt-block-prompt-pop" onClick={handleCopy} title="Cliquer pour copier">
            {promptText}
          </div>
        )}
      </>
    )
  }
  return (
    <span
      className="mtt-block-prompt-text"
      onClick={handleCopy}
      title="Cliquer pour copier le prompt"
    >
      {promptText}
    </span>
  )
}

/** Vignette du bloc (refonte 2026-05-15bg) — image grossie qui occupe toute
 *  la hauteur du bloc + au hover, la vidéo joue en muted/loop comme dans la
 *  banque. Pour image_static, juste l'image (pas de hover video). */
function BlockThumb({ block }: { block: TimelineBlock }) {
  const [hovering, setHovering] = React.useState(false)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const isVideo = block.kind === 'video'
  const videoUrl = isVideo ? block.videoUrl : null
  // Phase A bis 2026-05-18 — block kind 'layer' affiche aussi sa miniature
  // (media_url qui peut être PNG / MP4 / GIF — on prend l'URL directement).
  const thumbUrl = isVideo
    ? block.firstFrameUrl
    : block.kind === 'image_static' ? block.imageUrl
    : block.kind === 'layer' ? block.mediaUrl
    : null
  React.useEffect(() => {
    if (!isVideo || !videoUrl) return
    const v = videoRef.current
    if (!v) return
    if (hovering) {
      v.currentTime = 0
      void v.play().catch(() => { /* autoplay blocked, no-op */ })
    } else {
      v.pause()
    }
  }, [hovering, isVideo, videoUrl])
  if (!thumbUrl && !videoUrl) return null
  return (
    <div
      className="mtt-block-thumb-wrap"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Refonte 2026-05-20 — Si videoUrl dispo, on render le <video> EN
       *  PERMANENCE (preload=metadata décode la 1ère frame visible au repos).
       *  Évite la dépendance à first_frame_url extrait. Le hover déclenche play. */}
      {isVideo && videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          className="mtt-block-thumb"
        />
      ) : thumbUrl ? (
        <img src={thumbUrl} alt="" className="mtt-block-thumb" draggable={false} />
      ) : null}
    </div>
  )
}

function BlockView({ block, pxPerSec, selected, onClick, onResize, onDelete, onOpenEffects, onOpenCapture, onEdit, shiftPx, draggingSelf }: BlockViewProps) {
  // onAnimate retiré du destructuring (Phase 1c — bouton ▶ retiré, action
  // déplacée dans le drawer toolbar). La prop reste dans BlockViewProps
  // pour compat caller (= unused mais peut servir si revient).
  // State local pour le drag de resize : valeurs visuelles temps réel sans
  // attendre le re-render parent. Au mouseup, on commit via onResize.
  // Ref pour lire la dernière valeur dans le handler onUp (le state React
  // serait stale dans la closure, vu qu'on ne re-bind pas onUp à chaque
  // setResizing).
  const [resizing, setResizing] = React.useState<null | { edge: 'left' | 'right'; startMs: number; durationMs: number }>(null)
  const lastResizeRef = React.useRef<{ startMs: number; durationMs: number } | null>(null)
  const effectiveStartMs = resizing?.startMs ?? block.startMs
  const effectiveDurationMs = resizing?.durationMs ?? block.durationMs
  const left = msToPx(effectiveStartMs, pxPerSec)
  const width = Math.max(20, msToPx(effectiveDurationMs, pxPerSec))
  const colorClass = `mtt-block-${block.kind}`
  const label = (() => {
    switch (block.kind) {
      case 'video':        return block.label
      case 'image_static': return block.label
      case 'layer':        return block.label
      case 'sfx':
      case 'music':        return block.label
      case 'text':         return block.text.length > 20 ? block.text.slice(0, 20) + '…' : block.text
    }
  })()

  // Resize handler : drag du bord gauche/droit pour ajuster startMs / durationMs.
  // Utilise mouse events directs (pas HTML5 D&D) pour précision continue.
  // V2bis 2026-05-12.
  function handleResizeStart(edge: 'left' | 'right') {
    return (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      const initialClientX = e.clientX
      const initialStartMs = block.startMs
      const initialDurationMs = block.durationMs
      const initialEndMs = initialStartMs + initialDurationMs
      const minDurationMs = 200  // ne peut pas descendre sous 0.2s

      function onMove(ev: MouseEvent) {
        const dxPx = ev.clientX - initialClientX
        const dxMs = pxToMs(dxPx, pxPerSec)
        let next: { startMs: number; durationMs: number }
        if (edge === 'right') {
          // Right edge : startMs reste, durationMs = max(min, initial + dx)
          const newDur = Math.max(minDurationMs, initialDurationMs + dxMs)
          next = { startMs: initialStartMs, durationMs: newDur }
        } else {
          // Left edge : endMs reste constant, startMs change, durationMs ajusté
          const newStart = Math.max(0, Math.min(initialEndMs - minDurationMs, initialStartMs + dxMs))
          next = { startMs: newStart, durationMs: initialEndMs - newStart }
        }
        lastResizeRef.current = next
        setResizing({ edge, ...next })
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        if (lastResizeRef.current && onResize) {
          onResize(lastResizeRef.current.startMs, lastResizeRef.current.durationMs)
        }
        setResizing(null)
        lastResizeRef.current = null
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
  }

  // Drag handler : permet de repositionner ce bloc sur sa piste (V2 2026-05-12).
  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    // Calcule l'offset entre le startMs du bloc et la position curseur au grab
    // pour que le drop place le bloc au bon endroit (= curseur au même point
    // visuel relatif au bloc).
    const rect = e.currentTarget.getBoundingClientRect()
    const grabOffsetPx = e.clientX - rect.left
    const grabOffsetMs = pxToMs(grabOffsetPx, pxPerSec)
    const payload: MovePayload = {
      blockId: block.id,
      trackKind: block.trackKind,
      grabOffsetMs,
    }
    e.dataTransfer.setData(TIMELINE_MOVE_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
    // Refonte 2026-05-14bb : expose duration au système onDragOver pour la
    // réorganisation visuelle des blocs voisins.
    currentDragInfoRef.current = { blockId: block.id, durationMs: block.durationMs }
  }

  return (
    <div
      className={`mtt-block-wrap ${resizing ? 'resizing' : ''}${selected ? ' is-selected' : ''}${draggingSelf ? ' is-dragging-self' : ''}`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
        transform: shiftPx ? `translateX(${shiftPx}px)` : undefined,
      }}
      // Refonte 2026-05-15bl — Permet le drop d'une tile library SUR un bloc
      // existant (sinon HTML5 refuse silencieusement et l'event ne bubble pas
      // à la track parent → 2e drop "rien ne se passe"). On preventDefault
      // uniquement si dataTransfer contient le MIME library, sinon on laisse
      // le natif drag (notamment pour le repositionnement du bloc lui-même).
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes(TIMELINE_DRAG_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
    >
      {/* Refonte 2026-05-16 — passé de <button> à <div role="button"> pour
       *  permettre des <button> enfants (BlockPromptArea P-button, bandeau
       *  bas Effets/Capture). HTML interdit button-in-button = hydration error. */}
      <div
        role="button"
        tabIndex={0}
        className={`mtt-block ${colorClass}${
          block.kind === 'video' && !block.videoUrl ? ' is-empty' : ''
        }`}
        onClick={onClick}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && onClick) {
            e.preventDefault()
            onClick()
          }
        }}
        title={label + ' — drag pour déplacer · drag bord pour redimensionner'}
        draggable={!resizing}
        onDragStart={handleDragStart}
        onDragEnd={() => { currentDragInfoRef.current = null }}
      >
        {(block.kind === 'video' || block.kind === 'image_static') && (
          <div className="mtt-block-thumb-col">
            <BlockThumb block={block} />
            <span className="mtt-block-label-overlay">{label}</span>
          </div>
        )}
        {block.kind !== 'video' && block.kind !== 'image_static' && (
          <span className="mtt-block-label">{label}</span>
        )}
        {/* Prompt du shot 1 (refonte 2026-05-15bh) — affiché à droite de la
         *  vignette dans la zone restante. Si le bloc est trop étroit pour
         *  l'afficher en clair (<22rem), on rend un bouton P qui ouvre une
         *  popup avec le prompt copiable. */}
        {block.kind === 'video' && block.shots[0]?.prompt && (
          <BlockPromptArea promptText={block.shots[0].prompt} blockWidthPx={width} />
        )}
        {/* Sous-divisions shots (refonte 2026-05-14as) : 1 ligne verticale
         *  par shot >0 dans la pellicule, pour matérialiser les coupes
         *  sans casser l'unité "1 bloc = 1 vidéo MP4 LTX". */}
        {block.kind === 'video' && (block.shots?.length ?? 0) > 1 && block.shots!.slice(1).map(s => (
          <div
            key={s.id}
            className="mtt-block-shot-divider"
            style={{ left: `${(s.startMs / block.durationMs) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>
      {/* Phase 1c (refonte 2026-05-14y) : bouton ▶ retiré du bloc image —
       *  l'action "Animer" est désormais accessible via le drawer toolbar
       *  quand le bloc image est sélectionné. `onAnimate` reste dans la
       *  signature pour compat (= unused mais peut servir si on revient). */}
      {onDelete && (
        <button
          type="button"
          className="mtt-block-delete"
          draggable={false}
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
          title="Retirer de la timeline (l'asset reste dans la banque)"
          aria-label="Retirer"
        >
          ✕
        </button>
      )}
      {/* Bandeau bas Effets/Capture/Modifier — refonte 2026-05-16+17.
       *  - video AVEC videoUrl : Effets / Capture / Modifier (3 boutons)
       *  - video VIDE (draft sans videoUrl) : Modifier seul (pas d'effets/capture
       *    sur une pellicule non générée)
       *  - image_static : Modifier seul */}
      {(((block.kind === 'video' && block.videoUrl) && (onOpenEffects || onOpenCapture || onEdit))
        || (block.kind === 'video' && !block.videoUrl && onEdit)
        || (block.kind === 'image_static' && onEdit)) && (
        <div
          className="mtt-block-bottom-bar"
          draggable={false}
          onClick={(e) => e.stopPropagation()}
        >
          {block.kind === 'video' && block.videoUrl && onOpenEffects && (
            <button
              type="button"
              className="mtt-block-bb-btn mtt-block-bb-effects"
              draggable={false}
              onClick={e => { e.stopPropagation(); onOpenEffects() }}
              title="Ouvrir la bibliothèque d'effets"
            >✨ Effets</button>
          )}
          {block.kind === 'video' && block.videoUrl && onOpenCapture && (
            <button
              type="button"
              className="mtt-block-bb-btn mtt-block-bb-capture"
              draggable={false}
              onClick={e => { e.stopPropagation(); onOpenCapture() }}
              title="Capturer des frames"
            >📸 Capture</button>
          )}
          {onEdit && (
            <button
              type="button"
              className="mtt-block-bb-btn mtt-block-bb-edit"
              draggable={false}
              onClick={e => { e.stopPropagation(); onEdit() }}
              title={block.kind === 'video'
                ? 'Modifier dans Studio Animation'
                : 'Modifier dans Studio Image (Designer)'}
            >✏ Modifier</button>
          )}
        </div>
      )}
      {/* Handles resize gauche/droite (V2bis 2026-05-12). Hidden si onResize
       *  pas fourni (= mode read-only). */}
      {onResize && (
        <>
          <div className="mtt-block-resize-handle mtt-block-resize-left" onMouseDown={handleResizeStart('left')} />
          <div className="mtt-block-resize-handle mtt-block-resize-right" onMouseDown={handleResizeStart('right')} />
        </>
      )}
    </div>
  )
}
