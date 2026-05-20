'use client'
/**
 * CamcorderOverlay — Refonte 2026-05-15bu.
 *
 * Overlay HTML/CSS qui simule un caméscope / caméra de surveillance par
 * dessus n'importe quel canvas vidéo. Affiche :
 *   - Coin TL : "● REC" rouge pulsant
 *   - Coin TR : date + heure (live, mises à jour /1s)
 *   - Coin BL : timecode "HH:MM:SS:FF" synced sur video.currentTime
 *   - Coin BR : "BAT 87%" (statique pour V1, animable plus tard)
 *   - Overlay scanlines CSS (= lignes horizontales fines transparentes)
 *   - Bande de tracking VHS qui slide verticalement (pseudo-element animé)
 *
 * Usage : à wrap autour ou par dessus un VideoEffectsCanvas / <video>. Le
 * parent doit être `position: relative`. Toutes les props sont optionnelles
 * pour un usage standalone, mais `videoEl` (HTMLVideoElement ref) permet de
 * synchroniser le timecode sur la lecture réelle.
 */

import React, { useEffect, useState, useRef } from 'react'

interface CamcorderOverlayProps {
  enabled: boolean
  /** Élément vidéo source pour synchroniser le timecode. */
  videoEl?: HTMLVideoElement | null
  /** Frame rate (default 25fps) — pour calculer les frames du timecode. */
  fps?: number
  /** Format date affichée. Default "DD/MM/YYYY". */
  dateFormat?: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY'
  /** Texte custom du coin TL (default "● REC"). */
  recLabel?: string
  /** Niveau batterie 0-100 (default 87). null = cache l'indicateur. */
  battery?: number | null
  /** Affiche/cache les scanlines CSS (default true). */
  showScanlines?: boolean
  /** Affiche/cache la bande de tracking VHS (default true). */
  showTracking?: boolean
}

function formatDate(d: Date, format: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY') {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  if (format === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`
  if (format === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`
  return `${dd}/${mm}/${yyyy}`
}

function formatTime(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatTimecode(seconds: number, fps: number): string {
  const total = Math.max(0, seconds)
  const hh = String(Math.floor(total / 3600)).padStart(2, '0')
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(Math.floor(total % 60)).padStart(2, '0')
  const ff = String(Math.floor((total - Math.floor(total)) * fps)).padStart(2, '0')
  return `${hh}:${mm}:${ss}:${ff}`
}

export default function CamcorderOverlay({
  enabled, videoEl, fps = 25, dateFormat = 'DD/MM/YYYY',
  recLabel = '● REC', battery = 87,
  showScanlines = true, showTracking = true,
}: CamcorderOverlayProps) {
  const [now, setNow] = useState(() => new Date())
  const [tcSec, setTcSec] = useState(0)
  const rafRef = useRef<number>(0)

  // Met à jour la date/heure 1× par seconde
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [enabled])

  // Met à jour le timecode synced sur video.currentTime via rAF (smooth 60Hz)
  useEffect(() => {
    if (!enabled || !videoEl) return
    function tick() {
      if (videoEl) setTcSec(videoEl.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [enabled, videoEl])

  if (!enabled) return null

  return (
    <div className="cco-root" aria-hidden>
      {/* Coin haut-gauche : REC pulsant */}
      <div className="cco-corner cco-tl">
        <span className="cco-rec">{recLabel}</span>
      </div>

      {/* Coin haut-droit : date + heure */}
      <div className="cco-corner cco-tr">
        <div>{formatDate(now, dateFormat)}</div>
        <div>{formatTime(now)}</div>
      </div>

      {/* Coin bas-gauche : timecode video */}
      <div className="cco-corner cco-bl">
        TC {formatTimecode(tcSec, fps)}
      </div>

      {/* Coin bas-droit : batterie */}
      {battery !== null && (
        <div className="cco-corner cco-br">
          BAT {Math.round(battery)}%
        </div>
      )}

      {/* Scanlines (effet écran cathodique) */}
      {showScanlines && <div className="cco-scanlines" />}

      {/* Bande tracking VHS qui slide verticalement */}
      {showTracking && <div className="cco-tracking" />}

      <style jsx>{`
        .cco-root {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 10;
          font-family: 'Courier New', 'Consolas', monospace;
          font-weight: 700;
          color: #fff;
          text-shadow: 0 0 0.3rem rgba(0, 0, 0, 0.9), 0 0 0.15rem rgba(0, 0, 0, 0.9);
        }
        .cco-corner {
          position: absolute;
          padding: 0.4rem 0.7rem;
          font-size: 0.85rem;
          line-height: 1.2;
          letter-spacing: 0.05em;
        }
        .cco-tl { top: 0; left: 0; }
        .cco-tr { top: 0; right: 0; text-align: right; }
        .cco-bl { bottom: 0; left: 0; }
        .cco-br { bottom: 0; right: 0; }

        .cco-rec {
          color: #ff2d2d;
          text-shadow: 0 0 0.5rem rgba(255, 45, 45, 0.6), 0 0 0.3rem rgba(0, 0, 0, 0.9);
          animation: cco-rec-blink 1.2s steps(2, end) infinite;
        }
        @keyframes cco-rec-blink {
          0%, 50%   { opacity: 1; }
          50.01%, 100% { opacity: 0.25; }
        }

        .cco-scanlines {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0) 0,
            rgba(0, 0, 0, 0) 2px,
            rgba(0, 0, 0, 0.18) 3px,
            rgba(0, 0, 0, 0) 4px
          );
          mix-blend-mode: multiply;
          pointer-events: none;
        }

        .cco-tracking {
          position: absolute;
          left: 0;
          right: 0;
          height: 0.5rem;
          background: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.06) 30%,
            rgba(255, 255, 255, 0.12) 50%,
            rgba(255, 255, 255, 0.06) 70%,
            rgba(255, 255, 255, 0) 100%
          );
          mix-blend-mode: screen;
          animation: cco-tracking-slide 8s linear infinite;
          pointer-events: none;
        }
        @keyframes cco-tracking-slide {
          0%   { top: -2%; }
          100% { top: 102%; }
        }
      `}</style>
    </div>
  )
}
