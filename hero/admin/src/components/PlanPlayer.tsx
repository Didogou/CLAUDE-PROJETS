'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  blockTimeWindow,
  computePhraseTimings,
  getVisibleTextAtCursor,
  resolveBlockMedia,
  PHRASE_GAP_MS,
  type AvailableMediaSnapshot,
  type MediaBlock,
  type PhraseTiming,
} from '@/lib/timeline'
import {
  ensureTransitionStylesInjected,
  getTransitionAnimations,
  type TransitionEffect,
} from '@/lib/transitions'
import SimBubbleOverlay from './SimBubbleOverlay'
import type { Npc } from '@/types'

// ── Helpers de rendu (texte + média) — extraits du mini-tel ───────────────────

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogg)(?:[?&#]|$)/i
function isVideoUrl(url: string | undefined): boolean {
  return !!url && VIDEO_EXT_RE.test(url.toLowerCase())
}

function urlForBlockAtTime(
  block: MediaBlock,
  cursorMs: number,
  win: { start_ms: number; end_ms: number },
  available: AvailableMediaSnapshot,
): string | undefined {
  const resolved = resolveBlockMedia(block, available)
  if (resolved.urls && resolved.urls.length > 0) {
    const span = Math.max(1, win.end_ms - win.start_ms)
    const t = (cursorMs - win.start_ms) / span
    const idx = Math.max(0, Math.min(resolved.urls.length - 1, Math.floor(t * resolved.urls.length)))
    return resolved.urls[idx]
  }
  return resolved.url
}

function getActiveUrlAtCursor(
  cursorMs: number,
  blocks: MediaBlock[],
  timings: PhraseTiming[],
  available: AvailableMediaSnapshot,
  fallback?: string,
): string | undefined {
  if (blocks.length === 0) return fallback
  const windowed = blocks.map(b => ({ block: b, win: blockTimeWindow(b, timings, blocks) }))
  const active = windowed.filter(({ win }) => win.start_ms <= cursorMs && cursorMs < win.end_ms)
  if (active.length > 0) {
    active.sort((a, b) => b.win.start_ms - a.win.start_ms)
    return urlForBlockAtTime(active[0].block, cursorMs, active[0].win, available) ?? fallback
  }
  const ended = windowed.filter(({ win }) => win.end_ms <= cursorMs)
  if (ended.length > 0) {
    ended.sort((a, b) => b.win.end_ms - a.win.end_ms)
    const { block, win } = ended[0]
    return urlForBlockAtTime(block, win.end_ms - 1, win, available) ?? fallback
  }
  return fallback
}

// ── Composant principal ──────────────────────────────────────────────────────

export interface PlanPlayerProps {
  /** Phrases du plan (post `splitIntoSubPhrases`). */
  phrases: string[]
  /** Blocs media de la timeline du plan. */
  timeline: MediaBlock[]
  /** Snapshot live des médias dispo pour résoudre les `source_ref`. */
  available: AvailableMediaSnapshot
  /** Image affichée si timeline vide / pas de bloc actif. */
  fallbackImageUrl?: string

  /** Vitesse de lecture (mots/min). */
  wpm: number
  /** Intervalle entre chunks (ms). */
  wordIntervalMs: number
  /** Pause entre 2 phrases (ms). Défaut 4000. */
  phraseGapMs?: number
  /** Mots à colorer en rouge. */
  redWords: Set<string>
  /** Position du texte (% sur l'image). Défaut centre. */
  textPosition?: { x: number; y: number }
  /** Taille de texte de base (px) — équivalent simPrefs.textFontSize. Défaut 15. */
  textFontSize?: number
  /** Liste des PNJ pour lookup portrait dans les bulles (speaker → npc.portrait_url). */
  npcs?: Npc[]
  /** Positions des bulles par clé "speaker:type" (image.bubble_positions). */
  bubblePositions?: Record<string, { x: number; y: number }>

  /** True = en lecture (rAF actif). False = pause / aperçu statique. */
  isPlaying: boolean
  /** Callback fin de plan (cursor atteint totalMs). */
  onComplete?: () => void
  /** Callback à chaque tick (pour cursor sur timeline éditeur). null = arrêté. */
  onCursorChange?: (cursorMs: number | null) => void
  /** Callback lors d'un clic sur le frame (skip / interaction utilisateur). */
  onFrameClick?: () => void

  /** Effet de transition entre médias (chaque changement de bloc). Défaut crossfade 750ms. */
  mediaTransition?: TransitionEffect
  mediaTransitionMs?: number

  /** Ratio d'aspect du frame. Défaut '9/19.5' (mode phone). Mettre 'auto' pour fill parent. */
  aspectRatio?: string | 'auto'
  /** Ajoute un chrome téléphone (border arrondie + shadow). */
  phoneChrome?: boolean
  /** Largeur fixe du frame en mode phone (px). Défaut 280. */
  width?: number
  /** Couleur de fond derrière le média. */
  background?: string
}

/**
 * Lecteur unifié d'un plan : combine timeline media + texte WPM + transitions cinématiques.
 * Consommé par : mini-tel preview, SectionPlayer (orchestrateur), futur simulateur unifié.
 *
 * Mode lecture : `isPlaying=true` → rAF avance le cursor, médias se transitionnent automatiquement.
 * Mode pause   : `isPlaying=false` → affiche la 1ère phrase et le 1er média (aperçu statique).
 */
export default function PlanPlayer({
  phrases,
  timeline,
  available,
  fallbackImageUrl,
  wpm,
  wordIntervalMs,
  phraseGapMs = PHRASE_GAP_MS,
  redWords,
  textPosition,
  textFontSize = 15,
  npcs = [],
  bubblePositions,
  isPlaying,
  onComplete,
  onCursorChange,
  onFrameClick,
  mediaTransition = 'crossfade',
  mediaTransitionMs = 750,
  aspectRatio = '9/19.5',
  phoneChrome = true,
  width,
  background = '#000',
}: PlanPlayerProps) {
  useEffect(() => { ensureTransitionStylesInjected() }, [])

  // Ref + state pour mesurer la largeur réelle du conteneur média (CW utilisé par SimBubbleOverlay
  // pour dimensionner bulles, portraits, bruit). ResizeObserver garantit le recalcul si le parent
  // change la largeur (responsive).
  const mediaContainerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(typeof width === 'number' ? width : 280)
  useEffect(() => {
    const el = mediaContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cr = entry.contentRect
        if (cr.width > 0) setContainerWidth(cr.width)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const timings = useMemo(() => computePhraseTimings(phrases, wpm, wordIntervalMs, phraseGapMs), [phrases, wpm, wordIntervalMs, phraseGapMs])
  // Durée totale = max(fin des phrases, fin des blocs timeline). Permet aux plans
  // sans phrases d'être joués (durée pilotée par la timeline media seulement).
  const totalMs = useMemo(() => {
    const phraseEnd = timings.length > 0 ? timings[timings.length - 1].end_ms + phraseGapMs : 0
    let timelineEnd = 0
    if (timeline.length > 0) {
      for (const b of timeline) {
        const w = blockTimeWindow(b, timings, timeline)
        if (w.end_ms > timelineEnd) timelineEnd = w.end_ms
      }
    }
    return Math.max(phraseEnd, timelineEnd)
  }, [timings, timeline, phraseGapMs])

  const cursorRef = useRef(0)
  const [cursorMs, setCursorMs] = useState(0)
  const [currentUrl, setCurrentUrl] = useState<string | undefined>(undefined)
  const [previousUrl, setPreviousUrl] = useState<string | undefined>(undefined)
  const lastUrlRef = useRef<string | undefined>(undefined)
  const transitionTimeoutRef = useRef<number | null>(null)
  const completedRef = useRef(false)

  // ── Refs stables pour callbacks ─────────────────────────────────────────
  // CRITIQUE : sans ces refs, chaque render parent (qui fournit des arrows inline)
  // ferait redémarrer le rAF effect → tick perdu, image qui flash, rendu instable.
  const onCompleteRef = useRef(onComplete)
  const onCursorChangeRef = useRef(onCursorChange)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => { onCursorChangeRef.current = onCursorChange }, [onCursorChange])

  // Reset au play / setup état initial au mount + non-playing
  useEffect(() => {
    if (isPlaying) {
      cursorRef.current = 0
      setCursorMs(0)
      onCursorChangeRef.current?.(0)
      completedRef.current = false
      const initial = getActiveUrlAtCursor(0, timeline, timings, available, fallbackImageUrl)
      setPreviousUrl(undefined)
      setCurrentUrl(initial)
      lastUrlRef.current = initial
    } else {
      onCursorChangeRef.current?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Aperçu statique quand non-playing
  useEffect(() => {
    if (isPlaying) return
    const initial = getActiveUrlAtCursor(0, timeline, timings, available, fallbackImageUrl)
    setCurrentUrl(initial)
    lastUrlRef.current = initial
    setPreviousUrl(undefined)
  }, [isPlaying, timeline, timings, fallbackImageUrl, available])

  // Cleanup curseur on unmount
  useEffect(() => {
    return () => { onCursorChange?.(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refs pour les valeurs qui peuvent changer fréquemment depuis le parent SANS qu'on
  // veuille redémarrer le rAF. timeline/timings/available sont accédés via .current
  // dans tick() au lieu d'être en deps de l'effect.
  const timelineRef = useRef(timeline)
  const timingsRef = useRef(timings)
  const availableRef = useRef(available)
  const fallbackImageUrlRef = useRef(fallbackImageUrl)
  const totalMsRef = useRef(totalMs)
  useEffect(() => { timelineRef.current = timeline }, [timeline])
  useEffect(() => { timingsRef.current = timings }, [timings])
  useEffect(() => { availableRef.current = available }, [available])
  useEffect(() => { fallbackImageUrlRef.current = fallbackImageUrl }, [fallbackImageUrl])
  useEffect(() => { totalMsRef.current = totalMs }, [totalMs])

  // Boucle rAF — deps réduits à [isPlaying] uniquement.
  // Toutes les autres valeurs sont lues via refs pour éviter les restarts de boucle
  // à chaque render (qui faisaient flasher l'image et bloquer la lecture).
  useEffect(() => {
    if (!isPlaying) return
    let rafId = 0
    let lastT = performance.now()
    const tick = (now: number) => {
      const delta = now - lastT
      lastT = now
      cursorRef.current += delta
      const tMs = totalMsRef.current
      if (tMs > 0 && cursorRef.current >= tMs) {
        cursorRef.current = tMs
        setCursorMs(tMs)
        if (!completedRef.current) {
          completedRef.current = true
          onCompleteRef.current?.()
        }
        return
      }
      setCursorMs(cursorRef.current)
      onCursorChangeRef.current?.(cursorRef.current)
      const url = getActiveUrlAtCursor(cursorRef.current, timelineRef.current, timingsRef.current, availableRef.current, fallbackImageUrlRef.current)
      if (url !== lastUrlRef.current) {
        setPreviousUrl(lastUrlRef.current)
        setCurrentUrl(url)
        lastUrlRef.current = url
        if (transitionTimeoutRef.current) window.clearTimeout(transitionTimeoutRef.current)
        const anims = getTransitionAnimations(mediaTransition, mediaTransitionMs)
        transitionTimeoutRef.current = window.setTimeout(() => {
          setPreviousUrl(prev => (prev === lastUrlRef.current ? prev : undefined))
        }, anims.totalDurationMs + 100)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(rafId); if (transitionTimeoutRef.current) window.clearTimeout(transitionTimeoutRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, mediaTransition, mediaTransitionMs])

  // Texte visible à l'instant courant
  const visText = useMemo(() => {
    if (timings.length === 0) return null
    if (!isPlaying) {
      // Aperçu statique : première phrase entièrement visible
      return getVisibleTextAtCursor(timings[0].end_ms - 1, phrases, timings, wpm, wordIntervalMs, phraseGapMs)
    }
    return getVisibleTextAtCursor(cursorMs, phrases, timings, wpm, wordIntervalMs, phraseGapMs)
  }, [cursorMs, isPlaying, phrases, timings, wpm, wordIntervalMs, phraseGapMs])

  const anims = getTransitionAnimations(mediaTransition, mediaTransitionMs)

  // Frame style — chrome téléphone optionnel
  const frameStyle: React.CSSProperties = phoneChrome
    ? { background: '#0a0a0e', border: '6px solid #1a1a20', borderRadius: '24px', padding: 0, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', aspectRatio: aspectRatio === 'auto' ? undefined : aspectRatio, width: width ?? 280 }
    : { background, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', aspectRatio: aspectRatio === 'auto' ? undefined : aspectRatio, width: width ?? '100%', height: aspectRatio === 'auto' ? '100%' : undefined }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: width ?? (phoneChrome ? 280 : '100%') }}>
      {/* Frame */}
      <div style={frameStyle}>
        <div ref={mediaContainerRef} onClick={onFrameClick} style={{ width: '100%', flex: 1, background, position: 'relative', overflow: 'hidden', cursor: onFrameClick ? 'pointer' : 'default' }}>

          {/* Couche précédente (sortante) — joue l'animation `outAnimation` du catalogue */}
          {previousUrl && previousUrl !== currentUrl && (
            <div style={{ position: 'absolute', inset: 0, animation: anims.outAnimation }}>
              {isVideoUrl(previousUrl)
                ? <video src={previousUrl} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={previousUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
          )}

          {/* Couche courante (entrante) — délai inclus dans le shorthand inAnimation */}
          {currentUrl ? (
            <div key={currentUrl} style={{ position: 'absolute', inset: 0, animation: previousUrl && previousUrl !== currentUrl ? anims.inAnimation : 'none' }}>
              {isVideoUrl(currentUrl)
                ? <video src={currentUrl} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={currentUrl} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.7rem', fontStyle: 'italic' }}>Aucune image</div>
          )}

          {/* Texte overlay — utilise SimBubbleOverlay (renderer fidèle au simulateur).
              Bulles riches (foule/pensee/discussion/radio/bruit/discours) + portraits NPC + positions. */}
          {visText && visText.visibleChunks.length > 0 ? (
            <SimBubbleOverlay
              visibleChunks={visText.visibleChunks}
              npcs={npcs}
              bubblePositions={bubblePositions}
              textPosition={textPosition}
              textFontSize={textFontSize}
              redWords={redWords}
              containerWidth={containerWidth}
            />
          ) : phrases.length === 0 ? (
            <div style={{ position: 'absolute', bottom: '1rem', left: 0, right: 0, textAlign: 'center', color: 'var(--muted)', fontSize: '0.7rem', fontStyle: 'italic', pointerEvents: 'none' }}>Aucun texte assigné</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ── Helpers exportés (résolution media/url, utilitaires bas niveau) ─────────
export { getActiveUrlAtCursor, isVideoUrl }
