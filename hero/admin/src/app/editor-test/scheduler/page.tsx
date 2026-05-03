'use client'
/**
 * Démo Scheduler — primitive §12.
 * URL : http://localhost:3000/editor-test/scheduler
 *
 * Montre concrètement comment un rat peut traverser la scène toutes les 30-60s,
 * une bougie changer de couleur aléatoirement, un événement one-shot au démarrage.
 */

import React, { useEffect, useState } from 'react'
import { useScheduler, type SchedulerMode } from '@/lib/scheduler'
import SpriteLayer from '@/components/image-editor/SpriteLayer'
import LightLayer, { type LightMode } from '@/components/image-editor/LightLayer'

export default function SchedulerTestPage() {
  // Scheduler « rat qui passe » : random interval 3-8s pour la démo
  const [ratVisible, setRatVisible] = useState(false)
  const [ratStartX, setRatStartX] = useState(0)
  const { fireCount: ratFires } = useScheduler(
    { mode: 'random_interval', minInterval: 3000, maxInterval: 8000 },
    () => {
      setRatStartX(Math.random() > 0.5 ? -0.1 : 1.1)  // entrée gauche ou droite
      setRatVisible(true)
      setTimeout(() => setRatVisible(false), 3000)    // disparaît après 3s
    },
  )

  // Scheduler « bougie aléatoire » : change couleur et intensité toutes les 2-5s
  const [candleColor, setCandleColor] = useState('#ffb366')
  const [candleIntensity, setCandleIntensity] = useState(0.9)
  useScheduler(
    { mode: 'random_interval', minInterval: 2000, maxInterval: 5000, startImmediate: true },
    () => {
      const colors = ['#ffb366', '#ffcc80', '#ff9966', '#ffd580', '#ff8c40']
      setCandleColor(colors[Math.floor(Math.random() * colors.length)])
      setCandleIntensity(0.6 + Math.random() * 0.4)
    },
  )

  // Scheduler « flash one-shot » : 2s après le mount
  const [flashVisible, setFlashVisible] = useState(false)
  useScheduler(
    { mode: 'once', delay: 2000 },
    () => {
      setFlashVisible(true)
      setTimeout(() => setFlashVisible(false), 400)
    },
  )

  // Scheduler « coq périodique » : toutes les 10s (démo, en vrai ce serait 1x/jour)
  const [coqActive, setCoqActive] = useState(false)
  const { fireCount: coqFires } = useScheduler(
    { mode: 'periodic', interval: 10000 },
    () => {
      setCoqActive(true)
      setTimeout(() => setCoqActive(false), 1500)
    },
  )

  // Animation rat qui traverse
  const [ratX, setRatX] = useState(0)
  useEffect(() => {
    if (!ratVisible) return
    const target = ratStartX < 0.5 ? 1.15 : -0.15
    const start = ratStartX
    const startTime = performance.now()
    const duration = 3000
    let raf = 0
    const anim = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration)
      setRatX(start + (target - start) * t)
      if (t < 1) raf = requestAnimationFrame(anim)
    }
    raf = requestAnimationFrame(anim)
    return () => cancelAnimationFrame(raf)
  }, [ratVisible, ratStartX])

  // Sprite rat procédural
  const [ratSprite, setRatSprite] = useState('')
  useEffect(() => setRatSprite(generateRatSheet()), [])

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          Scheduler — primitive §12 (événements temporels)
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 20 }}>
          4 schedulers tournent en parallèle : <b>rat qui passe</b> (aléatoire 3-8s), <b>bougie</b> (aléatoire 2-5s),
          <b> flash one-shot</b> (2s après chargement), <b>coq</b> (périodique 10s).
          Regarde la scène et le dashboard à droite.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 12 }}>
          {/* Scene */}
          <div style={{ position: 'relative', aspectRatio: '16/9', background: 'radial-gradient(circle at 50% 60%, #2a2a3e 0%, #0a0a12 100%)', border: '1px solid #2a2a30', borderRadius: 8, overflow: 'hidden' }}>
            {/* Bougie aléatoire */}
            <LightLayer position={{ x: 0.3, y: 0.4 }} color={candleColor} intensity={candleIntensity} radius={120} mode="flicker" flickerAmount={0.3} speed={1.2} />

            {/* Rat qui traverse */}
            {ratVisible && ratSprite && (
              <SpriteLayer
                sheetUrl={ratSprite}
                frameWidth={48}
                frameHeight={32}
                frameCount={4}
                frameDuration={80}
                loop="loop"
                scale={1.2}
                position={{ x: ratX, y: 0.85 }}
                flipX={ratStartX > 0.5}
              />
            )}

            {/* Flash one-shot */}
            {flashVisible && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'white', opacity: 0.6,
                pointerEvents: 'none',
                animation: 'fadeOut 0.4s',
              }} />
            )}

            {/* Coq actif : halo jaune qui apparaît ponctuellement en haut */}
            {coqActive && (
              <LightLayer position={{ x: 0.8, y: 0.2 }} color="#ffea00" intensity={1} radius={80} mode="pulse" flickerAmount={0.8} speed={4} />
            )}
          </div>

          {/* Dashboard */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SchedulerCard label="🐀 Rat (random 3-8s)" fires={ratFires} active={ratVisible} />
            <SchedulerCard label="🕯️ Bougie (random 2-5s)" fires={-1} active color={candleColor} />
            <SchedulerCard label="⚡ Flash (once 2s)" fires={flashVisible ? 1 : 0} active={flashVisible} />
            <SchedulerCard label="🐓 Coq (periodic 10s)" fires={coqFires} active={coqActive} />
          </div>
        </div>

        <div style={{ marginTop: 20, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>Ce que ça valide :</strong> les 4 modes du scheduler fonctionnent
          indépendamment, sans bloquer ni leaker entre rerenders. Les calques pilotés (rat, bougie, flash, coq)
          changent d&apos;état automatiquement sans intervention utilisateur. C&apos;est la base de la vie ambiante
          autonome dans une scène.
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeOut {
          0%   { opacity: 0.8; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

function SchedulerCard({ label, fires, active, color }: { label: string; fires: number; active: boolean; color?: string }) {
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: `1px solid ${active ? '#EC4899' : '#2a2a30'}`, borderRadius: 6, transition: 'border-color 0.2s' }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#9898b4' }}>
        {fires >= 0 && <span>Déclenchements : <b style={{ color: '#ede9df' }}>{fires}</b></span>}
        {color && <span style={{ marginLeft: 8, display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, verticalAlign: 'middle' }} />}
      </div>
      <div style={{ fontSize: 10, color: active ? '#10B981' : '#6e6e85', marginTop: 4 }}>
        {active ? '● ACTIF' : '○ en attente'}
      </div>
    </div>
  )
}

function generateRatSheet(): string {
  const frameW = 48, frameH = 32, count = 4
  const canvas = document.createElement('canvas')
  canvas.width = frameW * count
  canvas.height = frameH
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  for (let i = 0; i < count; i++) {
    const cx = i * frameW + 24
    const cy = 20
    // Body
    ctx.fillStyle = '#5a4a3a'
    ctx.beginPath()
    ctx.ellipse(cx, cy, 14, 7, 0, 0, Math.PI * 2)
    ctx.fill()
    // Head
    ctx.beginPath()
    ctx.ellipse(cx + 13, cy - 2, 6, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    // Tail (wiggles per frame)
    ctx.strokeStyle = '#5a4a3a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx - 14, cy)
    const tailY = cy + [0, -3, 0, 3][i]
    ctx.quadraticCurveTo(cx - 22, tailY, cx - 26, cy + (i % 2 === 0 ? -2 : 2))
    ctx.stroke()
    // Legs (alternate per frame)
    const legOffset = i % 2 === 0 ? 2 : -2
    ctx.fillStyle = '#3a2a1a'
    ctx.fillRect(cx - 6, cy + 5 + legOffset, 2, 4)
    ctx.fillRect(cx + 4, cy + 5 - legOffset, 2, 4)
  }
  return canvas.toDataURL('image/png')
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}
