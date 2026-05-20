'use client'
/**
 * PelliculeRenderer — joue UNE pellicule (vidéo + image_static + audio + text overlays).
 *
 * - kind 'animation' : <video> autoplay puis fige sur lastFrameUrl à la fin
 * - kind 'image_static' : <img> affichée pendant shots[0].duration secondes
 *   (le rAF interne advance cursorMs)
 *
 * Audio mix (sfx + music) via Hook lecteur HTML5 : on instancie un HTMLAudioElement
 * par audioTrack, synchronisé avec cursorMsRef.
 *
 * Text overlays : on les rend par shot — startSec/durationSec relatifs au shot,
 * on calcule shot courant via cursor relatif à la pellicule.
 *
 * Au cursor === pellicule.totalMs, appelle onComplete pour que le parent passe à
 * la pellicule suivante (ou plan suivant).
 *
 * V1 2026-05-13.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PelliculePersisted } from '@/types'
import EffectsAwareVideo from '@/lib/video-effects/EffectsAwareVideo'
// Phase A keyframes chantier 2026-05-18 — calques runtime au-dessus de la pellicule.
import PelliculeLayerRenderer from './PelliculeLayerRenderer'
import PelliculeMaskOverlay from './PelliculeMaskOverlay'
import type { PelliculeLayerRow } from '@/lib/pellicule-layers-types'

// Phase A bis bonus 2026-05-18 — dérive un label affichable pour un calque
// (= nom de fichier extrait du media_url, ou fallback type+z_index).
function deriveLayerLabel(layer: PelliculeLayerRow): string {
  if (layer.media_url) {
    const match = /\/([^/]+?)(?:\?|$)/.exec(layer.media_url)
    if (match) {
      const filename = decodeURIComponent(match[1])
      // Retire l'extension pour clarté visuelle.
      return filename.replace(/\.[a-z0-9]+$/i, '')
    }
  }
  return `${layer.type} #${layer.z_index}`
}
// Phase B keyframes 2026-05-18 — animation runtime de la pellicule entière
// (Ken Burns / fade / slide). Lu via prop pelliculeKeyframes, interpolé selon
// cursorMsRef à chaque frame, appliqué en CSS transform sur le wrapper média.
import {
  interpolateKeyframes,
  keyframeStateToCssTransform,
  type PelliculeKeyframe,
} from '@/lib/pellicule-keyframes'

interface PelliculeRendererProps {
  pellicule: PelliculePersisted
  isPlaying: boolean
  onComplete: () => void
  onCursorChange?: (cursorMs: number) => void
  /** Refonte 2026-05-17 — seek vers cette position ms dans la pellicule.
   *  Re-applique à chaque change de valeur (= drag timeline ruler). */
  seekToMs?: number | null
  /** Phase A keyframes 2026-05-18 — calques runtime à rendre par-dessus la
   *  vidéo/image, sous les text overlays. Le parent fetch via
   *  /api/pellicules/[id]/layers et passe ici. null/undefined = pas de calques. */
  layers?: PelliculeLayerRow[] | null
  /** Phase A.5 — mode dessin de mask actif sur cette pellicule. Rend un
   *  overlay capture-clicks au-dessus de tout. null/undefined = pas de dessin. */
  maskDraft?: {
    shape: 'rect' | 'polygon'
    points: Array<[number, number]>
    onAddPoint: (point: [number, number]) => void
  } | null
  /** Phase B keyframes 2026-05-18 — animation runtime de la pellicule entière.
   *  Interpolés en lecture seule selon cursorMsRef, appliqués en CSS transform
   *  + opacity sur le wrapper média. null/undefined/[] = pas d'animation. */
  pelliculeKeyframes?: PelliculeKeyframe[] | null
}

export default function PelliculeRenderer({
  pellicule, isPlaying, onComplete, onCursorChange, seekToMs, layers, maskDraft,
  pelliculeKeyframes,
}: PelliculeRendererProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const cursorMsRef = useRef(0)

  // Refonte 2026-05-17 — seek externe synchrone : si seekToMs change, on
  // set videoEl.currentTime + cursorMsRef pour aligner la lecture sur le
  // timecode demandé par le parent (= drag ruler timeline). Idempotent
  // (re-applique uniquement si la valeur change vraiment).
  const lastSeekRef = useRef<number | null>(null)
  useEffect(() => {
    if (seekToMs == null) return
    if (seekToMs === lastSeekRef.current) return
    lastSeekRef.current = seekToMs
    cursorMsRef.current = seekToMs
    const v = videoRef.current
    if (v && isFinite(v.duration) && v.duration > 0) {
      try { v.currentTime = Math.max(0, Math.min(v.duration, seekToMs / 1000)) }
      catch { /* noop */ }
    }
    // Resync audio tracks
    for (const el of audioElsRef.current.values()) {
      if (isFinite(el.duration) && el.duration > 0) {
        try { el.currentTime = Math.max(0, Math.min(el.duration, seekToMs / 1000)) }
        catch { /* noop */ }
      }
    }
  }, [seekToMs])
  const [activeOverlays, setActiveOverlays] = useState<Array<{
    shotId: string
    overlayId: string
    text: string
    template: 'fade' | 'typewriter' | 'slide_up'
    position: 'top' | 'center' | 'bottom'
    size: 'sm' | 'md' | 'lg' | 'xl'
  }>>([])

  const isStatic = pellicule.type === 'image_static'
  const totalDurMs = useMemo(
    () => (pellicule.shots ?? []).reduce((s, sh) => s + (sh.duration ?? 4), 0) * 1000,
    [pellicule.shots],
  )

  // Pré-calcule les fenêtres de chaque shot (startMs absolu dans la pellicule)
  const shotWindows = useMemo(() => {
    const out: Array<{ id: string; startMs: number; endMs: number }> = []
    let cur = 0
    for (const s of pellicule.shots ?? []) {
      const dur = (s.duration ?? 4) * 1000
      out.push({ id: s.id, startMs: cur, endMs: cur + dur })
      cur += dur
    }
    return out
  }, [pellicule.shots])

  // ── Init audio elements ─────────────────────────────────────────────────
  useEffect(() => {
    const tracks = pellicule.audioTracks ?? []
    // Cleanup anciens
    for (const [id, el] of audioElsRef.current) {
      if (!tracks.find(t => t.id === id)) {
        el.pause()
        el.src = ''
        audioElsRef.current.delete(id)
      }
    }
    // Ajoute manquants
    for (const t of tracks) {
      if (!audioElsRef.current.has(t.id)) {
        const el = new Audio(t.audioUrl)
        el.preload = 'auto'
        el.volume = t.volume ?? 0.7
        el.loop = t.kind === 'music' && (t.loop ?? false)
        audioElsRef.current.set(t.id, el)
      } else {
        // Update volume si changé
        const el = audioElsRef.current.get(t.id)!
        el.volume = t.volume ?? 0.7
      }
    }
    return () => {
      // Pause + cleanup à l'unmount
      for (const el of audioElsRef.current.values()) {
        el.pause()
        el.src = ''
      }
      audioElsRef.current.clear()
    }
  }, [pellicule.audioTracks])

  // ── Boucle rAF principale (advance cursor, syncs audio, gère overlays) ──
  useEffect(() => {
    let raf = 0
    let lastTick = performance.now()
    const tracks = pellicule.audioTracks ?? []

    function tick(now: number) {
      const dt = now - lastTick
      lastTick = now

      if (isPlaying) {
        // Avance cursor
        if (isStatic) {
          // image_static : on avance le cursor selon dt (pas de vidéo)
          cursorMsRef.current += dt
        } else {
          // animation : cursor pris depuis videoRef.currentTime si vidéo en cours
          const v = videoRef.current
          if (v && !v.paused && !v.ended) {
            cursorMsRef.current = v.currentTime * 1000
          } else if (v?.ended) {
            cursorMsRef.current = totalDurMs  // figé fin
          }
        }

        // Sync audio tracks
        for (const t of tracks) {
          const el = audioElsRef.current.get(t.id)
          if (!el) continue
          const inWindow = cursorMsRef.current >= t.startMs
                        && cursorMsRef.current < t.startMs + t.durationMs
          if (inWindow) {
            if (el.paused) {
              // Aligne playback time sur cursor offset
              const offsetSec = (cursorMsRef.current - t.startMs) / 1000
              el.currentTime = Math.max(0, offsetSec)
              void el.play().catch(() => {})
            }
            // Fade in/out volume
            const elapsed = cursorMsRef.current - t.startMs
            const remaining = (t.startMs + t.durationMs) - cursorMsRef.current
            let vol = t.volume ?? 0.7
            if (elapsed < (t.fadeInMs ?? 0)) {
              vol *= elapsed / (t.fadeInMs ?? 1)
            }
            if (remaining < (t.fadeOutMs ?? 0)) {
              vol *= Math.max(0, remaining / (t.fadeOutMs ?? 1))
            }
            el.volume = Math.max(0, Math.min(1, vol))
          } else if (!el.paused) {
            el.pause()
          }
        }

        // Détecte overlays texte actifs
        const next: typeof activeOverlays = []
        const cur = cursorMsRef.current
        for (const w of shotWindows) {
          if (cur < w.startMs || cur >= w.endMs) continue
          const shot = (pellicule.shots ?? []).find(s => s.id === w.id)
          for (const o of shot?.textOverlays ?? []) {
            const oStart = w.startMs + o.startSec * 1000
            const oEnd = oStart + o.durationSec * 1000
            if (cur >= oStart && cur < oEnd) {
              next.push({
                shotId: w.id, overlayId: o.id, text: o.text,
                template: o.template, position: o.position, size: o.size,
              })
            }
          }
        }
        // Setstate only si diff
        if (next.length !== activeOverlays.length
            || next.some((o, i) => o.overlayId !== activeOverlays[i]?.overlayId)) {
          setActiveOverlays(next)
        }

        onCursorChange?.(cursorMsRef.current)

        // Détecte fin
        if (isStatic && cursorMsRef.current >= totalDurMs) {
          onComplete()
        }
      } else {
        // Pause : pause tous les audio
        for (const el of audioElsRef.current.values()) {
          if (!el.paused) el.pause()
        }
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, isStatic, totalDurMs, pellicule.audioTracks, pellicule.shots, shotWindows, activeOverlays, onComplete, onCursorChange])

  // ── Refonte Phase C v2 2026-05-15cn — controls play/pause + reset délégués
  // à EffectsAwareVideo via prop isPlaying. videoRef est désormais alimenté
  // via callback onVideoElement (l'élément réel peut être interne au canvas
  // WebGL si effets actifs).

  // ── Reset cursor au mount/changement pellicule ──────────────────────────
  useEffect(() => {
    cursorMsRef.current = 0
    setActiveOverlays([])
    const v = videoRef.current
    if (v) {
      v.currentTime = 0
    }
  }, [pellicule.id])

  // Phase A bis.6 keyframes 2026-05-18 — cursorMs lent (~10Hz) pour gate la
  // visibilité des calques selon leur start_ms_rel/duration_ms. 10Hz suffit
  // pour des transitions perçues smooth sans surcoût de re-render des layers.
  const [layerGateCursorMs, setLayerGateCursorMs] = useState(0)
  useEffect(() => {
    if (!layers || layers.length === 0) return
    const id = setInterval(() => {
      setLayerGateCursorMs(cursorMsRef.current)
    }, 100)
    return () => clearInterval(id)
  }, [layers])

  // Phase B keyframes 2026-05-18 — rAF tick qui applique les keyframes au
  // wrapper média via DOM mutation directe (= pas de re-render React 60Hz).
  // Pattern identique au cursor visuel de MultiTrackTimeline (project memory
  // useCursorRaf : DOM mutation > setState pour anim fluide).
  const animatedWrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!pelliculeKeyframes || pelliculeKeyframes.length === 0) {
      // Pas d'anim — reset le wrapper à l'état neutre
      if (animatedWrapperRef.current) {
        animatedWrapperRef.current.style.transform = ''
        animatedWrapperRef.current.style.opacity = ''
      }
      return
    }
    let raf = 0
    function tick() {
      const state = interpolateKeyframes(pelliculeKeyframes, cursorMsRef.current)
      if (state && animatedWrapperRef.current) {
        animatedWrapperRef.current.style.transform = keyframeStateToCssTransform(state)
        animatedWrapperRef.current.style.opacity = String(state.opacity)
        animatedWrapperRef.current.style.transformOrigin = 'center center'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pelliculeKeyframes])

  // ── Rendu ───────────────────────────────────────────────────────────────
  const mediaUrl = isStatic
    ? (pellicule.firstFrameUrl ?? '')
    : (pellicule.videoUrl ?? pellicule.firstFrameUrl ?? '')

  return (
    <div className="bp-canvas">
      {/* Phase B keyframes 2026-05-18 — wrapper transformé par rAF tick selon
       *  les keyframes interpolés. Reste neutre (style vide) si aucune anim.
       *  Calques + text overlays sont HORS de ce wrapper pour ne pas hériter
       *  du zoom/translate (ils ont leur propre positionning). */}
      <div ref={animatedWrapperRef} className="bp-canvas-anim-wrapper">
        {isStatic ? (
          mediaUrl ? <img src={mediaUrl} alt="" className="bp-canvas-media" /> : <div className="bp-error">Image manquante</div>
        ) : (
          pellicule.videoUrl ? (
            <EffectsAwareVideo
              videoUrl={pellicule.videoUrl}
              effectsParams={pellicule.effects_params}
              poster={pellicule.firstFrameUrl}
              isPlaying={isPlaying}
              className="bp-canvas-media"
              onVideoElement={(el) => { videoRef.current = el }}
              onEnded={() => {
                cursorMsRef.current = totalDurMs
                onComplete()
              }}
            />
          ) : (
            pellicule.firstFrameUrl
              ? <img src={pellicule.firstFrameUrl} alt="" className="bp-canvas-media" />
              : <div className="bp-error">Pellicule non générée</div>
          )
        )}
      </div>
      {/* Phase A bis bonus 2026-05-19 v2 — label pellicule bas-centre.
       *  Inline styles 100% explicites pour bypass tout cache CSS / HMR issue.
       *  TOUJOURS rendu (fallback id 8-chars). */}
      <div
        style={{
          position: 'absolute',
          bottom: '0.6rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          padding: '0.3rem 0.7rem',
          background: 'rgba(0, 0, 0, 0.85)',
          color: '#ffffff',
          fontSize: '0.75rem',
          fontWeight: 600,
          borderRadius: '0.3rem',
          letterSpacing: '0.03em',
          pointerEvents: 'none',
          userSelect: 'none',
          maxWidth: '80%',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textShadow: '0 1px 3px rgba(0, 0, 0, 1)',
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.5)',
        }}
      >
        🎬 {(pellicule as { label?: string }).label || pellicule.id?.slice(0, 8) || 'pellicule'}
      </div>
      {/* Phase A keyframes 2026-05-18 — calques runtime entre la pellicule
       *  (vidéo/image en arrière-plan) et les text overlays. Ordonnés par
       *  z_index ASC (= plus haut z_index rendu en dernier = au-dessus). */}
      {layers && layers.length > 0 && (
        <div className="bp-runtime-layers">
          {[...layers]
            .sort((a, b) => a.z_index - b.z_index)
            .map(layer => (
              <PelliculeLayerRenderer
                key={layer.id}
                layer={layer}
                cursorRelMs={layerGateCursorMs}
              />
            ))
          }
        </div>
      )}
      {/* Phase A bis bonus 2026-05-19 v2 — label calque TOPMOST visible.
       *  Inline styles 100% explicites pour bypass tout cache CSS / HMR issue. */}
      {(() => {
        if (!layers || layers.length === 0) return null
        const visibles = layers.filter(l => {
          if (!l.visible || !l.media_url) return false
          if (layerGateCursorMs < l.start_ms_rel) return false
          if (l.duration_ms != null && layerGateCursorMs >= l.start_ms_rel + l.duration_ms) return false
          return true
        })
        if (visibles.length === 0) return null
        const top = visibles.reduce((a, b) => (b.z_index > a.z_index ? b : a))
        return (
          <div
            style={{
              position: 'absolute',
              top: '0.6rem',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 50,
              padding: '0.3rem 0.7rem',
              background: 'rgba(0, 0, 0, 0.85)',
              color: '#ffffff',
              fontSize: '0.75rem',
              fontWeight: 600,
              borderRadius: '0.3rem',
              letterSpacing: '0.03em',
              pointerEvents: 'none',
              userSelect: 'none',
              maxWidth: '80%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textShadow: '0 1px 3px rgba(0, 0, 0, 1)',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.5)',
            }}
          >
            📷 {deriveLayerLabel(top)}
          </div>
        )
      })()}
      {/* Overlay texte */}
      <div className="bp-text-overlay-layer">
        {activeOverlays.map(o => (
          <TextOverlayItem key={`${o.shotId}-${o.overlayId}`} overlay={o} />
        ))}
      </div>
      {/* Phase A.5 keyframes 2026-05-18 — drawing mask overlay (z:10). */}
      {maskDraft && (
        <PelliculeMaskOverlay
          shape={maskDraft.shape}
          points={maskDraft.points}
          onAddPoint={maskDraft.onAddPoint}
        />
      )}
    </div>
  )
}

// ── Item texte overlay (CSS only — pas de keyframe wrap complexe pour V1) ──

function TextOverlayItem({ overlay }: {
  overlay: {
    text: string
    template: 'fade' | 'typewriter' | 'slide_up'
    position: 'top' | 'center' | 'bottom'
    size: 'sm' | 'md' | 'lg' | 'xl'
  }
}) {
  const fontSize = {
    sm: '0.9rem', md: '1.1rem', lg: '1.4rem', xl: '1.8rem',
  }[overlay.size]
  const verticalAlign: React.CSSProperties = {
    top:    { top: '8%', left: '50%', transform: 'translateX(-50%)' },
    center: { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' },
    bottom: { bottom: '8%', left: '50%', transform: 'translateX(-50%)' },
  }[overlay.position]
  const animClass = {
    fade: 'bp-anim-fade',
    typewriter: 'bp-anim-typewriter',
    slide_up: 'bp-anim-slide-up',
  }[overlay.template]
  return (
    <div
      className={`bp-text-overlay ${animClass}`}
      style={{
        position: 'absolute',
        ...verticalAlign,
        fontSize,
        color: '#fff',
        textShadow: '0 2px 8px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,1)',
        fontWeight: 600,
        textAlign: 'center',
        maxWidth: '80%',
        whiteSpace: 'pre-line',
      }}
    >
      {overlay.text}
    </div>
  )
}
