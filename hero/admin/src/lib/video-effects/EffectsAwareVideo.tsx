'use client'
/**
 * EffectsAwareVideo — wrapper vidéo qui applique automatiquement les effets
 * stockés dans `effects_params` (LUT + shader + overlays + mouse track sniper).
 *
 * Refonte 2026-05-15cn — Phase C v2 : faire que le runtime player rende les
 * mêmes effets que la modale Effets de l'auteur. Sans ça, l'auteur règle un
 * look, mais le joueur final voit la vidéo brute.
 *
 * Comportement :
 *   - Si `effectsParams` est null/empty/neutre → render `<video>` natif (chemin
 *     léger, zéro coût WebGL).
 *   - Sinon → render VideoEffectsCanvas + EffectsOverlayLayer + lookup mouse
 *     track au playback (rAF) si module sniper actif.
 *
 * Le composant expose :
 *   - `videoElRef` : ref vers le <video> interne (pour controls play/pause/
 *     currentTime depuis le parent — ex: PelliculeRenderer).
 *   - Events : `onEnded`, `onLoadedMetadata` propagés.
 *   - `isPlaying` : bind sync sur l'élément interne.
 *
 * Cas d'usage : PelliculeRenderer (book-player), AnimationStudioPreview,
 * potentiellement aussi le bake offscreen pour l'export Phase D.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react'
import VideoEffectsCanvas from './VideoEffectsCanvas'
import EffectsOverlayLayer from './EffectsOverlayLayer'
import VideoWeatherLayer from './VideoWeatherLayer'
import { lookupSmooth } from './useMouseTrack'
import {
  migrateLegacyEffectsParams,
  resolveShaderParams,
  findLook,
  type ComposedEffectsState,
} from './looks-catalog'
import type { VideoEffectsParams } from './VideoEffectsCanvas'

interface EffectsAwareVideoProps {
  videoUrl: string
  /** effects_params raw (peut être legacy VideoEffectsParams ou nouveau ComposedEffectsState). */
  effectsParams?: Record<string, unknown> | ComposedEffectsState | VideoEffectsParams | null
  /** Image fallback si videoUrl absent (ex: firstFrameUrl). */
  poster?: string | null
  /** Bind play/pause depuis le parent. */
  isPlaying?: boolean
  /** Loop la vidéo (default false). */
  loop?: boolean
  /** Muted (default false). Pour les previews qui ne veulent pas le son. */
  muted?: boolean
  /** Callback fin de lecture. */
  onEnded?: () => void
  /** Callback metadata loaded (durée connue). */
  onLoadedMetadata?: (videoEl: HTMLVideoElement) => void
  /** Expose la ref vers le <video> interne pour les controls externes. */
  onVideoElement?: (v: HTMLVideoElement | null) => void
  /** className passé au wrapper externe. */
  className?: string
  /** Aspect ratio override (default 16/9). */
  aspectRatio?: number
}

/** Détecte si l'état contient des effets actifs (look OU modules OU overrides
 *  OU weather OU slowMotion). Refonte 2026-05-15dm — étendu au ralenti. */
function hasActiveEffects(state: ComposedEffectsState): boolean {
  if (state.look_id) return true
  if (state.modules && state.modules.length > 0) return true
  if (state.overrides && Object.keys(state.overrides).length > 0) return true
  if (state.weather && state.weather.length > 0) return true
  if (state.slowMotion) return true
  return false
}

export default function EffectsAwareVideo({
  videoUrl, effectsParams, poster, isPlaying = true, loop = false, muted = false,
  onEnded, onLoadedMetadata, onVideoElement, className, aspectRatio = 16 / 9,
}: EffectsAwareVideoProps) {
  // Normalise effects_params en ComposedEffectsState
  const state = useMemo(
    () => migrateLegacyEffectsParams(effectsParams as ComposedEffectsState | null),
    [effectsParams],
  )
  const active = useMemo(() => hasActiveEffects(state), [state])

  // ── Mouse track lookup au playback (sniper + viewfinder + hud trackables)
  // Refonte 2026-05-15co — étendu au-delà du sniper.
  const trackableActive = active && state.modules.some(mid =>
    mid === 'sniper' || mid === 'viewfinder_photo' || mid === 'hud_reticle',
  )
  const [currentXY, setCurrentXY] = useState<{ x: number; y: number } | null>(null)
  const [internalVideoEl, setInternalVideoEl] = useState<HTMLVideoElement | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!trackableActive || !internalVideoEl || !state.mouse_track || state.mouse_track.length === 0) {
      setCurrentXY(null)
      return
    }
    function tick() {
      const v = internalVideoEl
      if (!v) return
      const xy = lookupSmooth(state.mouse_track ?? [], v.currentTime * 1000)
      setCurrentXY(xy)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [trackableActive, internalVideoEl, state.mouse_track])

  // ── Ralenti (refonte 2026-05-15dn) — setInterval 100ms (au lieu de rAF 60Hz)
  // pour réduire saccade au runtime. Le browser n'apprécie pas qu'on re-set
  // playbackRate à chaque frame.
  const slowMo = state.slowMotion
  useEffect(() => {
    if (!slowMo || !internalVideoEl) return
    const v = internalVideoEl
    let lastApplied = -1
    const id = setInterval(() => {
      const t = v.currentTime
      const inside = t >= slowMo.startSec && t < slowMo.endSec
      const target = inside ? Math.max(0.1, Math.min(1, slowMo.factor)) : 1
      if (Math.abs(target - lastApplied) > 0.01) {
        v.playbackRate = target
        lastApplied = target
      }
    }, 100)
    return () => {
      clearInterval(id)
      try { v.playbackRate = 1 } catch { /* noop */ }
    }
  }, [slowMo, internalVideoEl])

  // ── Bind isPlaying → video.play()/pause() (chemin avec effets) ──────────
  // Refonte 2026-05-17 — retry avec muted=true en cas de fail autoplay
  // (Chrome/Safari bloque play() sans user gesture si pas muted). Le son
  // peut être réactivé par l'auteur via les controls audio du modal.
  useEffect(() => {
    if (!internalVideoEl) return
    if (isPlaying) {
      const el = internalVideoEl
      void el.play().catch(() => {
        // Retry muted
        el.muted = true
        void el.play().catch(err => console.warn('[EffectsAwareVideo] play() failed even muted:', err.message))
      })
    } else {
      internalVideoEl.pause()
    }
  }, [isPlaying, internalVideoEl])

  // ── Bind onEnded (chemin avec effets) ──────────────────────────────────
  useEffect(() => {
    if (!internalVideoEl || !onEnded) return
    const handler = () => onEnded()
    internalVideoEl.addEventListener('ended', handler)
    return () => internalVideoEl.removeEventListener('ended', handler)
  }, [internalVideoEl, onEnded])

  // ── Bind onLoadedMetadata (chemin avec effets) ──────────────────────────
  useEffect(() => {
    if (!internalVideoEl || !onLoadedMetadata) return
    const handler = () => onLoadedMetadata(internalVideoEl)
    if (internalVideoEl.readyState >= 1) {
      handler()
    } else {
      internalVideoEl.addEventListener('loadedmetadata', handler)
      return () => internalVideoEl.removeEventListener('loadedmetadata', handler)
    }
  }, [internalVideoEl, onLoadedMetadata])

  // ── Propage videoEl au parent (pour controls externes type seek/cleanup) ─
  useEffect(() => {
    onVideoElement?.(internalVideoEl)
  }, [internalVideoEl, onVideoElement])

  // ── Chemin léger : pas d'effets → <video> natif ─────────────────────────
  if (!active) {
    return (
      <video
        // Refonte 2026-05-17 — ref callback stable via setInternalVideoEl
        // (qui vient de useState et est garanti stable par React). Sans ça,
        // une fonction inline ref={el => ...} était recréée à chaque render,
        // déclenchant ref(null) puis ref(el) → 2 setState par render → boucle
        // "Maximum update depth" quand quelque chose en amont re-render
        // fréquemment (ex: sync cursor PreviewModal ↔ timeline).
        ref={setInternalVideoEl}
        src={videoUrl}
        className={className}
        playsInline
        muted={muted}
        loop={loop}
        poster={poster ?? undefined}
        // Pas besoin de bind play/pause via useEffect ici : on laisse le
        // parent contrôler via ref. Mais pour cohérence avec le path effects,
        // on bind quand même via les useEffect ci-dessus (qui marchent aussi).
      />
    )
  }

  // ── Chemin avec effets : VideoEffectsCanvas + overlays ──────────────────
  const shaderParams = resolveShaderParams(state)
  const lutUrl = findLook(state.look_id)?.lut_url ?? null
  return (
    <div className={`efx-aware ${className ?? ''}`} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <VideoEffectsCanvas
        videoUrl={videoUrl}
        params={shaderParams}
        lutUrl={lutUrl}
        width="100%"
        aspectRatio={aspectRatio}
        loop={loop}
        autoPlay={isPlaying}
        muted={muted}
        onVideoElement={setInternalVideoEl}
      />
      <EffectsOverlayLayer
        state={state}
        currentXY={currentXY}
        videoEl={internalVideoEl}
      />
      {/* Weather (refonte 2026-05-15de) — pluie/neige/brouillard/etc. */}
      <VideoWeatherLayer weather={state.weather} />
    </div>
  )
}
