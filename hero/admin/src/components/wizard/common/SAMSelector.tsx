'use client'
/**
 * Sélecteur de zone par points cliqués (mode SAM 2).
 *
 *   - Clic simple             → point positif (vert, inclus dans la segmentation)
 *   - Shift + clic            → point négatif (rouge, exclu)
 *   - Clic droit sur un point → le supprime
 *
 * Émet `onPointsChange(points[])` avec coordonnées en pixels *display*.
 * Le parent convertit display → natural via ref image lors de l'appel SAM.
 *
 * Interchangeable avec BoxSelector : même prop pour la callback ref image.
 */
import React, { useRef } from 'react'

export interface SAMPoint { x: number; y: number; positive: boolean }

export interface SAMSelectorProps {
  imageUrl: string
  points: SAMPoint[]
  onPointsChange: (pts: SAMPoint[]) => void
  disabled?: boolean
  maxHeight?: string
  imgRefCallback?: (el: HTMLImageElement | null) => void
}

export default function SAMSelector({
  imageUrl, points, onPointsChange, disabled = false, maxHeight = 'calc(95vh - 280px)', imgRefCallback,
}: SAMSelectorProps) {
  const localRef = useRef<HTMLImageElement | null>(null)

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const positive = !e.shiftKey
    onPointsChange([...points, { x, y, positive }])
  }
  function handleRemove(i: number, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    onPointsChange(points.filter((_, j) => j !== i))
  }

  return (
    <div
      onClick={handleClick}
      style={{ position: 'relative', display: 'inline-block', alignSelf: 'center', maxWidth: '100%', maxHeight, cursor: disabled ? 'wait' : 'crosshair', userSelect: 'none' }}>
      <img
        ref={el => { localRef.current = el; imgRefCallback?.(el) }}
        src={imageUrl}
        alt="source"
        draggable={false}
        style={{ maxWidth: '100%', maxHeight, height: 'auto', display: 'block', borderRadius: '6px', border: '1px solid var(--border)' }}
      />
      {points.map((p, i) => (
        <div
          key={i}
          title={`${p.positive ? '✓ Positif' : '✕ Négatif'} — clic droit pour supprimer`}
          onContextMenu={e => handleRemove(i, e)}
          style={{
            position: 'absolute',
            left: p.x - 7,
            top: p.y - 7,
            width: 14, height: 14, borderRadius: '50%',
            background: p.positive ? '#52c484' : '#c94c4c',
            border: '2px solid white',
            boxShadow: '0 0 4px rgba(0,0,0,0.5)',
            pointerEvents: 'auto',
            cursor: 'context-menu',
          }}
        />
      ))}
    </div>
  )
}
