'use client'
/**
 * AnimationStudioLightbox — overlay plein écran pour visionner une pellicule.
 *
 * Palier C (2026-05-07) :
 *   - Ouvert depuis click vignette timeline OU bouton plein écran preview
 *   - Vidéo centrée, max 92vh × 92vw, aspect-ratio préservé
 *   - Contrôles : play/pause + barre de progression scrubbable + temps
 *   - Fermeture : Échap, click backdrop, bouton X
 *   - Si pas de vidéo générée → affiche poster + message "À générer"
 *
 * Foundation pour Palier D (pan-and-scan) : la zone vidéo expose son ref
 * pour permettre l'overlay des handles de crop par device en surimpression.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, X, Crop } from 'lucide-react'
import type { AnimationPellicule, Shot } from '@/components/image-editor/EditorStateContext'
import AnimationStudioCropEditor from './AnimationStudioCropEditor'

interface AnimationStudioLightboxProps {
  open: boolean
  pellicule: AnimationPellicule | null
  baseImageUrl: string | null
  onClose: () => void
  /** Patch un shot — utilisé en mode Cadrage pour persister cropKeyframes.
   *  Si absent, le bouton "Cadrage" est masqué (mode lecture seule). */
  onUpdateShot?: (shotId: string, patch: Partial<Shot>) => void
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function AnimationStudioLightbox({
  open, pellicule, baseImageUrl, onClose, onUpdateShot,
}: AnimationStudioLightboxProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  /** True pendant un drag de la barre — on suspend la sync onTimeUpdate
   *  pour ne pas faire sauter le pouce pendant le scrub. */
  const [scrubbing, setScrubbing] = useState(false)
  /** Mode Cadrage (Palier D) : pause la vidéo, overlay éditeur de crop
   *  par device sur le shot[0] de la pellicule. */
  const [cropMode, setCropMode] = useState(false)
  /** videoWidth/Height naturels de la source vidéo, pour calculer l'aspect
   *  exact (≠ aspect display si le navigateur applique du letterbox).
   *  Aussi affiché à l'auteur en mode Cadrage pour qu'il sache la résolution
   *  réelle de sa vidéo source. */
  const [videoAspect, setVideoAspect] = useState<number | null>(null)
  const [videoResolution, setVideoResolution] = useState<{ w: number; h: number } | null>(null)

  const sourceUrl = pellicule?.videoUrl ?? null
  const posterUrl = pellicule?.firstFrameUrl ?? baseImageUrl ?? null
  const editableShot = pellicule?.shots[0] ?? null

  /** Reset internal state quand on ferme/change de pellicule. */
  useEffect(() => {
    if (!open) {
      const v = videoRef.current
      if (v) { v.pause(); v.currentTime = 0 }
      setPlaying(false)
      setCurrentTime(0)
      setCropMode(false)
    }
  }, [open, pellicule?.id])

  /** En mode Cadrage V2 (Palier D 2026-05-08), on NE pause PAS la vidéo —
   *  l'auteur a besoin de scrub/play pour positionner ses keyframes le long
   *  de la séquence (effet travelling). La rect interpole en live entre les
   *  keyframes pendant la lecture. */

  /** Échap ferme le lightbox — sauf en cropMode (modal verrouillé). */
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (cropMode) return  // modal lock en cadrage
        onClose()
      } else if (e.key === ' ') {
        // Espace = toggle play, sauf si focus sur un input (range, etc.)
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
        e.preventDefault()
        handleTogglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cropMode])

  const handleTogglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { void v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }, [])

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current
    const t = parseFloat(e.target.value)
    setCurrentTime(t)
    if (v) v.currentTime = t
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="as-lightbox-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => {
            // Click direct sur le backdrop (pas sur un enfant) → ferme.
            // EXCEPTION en mode cadrage : on lock le modal pour éviter une
            // fermeture accidentelle pendant l'édition des keyframes (drag
            // souris qui déborde de la zone d'édition).
            if (cropMode) return
            if (e.target === e.currentTarget) onClose()
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu plein écran"
        >
          <motion.div
            className={`as-lightbox ${cropMode ? 'crop-mode' : ''}`}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <button
              type="button"
              className="as-lightbox-close"
              onClick={onClose}
              title="Fermer (Échap)"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>

            <div className="as-lightbox-stage">
              {sourceUrl ? (
                <video
                  ref={videoRef}
                  src={sourceUrl}
                  poster={posterUrl ?? undefined}
                  playsInline
                  onLoadedMetadata={(e) => {
                    setDuration(e.currentTarget.duration)
                    const w = e.currentTarget.videoWidth
                    const h = e.currentTarget.videoHeight
                    if (w > 0 && h > 0) {
                      setVideoAspect(w / h)
                      setVideoResolution({ w, h })
                    }
                  }}
                  onTimeUpdate={(e) => {
                    if (!scrubbing) setCurrentTime(e.currentTarget.currentTime)
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onClick={cropMode ? undefined : handleTogglePlay}
                />
              ) : posterUrl ? (
                <div className="as-lightbox-poster-wrap">
                  <img src={posterUrl} alt="Aperçu" />
                  <div className="as-lightbox-empty-overlay">
                    Cette pellicule n&apos;est pas encore générée
                  </div>
                </div>
              ) : (
                <div className="as-lightbox-empty">Aucune image disponible</div>
              )}

              {/* Crop overlay (Palier D) : couvre la stage avec un éditeur
               *  par-dessus la vidéo. Activé via le bouton Cadrage. */}
              {cropMode && sourceUrl && editableShot && videoAspect && onUpdateShot && (
                <div className="as-lightbox-crop-overlay">
                  <AnimationStudioCropEditor
                    shot={editableShot}
                    videoAspect={videoAspect}
                    videoResolution={videoResolution ?? undefined}
                    videoUrl={sourceUrl}
                    posterUrl={posterUrl}
                    currentTime={currentTime}
                    playing={playing}
                    duration={duration}
                    onSeek={(t) => {
                      const v = videoRef.current
                      if (v) v.currentTime = t
                      setCurrentTime(t)
                    }}
                    onChange={(cropKeyframes) =>
                      onUpdateShot(editableShot.id, { cropKeyframes })
                    }
                  />
                </div>
              )}
            </div>

            {/* Controls : play/scrub TOUJOURS disponibles. En mode Cadrage on
             *  ajoute le bouton "Quitter" à droite ; sinon on ajoute "Cadrage". */}
            {sourceUrl && (
              <div className="as-lightbox-controls">
                <button
                  type="button"
                  className="as-lightbox-play-btn"
                  onClick={handleTogglePlay}
                  title={playing ? 'Pause (Espace)' : 'Jouer (Espace)'}
                  aria-label={playing ? 'Pause' : 'Jouer'}
                >
                  {playing ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <span className="as-lightbox-time">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  className="as-lightbox-scrub"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={currentTime}
                  onChange={handleScrub}
                  onMouseDown={() => setScrubbing(true)}
                  onMouseUp={() => setScrubbing(false)}
                  onTouchStart={() => setScrubbing(true)}
                  onTouchEnd={() => setScrubbing(false)}
                  aria-label="Position dans la vidéo"
                />
                <span className="as-lightbox-time">{formatTime(duration)}</span>
                {!cropMode && onUpdateShot && editableShot && videoAspect && (
                  <button
                    type="button"
                    className="as-lightbox-crop-btn"
                    onClick={() => setCropMode(true)}
                    title="Définir le cadrage par device (mobile/tablette)"
                  >
                    <Crop size={14} />
                    <span>Cadrage</span>
                  </button>
                )}
                {cropMode && (
                  <button
                    type="button"
                    className="as-lightbox-crop-back"
                    onClick={() => setCropMode(false)}
                    title="Quitter le mode cadrage"
                  >
                    <X size={14} />
                    <span>Quitter cadrage</span>
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
