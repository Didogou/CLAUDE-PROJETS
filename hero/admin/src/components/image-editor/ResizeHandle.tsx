'use client'
/**
 * Poignée de redimensionnement draggable entre deux panneaux.
 *
 * Usage :
 *   <ResizeHandle axis="x" onResize={(delta) => setWidth(w => w + delta)} />
 *
 * Axis :
 *   - 'x' → poignée verticale qu'on glisse horizontalement (redim sidebar/gallery)
 *   - 'y' → poignée horizontale qu'on glisse verticalement (redim gen panel)
 *
 * Comportements :
 *   - Drag live : chaque mouvement envoie un delta (pixels)
 *   - Hover : fond accent léger (feedback visuel)
 *   - Drag actif : fond accent fort
 *   - Double-clic : appelle onDoubleClick si fourni (utile pour toggle replier)
 *   - Curseur adaptatif (col-resize / row-resize)
 *   - Pendant le drag, on pose un overlay body pour éviter que la sélection de
 *     texte parasite le geste et garder le curseur constant sur toute la page.
 */
import React, { useCallback, useRef, useState } from 'react'

export interface ResizeHandleProps {
  axis: 'x' | 'y'
  /** Appelé à chaque mousemove avec le delta depuis le dernier event (en pixels).
   *  Delta positif = la poignée a bougé à droite (x) ou vers le bas (y). */
  onResize: (delta: number) => void
  /** Appelé au relâchement — utile pour appliquer un snap éventuel. */
  onResizeEnd?: () => void
  /** Appelé sur double-clic — pratique pour basculer replier/étendre. */
  onDoubleClick?: () => void
  /** Accessible label. */
  ariaLabel?: string
}

export default function ResizeHandle({ axis, onResize, onResizeEnd, onDoubleClick, ariaLabel }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)
  const lastPos = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    lastPos.current = axis === 'x' ? e.clientX : e.clientY

    function onMove(ev: MouseEvent) {
      const current = axis === 'x' ? ev.clientX : ev.clientY
      const delta = current - lastPos.current
      lastPos.current = current
      if (delta !== 0) onResize(delta)
    }
    function onUp() {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onResizeEnd?.()
    }
    // Verrouille le curseur + empêche la sélection texte pendant le drag
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [axis, onResize, onResizeEnd])

  const isActive = dragging || hovering

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel ?? `Poignée de redimensionnement`}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onDoubleClick={onDoubleClick}
      style={{
        flex: '0 0 auto',
        position: 'relative',
        cursor: axis === 'x' ? 'col-resize' : 'row-resize',
        // Hit zone invisible par défaut (juste pour capturer le hover/drag),
        // teinte rose translucide UNIQUEMENT au hover/drag → pas de bar massive
        background: dragging
          ? 'var(--ie-accent-faint)'
          : hovering
            ? 'rgba(236, 72, 153, 0.06)'
            : 'transparent',
        transition: dragging ? 'none' : 'background 150ms ease-out',
        // Hit zone large (6px) mais visuellement fine via le trait interne
        ...(axis === 'x'
          ? { width: 6, minWidth: 6, marginLeft: -2, marginRight: -2 }
          : { height: 6, minHeight: 6, marginTop: -2, marginBottom: -2 }),
        zIndex: 5,
      }}
    >
      {/* Trait fin centré : 1px gris très discret par défaut, rose au hover/drag */}
      <div
        style={{
          position: 'absolute',
          ...(axis === 'x'
            ? { top: 0, bottom: 0, left: 2.5, width: 1 }
            : { left: 0, right: 0, top: 2.5, height: 1 }),
          background: dragging
            ? 'var(--ie-accent)'
            : hovering
              ? 'var(--ie-accent)'
              : 'var(--ie-border)',
          transition: 'background 150ms ease-out',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
