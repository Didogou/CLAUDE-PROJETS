'use client'
import React, { useEffect, useRef, useState } from 'react'
import {
  ensureTransitionStylesInjected,
  getTransitionAnimations,
  type TransitionEffect,
} from '@/lib/transitions'

// ── Snapshot d'un média (image ou vidéo) ─────────────────────────────────────

export interface MediaSnapshot {
  url?: string
  /** force le type. Sinon auto-détecté via extension. */
  isVideo?: boolean
  /** Image fallback si url absente. */
  placeholder?: React.ReactNode
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogg)(?:[?&#]|$)/i
function isVideoUrl(url?: string): boolean {
  return !!url && VIDEO_EXT_RE.test(url)
}

function MediaLayer({ src, fit = 'cover', style, ...rest }: { src?: string; fit?: 'cover' | 'contain'; style?: React.CSSProperties; placeholder?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const isVid = isVideoUrl(src)
  const baseStyle: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit, ...style }
  if (!src) return <div style={baseStyle} {...rest}>{rest.placeholder}</div>
  if (isVid) return <video src={src} autoPlay muted loop playsInline style={baseStyle as React.CSSProperties} />
  return <img src={src} alt="" style={baseStyle as React.CSSProperties} />
}

// ── Mode 1 : transition explicite (from → to, jouée une fois) ────────────────

export interface CinematicTransitionProps {
  from?: MediaSnapshot
  to: MediaSnapshot
  effect: TransitionEffect
  /** Durée d'UNE phase (out OU in). Effets séquentiels (fade-to-black) durent ~2× cette valeur. */
  durationMs?: number
  fit?: 'cover' | 'contain'
  className?: string
  style?: React.CSSProperties
  onComplete?: () => void
}

/**
 * Joue UNE transition explicite entre `from` et `to` puis appelle `onComplete`.
 * Reste figé sur `to` après la transition. Idéal pour navigation section→section.
 */
export default function CinematicTransition({ from, to, effect, durationMs = 600, fit = 'cover', className, style, onComplete }: CinematicTransitionProps) {
  useEffect(() => { ensureTransitionStylesInjected() }, [])
  const anims = getTransitionAnimations(effect, durationMs)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDone(false)
    if (anims.totalDurationMs === 0) {
      onComplete?.()
      setDone(true)
      return
    }
    const t = window.setTimeout(() => {
      setDone(true)
      onComplete?.()
    }, anims.totalDurationMs)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.url, to.url, effect, durationMs])

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', background: anims.background, ...style }}>
      {/* Couche sortante */}
      {from && !done && (
        <div style={{ position: 'absolute', inset: 0, animation: anims.outAnimation }}>
          <MediaLayer src={from.url} fit={fit} placeholder={from.placeholder} />
        </div>
      )}
      {/* Couche entrante */}
      <div style={{ position: 'absolute', inset: 0, animation: done ? undefined : anims.inAnimation, opacity: done ? 1 : (anims.inDelayMs ? 0 : undefined) }}>
        <MediaLayer src={to.url} fit={fit} placeholder={to.placeholder} />
      </div>
    </div>
  )
}

// ── Mode 2 : <MediaSwapper> — re-déclenche transition à chaque changement d'url ─

export interface MediaSwapperProps {
  /** URL courante. Toute mutation déclenche une transition depuis l'URL précédente. */
  url?: string
  isVideo?: boolean
  effect?: TransitionEffect
  durationMs?: number
  fit?: 'cover' | 'contain'
  className?: string
  style?: React.CSSProperties
  placeholder?: React.ReactNode
}

/**
 * Affiche un média qui change dans le temps, en jouant une transition
 * cinématique entre chaque changement d'`url`. Conçu pour piloter le rendu
 * d'un PlanPlayer ou d'un mini-tel preview.
 */
export function MediaSwapper({ url, isVideo, effect = 'crossfade', durationMs = 600, fit = 'cover', className, style, placeholder }: MediaSwapperProps) {
  useEffect(() => { ensureTransitionStylesInjected() }, [])
  const [current, setCurrent] = useState<string | undefined>(url)
  const [previous, setPrevious] = useState<string | undefined>(undefined)
  const [transitionKey, setTransitionKey] = useState(0)
  const lastUrlRef = useRef<string | undefined>(url)

  useEffect(() => {
    if (url === lastUrlRef.current) return
    setPrevious(lastUrlRef.current)
    setCurrent(url)
    lastUrlRef.current = url
    setTransitionKey(k => k + 1)
  }, [url])

  const anims = getTransitionAnimations(effect, durationMs)

  // Cleanup de la couche précédente après la durée totale
  useEffect(() => {
    if (anims.totalDurationMs === 0) { setPrevious(undefined); return }
    const t = window.setTimeout(() => setPrevious(undefined), anims.totalDurationMs + 50)
    return () => window.clearTimeout(t)
  }, [transitionKey, anims.totalDurationMs])

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', background: anims.background, ...style }}>
      {previous && previous !== current && (
        <div key={`prev-${transitionKey}`} style={{ position: 'absolute', inset: 0, animation: anims.outAnimation }}>
          <MediaLayer src={previous} fit={fit} placeholder={placeholder} />
        </div>
      )}
      {current ? (
        <div key={`curr-${transitionKey}`} style={{ position: 'absolute', inset: 0, animation: previous ? anims.inAnimation : 'none' }}>
          <MediaLayer src={current} fit={fit} placeholder={placeholder} />
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{placeholder}</div>
      )}
    </div>
  )
}

export { isVideoUrl }
