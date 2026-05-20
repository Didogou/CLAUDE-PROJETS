'use client'
/**
 * PreviewModal — floating window non-modale pour preview Hero.
 *
 * V1 2026-05-16 (memory project_preview_modal_unified) :
 * - Pas de backdrop, l'édition continue derrière
 * - Header draggable, bouton minimize (repli mini-bar bas-droite)
 * - Position mémorisée en localStorage
 * - Sélecteur device (iPhone/iPad/Desktop) + frame styling
 * - Joue séquence de pellicules en linéaire + vignettes cliquables avec highlight
 *
 * Reuse : <PelliculeRenderer> + <EffectsAwareVideo> sous le capot.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, Minus, Square, Play, Pause, SkipBack } from 'lucide-react'
import type { PelliculePersisted } from '@/types'
import PelliculeRenderer from '@/components/book-player/PelliculeRenderer'
import {
  PREVIEW_DEVICES,
  DEFAULT_DEVICE_ID,
  getDeviceById,
  getDeviceHeightRem,
} from './devices'
import DeviceFrame from './DeviceFrame'
import './preview-modal.css'

export interface PreviewModalProps {
  open: boolean
  onClose: () => void
  /** Liste des pellicules à jouer en séquence. Vide → état empty. */
  pellicules: PelliculePersisted[]
  /** Device id initial (défaut iPhone 16 portrait). Mémorisé en localStorage. */
  initialDeviceId?: string
  /** Titre affiché dans le header (ex: "Section 1 — 4 pellicules"). */
  title?: string
  /** Refonte 2026-05-17 — sync bidirectionnelle isPlaying avec un parent
   *  (Studio Section : pause timeline = pause preview, et inverse). Si
   *  défini, override le state interne du modal. null = pas de control. */
  controlledIsPlaying?: boolean | null
  /** Callback notifié à chaque change interne du isPlaying (= utilisateur a
   *  cliqué Play/Pause dans le modal). Permet au parent (timeline) de se
   *  synchroniser. */
  onPlayingChange?: (playing: boolean) => void
  /** Refonte 2026-05-17 — cursor externe (timeline) pour seek. La valeur est
   *  le cursorMs GLOBAL (cumul des durées des pellicules précédentes +
   *  cursor dans la pellicule courante). Le modal calcule pelliculeIdx +
   *  offset et seek le PelliculeRenderer interne. */
  externalCursorMs?: number | null
  /** Callback notifié quand le modal avance son propre cursor (= pendant
   *  la lecture). Permet au parent (timeline) de syncer sa barre rouge.
   *  cursorMs est GLOBAL (cumul + offset). */
  onCursorChange?: (cursorMs: number) => void
  /** Refonte 2026-05-17 — mode `embedded` : rend la PreviewModal en flux
   *  normal (pas position:fixed, pas drag, pas minimize, pas onClose visible).
   *  Sert au Studio Mono pour afficher le preview source inline dans la
   *  colonne aside. Utilise les mêmes classes CSS que le mode floating, le
   *  layout interne ne change pas. */
  embedded?: boolean

  /** Phase A.4 keyframes 2026-05-18 — calques runtime par pellicule. Map
   *  pelliculeId → liste de PelliculeLayerRow. Passé au PelliculeRenderer
   *  courant pour rendre les calques au-dessus de la pellicule. */
  layersByPelliculeId?: Record<string, import('@/lib/pellicule-layers-types').PelliculeLayerRow[]>

  /** Phase A.5 keyframes 2026-05-18 — état mask drawing en cours. Si présent
   *  ET pelliculeId match avec la pellicule courante, on rend l'overlay
   *  capture-clicks. */
  maskDraft?: {
    pelliculeId: string
    shape: 'rect' | 'polygon'
    points: Array<[number, number]>
    onAddPoint: (point: [number, number]) => void
  } | null
  /** Phase B keyframes 2026-05-18 — keyframes runtime par pellicule, forwardé
   *  au PelliculeRenderer courant pour animer la pellicule entière. */
  pelliculeKeyframesById?: Record<string, import('@/lib/pellicule-keyframes').PelliculeKeyframe[]>

  /** Phase A bis bonus 2026-05-18 — badge contextuel rendu en overlay sur le
   *  preview quand l'auteur édite un calque (= afficher le label du calque +
   *  celui de la pellicule parente avec 2 couleurs différentes). */
  contextBadge?: {
    layerLabel: string
    parentLabel: string
  } | null
  /** Phase A bis bonus 2026-05-18 — limite la lecture au cumul ms global donné.
   *  Quand le cursor atteint cette valeur, le PreviewModal stop (pas de passage
   *  à la pellicule suivante). Utile pour focus sur l'édition d'une seule
   *  pellicule (= la parente du calque édité). null = pas de limite. */
  playUntilGlobalMs?: number | null
}

type Pos = { x: number; y: number }

const STORAGE_KEY_POS = 'hero:preview-modal:pos'
const STORAGE_KEY_DEVICE = 'hero:preview-modal:device'

function loadStoredPos(): Pos | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Pos
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed
  } catch { /* noop */ }
  return null
}

function loadStoredDevice(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(STORAGE_KEY_DEVICE) } catch { return null }
}

export default function PreviewModal({
  open, onClose, pellicules, initialDeviceId, title,
  controlledIsPlaying, onPlayingChange, externalCursorMs, onCursorChange,
  embedded = false, layersByPelliculeId, maskDraft, pelliculeKeyframesById,
  contextBadge, playUntilGlobalMs,
}: PreviewModalProps) {
  // ── Device sélectionné (mémorisé localStorage) ──
  const [deviceId, setDeviceId] = useState<string>(() => {
    return initialDeviceId ?? loadStoredDevice() ?? DEFAULT_DEVICE_ID
  })
  const device = getDeviceById(deviceId)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { localStorage.setItem(STORAGE_KEY_DEVICE, deviceId) } catch { /* noop */ }
  }, [deviceId])

  // ── Position floating window (drag + mémorisée localStorage) ──
  const [pos, setPos] = useState<Pos | null>(null)
  // Au 1er ouverture : center screen ou pos stockée.
  useEffect(() => {
    if (!open) return
    if (pos !== null) return
    const stored = loadStoredPos()
    if (stored) { setPos(stored); return }
    // Centre approximatif (modal ~ 30rem large × 50rem haut)
    if (typeof window !== 'undefined') {
      const rem = 16
      const w = 30 * rem
      const h = 50 * rem
      setPos({
        x: Math.max(20, (window.innerWidth - w) / 2),
        y: Math.max(20, (window.innerHeight - h) / 2),
      })
    }
  }, [open, pos])

  // Refonte 2026-05-19 — re-ancrer la fenêtre dans le viewport. Cas couverts :
  //   1. Device change → re-mesure et clamp si débord
  //   2. Resize browser → idem
  //   3. Init (1er render avec pos non-null) → clamp si pos stockée déborde
  // posRef = source de vérité courante de pos, lue à chaque appel reanchor
  // sans recréer la fonction (= deps stables, pas de boucle).
  const windowRef = useRef<HTMLDivElement | null>(null)
  const posRef = useRef(pos)
  useEffect(() => { posRef.current = pos }, [pos])
  const reanchor = useCallback(() => {
    if (embedded) return
    if (typeof window === 'undefined') return
    const win = windowRef.current
    const p = posRef.current
    if (!win || !p) return
    const width = win.offsetWidth
    const height = win.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const anchoredRight = p.x + width / 2 > vw / 2
    let nextX = p.x
    let nextY = p.y
    if (anchoredRight) {
      if (nextX + width > vw) nextX = Math.max(0, vw - width)
      if (nextX < 0) nextX = 0
    } else {
      if (nextX < 0) nextX = 0
      if (nextX + width > vw) nextX = Math.max(0, vw - width)
    }
    if (nextY < 0) nextY = 0
    if (nextY + height > vh) nextY = Math.max(0, vh - height)
    if (nextX !== p.x || nextY !== p.y) {
      setPos({ x: nextX, y: nextY })
      try { localStorage.setItem(STORAGE_KEY_POS, JSON.stringify({ x: nextX, y: nextY })) } catch { /* noop */ }
    }
  }, [embedded])
  // Re-ancrer au device change + sur resize browser.
  useEffect(() => {
    if (embedded) return
    if (typeof window === 'undefined') return
    const raf = requestAnimationFrame(reanchor)
    window.addEventListener('resize', reanchor)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', reanchor)
    }
  }, [device, embedded, reanchor])
  // Re-ancrer ONE-SHOT au 1er render où pos devient non-null (init depuis
  // localStorage ou center-screen). didInitReanchorRef évite la ré-exécution
  // sur les setPos suivants (drag user) qui ont leur propre clamp.
  const didInitReanchorRef = useRef(false)
  useEffect(() => {
    if (embedded) return
    if (didInitReanchorRef.current) return
    if (!pos) return
    didInitReanchorRef.current = true
    // rAF pour mesurer après le 1er paint avec la pos initiale.
    const raf = requestAnimationFrame(reanchor)
    return () => cancelAnimationFrame(raf)
  }, [pos, embedded, reanchor])

  const dragStateRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const onDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pos) return
    dragStateRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    e.preventDefault()
  }, [pos])
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const s = dragStateRef.current
      if (!s) return
      const nx = s.origX + (e.clientX - s.startX)
      const ny = s.origY + (e.clientY - s.startY)
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, nx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, ny)),
      })
    }
    function onUp() {
      if (dragStateRef.current && pos) {
        try { localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(pos)) } catch { /* noop */ }
      }
      dragStateRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [pos])

  // ── Minimize ──
  const [minimized, setMinimized] = useState(false)

  // ── Playback : index pellicule courante + play/pause ──
  // Refonte 2026-05-17 — controlledIsPlaying RÉINTRODUIT avec guards refs.
  // Le state interne reste maître, mais on resync depuis le parent quand
  // controlledIsPlaying CHANGE (= drag ruler timeline pause aussi le
  // preview, et inverse). Guard ref évite toute boucle ping-pong.
  const [pelliculeIdx, setPelliculeIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  // Refonte 2026-05-19 — état transitoire pour le fade-out à la fermeture.
  // Reste `true` ~220ms après que open passe à false, le temps que la CSS
  // animation joue, puis revient à false → unmount du modal.
  const [isClosing, setIsClosing] = useState(false)
  const wasOpenRef = useRef(open)
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      // Transition true → false : on déclenche le fade-out.
      setIsClosing(true)
      const t = setTimeout(() => setIsClosing(false), 220)
      wasOpenRef.current = open
      return () => clearTimeout(t)
    }
    if (open) {
      // Ré-ouverture : on coupe immédiatement un fade-out en cours.
      setIsClosing(false)
    }
    wasOpenRef.current = open
  }, [open])
  // Refonte 2026-05-19 — auto-scroll vertical des vignettes : la pellicule
  // active doit toujours rester visible dans la strip droite pendant la
  // lecture, ET on anticipe d'une vignette (= dès qu'on atteint l'AVANT-
  // dernière visible, on scrolle pour montrer la suivante) pour ne pas être
  // collé au bord en bas.
  const thumbsContainerRef = useRef<HTMLDivElement | null>(null)
  const activeThumbRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const btn = activeThumbRef.current
    const container = thumbsContainerRef.current
    if (!btn || !container) return
    const btnRect = btn.getBoundingClientRect()
    const contRect = container.getBoundingClientRect()
    // Hauteur d'une vignette (active = toutes les autres, même aspect-ratio
    // 16:9) pour anticiper d'un cran. Fallback 80px si pas mesurable.
    const thumbHeight = btnRect.height || 80
    const above = btnRect.top < contRect.top + 8
    // L'avant-dernière visible : on déclenche si btn.bottom dépasse
    // (contRect.bottom - thumbHeight) → il reste moins d'1 vignette dessous.
    const belowAnticipate = btnRect.bottom > contRect.bottom - thumbHeight
    if (above || belowAnticipate) {
      // block:'center' (vs nearest) garantit ~1 vignette visible des deux
      // côtés de l'active. Plus confortable que scrollIntoView nearest.
      btn.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [pelliculeIdx])
  // Sync : controlledIsPlaying parent → setIsPlaying interne.
  const lastSyncedCtrlPlayRef = useRef<boolean | null>(null)
  // Refonte 2026-05-19 — lock window pour empêcher controlledIsPlaying de
  // re-activer la lecture immédiatement après un stop forcé interne (cas
  // playUntilGlobalMs). Sans ce lock, la prop arrive encore à `true` (parent
  // pas encore propagé) et la useEffect [controlledIsPlaying] réactive la
  // vidéo dans le même render, créant la désync barre-stop / video-continue.
  const ignoreCtrlSyncUntilRef = useRef(0)
  useEffect(() => {
    if (controlledIsPlaying == null) return
    if (controlledIsPlaying === lastSyncedCtrlPlayRef.current) return
    if (Date.now() < ignoreCtrlSyncUntilRef.current) {
      // On ignore cette sync (= override local récent). Le parent va finir par
      // se synchroniser via le ref → la prochaine fois on aura match + bail.
      return
    }
    lastSyncedCtrlPlayRef.current = controlledIsPlaying
    setIsPlaying(controlledIsPlaying)
  }, [controlledIsPlaying])
  // Notifie le parent à chaque change interne (lecture seule, pas de boucle).
  // CRITIQUE : quand `open` flip false→true, l'effet [isPlaying, open] tire
  // AVANT que le setIsPlaying(true) du `useEffect [open]` ne se commit, donc
  // avec un isPlaying stale=false. Émettre ce stale flippe sharedIsPlaying
  // à false côté parent et amorce un ping-pong avec la timeline.
  // → On skip la 1ère fire par cycle d'ouverture, puis on émet les changes.
  const onPlayingChangeRef = useRef(onPlayingChange)
  const isFirstRunPerOpenRef = useRef(true)
  useEffect(() => { onPlayingChangeRef.current = onPlayingChange }, [onPlayingChange])
  useEffect(() => {
    if (!open) {
      isFirstRunPerOpenRef.current = true  // reset pour le prochain open
      return
    }
    if (isFirstRunPerOpenRef.current) {
      isFirstRunPerOpenRef.current = false
      return  // skip stale emit immédiatement après open false→true
    }
    lastSyncedCtrlPlayRef.current = isPlaying
    onPlayingChangeRef.current?.(isPlaying)
  }, [isPlaying, open])
  // Reset à l'ouverture — sauf si externalCursorMs déjà positionné (= ouvre
  // au milieu, ex: click calque qui force seek + open en même temps). Dans
  // ce cas le pelliculeIdx sera recalculé par l'useEffect [externalCursorMs]
  // ci-dessous. Évite le saccade visible "pellicule 0 mount puis switch".
  // Refonte 2026-05-20 — autoplay conditionnel : si controlledIsPlaying est
  // explicitement `false`, on n'autoplay PAS (cas step frame qui ouvre le
  // preview en pause). null/undefined/true = autoplay comme avant.
  useEffect(() => {
    if (!open) return
    if (externalCursorMs == null) {
      setPelliculeIdx(0)
    }
    setIsPlaying(controlledIsPlaying !== false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  // Si minimized, pause audio (les <audio> dans PelliculeRenderer suivent isPlaying)
  useEffect(() => {
    if (minimized && isPlaying) setIsPlaying(false)
  }, [minimized, isPlaying, setIsPlaying])

  // Refonte 2026-05-17 — ref pour tracker le dernier cursor envoyé par CE
  // composant, afin d'ignorer le retour d'écho via externalCursorMs (sinon
  // boucle infinie : on emit → parent setState → externalCursorMs change →
  // useEffect seek → ré-emit → …).
  const lastEmittedCursorMsRef = useRef<number | null>(null)
  // Throttle handleRendererCursorChange à 250ms (4 emits/sec suffisent pour
  // l'UI barre de progression timeline).
  const lastEmitTsRef = useRef<number>(0)

  // Refonte 2026-05-17 — externalCursorMs : calcule (pelliculeIdx, offsetMs)
  // et expose un `seekToCurrentPelliculeMs` au PelliculeRenderer pour seek
  // précis dans la vidéo. La barre timeline et le preview partagent UN seul
  // playhead : drag ruler timeline → effet immédiat visuel sur le preview.
  const [seekToCurrentPelliculeMs, setSeekToCurrentPelliculeMs] = useState<number | null>(null)
  useEffect(() => {
    if (externalCursorMs == null) return
    // Self-sourced ? Ignore pour éviter loop ping-pong avec onCursorChange.
    if (lastEmittedCursorMsRef.current != null
      && Math.abs(externalCursorMs - lastEmittedCursorMsRef.current) < 300) {
      return
    }
    let cumul = 0
    for (let i = 0; i < pellicules.length; i++) {
      const p = pellicules[i]
      const dur = (p.shots ?? []).reduce((s, sh) => s + (sh.duration ?? 4), 0) * 1000
      if (externalCursorMs < cumul + dur) {
        const offsetMs = externalCursorMs - cumul
        if (i !== pelliculeIdx) setPelliculeIdx(i)
        setSeekToCurrentPelliculeMs(offsetMs)
        return
      }
      cumul += dur
    }
    // Si on dépasse la fin, set au dernier
    if (pellicules.length > 0) {
      setPelliculeIdx(pellicules.length - 1)
      const last = pellicules[pellicules.length - 1]
      const lastDur = (last.shots ?? []).reduce((s, sh) => s + (sh.duration ?? 4), 0) * 1000
      setSeekToCurrentPelliculeMs(lastDur)
    }
  }, [externalCursorMs, pellicules, pelliculeIdx])

  const currentPellicule = pellicules[pelliculeIdx] ?? null

  // Cursor tracking → onCursorChange throttled (refonte 2026-05-17).
  const handleRendererCursorChange = useCallback((cursorMs: number) => {
    // Phase A bis bonus 2026-05-19 — playUntilGlobalMs : si cursor dépasse,
    // on stop + pause + NOTIFIE le parent pour qu'il sync sharedIsPlaying=false
    // sinon la prop controlledIsPlaying revient à true au prochain render et
    // ré-active la lecture (boucle bug observée 2026-05-19).
    let cumul = 0
    for (let i = 0; i < pelliculeIdx; i++) {
      const p = pellicules[i]
      cumul += (p.shots ?? []).reduce((s, sh) => s + (sh.duration ?? 4), 0) * 1000
    }
    const globalMs = cumul + cursorMs
    if (playUntilGlobalMs != null && globalMs >= playUntilGlobalMs) {
      setIsPlaying(false)
      lastSyncedCtrlPlayRef.current = false
      // Lock 500ms : empêche la prop controlledIsPlaying (encore true côté
      // parent pour ~1 tick React) de re-activer la lecture.
      ignoreCtrlSyncUntilRef.current = Date.now() + 500
      onPlayingChangeRef.current?.(false)
      // Refonte 2026-05-19 — force le cursor parent à playUntilGlobalMs - 1 ms
      // (= dans la dernière frame de la pellicule courante, PAS dans la suivante).
      // Le check `externalCursorMs < cumul + dur` est strict : à la valeur exacte
      // de la boundary, la useEffect [externalCursorMs] computait l'idx de la
      // pellicule SUIVANTE → currentPellicule devenait next → first frame next
      // visible au lieu de last frame current.
      const stopAt = Math.max(0, playUntilGlobalMs - 1)
      lastEmittedCursorMsRef.current = stopAt
      lastEmitTsRef.current = Date.now()
      onCursorChange?.(stopAt)
    }
    if (!onCursorChange) return
    const now = Date.now()
    if (now - lastEmitTsRef.current < 250) return  // throttle 250ms
    lastEmitTsRef.current = now
    lastEmittedCursorMsRef.current = globalMs
    onCursorChange(globalMs)
  }, [pelliculeIdx, pellicules, onCursorChange, playUntilGlobalMs])

  const onPelliculeComplete = useCallback(() => {
    // Phase A bis bonus 2026-05-19 — si playUntilGlobalMs est défini (= mode
    // focus sur 1 pellicule, déclenché par click calque), on NE PASSE PAS au
    // suivant. La lecture s'arrête sur la dernière frame de la pellicule
    // courante. Sinon la séquence continuerait à enchainer les pellicules
    // d'après alors que la barre s'arrête à la fin de la pellicule scope.
    if (playUntilGlobalMs != null) {
      setIsPlaying(false)
      ignoreCtrlSyncUntilRef.current = Date.now() + 500
      onPlayingChangeRef.current?.(false)
      return
    }
    if (pelliculeIdx + 1 < pellicules.length) {
      setPelliculeIdx(i => i + 1)
    } else {
      setIsPlaying(false) // fin de séquence, on s'arrête sur la dernière frame
    }
  }, [pelliculeIdx, pellicules.length, setIsPlaying, playUntilGlobalMs])

  // Refonte 2026-05-19 — fade-out à la fermeture : on garde le modal monté
  // ~220ms avec la classe is-closing pour jouer l'animation, puis on unmount.
  // Symétrique au fade-in déjà présent.
  if (!open && !isClosing) return null

  // ── Render ──
  // En mode embedded on n'attend pas le calcul de position (pas de pos).
  if (!embedded && !pos) return null

  // Mini-bar (minimized) — uniquement en mode floating, pas embedded
  if (!embedded && minimized) {
    return (
      <div className="preview-modal-minibar" role="dialog" aria-label="Preview minimisé">
        <span className="preview-modal-minibar-title">▶ {title ?? 'Preview'}</span>
        <button type="button" className="preview-modal-minibar-btn" onClick={() => setMinimized(false)} title="Restaurer">
          <Square size={12} />
        </button>
        <button type="button" className="preview-modal-minibar-btn" onClick={onClose} title="Fermer">
          <X size={12} />
        </button>
      </div>
    )
  }

  const frameHeightRem = getDeviceHeightRem(device)

  return (
    <div
      ref={windowRef}
      className={`preview-modal-window${embedded ? ' is-embedded' : ''}${isClosing ? ' is-closing' : ''}`}
      style={embedded ? undefined : { left: pos!.x, top: pos!.y }}
      role={embedded ? 'region' : 'dialog'}
      aria-label="Preview"
    >
      <div
        className="preview-modal-header"
        onMouseDown={embedded ? undefined : onDragStart}
        style={embedded ? { cursor: 'default' } : undefined}
      >
        <span className="preview-modal-title">▶ {title ?? 'Preview'}</span>
        <select
          className="preview-modal-device-select"
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
          onMouseDown={e => e.stopPropagation()}  // évite drag pendant select
        >
          {PREVIEW_DEVICES.map(d => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
        {!embedded && (
          <div className="preview-modal-header-actions">
            <button type="button" className="preview-modal-iconbtn" onClick={() => setMinimized(true)} title="Réduire">
              <Minus size={14} />
            </button>
            <button type="button" className="preview-modal-iconbtn" onClick={onClose} title="Fermer">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="preview-modal-body">
        {/* Phase A bis bonus 2026-05-18 v2 — badge contextuel RETIRÉ : remplacé
         *  par les labels in-canvas auto-affichés pendant la lecture (cf
         *  PelliculeRenderer.bp-pellicule-label + PelliculeLayerRenderer.bp-layer-label).
         *  contextBadge prop conservé pour compat caller mais non rendu. */}
        <DeviceFrame device={device}>
          {currentPellicule ? (
            <PelliculeRenderer
              key={currentPellicule.id /* force remount à chaque pellicule */}
              pellicule={currentPellicule}
              isPlaying={isPlaying}
              onComplete={onPelliculeComplete}
              onCursorChange={handleRendererCursorChange}
              seekToMs={seekToCurrentPelliculeMs}
              layers={layersByPelliculeId?.[currentPellicule.id] ?? null}
              maskDraft={
                maskDraft && maskDraft.pelliculeId === currentPellicule.id
                  ? { shape: maskDraft.shape, points: maskDraft.points, onAddPoint: maskDraft.onAddPoint }
                  : null
              }
              pelliculeKeyframes={pelliculeKeyframesById?.[currentPellicule.id] ?? null}
            />
          ) : (
            <div className="preview-modal-empty">Aucune pellicule à prévisualiser</div>
          )}
        </DeviceFrame>

        {/* Colonne side droite : controls + vignettes en colonne. Refonte
         *  2026-05-16 — layout horizontal pour mieux exploiter l'espace
         *  avec un device portrait. Refonte 2026-05-19 — height fixée à
         *  `frameHeightRem` (= même valeur que DeviceFrame) pour que la
         *  colonne ne déborde pas en device landscape, et que les vignettes
         *  scrollent à l'intérieur de ce cadre. Inline style = pas de race
         *  ResizeObserver, valable dès le 1er render. */}
        <div
          className="preview-modal-side"
          style={{ height: `${frameHeightRem}rem` }}
        >
          <div className="preview-modal-controls">
            <button
              type="button"
              className="preview-modal-iconbtn"
              onClick={() => { setPelliculeIdx(0); setIsPlaying(true) }}
              title="Revenir au début"
              disabled={pellicules.length === 0}
            >
              <SkipBack size={14} />
            </button>
            <button
              type="button"
              className="preview-modal-iconbtn preview-modal-playbtn"
              onClick={() => setIsPlaying(p => !p)}
              title={isPlaying ? 'Pause' : 'Lecture'}
              disabled={pellicules.length === 0}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span className="preview-modal-counter">
              {pelliculeIdx + 1} / {pellicules.length || 0}
            </span>
          </div>

          {/* Vignettes pellicules — cliquables, highlight de l'active.
           *  Layout colonne vertical scrollable. */}
          {pellicules.length > 0 && (
            <div className="preview-modal-thumbs" ref={thumbsContainerRef}>
              {pellicules.map((p, idx) => {
                const thumb = p.firstFrameUrl ?? p.lastFrameUrl ?? null
                const videoUrl = (p as { videoUrl?: string | null }).videoUrl ?? null
                const isActive = idx === pelliculeIdx
                return (
                  <button
                    key={p.id}
                    type="button"
                    /* Refonte 2026-05-19 — ref sur la vignette active pour
                     *  scrollIntoView automatique en lecture (suit la pellicule
                     *  en cours dans la strip verticale). */
                    ref={isActive ? activeThumbRef : null}
                    className={`preview-modal-thumb ${isActive ? 'is-active' : ''}`}
                    onClick={() => { setPelliculeIdx(idx); setIsPlaying(true) }}
                    title={`Pellicule ${idx + 1}`}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt={`Pellicule ${idx + 1}`} />
                    ) : videoUrl ? (
                      // Refonte 2026-05-20 — fallback video preload=metadata si
                      // pas de firstFrameUrl extrait (uploads récents).
                      <video src={videoUrl} muted playsInline preload="metadata" />
                    ) : (
                      <span className="preview-modal-thumb-placeholder">{idx + 1}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// DeviceFrame extrait dans ./DeviceFrame.tsx 2026-05-17 pour réutilisation
// par le Studio Mono (SourceTile inline) + futurs écrans.
