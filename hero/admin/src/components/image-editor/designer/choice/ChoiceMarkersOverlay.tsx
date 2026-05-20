'use client'
/**
 * ChoiceMarkersOverlay — overlay absolu sur le canvas qui rend les markers
 * de choix d'un Plan choix.
 *
 * 2 styles selon `markerStyle` du context :
 *  - 'pin' = pastille numérotée (édition rapide, pas envahissant)
 *  - 'preview' = bouton WYSIWYG style runtime (texte du choix visible)
 *
 * Drag direct : mousedown sur marker → mousemove → moveOption(x,y).
 * Position normalisée 0..1 par rapport à la zone overlay (= canvas zone).
 *
 * Click sans drag = sélection (highlight + focus inspector).
 */

import React, { useRef, useState } from 'react'
import { useChoicePlan } from './ChoicePlanContext'

export default function ChoiceMarkersOverlay() {
  const {
    isPlanChoice, options, sectionChoices,
    moveOption, setSelectedOptionId, selectedOptionId,
    markerStyle,
  } = useChoicePlan()

  const overlayRef = useRef<HTMLDivElement>(null)
  // Track drag pour distinguer drag (move) vs click (select).
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragMovedRef = useRef(false)

  if (!isPlanChoice) return null

  function handleMouseDown(e: React.MouseEvent, optionId: string) {
    e.preventDefault()
    e.stopPropagation()
    setDraggingId(optionId)
    dragMovedRef.current = false
    const startX = e.clientX
    const startY = e.clientY
    const overlay = overlayRef.current
    if (!overlay) return

    function onMove(ev: MouseEvent) {
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) {
        dragMovedRef.current = true
      }
      const rect = overlay!.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const x = (ev.clientX - rect.left) / rect.width
      const y = (ev.clientY - rect.top) / rect.height
      moveOption(optionId, x, y)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Si pas de drag réel → sélection
      if (!dragMovedRef.current) setSelectedOptionId(optionId)
      setDraggingId(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={overlayRef}
      className="dz-choix-overlay"
    >
      {options.map((o, i) => {
        const isSel = selectedOptionId === o.id
        const isDragging = draggingId === o.id
        const left = `${(o.position.x * 100).toFixed(2)}%`
        const top = `${(o.position.y * 100).toFixed(2)}%`

        if (markerStyle === 'pin') {
          return (
            <button
              key={o.id}
              type="button"
              className={`dz-choix-marker dz-choix-marker-pin${isSel ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
              style={{ left, top }}
              onMouseDown={e => handleMouseDown(e, o.id)}
              onClick={e => e.stopPropagation()}
              title={resolveMarkerLabel(o, sectionChoices)}
              aria-label={`Marker ${i + 1}`}
            >
              <span className="dz-choix-marker-num">{i + 1}</span>
            </button>
          )
        }

        // Style 'preview' = bouton WYSIWYG
        return (
          <button
            key={o.id}
            type="button"
            className={`dz-choix-marker dz-choix-marker-preview${isSel ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
            style={{ left, top }}
            onMouseDown={e => handleMouseDown(e, o.id)}
            onClick={e => e.stopPropagation()}
            title="Glisser pour repositionner"
          >
            <span className="dz-choix-marker-preview-num">{i + 1}</span>
            <span className="dz-choix-marker-preview-label">
              {resolveMarkerLabel(o, sectionChoices)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function resolveMarkerLabel(
  o: ReturnType<typeof useChoicePlan>['options'][number],
  sectionChoices: ReturnType<typeof useChoicePlan>['sectionChoices'],
): string {
  if (o.source.kind === 'plan') return o.source.label
  const sourceId = o.source.section_choice_id
  const choice = sectionChoices.find(c => c.id === sourceId)
  if (!choice) return '(choix introuvable)'
  return choice.label.length > 50 ? choice.label.slice(0, 49) + '…' : choice.label
}
