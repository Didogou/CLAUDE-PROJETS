'use client'
/**
 * PelliculeMaskOverlay — overlay de dessin de mask au-dessus d'une pellicule.
 *
 * Phase A.5 keyframes chantier 2026-05-18.
 *
 * Affiché au-dessus de la pellicule (donc au-dessus des calques runtime + text
 * overlays) quand l'auteur entre en mode "Définir mask". Capture les clicks,
 * convertit en coords % du canvas, accumule les points, et émet les events :
 *   - onAddPoint([x%, y%])    à chaque click
 *   - onFinish()              quand l'auteur valide (déclenché côté panel via
 *                             le bouton Terminer, pas ici — l'overlay est juste
 *                             la zone de capture clicks + rendu visuel)
 *   - onCancel()              idem, déclenché côté panel
 *
 * Rendu visuel :
 *   - cursor crosshair sur l'overlay
 *   - cercles aux points placés
 *   - lignes entre points (preview de la forme finale)
 *   - rect ou polygon fermé selon shape
 *   - hint texte en bas ("Clique pour ajouter un point — Terminer dans le panel")
 */

import React from 'react'

interface PelliculeMaskOverlayProps {
  shape: 'rect' | 'polygon'
  points: Array<[number, number]>  // % canvas, accumulés au fil des clicks
  onAddPoint: (point: [number, number]) => void
}

export default function PelliculeMaskOverlay({
  shape, points, onAddPoint,
}: PelliculeMaskOverlayProps) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    // Clamp [0, 100]
    const x = Math.max(0, Math.min(100, xPct))
    const y = Math.max(0, Math.min(100, yPct))
    onAddPoint([x, y])
  }

  // Pour rect avec 2 points cliqués, on visualise déjà le rectangle final
  // (4 coins) ; sinon polygone open des points cliqués + ligne vers le 1er.
  const displayPoints = (() => {
    if (shape === 'rect' && points.length === 2) {
      const [[x1, y1], [x2, y2]] = points
      const xMin = Math.min(x1, x2), xMax = Math.max(x1, x2)
      const yMin = Math.min(y1, y2), yMax = Math.max(y1, y2)
      return [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]] as Array<[number, number]>
    }
    return points
  })()

  // Build SVG path : ferme la forme uniquement si on a assez de points
  const minClosed = shape === 'rect' ? 4 : 3
  const closed = displayPoints.length >= minClosed
  const pathD = displayPoints.length > 0
    ? `M ${displayPoints.map(([x, y]) => `${x},${y}`).join(' L ')}${closed ? ' Z' : ''}`
    : ''

  const hint = shape === 'rect'
    ? (points.length === 0 ? 'Clique le 1er coin du rectangle' :
       points.length === 1 ? 'Clique le coin opposé' :
       'Rectangle défini — Terminer dans le panel pour appliquer')
    : (points.length < 3 ? `Polygone : ${points.length} point${points.length > 1 ? 's' : ''} — clique pour ajouter (min 3)` :
       `Polygone : ${points.length} points — clique pour ajouter ou Terminer dans le panel`)

  return (
    <div
      className="bp-mask-overlay"
      onClick={handleClick}
      role="presentation"
    >
      {/* SVG overlay viewBox 0-100 pour mapper directement les % */}
      <svg
        className="bp-mask-overlay-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {pathD && (
          <path
            d={pathD}
            fill="rgba(236, 72, 153, 0.18)"
            stroke="#ec4899"
            strokeWidth="0.4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {displayPoints.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="0.8"
            fill="#ec4899"
            stroke="#fff"
            strokeWidth="0.3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="bp-mask-overlay-hint">{hint}</div>
    </div>
  )
}
