'use client'
/**
 * VideoCutModal — modal frame-by-frame pour couper une vidéo (cut range) ou
 * splitter en 2 pellicules distinctes.
 *
 * Refonte 2026-05-19.
 *
 * Pipeline :
 * 1. User ouvre la modal (toolbar Animation → Couper sur une pellicule)
 * 2. Vidéo chargée en HTML5 <video>, currentTime stepping ±1/30s via flèches
 * 3. User choisit mode CUT (2 marqueurs start+end) ou SPLIT (1 marqueur)
 * 4. Click Appliquer → ffmpeg.wasm cut/split → Blob(s) résultat
 * 5. Callback `onApply(result)` au parent qui upload + persiste
 *
 * La modal est UI-only : elle ne sait rien de Supabase ni de la DB. Le parent
 * (page.tsx) wire le upload + POST asset + update timeline.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Scissors, Play, Pause, X, Loader2, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { cutRange, splitAt, type VideoCutProgress } from '@/lib/video-cut'

export type CutMode = 'cut' | 'split'

export interface CutResult {
  mode: 'cut'
  blob: Blob
  /** Range coupé (start/end en secondes), informatif. */
  cutRange: { startSec: number; endSec: number }
}
export interface SplitResult {
  mode: 'split'
  partA: Blob
  partB: Blob
  splitSec: number
}
export type VideoCutResult = CutResult | SplitResult

interface VideoCutModalProps {
  open: boolean
  videoUrl: string | null
  /** Titre informatif (ex: nom de la pellicule). */
  title?: string
  onClose: () => void
  /** Appelé après ffmpeg, avant fermeture. Le parent upload + persiste. */
  onApply: (result: VideoCutResult) => Promise<void> | void
}

/** Step frame ~1/30s. La majorité des vidéos LTX Hero sont 24-30 fps. */
const FRAME_STEP = 1 / 30

export default function VideoCutModal({ open, videoUrl, title, onClose, onApply }: VideoCutModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [mode, setMode] = useState<CutMode>('cut')
  // Cut : 2 marqueurs (start, end). Split : 1 marqueur (split).
  const [cutStartSec, setCutStartSec] = useState(0)
  const [cutEndSec, setCutEndSec] = useState(0)
  const [splitSec, setSplitSec] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<VideoCutProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reset state à chaque ouverture (videoUrl change OU open passe à true).
  useEffect(() => {
    if (!open || !videoUrl) return
    setCurrentTime(0)
    setIsPlaying(false)
    setMode('cut')
    setCutStartSec(0)
    setCutEndSec(0)
    setSplitSec(0)
    setProcessing(false)
    setProgress(null)
    setError(null)
  }, [open, videoUrl])

  // Init markers when duration known.
  useEffect(() => {
    if (duration > 0 && cutEndSec === 0) {
      // Default : on prépose un cut de 1s au milieu, split à mi-vidéo.
      const mid = duration / 2
      setCutStartSec(Math.max(0, mid - 0.5))
      setCutEndSec(Math.min(duration, mid + 0.5))
      setSplitSec(mid)
    }
  }, [duration, cutEndSec])

  // Sync video currentTime → state (50ms throttled via timeupdate).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrentTime(v.currentTime)
    const onLoaded = () => setDuration(v.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [videoUrl])

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    if (!v) return
    const clamped = Math.max(0, Math.min(duration, t))
    v.currentTime = clamped
    setCurrentTime(clamped)
  }, [duration])

  const stepFrame = useCallback((dir: -1 | 1) => {
    seek(currentTime + dir * FRAME_STEP)
  }, [currentTime, seek])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }, [])

  // Keyboard shortcuts : ←/→ frame step, space play/pause, esc close.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1) }
      else if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if (e.key === 'Escape' && !processing) { onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, stepFrame, togglePlay, onClose, processing])

  const setCutMarker = useCallback((which: 'start' | 'end') => {
    if (which === 'start') setCutStartSec(currentTime)
    else setCutEndSec(currentTime)
  }, [currentTime])
  const setSplitMarker = useCallback(() => {
    setSplitSec(currentTime)
  }, [currentTime])

  const canApply = (() => {
    if (!videoUrl || processing) return false
    if (mode === 'cut') return cutEndSec > cutStartSec + 0.05
    return splitSec > 0.05 && splitSec < duration - 0.05
  })()

  const handleApply = useCallback(async () => {
    if (!videoUrl || !canApply) return
    setProcessing(true); setError(null)
    try {
      if (mode === 'cut') {
        const blob = await cutRange(videoUrl, cutStartSec, cutEndSec, {
          onProgress: setProgress,
        })
        await onApply({ mode: 'cut', blob, cutRange: { startSec: cutStartSec, endSec: cutEndSec } })
      } else {
        const [partA, partB] = await splitAt(videoUrl, splitSec, {
          onProgress: setProgress,
        })
        await onApply({ mode: 'split', partA, partB, splitSec })
      }
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[VideoCutModal] apply failed:', msg)
      setError(msg)
    } finally {
      setProcessing(false)
      setProgress(null)
    }
  }, [mode, videoUrl, cutStartSec, cutEndSec, splitSec, canApply, onApply, onClose])

  if (!open || !videoUrl) return null

  const fmt = (s: number) => `${s.toFixed(2)}s`

  return (
    <div className="vcm-backdrop" onClick={() => !processing && onClose()}>
      <div className="vcm-modal" onClick={e => e.stopPropagation()}>
        <div className="vcm-header">
          <div className="vcm-title">
            <Scissors size={14} />
            <span>{title ?? 'Couper la pellicule'}</span>
          </div>
          <button
            type="button"
            className="vcm-close"
            onClick={onClose}
            disabled={processing}
            aria-label="Fermer"
            title="Fermer (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        <div className="vcm-body">
          <div className="vcm-player">
            <video
              ref={videoRef}
              src={videoUrl}
              className="vcm-video"
              preload="auto"
              playsInline
              onClick={togglePlay}
            />
            <div className="vcm-time-overlay">
              {fmt(currentTime)} / {fmt(duration)}
            </div>
          </div>

          <div className="vcm-controls">
            <button type="button" className="vcm-ctrl-btn" onClick={() => seek(0)} title="Début" disabled={processing}>
              <ChevronsLeft size={14} />
            </button>
            <button type="button" className="vcm-ctrl-btn" onClick={() => stepFrame(-1)} title="Frame précédente (←)" disabled={processing}>
              <ChevronLeft size={14} />
            </button>
            <button type="button" className="vcm-ctrl-btn vcm-ctrl-play" onClick={togglePlay} title="Play/Pause (Espace)" disabled={processing}>
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button type="button" className="vcm-ctrl-btn" onClick={() => stepFrame(1)} title="Frame suivante (→)" disabled={processing}>
              <ChevronRight size={14} />
            </button>
            <button type="button" className="vcm-ctrl-btn" onClick={() => seek(duration)} title="Fin" disabled={processing}>
              <ChevronsRight size={14} />
            </button>
            <input
              type="range"
              min={0}
              max={duration}
              step={FRAME_STEP}
              value={currentTime}
              onChange={e => seek(parseFloat(e.target.value))}
              className="vcm-scrubber"
              disabled={processing}
            />
          </div>

          {/* Mode tabs */}
          <div className="vcm-mode-row">
            <button
              type="button"
              className={`vcm-mode-btn ${mode === 'cut' ? 'is-active' : ''}`}
              onClick={() => setMode('cut')}
              disabled={processing}
            >
              ✂ Couper un range
            </button>
            <button
              type="button"
              className={`vcm-mode-btn ${mode === 'split' ? 'is-active' : ''}`}
              onClick={() => setMode('split')}
              disabled={processing}
            >
              ⫶ Splitter en 2
            </button>
          </div>

          {/* Markers row : différent selon mode */}
          {mode === 'cut' ? (
            <div className="vcm-markers">
              <div className="vcm-marker-block">
                <span className="vcm-marker-label">Début du cut</span>
                <span className="vcm-marker-value">{fmt(cutStartSec)}</span>
                <button type="button" className="vcm-marker-btn" onClick={() => setCutMarker('start')} disabled={processing}>
                  Marquer ici
                </button>
                <button type="button" className="vcm-marker-btn vcm-marker-btn-ghost" onClick={() => seek(cutStartSec)} disabled={processing} title="Aller au marqueur">
                  →
                </button>
              </div>
              <div className="vcm-marker-block">
                <span className="vcm-marker-label">Fin du cut</span>
                <span className="vcm-marker-value">{fmt(cutEndSec)}</span>
                <button type="button" className="vcm-marker-btn" onClick={() => setCutMarker('end')} disabled={processing}>
                  Marquer ici
                </button>
                <button type="button" className="vcm-marker-btn vcm-marker-btn-ghost" onClick={() => seek(cutEndSec)} disabled={processing} title="Aller au marqueur">
                  →
                </button>
              </div>
              <div className="vcm-marker-summary">
                Segment supprimé : <strong>{fmt(cutEndSec - cutStartSec)}</strong> · résultat ~ <strong>{fmt(duration - (cutEndSec - cutStartSec))}</strong>
              </div>
            </div>
          ) : (
            <div className="vcm-markers">
              <div className="vcm-marker-block">
                <span className="vcm-marker-label">Point de split</span>
                <span className="vcm-marker-value">{fmt(splitSec)}</span>
                <button type="button" className="vcm-marker-btn" onClick={setSplitMarker} disabled={processing}>
                  Marquer ici
                </button>
                <button type="button" className="vcm-marker-btn vcm-marker-btn-ghost" onClick={() => seek(splitSec)} disabled={processing} title="Aller au marqueur">
                  →
                </button>
              </div>
              <div className="vcm-marker-summary">
                Partie A : <strong>0 → {fmt(splitSec)}</strong> · Partie B : <strong>{fmt(splitSec)} → {fmt(duration)}</strong>
              </div>
            </div>
          )}

          {processing && progress && (
            <div className="vcm-progress">
              <Loader2 size={12} className="vcm-spin" />
              <span>{progress.label ?? 'Traitement…'}</span>
            </div>
          )}
          {error && (
            <div className="vcm-error">⚠ {error}</div>
          )}
        </div>

        <div className="vcm-footer">
          <button
            type="button"
            className="vcm-btn vcm-btn-ghost"
            onClick={onClose}
            disabled={processing}
          >
            Annuler
          </button>
          <button
            type="button"
            className="vcm-btn vcm-btn-primary"
            onClick={() => void handleApply()}
            disabled={!canApply}
          >
            {processing
              ? <><Loader2 size={12} className="vcm-spin" /> Traitement…</>
              : mode === 'cut' ? 'Couper' : 'Splitter'}
          </button>
        </div>
      </div>
    </div>
  )
}
