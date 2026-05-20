'use client'
/**
 * useMouseTrack — Hook record/play d'une trajectoire souris synced sur vidéo.
 *
 * Refonte 2026-05-15bx — flow simplifié :
 *   - Click start() → vidéo pause + currentTime=0 → countdown 3-2-1 → play
 *     auto + recording. Mousemove throttle 30Hz → push points.
 *   - Vidéo onEnded → stop auto, points commit, mode = idle.
 *   - Click play() → vidéo currentTime=0 + play, mode = playing, rAF lookup.
 *   - Smoothing : moving average sur 3 points lookup pour adoucir.
 *
 * Modes : idle | countdown | recording | playing
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface TrackPoint {
  tMs: number
  x: number
  y: number
}

export type MouseTrackMode = 'idle' | 'countdown' | 'recording' | 'playing'

interface UseMouseTrackOptions {
  videoEl: HTMLVideoElement | null
  /** Throttle enregistrement (ms entre chaque point capturé). Default 33 = ~30fps. */
  throttleMs?: number
  /** Compte à rebours avant record (en secondes). Default 3. */
  countdownSec?: number
  /** Vitesse de lecture pendant recording ET playing (default 0.5 = ralenti).
   *  Refonte 2026-05-15by — permet à l'auteur de mieux suivre la cible. */
  playbackRate?: number
}

export function useMouseTrack({
  videoEl, throttleMs = 33, countdownSec = 3, playbackRate = 0.5,
}: UseMouseTrackOptions) {
  const [mode, setMode] = useState<MouseTrackMode>('idle')
  const [countdownValue, setCountdownValue] = useState<number | null>(null)
  const [points, setPoints] = useState<TrackPoint[]>([])
  const [currentXY, setCurrentXY] = useState<{ x: number; y: number } | null>(null)

  const targetRef = useRef<HTMLElement | null>(null)
  const pointsRef = useRef<TrackPoint[]>([])
  const lastPushMsRef = useRef<number>(0)
  const rafRef = useRef<number>(0)
  const modeRef = useRef<MouseTrackMode>('idle')
  // Position visée (= dernière souris) vs position affichée (= lerp easing)
  const targetXYRef = useRef<{ x: number; y: number } | null>(null)
  const displayedXYRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { pointsRef.current = points }, [points])

  const attachTarget = useCallback((el: HTMLElement | null) => {
    targetRef.current = el
  }, [])

  /** Helper : attend que la vidéo ait chargé ses métadonnées (= src valide,
   *  durée connue). Si déjà prête, return immédiat. Sinon attend loadedmetadata
   *  ou canplay (max 3s). Refonte 2026-05-15bz — fixe play() rejected
   *  NotSupportedError quand on clique Record trop tôt après upload. */
  async function waitReady(v: HTMLVideoElement): Promise<void> {
    if (!v.src && !v.currentSrc) {
      throw new Error('[useMouseTrack] video sans src')
    }
    if (v.readyState >= 1) return  // HAVE_METADATA
    return new Promise<void>((resolve, reject) => {
      const onMeta = () => { cleanup(); resolve() }
      const onError = () => { cleanup(); reject(new Error('[useMouseTrack] video error event')) }
      const cleanup = () => {
        v.removeEventListener('loadedmetadata', onMeta)
        v.removeEventListener('canplay', onMeta)
        v.removeEventListener('error', onError)
        clearTimeout(timeoutId)
      }
      v.addEventListener('loadedmetadata', onMeta)
      v.addEventListener('canplay', onMeta)
      v.addEventListener('error', onError)
      const timeoutId = setTimeout(() => { cleanup(); resolve() }, 3000)
    })
  }

  /** Helper : seek à 0 puis attend l'event `seeked` (= la frame est prête). */
  async function seekToZero(v: HTMLVideoElement): Promise<void> {
    if (v.currentTime === 0 && v.readyState >= 2) return
    return new Promise<void>((resolve) => {
      const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve() }
      v.addEventListener('seeked', onSeeked)
      v.currentTime = 0
      // Safety timeout 1s si l'event ne fire pas (vidéo cassée)
      setTimeout(() => { v.removeEventListener('seeked', onSeeked); resolve() }, 1000)
    })
  }

  /** Démarre : pause vidéo, reset à 0, countdown, puis play (au ralenti) + recording. */
  const start = useCallback(async () => {
    if (!videoEl) {
      console.warn('[useMouseTrack] start: videoEl null')
      return
    }
    pointsRef.current = []
    setPoints([])
    setCurrentXY(null)
    targetXYRef.current = null
    displayedXYRef.current = null
    try { await waitReady(videoEl) } catch (err) {
      console.error(err); return
    }
    videoEl.pause()
    await seekToZero(videoEl)
    console.log('[useMouseTrack] after seek: currentTime=', videoEl.currentTime, 'readyState=', videoEl.readyState)
    setMode('countdown')
    for (let i = countdownSec; i >= 1; i--) {
      setCountdownValue(i)
      await new Promise(r => setTimeout(r, 800))
    }
    setCountdownValue(null)
    if (modeRef.current !== 'countdown') return
    setMode('recording')
    videoEl.playbackRate = playbackRate
    videoEl.muted = true  // contourne autoplay policy si user gesture trop ancien
    try {
      await videoEl.play()
      // Petite vérif post-play : si paused encore après 100ms, retry une fois
      await new Promise(r => setTimeout(r, 100))
      if (videoEl.paused) {
        console.warn('[useMouseTrack] video toujours paused après play(), retry')
        await videoEl.play()
      }
      console.log('[useMouseTrack] recording: video.paused=', videoEl.paused, 'rate=', videoEl.playbackRate)
    } catch (err) {
      console.error('[useMouseTrack] play() rejected:', err)
    }
  }, [videoEl, countdownSec, playbackRate])

  /** Lance la lecture de la trajectoire enregistrée. */
  const play = useCallback(async () => {
    if (!videoEl) {
      console.warn('[useMouseTrack] play: videoEl null')
      return
    }
    if (pointsRef.current.length === 0) {
      console.warn('[useMouseTrack] play: aucun point enregistré')
      return
    }
    try { await waitReady(videoEl) } catch (err) {
      console.error(err); return
    }
    videoEl.pause()
    await seekToZero(videoEl)
    setMode('playing')
    videoEl.playbackRate = playbackRate
    videoEl.muted = true
    try {
      await videoEl.play()
      await new Promise(r => setTimeout(r, 100))
      if (videoEl.paused) await videoEl.play()
      console.log('[useMouseTrack] playing: video.paused=', videoEl.paused)
    } catch (err) {
      console.error('[useMouseTrack] play() rejected:', err)
    }
  }, [videoEl, playbackRate])

  /** Stop manuel (interrompt countdown / recording / playing). */
  const stop = useCallback(() => {
    setMode('idle')
    setCountdownValue(null)
    if (videoEl) videoEl.pause()
  }, [videoEl])

  /** Reset complet. */
  const clear = useCallback(() => {
    setPoints([])
    pointsRef.current = []
    setCurrentXY(null)
    targetXYRef.current = null
    displayedXYRef.current = null
    setMode('idle')
    setCountdownValue(null)
  }, [])

  // ── Mousemove handler — TOUJOURS actif pour preview live (refonte 2026-05-15by).
  // Update targetXY en continu (= croix suit la souris pendant countdown / idle).
  // Push dans pointsRef UNIQUEMENT en mode RECORDING + throttle.
  useEffect(() => {
    const target = targetRef.current
    if (!target) return
    function onMove(ev: MouseEvent) {
      if (!target) return
      const rect = target.getBoundingClientRect()
      const x = (ev.clientX - rect.left) / rect.width
      const y = (ev.clientY - rect.top) / rect.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return
      targetXYRef.current = { x, y }
      // Push uniquement en mode recording avec throttle
      if (modeRef.current !== 'recording' || !videoEl) return
      const now = performance.now()
      // Throttle push à `throttleMs`
      if (now - lastPushMsRef.current < throttleMs) return
      lastPushMsRef.current = now
      pointsRef.current.push({ tMs: videoEl.currentTime * 1000, x, y })
    }
    target.addEventListener('mousemove', onMove)
    return () => target.removeEventListener('mousemove', onMove)
  }, [videoEl, throttleMs])

  // ── Auto-stop à fin vidéo (mode RECORDING ou PLAYING) ────────────────────
  useEffect(() => {
    if (!videoEl) return
    function onEnded() {
      if (modeRef.current === 'recording') {
        // Commit points + bascule en idle (l'utilisateur peut faire Play)
        setPoints([...pointsRef.current])
        setMode('idle')
      } else if (modeRef.current === 'playing') {
        setMode('idle')
      }
    }
    videoEl.addEventListener('ended', onEnded)
    return () => videoEl.removeEventListener('ended', onEnded)
  }, [videoEl])

  // ── rAF tick : lerp easing sur targetXY → displayedXY ────────────────────
  // Refonte 2026-05-15by — actif AUSSI pendant 'countdown' pour que la croix
  // suive la souris en preview avant le record (= positionne la cible).
  // Refonte 2026-05-15cy — actif AUSSI en 'idle' pour que l'auteur voie le
  // sniper scope suivre sa souris en preview AVANT d'enregistrer la cible
  // (UX : "regarde où ça va se passer, puis valide en cliquant Record").
  // En mode 'playing' on lookup la trajectoire, sinon on suit targetXY (= souris).
  useEffect(() => {
    function tick() {
      let target = targetXYRef.current
      if (mode === 'playing' && videoEl && pointsRef.current.length > 0) {
        target = lookupSmooth(pointsRef.current, videoEl.currentTime * 1000)
        targetXYRef.current = target
      }
      if (target) {
        const prev = displayedXYRef.current
        // Easing : countdown/idle = rapide (réactivité preview), recording/playing = doux
        const k = (mode === 'countdown' || mode === 'idle') ? 0.4 : 0.18
        if (!prev) {
          displayedXYRef.current = { ...target }
        } else {
          displayedXYRef.current = {
            x: prev.x + (target.x - prev.x) * k,
            y: prev.y + (target.y - prev.y) * k,
          }
        }
        setCurrentXY({ ...displayedXYRef.current })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [mode, videoEl])

  return {
    mode, countdownValue, points, currentXY,
    start, play, stop, clear, attachTarget,
    hasTrack: points.length > 0,
  }
}

/** Lookup avec lissage : moyenne pondérée sur 3 points centrés autour de tMs.
 *  Évite les sauts brusques entre 2 points consécutifs (smoothing temporel). */
export function lookupSmooth(points: TrackPoint[], tMs: number): { x: number; y: number } | null {
  if (points.length === 0) return null
  if (points.length === 1) return { x: points[0].x, y: points[0].y }
  if (tMs <= points[0].tMs) return { x: points[0].x, y: points[0].y }
  const last = points[points.length - 1]
  if (tMs >= last.tMs) return { x: last.x, y: last.y }
  // Trouve l'index du segment qui contient tMs
  let i = 0
  for (; i < points.length - 1; i++) {
    if (tMs >= points[i].tMs && tMs <= points[i + 1].tMs) break
  }
  // Moyenne pondérée des 3 points (i-1, i, i+1) avec poids gaussien centré
  // sur l'interpolation linéaire entre points[i] et points[i+1].
  const a = points[i]
  const b = points[i + 1]
  const t = (tMs - a.tMs) / (b.tMs - a.tMs || 1)
  let x = a.x + (b.x - a.x) * t
  let y = a.y + (b.y - a.y) * t
  // Smoothing : moyenne avec voisins immédiats si dispo
  if (i > 0 && i < points.length - 2) {
    const prev = points[i - 1]
    const next = points[i + 2]
    x = (prev.x * 0.15 + x * 0.7 + next.x * 0.15)
    y = (prev.y * 0.15 + y * 0.7 + next.y * 0.15)
  }
  return { x, y }
}
