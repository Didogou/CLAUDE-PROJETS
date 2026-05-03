'use client'
/**
 * Sélecteur de zone par drag d'un rectangle sur une image.
 *
 * Émet un `onBoxChange(box | null)` avec coordonnées en pixels *display*
 * (le parent se charge de la conversion display → natural via ref image).
 *
 * Isolé pour qu'un futur `SAMSelector` (sélection par points) puisse le
 * remplacer sans toucher au flow du composant parent.
 */
import React, { useRef, useState } from 'react'

export interface Box { x: number; y: number; w: number; h: number }

export interface BoxSelectorProps {
  imageUrl: string
  box: Box | null
  onBoxChange: (b: Box | null) => void
  disabled?: boolean
  maxHeight?: string
  /** Attache la ref native <img> (utile au parent pour naturalWidth/Height). */
  imgRefCallback?: (el: HTMLImageElement | null) => void
}

export default function BoxSelector({
  imageUrl, box, onBoxChange, disabled = false, maxHeight = 'calc(95vh - 280px)', imgRefCallback,
}: BoxSelectorProps) {
  const [drag, setDrag] = useState<{ startX: number; startY: number } | null>(null)
  const localRef = useRef<HTMLImageElement | null>(null)

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDrag({ startX: x, startY: y })
    onBoxChange({ x, y, w: 0, h: 0 })
  }
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!drag || disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    onBoxChange({
      x: Math.min(drag.startX, x),
      y: Math.min(drag.startY, y),
      w: Math.abs(x - drag.startX),
      h: Math.abs(y - drag.startY),
    })
  }
  function handleMouseUp() { setDrag(null) }

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ position: 'relative', display: 'inline-block', alignSelf: 'center', maxWidth: '100%', maxHeight, cursor: disabled ? 'wait' : 'crosshair', userSelect: 'none' }}>
      <img
        ref={el => { localRef.current = el; imgRefCallback?.(el) }}
        src={imageUrl}
        alt="source"
        draggable={false}
        style={{ maxWidth: '100%', maxHeight, height: 'auto', display: 'block', borderRadius: '6px', border: '1px solid var(--border)' }}
      />
      {box && (
        <div style={{
          position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
          border: '2px solid #52c484', background: 'rgba(82,196,132,0.15)', pointerEvents: 'none',
        }} />
      )}
    </div>
  )
}
