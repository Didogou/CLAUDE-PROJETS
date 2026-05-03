'use client'
/**
 * HudLayer — overlay UI persistant au-dessus de la scène.
 *
 * Les widgets HUD restent fixes dans la zone parent, ignorent pan/zoom de la
 * scène. Utilisés pour : barre de vie, inventaire, timer, jauges, notifications.
 *
 * 4 widgets de base :
 *   - Bar      : barre de progression (HP, endurance, XP…)
 *   - Counter  : valeur numérique avec icône (pièces, objets, munitions)
 *   - Timer    : chrono décroissant (tension narrative)
 *   - Text     : texte libre positionné (hint, titre, narrateur)
 *
 * Positionnement : chaque widget a un `anchor` parmi les 9 positions (coins
 * + bords + centre) et un `offset` en pixels.
 */

import React from 'react'

export type HudAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface HudBarWidget {
  kind: 'bar'
  id: string
  anchor: HudAnchor
  offsetX?: number
  offsetY?: number
  label?: string
  value: number       // 0-1
  color?: string
  width?: number      // px, défaut 180
  icon?: string       // emoji ou texte court
}

export interface HudCounterWidget {
  kind: 'counter'
  id: string
  anchor: HudAnchor
  offsetX?: number
  offsetY?: number
  icon?: string
  value: number | string
  label?: string
}

export interface HudTimerWidget {
  kind: 'timer'
  id: string
  anchor: HudAnchor
  offsetX?: number
  offsetY?: number
  /** Secondes restantes à afficher (MM:SS). */
  seconds: number
  critical?: boolean  // si true, passe en rouge clignotant
}

export interface HudTextWidget {
  kind: 'text'
  id: string
  anchor: HudAnchor
  offsetX?: number
  offsetY?: number
  text: string
  color?: string
  fontSize?: number
  fontWeight?: number
}

export type HudWidget = HudBarWidget | HudCounterWidget | HudTimerWidget | HudTextWidget

export default function HudLayer({ widgets }: { widgets: HudWidget[] }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100 }}>
      {widgets.map(w => (
        <div key={w.id} style={{ position: 'absolute', ...anchorToStyle(w.anchor, w.offsetX ?? 0, w.offsetY ?? 0) }}>
          {renderWidget(w)}
        </div>
      ))}
    </div>
  )
}

function anchorToStyle(anchor: HudAnchor, offsetX: number, offsetY: number): React.CSSProperties {
  const [v, h] = anchor.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right']
  const style: React.CSSProperties = {}
  if (v === 'top') style.top = 12 + offsetY
  else if (v === 'bottom') style.bottom = 12 - offsetY
  else { style.top = '50%'; style.transform = 'translateY(-50%)' }
  if (h === 'left') style.left = 12 + offsetX
  else if (h === 'right') style.right = 12 - offsetX
  else {
    style.left = '50%'
    style.transform = (style.transform ? style.transform + ' ' : '') + 'translateX(-50%)'
  }
  return style
}

function renderWidget(w: HudWidget): React.ReactNode {
  switch (w.kind) {
    case 'bar': return <BarWidget {...w} />
    case 'counter': return <CounterWidget {...w} />
    case 'timer': return <TimerWidget {...w} />
    case 'text': return <TextWidget {...w} />
  }
}

function BarWidget({ label, value, color = '#EC4899', width = 180, icon }: HudBarWidget) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(13,13,13,0.8)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)' }}>
      {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {label && <span style={{ fontSize: 10, color: '#c0c0d0', fontWeight: 600, letterSpacing: '.02em', textTransform: 'uppercase' }}>{label}</span>}
        <div style={{ width, height: 10, background: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
        </div>
      </div>
    </div>
  )
}

function CounterWidget({ icon = '●', value, label }: HudCounterWidget) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(13,13,13,0.8)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)' }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color: '#ede9df' }}>{value}</span>
      {label && <span style={{ fontSize: 10, color: '#9898b4' }}>{label}</span>}
    </div>
  )
}

function TimerWidget({ seconds, critical }: HudTimerWidget) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const color = critical ? '#ef4444' : '#ede9df'
  return (
    <div style={{
      padding: '6px 12px',
      background: 'rgba(13,13,13,0.85)',
      borderRadius: 4,
      border: '1px solid rgba(255,255,255,0.1)',
      color,
      fontSize: 18,
      fontWeight: 700,
      fontFamily: 'JetBrains Mono, monospace',
      animation: critical ? 'pulseRed 0.8s infinite' : undefined,
    }}>
      {m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </div>
  )
}

function TextWidget({ text, color = '#ede9df', fontSize = 14, fontWeight = 500 }: HudTextWidget) {
  return (
    <div style={{
      padding: '6px 12px',
      background: 'rgba(13,13,13,0.75)',
      borderRadius: 4,
      border: '1px solid rgba(255,255,255,0.08)',
      color,
      fontSize,
      fontWeight,
      maxWidth: 400,
    }}>
      {text}
    </div>
  )
}
