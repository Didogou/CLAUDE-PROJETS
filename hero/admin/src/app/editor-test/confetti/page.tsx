'use client'
/**
 * POC canvas-confetti — particules d'événements ponctuels.
 * URL : http://localhost:3000/editor-test/confetti
 *
 * Cas d'usage Hero : moments narratifs ponctuels (combat gagné, item rare,
 * sortilège, étoile filante, explosion, magie). PAS pour ambiance continue
 * (utiliser tsParticles ou ParticleLayer).
 *
 * Force de la lib : très petite (~10kb gzip), API ultra simple, custom shapes
 * via SVG path ou texte (emoji confetti = killer feature).
 */

import React, { useEffect, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import type { CreateTypes } from 'canvas-confetti'

const TEST_BG_URLS = [
  'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1200&h=800&fit=crop',  // château
  'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=1200&h=800&fit=crop',  // forêt
  'https://images.unsplash.com/photo-1465056836041-7f43ac27dcb5?w=1200&h=800&fit=crop',  // montagne
]

type RecipeKey = 'classic' | 'sparks' | 'magic' | 'level_up' | 'cannon_left' | 'cannon_right' | 'fireworks' | 'snow_burst' | 'emoji_swords' | 'emoji_hearts'

const RECIPE_LABELS: Record<RecipeKey, string> = {
  classic: '🎉 Classique',
  sparks: '✨ Étincelles',
  magic: '🔮 Magie',
  level_up: '⬆️ Level Up',
  cannon_left: '💥 Canon ←',
  cannon_right: '💥 Canon →',
  fireworks: '🎆 Feux d\'artifice',
  snow_burst: '❄️ Burst neige',
  emoji_swords: '⚔️ Épées',
  emoji_hearts: '💖 Cœurs',
}

export default function ConfettiTestPage() {
  const [bgUrl, setBgUrl] = useState(TEST_BG_URLS[0])
  const [originX, setOriginX] = useState(0.5)
  const [originY, setOriginY] = useState(0.5)
  const [particleCount, setParticleCount] = useState(100)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fireRef = useRef<CreateTypes | null>(null)

  // Init fire scopé au canvas du preview (pas plein écran).
  useEffect(() => {
    if (!canvasRef.current) return
    fireRef.current = confetti.create(canvasRef.current, {
      resize: true,
      useWorker: true,
    })
    return () => {
      fireRef.current?.reset()
      fireRef.current = null
    }
  }, [])

  function fire(recipe: RecipeKey) {
    const fn = fireRef.current
    if (!fn) return
    const origin = { x: originX, y: originY }

    switch (recipe) {
      case 'classic':
        fn({
          particleCount,
          spread: 70,
          origin,
          colors: ['#EC4899', '#d4a84c', '#10B981', '#6366F1', '#ffffff'],
        })
        break
      case 'sparks':
        // Petites particules dorées qui jaillissent vers le haut.
        fn({
          particleCount: particleCount * 0.6,
          startVelocity: 35,
          spread: 360,
          origin,
          colors: ['#ffaa00', '#ff6600', '#ffdd00', '#ffffff'],
          shapes: ['circle'],
          scalar: 0.5,
          gravity: 0.5,
          ticks: 60,
        })
        break
      case 'magic':
        // Étoiles violettes/roses, descendent doucement.
        fn({
          particleCount,
          spread: 180,
          origin,
          colors: ['#EC4899', '#a855f7', '#6366F1', '#ffffff'],
          shapes: ['star'],
          scalar: 1.2,
          gravity: 0.4,
          drift: 1,
          ticks: 200,
        })
        break
      case 'level_up':
        // Burst dirigé vers le haut, dorée.
        fn({
          particleCount,
          angle: 90,
          spread: 50,
          startVelocity: 60,
          origin: { x: originX, y: 1 },
          colors: ['#d4a84c', '#fbbf24', '#fde68a', '#ffffff'],
          shapes: ['circle', 'star'],
        })
        break
      case 'cannon_left':
        fn({
          particleCount,
          angle: 60,
          spread: 55,
          startVelocity: 60,
          origin: { x: 0, y: 0.7 },
          colors: ['#EC4899', '#d4a84c', '#ffffff'],
        })
        break
      case 'cannon_right':
        fn({
          particleCount,
          angle: 120,
          spread: 55,
          startVelocity: 60,
          origin: { x: 1, y: 0.7 },
          colors: ['#EC4899', '#d4a84c', '#ffffff'],
        })
        break
      case 'fireworks': {
        // Séquence de 3 explosions à origins random sur la moitié haute.
        const duration = 2000
        const end = Date.now() + duration
        const interval = setInterval(() => {
          if (Date.now() > end) { clearInterval(interval); return }
          fn({
            particleCount: 40,
            startVelocity: 30,
            spread: 360,
            origin: {
              x: Math.random() * 0.6 + 0.2,
              y: Math.random() * 0.4 + 0.1,
            },
            colors: ['#EC4899', '#d4a84c', '#10B981', '#6366F1', '#ffffff'],
            ticks: 100,
          })
        }, 250)
        break
      }
      case 'snow_burst':
        fn({
          particleCount: particleCount * 1.5,
          spread: 360,
          origin,
          colors: ['#ffffff', '#dbeafe', '#bfdbfe'],
          shapes: ['circle'],
          scalar: 0.8,
          gravity: 0.3,
          drift: 0.5,
          ticks: 250,
        })
        break
      case 'emoji_swords':
      case 'emoji_hearts': {
        const shape = recipe === 'emoji_swords'
          ? confetti.shapeFromText({ text: '⚔️', scalar: 2 })
          : confetti.shapeFromText({ text: '💖', scalar: 2 })
        fn({
          particleCount: particleCount * 0.4,
          spread: 100,
          origin,
          shapes: [shape],
          scalar: 2,
          ticks: 200,
        })
        break
      }
    }
  }

  // Click sur preview = met à jour origin + tire la recipe courante (utile
  // pour viser un endroit précis de l'image).
  const [lastRecipe, setLastRecipe] = useState<RecipeKey>('classic')
  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setOriginX(x)
    setOriginY(y)
    // Fire à l'endroit cliqué directement (évite double clic).
    setTimeout(() => fire(lastRecipe), 0)
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC canvas-confetti — événements ponctuels
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          10 recettes (classique, étincelles, magie, level up, canons, feux d&apos;artifice, neige, emoji).
          <strong style={{ color: '#d4a84c' }}> Clique sur l&apos;image</strong> pour tirer à l&apos;endroit précis.
        </p>

        {/* Preview */}
        <div
          onClick={handlePreviewClick}
          style={{
            position: 'relative',
            aspectRatio: '16/9',
            background: `url(${bgUrl}) center/cover`,
            border: '1px solid #2a2a30',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
            cursor: 'crosshair',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />
          {/* Marqueur position origin */}
          <div style={{
            position: 'absolute',
            left: `${originX * 100}%`,
            top: `${originY * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 16,
            height: 16,
            borderRadius: 8,
            border: '2px solid #EC4899',
            background: 'rgba(236, 72, 153, 0.2)',
            pointerEvents: 'none',
          }} />
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Recettes (clique pour tirer)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {(Object.keys(RECIPE_LABELS) as RecipeKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => { setLastRecipe(k); fire(k) }}
                  style={{ ...btnStyle, background: lastRecipe === k ? '#EC4899' : '#1a1a1e' }}
                >
                  {RECIPE_LABELS[k]}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Paramètres">
            <Field label={`Particle count : ${particleCount}`}>
              <input type="range" min={10} max={400} step={10} value={particleCount} onChange={e => setParticleCount(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Origin X : ${originX.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.05} value={originX} onChange={e => setOriginX(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Origin Y : ${originY.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.05} value={originY} onChange={e => setOriginY(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
          </Section>

          <Section title="Image de fond">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {TEST_BG_URLS.map((u, i) => (
                <button
                  key={u}
                  onClick={() => setBgUrl(u)}
                  style={{ ...btnStyle, background: bgUrl === u ? '#EC4899' : '#1a1a1e' }}
                >
                  Image {i + 1}
                </button>
              ))}
            </div>
            <button onClick={() => fireRef.current?.reset()} style={{ ...btnStyle, background: '#7f1d1d', marginTop: 8 }}>
              ✕ Reset canvas
            </button>
          </Section>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À évaluer :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Recettes utiles pour Hero : magie / level_up / sparks / emoji_* (combat, sorts, items rares)</li>
            <li>API ultra simple : 1 fonction, position normalisée, custom shapes via SVG path / emoji</li>
            <li>Bundle : ~10 kb gzip, useWorker:true → animation off-thread</li>
            <li>Limite : événements ponctuels uniquement (pas de boucle infinie sans coût CPU)</li>
            <li>Idée intégration : trigger sur transitions de section / actions de combat</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: 11, color: '#9898b4' }}>{label}</label>
      {children}
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

const btnStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
