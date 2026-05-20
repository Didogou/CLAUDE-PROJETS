'use client'
/**
 * WeatherZoneRectEditor — overlay interactif drag pour définir un rectangle
 * de zone météo (mode 'rect'). Refonte 2026-05-15di — M3 zones.
 *
 * Monté sur le preview-box quand l'auteur clique "Définir zone" sur un effet
 * weather. Coordonnées normalisées 0-1 (x1, y1, x2, y2). Au mouseup, commit.
 * Pendant le drag : preview live du rectangle pointillé.
 *
 * Visualisation aussi du rect existant (outline permanent) si fourni — utile
 * pour que l'auteur voie où la pluie tombe même hors mode édition.
 */

import React, { useEffect, useRef, useState } from 'react'

export interface ZoneRect {
  x1: number; y1: number; x2: number; y2: number
}

interface WeatherZoneRectEditorProps {
  /** Mode : 'editing' = drag actif (overlay grisé + crosshair) ;
   *  'view' = juste outline permanent du rect committed (si présent). */
  mode: 'editing' | 'view'
  /** Rect actuellement committed (visualisé en outline). */
  committedRect?: ZoneRect | null
  /** Couleur d'accent (default bleu météo). */
  accent?: string
  /** Callback quand l'auteur termine le drag (mouseup). x1<x2, y1<y2 garantis. */
  onCommit?: (rect: ZoneRect) => void
  /** Callback annulation (Escape ou click "Annuler"). */
  onCancel?: () => void
}

export default function WeatherZoneRectEditor({
  mode, committedRect, accent = '#60A5FA', onCommit, onCancel,
}: WeatherZoneRectEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [draftRect, setDraftRect] = useState<ZoneRect | null>(null)
  const draggingRef = useRef<{ startX: number; startY: number } | null>(null)

  // Escape pour annuler en mode editing
  useEffect(() => {
    if (mode !== 'editing') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onCancel])

  function pointNorm(ev: React.PointerEvent | PointerEvent): { x: number; y: number } | null {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const x = (ev.clientX - rect.left) / rect.width
    const y = (ev.clientY - rect.top) / rect.height
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
  }

  function handlePointerDown(ev: React.PointerEvent) {
    if (mode !== 'editing') return
    ev.preventDefault()
    const p = pointNorm(ev)
    if (!p) return
    draggingRef.current = { startX: p.x, startY: p.y }
    setDraftRect({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    ;(ev.target as Element).setPointerCapture?.(ev.pointerId)
  }

  function handlePointerMove(ev: React.PointerEvent) {
    if (!draggingRef.current) return
    const p = pointNorm(ev)
    if (!p) return
    const start = draggingRef.current
    setDraftRect({
      x1: Math.min(start.startX, p.x),
      y1: Math.min(start.startY, p.y),
      x2: Math.max(start.startX, p.x),
      y2: Math.max(start.startY, p.y),
    })
  }

  function handlePointerUp() {
    const r = draftRect
    draggingRef.current = null
    if (r && (r.x2 - r.x1) > 0.01 && (r.y2 - r.y1) > 0.01) {
      onCommit?.(r)
    }
    setDraftRect(null)
  }

  // Affichage : rect en cours de drag prend précédence sur le committed
  const displayRect = draftRect ?? committedRect ?? null
  const editing = mode === 'editing'

  return (
    <div
      ref={containerRef}
      className="efx-zone-editor"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'absolute', inset: 0, zIndex: 25,
        cursor: editing ? 'crosshair' : 'default',
        pointerEvents: editing ? 'auto' : 'none',
        background: editing ? 'rgba(0, 0, 0, 0.25)' : 'transparent',
      }}
    >
      {displayRect && (
        <div
          className="efx-zone-rect"
          style={{
            position: 'absolute',
            left: `${(displayRect.x1 * 100).toFixed(2)}%`,
            top: `${(displayRect.y1 * 100).toFixed(2)}%`,
            width: `${((displayRect.x2 - displayRect.x1) * 100).toFixed(2)}%`,
            height: `${((displayRect.y2 - displayRect.y1) * 100).toFixed(2)}%`,
            border: `0.125rem dashed ${accent}`,
            background: editing ? 'rgba(96, 165, 250, 0.05)' : 'transparent',
            boxShadow: `0 0 0.4rem ${accent}80`,
            pointerEvents: 'none',
          }}
        />
      )}
      {editing && (
        <div
          className="efx-zone-hint"
          style={{
            position: 'absolute', top: '0.5rem', left: '50%',
            transform: 'translateX(-50%)',
            padding: '0.4rem 0.85rem',
            background: 'rgba(0, 0, 0, 0.78)',
            color: '#fff', fontSize: '0.78rem', fontWeight: 500,
            borderRadius: '0.3rem',
            pointerEvents: 'none',
            border: `0.0625rem solid ${accent}`,
          }}
        >
          Glisse pour définir la zone — Échap pour annuler
        </div>
      )}
    </div>
  )
}
