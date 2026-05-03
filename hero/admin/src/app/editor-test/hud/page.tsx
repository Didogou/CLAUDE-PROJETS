'use client'
/**
 * Démo HUD — primitive §11.
 * URL : http://localhost:3000/editor-test/hud
 *
 * Montre l'overlay UI persistant : barre de vie, compteurs d'inventaire,
 * timer décroissant, notification textuelle. Indépendant de la scène.
 */

import React, { useEffect, useState } from 'react'
import HudLayer, { type HudWidget } from '@/components/image-editor/HudLayer'
import LightLayer from '@/components/image-editor/LightLayer'

export default function HudTestPage() {
  const [hp, setHp] = useState(0.8)
  const [endurance, setEndurance] = useState(0.65)
  const [money, setMoney] = useState(42)
  const [items, setItems] = useState(3)
  const [timerSec, setTimerSec] = useState(125)

  // Timer décroissant
  useEffect(() => {
    if (timerSec <= 0) return
    const id = window.setInterval(() => setTimerSec(s => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(id)
  }, [timerSec])

  const widgets: HudWidget[] = [
    // Barres en haut-gauche
    { kind: 'bar', id: 'hp',  anchor: 'top-left', icon: '❤️', label: 'Santé',     value: hp,        color: '#ef4444' },
    { kind: 'bar', id: 'end', anchor: 'top-left', offsetY: 36, icon: '⚡', label: 'Endurance', value: endurance, color: '#10B981' },
    // Compteurs en haut-droite
    { kind: 'counter', id: 'money', anchor: 'top-right', icon: '💰', value: money, label: '$' },
    { kind: 'counter', id: 'items', anchor: 'top-right', offsetY: 36, icon: '🎒', value: items, label: 'obj' },
    // Timer en haut-centre
    { kind: 'timer', id: 'timer', anchor: 'top-center', seconds: timerSec, critical: timerSec < 30 },
    // Texte narrateur en bas-centre
    { kind: 'text', id: 'narr', anchor: 'bottom-center', text: 'Une ombre bouge derrière toi...', fontSize: 13 },
  ]

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          HudLayer — primitive §11 (overlay UI persistant)
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 20 }}>
          Les widgets HUD restent fixes aux coins/bords de la zone. 4 types : <b>bar</b> (santé, endurance),
          <b> counter</b> (argent, objets), <b>timer</b> (décroissant, rouge si critique), <b>text</b> (narrateur).
          Utilisable dans toutes les scènes combat / exploration / narration.
        </p>

        {/* Scene avec HUD */}
        <div style={{ position: 'relative', aspectRatio: '16/9', background: 'radial-gradient(circle at 40% 70%, #3a2a1a 0%, #0a0a12 100%)', border: '1px solid #2a2a30', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <LightLayer position={{ x: 0.5, y: 0.6 }} color="#ff8c40" intensity={0.9} radius={180} mode="flicker" flickerAmount={0.4} speed={1.5} />
          <HudLayer widgets={widgets} />
        </div>

        {/* Simulation controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <div style={sectionBox}>
            <div style={sectionTitle}>Santé / Endurance</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setHp(v => Math.max(0, v - 0.1))} style={btnStyle}>💥 Dégât -10%</button>
              <button onClick={() => setHp(1)} style={btnStyle}>🫀 Full HP</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => setEndurance(v => Math.max(0, v - 0.15))} style={btnStyle}>🏃 Effort</button>
              <button onClick={() => setEndurance(1)} style={btnStyle}>💤 Repos</button>
            </div>
          </div>

          <div style={sectionBox}>
            <div style={sectionTitle}>Inventaire</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setMoney(m => m + 5)} style={btnStyle}>💰 +5$</button>
              <button onClick={() => setMoney(m => Math.max(0, m - 10))} style={btnStyle}>💸 -10$</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => setItems(i => i + 1)} style={btnStyle}>🎒 +1 obj</button>
              <button onClick={() => setItems(i => Math.max(0, i - 1))} style={btnStyle}>🗑 -1 obj</button>
            </div>
          </div>

          <div style={sectionBox}>
            <div style={sectionTitle}>Timer</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setTimerSec(125)} style={btnStyle}>2:05</button>
              <button onClick={() => setTimerSec(25)} style={btnStyle}>0:25 (critique)</button>
              <button onClick={() => setTimerSec(0)} style={btnStyle}>Stop</button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>Validé :</strong> le HUD reste persistant par-dessus la scène (ici une torche qui vacille), reçoit les states runtime sans interférer avec le rendu canvas. Positionnement via 9 ancres (coins/bords/centre) + offsets en pixels. Prêt à être branché au moteur de conditions pour affichage conditionnel (ex: barre de vie visible uniquement en combat).
        </div>
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const sectionBox: React.CSSProperties = {
  padding: 12,
  background: '#0f0f13',
  border: '1px solid #2a2a30',
  borderRadius: 6,
}

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#d4a84c',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  marginBottom: 8,
}

const btnStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
  flex: 1,
}
