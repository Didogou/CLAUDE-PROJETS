'use client'
/**
 * Page de test SpriteLayer — primitive §2 (sprite-sheet loop).
 * URL : http://localhost:3000/editor-test/sprite-sheet
 *
 * Permet de valider la mécanique de lecture de sprite-sheets avant de
 * l'intégrer comme type de calque dans l'ImageEditor. Une sprite-sheet
 * procédurale est générée par défaut pour tester sans asset externe,
 * mais tu peux charger n'importe quelle URL.
 */

import React, { useEffect, useState } from 'react'
import SpriteLayer from '@/components/image-editor/SpriteLayer'

type LoopMode = 'loop' | 'once' | 'pingpong'

const DEFAULT_BG = 'linear-gradient(135deg, #1a2332 0%, #2d4055 50%, #1a2332 100%)'

export default function SpriteSheetTestPage() {
  const [sheetUrl, setSheetUrl] = useState('')
  const [frameWidth, setFrameWidth] = useState(64)
  const [frameHeight, setFrameHeight] = useState(64)
  const [frameCount, setFrameCount] = useState(6)
  const [rows, setRows] = useState(1)
  const [frameDuration, setFrameDuration] = useState(120)
  const [loop, setLoop] = useState<LoopMode>('loop')
  const [scale, setScale] = useState(2)
  const [posX, setPosX] = useState(0.5)
  const [posY, setPosY] = useState(0.5)
  const [paused, setPaused] = useState(false)
  const [flipX, setFlipX] = useState(false)
  const [opacity, setOpacity] = useState(1)
  const [bgUrl, setBgUrl] = useState('')

  // Sprite-sheet procédurale par défaut : 6 frames 64×64 d'un disque qui pulse
  // en changeant de couleur. Permet de tester sans avoir besoin d'un asset.
  // Génération en useEffect car `document` n'existe pas côté serveur (SSR).
  const [proceduralSheet, setProceduralSheet] = useState('')
  useEffect(() => {
    setProceduralSheet(generateProceduralSheet())
  }, [])

  const effectiveSheetUrl = sheetUrl.trim() || proceduralSheet
  const bgStyle: React.CSSProperties = bgUrl.trim()
    ? { backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: DEFAULT_BG }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          SpriteLayer — primitive §2 (sprite-sheet loop)
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 20 }}>
          Valide la lecture d&apos;une sprite-sheet en boucle. Par défaut une sheet procédurale
          (disque pulsant multicolore). Tu peux charger n&apos;importe quelle URL de sprite PNG,
          puis configurer les paramètres et voir le rendu en live.
        </p>

        {/* Preview */}
        <div style={{ position: 'relative', aspectRatio: '16/9', border: '1px solid #2a2a30', borderRadius: 8, overflow: 'hidden', marginBottom: 16, ...bgStyle }}>
          <SpriteLayer
            sheetUrl={effectiveSheetUrl}
            frameWidth={frameWidth}
            frameHeight={frameHeight}
            frameCount={frameCount}
            rows={rows}
            frameDuration={frameDuration}
            loop={loop}
            scale={scale}
            position={{ x: posX, y: posY }}
            paused={paused}
            flipX={flipX}
            opacity={opacity}
          />
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <Section title="Source">
            <Field label="URL de la sprite-sheet (vide = sheet procédurale)">
              <input
                type="url"
                value={sheetUrl}
                onChange={e => setSheetUrl(e.target.value)}
                placeholder="https://…/sprite.png"
                style={inputStyle}
              />
            </Field>
            <Field label="URL image de fond (optionnelle)">
              <input
                type="url"
                value={bgUrl}
                onChange={e => setBgUrl(e.target.value)}
                placeholder="https://…/scene.jpg"
                style={inputStyle}
              />
            </Field>
          </Section>

          <Section title="Dimensions & layout">
            <Field label={`Largeur frame : ${frameWidth}px`}>
              <input type="range" min={8} max={512} value={frameWidth} onChange={e => setFrameWidth(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Hauteur frame : ${frameHeight}px`}>
              <input type="range" min={8} max={512} value={frameHeight} onChange={e => setFrameHeight(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Nombre de frames : ${frameCount}`}>
              <input type="range" min={1} max={32} value={frameCount} onChange={e => setFrameCount(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Rangées : ${rows}`}>
              <input type="range" min={1} max={8} value={rows} onChange={e => setRows(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
          </Section>

          <Section title="Animation">
            <Field label={`Durée / frame : ${frameDuration}ms (${(1000 / frameDuration).toFixed(1)} fps)`}>
              <input type="range" min={16} max={1000} step={10} value={frameDuration} onChange={e => setFrameDuration(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label="Mode de lecture">
              <select value={loop} onChange={e => setLoop(e.target.value as LoopMode)} style={inputStyle}>
                <option value="loop">Loop (boucle infinie)</option>
                <option value="once">Once (une fois puis fige)</option>
                <option value="pingpong">Ping-pong (A→B→A→B…)</option>
              </select>
            </Field>
            <Field label="Contrôles">
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPaused(p => !p)} style={btnStyle}>
                  {paused ? '▶ Play' : '⏸ Pause'}
                </button>
                <button onClick={() => setFlipX(f => !f)} style={btnStyle}>
                  {flipX ? '⇄ Flip ON' : '⇄ Flip OFF'}
                </button>
              </div>
            </Field>
          </Section>

          <Section title="Rendu">
            <Field label={`Échelle : ${scale.toFixed(1)}×`}>
              <input type="range" min={0.5} max={8} step={0.1} value={scale} onChange={e => setScale(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Position X : ${posX.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.01} value={posX} onChange={e => setPosX(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Position Y : ${posY.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.01} value={posY} onChange={e => setPosY(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Opacité : ${opacity.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
          </Section>
        </div>

        <div style={{ marginTop: 20, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>Pour tester avec une vraie sprite</strong> : génère-en une avec ton ComfyUI
          (ex: prompt « sprite sheet, 4 frames horizontal, character walking cycle, 64x64 each, transparent background »),
          upload l&apos;image quelque part (ou drop-la dans <code>public/</code>), et colle l&apos;URL dans le champ Source.
          Ajuste ensuite frame width/height, count et duration pour voir l&apos;anim se lire correctement.
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#9898b4' }}>{label}</label>
      {children}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sprite-sheet procédurale (dataURL PNG)
// ────────────────────────────────────────────────────────────────────────

/** Génère une sprite-sheet 6 frames × 64×64 : disque pulsant multicolore.
 *  Renvoyée comme data URL PNG, passable directement à SpriteLayer.sheetUrl. */
function generateProceduralSheet(): string {
  const frameW = 64
  const frameH = 64
  const count = 6
  const canvas = document.createElement('canvas')
  canvas.width = frameW * count
  canvas.height = frameH
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const colors = ['#ef4444', '#f97316', '#eab308', '#10b981', '#3b82f6', '#a855f7']
  const radii  = [12, 18, 24, 28, 24, 18]

  for (let i = 0; i < count; i++) {
    const cx = i * frameW + frameW / 2
    const cy = frameH / 2
    const r = radii[i]
    // Halo radial externe
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5)
    grad.addColorStop(0, colors[i])
    grad.addColorStop(0.6, colors[i])
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(i * frameW, 0, frameW, frameH)
    // Disque net
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = colors[i]
    ctx.fill()
    // Numéro de frame
    ctx.fillStyle = 'white'
    ctx.font = 'bold 14px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i), cx, cy)
  }

  return canvas.toDataURL('image/png')
}

// ────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#EC4899',
  border: 'none',
  borderRadius: 4,
  color: 'white',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flex: 1,
}
