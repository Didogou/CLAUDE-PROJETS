'use client'
/**
 * useCursorRaf — hook curseur de lecture 60Hz pour la timeline multi-pistes.
 *
 * Inspiré du pattern legacy `cursorMsRef + rAF` (PlanTimelineEditor:114-130)
 * qui évite les saccades en NE déclenchant PAS de re-render parent à chaque
 * frame. Le curseur visuel poll cette ref directement via `requestAnimationFrame`
 * et applique `transform: translateX(...)` en CSS — coût minimal.
 *
 * Refonte 2026-05-12 — adaptation React-hook clean.
 *
 * Usage :
 * ```tsx
 * const { cursorMsRef, isPlaying, play, pause, seek } = useCursorRaf({
 *   totalDurationMs: state.totalDurationMs,
 *   onEnd: () => console.log('fin de séquence'),
 * })
 * // Dans un useEffect rAF dédié (au composant qui dessine le curseur) :
 * useEffect(() => {
 *   let raf = 0
 *   function tick() {
 *     const ms = cursorMsRef.current ?? 0
 *     if (curRef.current) {
 *       curRef.current.style.transform = `translateX(${msToPx(ms, pxPerSec)}px)`
 *     }
 *     raf = requestAnimationFrame(tick)
 *   }
 *   raf = requestAnimationFrame(tick)
 *   return () => cancelAnimationFrame(raf)
 * }, [pxPerSec])
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCursorRafOptions {
  /** Durée totale de la séquence en ms — borne le curseur. */
  totalDurationMs: number
  /** Callback fire quand le curseur atteint la fin (auto-pause). */
  onEnd?: () => void
}

interface UseCursorRafResult {
  /** Position courante en ms. Mise à jour 60Hz pendant la lecture, SANS
   *  déclencher de re-render. Le composant qui veut afficher le curseur
   *  poll cette ref via son propre requestAnimationFrame. */
  cursorMsRef: React.MutableRefObject<number>
  /** True si la lecture est active. Re-render trigger (state React). */
  isPlaying: boolean
  /** Démarre la lecture depuis la position courante. Si à la fin, restart 0. */
  play: () => void
  /** Met en pause. La position courante reste mémorisée. */
  pause: () => void
  /** Arrête la lecture et remet le curseur à 0. */
  stop: () => void
  /** Place le curseur à `ms` (clampé [0, totalDurationMs]). Pause si lecture. */
  seek: (ms: number) => void
}

export function useCursorRaf({ totalDurationMs, onEnd }: UseCursorRafOptions): UseCursorRafResult {
  const cursorMsRef = useRef<number>(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const lastTickRef = useRef<number>(0)
  const rafRef = useRef<number>(0)

  // Boucle interne — incrémente cursorMsRef selon le delta temps réel.
  const tick = useCallback((now: number) => {
    if (lastTickRef.current === 0) {
      lastTickRef.current = now
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    const dt = now - lastTickRef.current
    lastTickRef.current = now
    cursorMsRef.current = Math.min(totalDurationMs, cursorMsRef.current + dt)
    if (cursorMsRef.current >= totalDurationMs) {
      // Fin atteinte — auto-pause + callback
      cancelAnimationFrame(rafRef.current)
      lastTickRef.current = 0
      setIsPlaying(false)
      onEnd?.()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [totalDurationMs, onEnd])

  // Démarre/arrête la rAF selon isPlaying
  useEffect(() => {
    if (!isPlaying) return
    lastTickRef.current = 0  // reset delta au démarrage pour éviter saut
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      lastTickRef.current = 0
    }
  }, [isPlaying, tick])

  const play = useCallback(() => {
    if (cursorMsRef.current >= totalDurationMs) cursorMsRef.current = 0
    setIsPlaying(true)
  }, [totalDurationMs])

  const pause = useCallback(() => {
    setIsPlaying(false)
  }, [])

  const stop = useCallback(() => {
    cursorMsRef.current = 0
    setIsPlaying(false)
  }, [])

  const seek = useCallback((ms: number) => {
    cursorMsRef.current = Math.max(0, Math.min(totalDurationMs, ms))
    setIsPlaying(false)
  }, [totalDurationMs])

  return { cursorMsRef, isPlaying, play, pause, stop, seek }
}
