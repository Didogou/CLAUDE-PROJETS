'use client'
/**
 * PelliculeLayerRenderer — rendu runtime d'un calque (image/video/gif) au-dessus
 * d'une pellicule. Phase A keyframes chantier 2026-05-18.
 *
 * Reçoit 1 row pellicule_layers (table 088), génère le markup CSS approprié :
 *   - position absolue ancrée par le CENTRE du calque (translate(-50%,-50%))
 *   - transform : scale + rotate
 *   - opacity + mix-blend-mode + z-index
 *   - mask via clip-path (rect = 4 points TL/TR/BR/BL, polygon = N points)
 *   - effets via filter : drop-shadow (glow + shadow) + blur
 *
 * Pas de re-fetch ni de state interne — purement présentationnel.
 * Le parent (PelliculeRenderer) lui passe les rows directement.
 */

import React from 'react'
import type {
  PelliculeLayerRow,
  PelliculeLayerEffects,
  PelliculeLayerMask,
} from '@/lib/pellicule-layers-types'

interface PelliculeLayerRendererProps {
  layer: PelliculeLayerRow
  /** Phase A bis.6 — cursor relatif à la pellicule (ms). Si fourni, on gate
   *  l'affichage selon start_ms_rel + duration_ms du calque. Si non fourni,
   *  toujours visible (back-compat). */
  cursorRelMs?: number
}

export default function PelliculeLayerRenderer({ layer, cursorRelMs }: PelliculeLayerRendererProps) {
  if (!layer.visible || !layer.media_url) return null
  // Phase A bis.6 — gate temporel : calque visible UNIQUEMENT entre
  // [start_ms_rel, start_ms_rel + duration_ms] (ou jusqu'à la fin pellicule
  // si duration_ms null). Si cursorRelMs absent (back-compat), pas de gate.
  if (cursorRelMs != null) {
    const inStart = cursorRelMs >= layer.start_ms_rel
    const inEnd = layer.duration_ms == null
      ? true
      : cursorRelMs < layer.start_ms_rel + layer.duration_ms
    if (!inStart || !inEnd) return null
  }

  // Phase A bis bonus 2026-05-18 — wrapper en position absolute avec le
  // transform partagé, qui contient le média + le label top-right. Le label
  // est positionné EN HAUT-DROITE du rectangle bounding (display:inline-block).
  // z-index du wrapper = layer.z_index → le calque le PLUS HAUT a son label
  // automatiquement au-dessus (= si 2 calques se chevauchent, on voit le label
  // du calque dessus).
  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${layer.position_x}%`,
    top: `${layer.position_y}%`,
    transform: `translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`,
    transformOrigin: 'center center',
    opacity: layer.opacity,
    mixBlendMode: layer.blend as React.CSSProperties['mixBlendMode'],
    zIndex: layer.z_index,
    maxWidth: '40%',
    maxHeight: '60%',
    pointerEvents: 'none',
    filter: buildFilter(layer.effects),
    clipPath: buildClipPath(layer.mask),
    // Inline-block pour que le wrapper épouse la taille naturelle du média.
    display: 'inline-block',
  }
  const mediaStyle: React.CSSProperties = {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  }

  const media = (() => {
    switch (layer.type) {
      case 'image':
      case 'gif':
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={layer.media_url} alt="" style={mediaStyle} draggable={false} />
        )
      case 'video':
        return (
          <video src={layer.media_url} autoPlay loop muted playsInline style={mediaStyle} />
        )
      default:
        return null
    }
  })()

  // Phase A bis bonus 2026-05-19 — label rendu PAR PelliculeRenderer (coordinateur)
  // qui sélectionne le TOP visible parmi les calques actuels. Voir prop
  // visibleTopmostLayerId dans PelliculeRenderer.
  return <div style={wrapperStyle}>{media}</div>
}

// ── Helpers CSS ─────────────────────────────────────────────────────────

/** Construit la string `filter:` CSS depuis effects.
 *  Glow = drop-shadow(0 0 spread color@intensity)
 *  Shadow = drop-shadow(offsetX offsetY blur color@intensity)
 *  Blur = blur(amount)
 *  drop-shadow épouse l'alpha de la PNG (≠ box-shadow qui suit le rectangle). */
export function buildFilter(effects: PelliculeLayerEffects | null | undefined): string | undefined {
  if (!effects) return undefined
  const parts: string[] = []

  if (effects.glow && effects.glow.intensity > 0 && effects.glow.spread > 0) {
    const { color, intensity, spread } = effects.glow
    parts.push(`drop-shadow(0 0 ${spread}rem ${withAlpha(color, intensity)})`)
  }
  if (effects.shadow && effects.shadow.intensity > 0) {
    const { color, intensity, offsetX, offsetY, blur } = effects.shadow
    parts.push(
      `drop-shadow(${offsetX}rem ${offsetY}rem ${blur}rem ${withAlpha(color, intensity)})`,
    )
  }
  if (effects.blur && effects.blur.amount > 0) {
    parts.push(`blur(${effects.blur.amount}rem)`)
  }

  return parts.length > 0 ? parts.join(' ') : undefined
}

/** Construit la string `clip-path: polygon(...)` CSS depuis un mask.
 *  Les points sont en % du canvas pellicule. Pour `shape: 'rect'`, attend 4
 *  points (TL/TR/BR/BL). Pour `shape: 'polygon'`, N points (≥3). */
export function buildClipPath(mask: PelliculeLayerMask | null | undefined): string | undefined {
  if (!mask || !mask.points || mask.points.length < 3) return undefined
  const points = mask.points.map(([x, y]) => `${x}% ${y}%`).join(', ')
  return `polygon(${points})`
}

/** Convertit une couleur (#rgb, #rrggbb, ou rgb(...)) + alpha 0-1 vers rgba(). */
export function withAlpha(color: string, alpha: number): string {
  // Cas hex #rrggbb
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(color.trim())
  if (m6) {
    const r = parseInt(m6[1].slice(0, 2), 16)
    const g = parseInt(m6[1].slice(2, 4), 16)
    const b = parseInt(m6[1].slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  // Cas hex #rgb (court)
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(color.trim())
  if (m3) {
    const r = parseInt(m3[1][0] + m3[1][0], 16)
    const g = parseInt(m3[1][1] + m3[1][1], 16)
    const b = parseInt(m3[1][2] + m3[1][2], 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  // Cas rgb(...) — on injecte alpha via rgba()
  const mRgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(color.trim())
  if (mRgb) {
    return `rgba(${mRgb[1]}, ${mRgb[2]}, ${mRgb[3]}, ${alpha})`
  }
  // Fallback : retourne la couleur telle quelle (le browser appliquera alpha:1
  // implicitement). Pas idéal mais évite les crashes.
  return color
}
