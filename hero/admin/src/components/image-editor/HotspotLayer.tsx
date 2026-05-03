'use client'
/**
 * HotspotLayer — zone cliquable conditionnelle sur une image (Famille 6 §7).
 *
 * Le cœur du moat Hero : pont entre Couche 1 (moteur de conditions/actions) et
 * Couche 2 (visuel). Un hotspot :
 *   - a une forme (rect ou circle) en coordonnées normalisées 0-1
 *   - est visible si `visibleIf` évalue à true (ou absent → toujours visible)
 *   - est actif (cliquable) si `enabledIf` évalue à true (ou absent → toujours actif)
 *   - au clic : émet une cascade d'actions que le parent exécute via le moteur
 *
 * Feedback visuel :
 *   - halo pulsant optionnel (couleur + mode)
 *   - curseur custom au hover
 *   - tooltip au hover
 *   - effet de clic (ripple + flash)
 *
 * Évaluation des conditions : le composant reçoit le `PlayerState` et appelle
 * `evaluateCondition` pour décider visible / enabled à chaque render.
 */

import React, { useState } from 'react'
import { evaluateCondition } from '@/lib/conditions-engine'
import type { Condition, PlayerState } from '@/types/conditions'
import type { Action } from '@/types/actions'

export type HotspotShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }        // 0-1 normalisés
  | { kind: 'circle'; cx: number; cy: number; r: number }               // r en fraction de min(w,h)

export interface HotspotFeedback {
  /** Affiche un halo pulsant pour indiquer la zone cliquable. */
  halo?: boolean
  /** Couleur du halo (hex/rgb). Défaut jaune doré. */
  haloColor?: string
  /** Forme du halo : doux (soft glow) ou contour net (border). Défaut 'glow'. */
  haloStyle?: 'glow' | 'border' | 'both'
  /** Curseur au survol. Défaut 'pointer'. */
  cursor?: React.CSSProperties['cursor']
  /** Tooltip affiché au survol. */
  tooltip?: string
  /** Effet ripple au clic. Défaut true. */
  ripple?: boolean
}

export interface HotspotLayerProps {
  id: string
  shape: HotspotShape
  /** Label debug (affiché en mode debug uniquement). */
  label?: string
  visibleIf?: Condition
  enabledIf?: Condition
  actions: Action[]
  feedback?: HotspotFeedback
  /** État joueur courant (pour évaluer les conditions). */
  state: PlayerState
  /** Appelé au clic avec les actions à exécuter (parent les passe au moteur). */
  onTrigger: (id: string, actions: Action[]) => void
  /** Mode debug : affiche les contours et labels même si invisible. */
  debug?: boolean
}

export default function HotspotLayer({
  id, shape, label, visibleIf, enabledIf, actions, feedback, state, onTrigger, debug,
}: HotspotLayerProps) {
  const visible = !visibleIf || evaluateCondition(visibleIf, state)
  const enabled = !enabledIf || evaluateCondition(enabledIf, state)
  const [hovering, setHovering] = useState(false)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])

  if (!visible && !debug) return null

  const fb: HotspotFeedback = feedback ?? {}
  const haloColor = fb.haloColor ?? '#d4a84c'
  const haloStyle = fb.haloStyle ?? 'glow'
  const showHalo = fb.halo !== false && enabled  // pas de halo sur zone désactivée
  const cursor = enabled ? (fb.cursor ?? 'pointer') : 'not-allowed'

  // Styles de positionnement selon forme
  const pos: React.CSSProperties = shape.kind === 'rect'
    ? { left: `${shape.x * 100}%`, top: `${shape.y * 100}%`, width: `${shape.w * 100}%`, height: `${shape.h * 100}%` }
    : (() => {
        // Pour circle : on centre un div carré sur (cx, cy) avec size = 2r
        const size = shape.r * 2 * 100
        return {
          left: `${(shape.cx - shape.r) * 100}%`,
          top: `${(shape.cy - shape.r) * 100}%`,
          width: `${size}%`,
          aspectRatio: '1',
        }
      })()

  const borderRadius = shape.kind === 'circle' ? '50%' : 4

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!enabled) return
    // Ripple effect
    if (fb.ripple !== false) {
      const rect = e.currentTarget.getBoundingClientRect()
      const rx = e.clientX - rect.left
      const ry = e.clientY - rect.top
      const rid = Date.now()
      setRipples(r => [...r, { id: rid, x: rx, y: ry }])
      window.setTimeout(() => setRipples(r => r.filter(x => x.id !== rid)), 600)
    }
    onTrigger(id, actions)
  }

  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        borderRadius,
        cursor,
        pointerEvents: 'auto',
        opacity: debug && !visible ? 0.3 : (enabled ? 1 : 0.55),
        transition: 'opacity 0.2s',
        overflow: 'hidden',
      }}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onClick={handleClick}
      data-hotspot-id={id}
    >
      {/* Halo glow (box-shadow pulsant inner) */}
      {showHalo && (haloStyle === 'glow' || haloStyle === 'both') && (
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius,
          boxShadow: `inset 0 0 ${hovering ? 40 : 20}px ${haloColor}`,
          animation: 'hotspotPulse 2s ease-in-out infinite',
          pointerEvents: 'none',
          transition: 'box-shadow 0.2s',
        }} />
      )}
      {/* Halo border (contour net) */}
      {showHalo && (haloStyle === 'border' || haloStyle === 'both') && (
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius,
          border: `2px solid ${haloColor}`,
          opacity: hovering ? 1 : 0.5,
          animation: 'hotspotPulse 2s ease-in-out infinite',
          pointerEvents: 'none',
          transition: 'opacity 0.2s',
        }} />
      )}
      {/* Debug outline + label */}
      {debug && (
        <div style={{
          position: 'absolute', inset: 0,
          border: '1px dashed ' + (visible ? (enabled ? '#10B981' : '#f97316') : '#ef4444'),
          borderRadius,
          pointerEvents: 'none',
        }}>
          <span style={{
            position: 'absolute', top: 2, left: 4,
            fontSize: 10, color: visible ? (enabled ? '#10B981' : '#f97316') : '#ef4444',
            background: 'rgba(0,0,0,0.7)', padding: '1px 4px', borderRadius: 2,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {label ?? id} {!visible ? '(hidden)' : !enabled ? '(locked)' : ''}
          </span>
        </div>
      )}
      {/* Ripple effect */}
      {ripples.map(r => (
        <div key={r.id} style={{
          position: 'absolute',
          left: r.x, top: r.y,
          width: 4, height: 4,
          borderRadius: '50%',
          background: haloColor,
          transform: 'translate(-50%, -50%)',
          animation: 'hotspotRipple 0.6s ease-out',
          pointerEvents: 'none',
        }} />
      ))}
      {/* Tooltip */}
      {fb.tooltip && hovering && (
        <div style={{
          position: 'absolute',
          bottom: '100%', left: '50%',
          transform: 'translateX(-50%) translateY(-8px)',
          padding: '6px 10px',
          background: 'rgba(13,13,13,0.92)',
          color: '#ede9df',
          fontSize: 12,
          fontWeight: 500,
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.15)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 100,
        }}>
          {fb.tooltip}
        </div>
      )}

      {/* Styles globaux pour les animations (injectés une seule fois) */}
      <style jsx global>{`
        @keyframes hotspotPulse {
          0%, 100% { opacity: 0.4; }
          50%      { opacity: 0.85; }
        }
        @keyframes hotspotRipple {
          from { width: 4px; height: 4px; opacity: 0.8; }
          to   { width: 120px; height: 120px; opacity: 0; }
        }
      `}</style>
    </div>
  )
}
