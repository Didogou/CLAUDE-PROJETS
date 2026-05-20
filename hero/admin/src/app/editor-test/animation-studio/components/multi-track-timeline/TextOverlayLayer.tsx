'use client'
/**
 * TextOverlayLayer — rend les textes overlay par-dessus une vidéo/image en
 * cours de lecture, avec animations CSS selon le template.
 *
 * 3 templates V1 (Phase 3 2026-05-12) :
 *   - fade        : opacity 0→1 (250ms) → reste → 1→0 (250ms)
 *   - typewriter  : caractères apparaissent un par un (60ms/char)
 *   - slide_up    : translateY(20px) opacity 0 → 0 + opacity 1
 *
 * Le composant lit `currentTimeSec` (ms par 1000) et active/anime chaque
 * overlay selon sa fenêtre [startSec, startSec + durationSec].
 *
 * Réutilisable :
 *   - Aperçu Designer (preview pendant édition)
 *   - Renderer player du livre joué
 */

import React from 'react'
import type { TextOverlayData } from '@/components/image-editor/EditorStateContext'
import './text-overlay-layer.css'

interface TextOverlayLayerProps {
  /** Liste des overlays à rendre. Filtrés selon currentTimeSec en interne. */
  overlays: TextOverlayData[]
  /** Position de lecture courante en SECONDES (relatif au shot/pellicule
   *  dans lequel ces overlays vivent). */
  currentTimeSec: number
}

export default function TextOverlayLayer({ overlays, currentTimeSec }: TextOverlayLayerProps) {
  // Filtre actif : overlay visible si currentTime ∈ [startSec, startSec + durationSec]
  const active = overlays.filter(o =>
    currentTimeSec >= o.startSec && currentTimeSec < o.startSec + o.durationSec,
  )
  if (active.length === 0) return null

  return (
    <div className="tol-root" aria-hidden>
      {active.map(o => (
        <OverlayItem key={o.id} overlay={o} currentTimeSec={currentTimeSec} />
      ))}
    </div>
  )
}

interface OverlayItemProps {
  overlay: TextOverlayData
  currentTimeSec: number
}

function OverlayItem({ overlay, currentTimeSec }: OverlayItemProps) {
  const elapsed = currentTimeSec - overlay.startSec
  const remaining = overlay.startSec + overlay.durationSec - currentTimeSec

  // Calcul opacité selon template
  let opacity = 1
  let transformY = '0'
  let visibleText = overlay.text

  switch (overlay.template) {
    case 'fade': {
      const fadeIn = 0.25  // 250ms
      const fadeOut = 0.25
      if (elapsed < fadeIn) opacity = elapsed / fadeIn
      else if (remaining < fadeOut) opacity = Math.max(0, remaining / fadeOut)
      break
    }
    case 'slide_up': {
      const slideIn = 0.4
      if (elapsed < slideIn) {
        const progress = elapsed / slideIn
        opacity = progress
        transformY = `${(1 - progress) * 20}px`
      } else if (remaining < 0.25) {
        opacity = Math.max(0, remaining / 0.25)
      }
      break
    }
    case 'typewriter': {
      const charsPerSec = 1000 / 60  // 60ms par char
      const charsToShow = Math.min(overlay.text.length, Math.floor(elapsed * charsPerSec))
      visibleText = overlay.text.slice(0, charsToShow)
      // Fade out à la fin
      if (remaining < 0.25) opacity = Math.max(0, remaining / 0.25)
      break
    }
  }

  return (
    <div
      className={`tol-item tol-pos-${overlay.position} tol-size-${overlay.size}`}
      style={{
        opacity,
        transform: `translateY(${transformY})`,
      }}
    >
      {visibleText}
      {overlay.template === 'typewriter' && visibleText.length < overlay.text.length && (
        <span className="tol-cursor">▍</span>
      )}
    </div>
  )
}
