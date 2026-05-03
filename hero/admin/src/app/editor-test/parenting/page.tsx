'use client'
/**
 * Page de test Parenting — primitive §5.
 * URL : http://localhost:3000/editor-test/parenting
 *
 * Démontre qu'un calque enfant (lumière) suit un calque parent (sprite) via
 * un state partagé de position. Drag du sprite à la souris, ou animation
 * automatique (trajectoire sinusoïdale / circulaire).
 *
 * Cas d'usage réels :
 *   - Personnage portant une torche : sprite + halo flicker qui suit
 *   - PNJ avec aura : portrait + aura pulsante qui suit
 *   - Lampion porté : lampion sprite + lumière qui se balance avec le mouvement
 */

import React, { useEffect, useRef, useState } from 'react'
import SpriteLayer from '@/components/image-editor/SpriteLayer'
import LightLayer, { type LightMode } from '@/components/image-editor/LightLayer'

interface Child {
  id: string
  label: string
  offsetX: number           // en fraction de la zone parent (-0.5 à +0.5)
  offsetY: number
  color: string
  radius: number
  mode: LightMode
  flickerAmount: number
  speed: number
  intensity: number
}

type AnimMode = 'none' | 'circle' | 'horizontal' | 'wander'

export default function ParentingTestPage() {
  const [parentPos, setParentPos] = useState({ x: 0.5, y: 0.5 })
  const [spriteUrl, setSpriteUrl] = useState('')
  const [children, setChildren] = useState<Child[]>([
    { id: 'c1', label: 'Torche',     offsetX: 0.04,  offsetY: -0.08, color: '#ff8c40', radius: 140, mode: 'flicker', flickerAmount: 0.45, speed: 1.5, intensity: 1 },
  ])
  const [selectedChildId, setSelectedChildId] = useState<string>('c1')
  const [animMode, setAnimMode] = useState<AnimMode>('none')
  const [animSpeed, setAnimSpeed] = useState(0.5)
  const [bgUrl, setBgUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [proceduralSprite, setProceduralSprite] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Sprite par défaut : petit personnage stick figure de 4 frames (idle + 3 poses)
  useEffect(() => {
    setProceduralSprite(generateStickFigureSheet())
  }, [])

  // Animation automatique du parent
  useEffect(() => {
    if (animMode === 'none') return
    let rafId = 0
    const t0 = performance.now()
    let wanderX = 0.5, wanderY = 0.5
    let wanderVx = 0.0005, wanderVy = 0.0003

    const tick = (now: number) => {
      const t = (now - t0) / 1000
      if (animMode === 'circle') {
        setParentPos({
          x: 0.5 + 0.3 * Math.cos(t * animSpeed * Math.PI),
          y: 0.5 + 0.2 * Math.sin(t * animSpeed * Math.PI),
        })
      } else if (animMode === 'horizontal') {
        setParentPos({
          x: 0.5 + 0.35 * Math.sin(t * animSpeed * Math.PI),
          y: 0.5,
        })
      } else if (animMode === 'wander') {
        wanderX += wanderVx * animSpeed
        wanderY += wanderVy * animSpeed
        if (wanderX < 0.15 || wanderX > 0.85) wanderVx *= -1
        if (wanderY < 0.2  || wanderY > 0.8)  wanderVy *= -1
        // Bruit Perlin-lite pour un mouvement moins mécanique
        wanderVx += (Math.random() - 0.5) * 0.00005
        wanderVy += (Math.random() - 0.5) * 0.00005
        setParentPos({ x: wanderX, y: wanderY })
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [animMode, animSpeed])

  // Drag manuel du parent
  function handlePointer(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    setParentPos({ x, y })
  }

  const selected = children.find(c => c.id === selectedChildId)
  const effectiveSprite = spriteUrl.trim() || proceduralSprite

  function addChild() {
    const id = `c${Date.now()}`
    const newChild: Child = {
      id, label: `Halo ${children.length + 1}`,
      offsetX: 0, offsetY: -0.05,
      color: '#ffd580', radius: 80, mode: 'pulse',
      flickerAmount: 0.5, speed: 1, intensity: 0.8,
    }
    setChildren([...children, newChild])
    setSelectedChildId(id)
  }

  function removeChild(id: string) {
    const next = children.filter(c => c.id !== id)
    setChildren(next)
    if (selectedChildId === id && next.length > 0) setSelectedChildId(next[0].id)
  }

  function updateSelected(patch: Partial<Child>) {
    setChildren(children.map(c => c.id === selectedChildId ? { ...c, ...patch } : c))
  }

  const bgStyle: React.CSSProperties = bgUrl.trim()
    ? { backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: 'radial-gradient(circle at 30% 40%, #1a1a2e 0%, #0a0a12 100%)' }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          Parenting — primitive §5 (calques qui suivent un parent)
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 20 }}>
          Un sprite parent + un ou plusieurs halos enfants. Drag le sprite à la souris ou active
          une animation. Les halos suivent en temps réel via state partagé.
          <br />
          <strong style={{ color: '#d4a84c' }}>Cas d&apos;usage type</strong> : personnage qui porte une torche, PNJ avec aura, lampion porté.
        </p>

        {/* Preview */}
        <div
          ref={containerRef}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerLeave={() => setDragging(false)}
          onPointerMove={handlePointer}
          style={{
            position: 'relative',
            aspectRatio: '16/9',
            border: '1px solid #2a2a30',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
            cursor: dragging ? 'grabbing' : 'grab',
            ...bgStyle,
          }}
        >
          {/* Enfants rendus avec position = parent + offset */}
          {children.map(c => (
            <LightLayer
              key={c.id}
              position={{ x: parentPos.x + c.offsetX, y: parentPos.y + c.offsetY }}
              color={c.color}
              intensity={c.intensity}
              radius={c.radius}
              mode={c.mode}
              flickerAmount={c.flickerAmount}
              speed={c.speed}
            />
          ))}
          {/* Sprite parent au-dessus */}
          {effectiveSprite && (
            <SpriteLayer
              sheetUrl={effectiveSprite}
              frameWidth={64}
              frameHeight={96}
              frameCount={4}
              frameDuration={180}
              loop="loop"
              scale={1.5}
              position={parentPos}
            />
          )}
          {/* Marqueur visuel de position du parent */}
          <div style={{
            position: 'absolute',
            left: `${parentPos.x * 100}%`,
            top: `${parentPos.y * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 12, height: 12,
            borderRadius: '50%',
            border: '2px solid #EC4899',
            background: 'rgba(236, 72, 153, 0.3)',
            pointerEvents: 'none',
            zIndex: 10,
          }} />
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <Section title="Mouvement du parent">
            <Field label="Animation">
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(['none', 'circle', 'horizontal', 'wander'] as AnimMode[]).map(m => (
                  <button key={m} onClick={() => setAnimMode(m)} style={{
                    ...btnStyle,
                    background: animMode === m ? '#EC4899' : '#1a1a1e',
                    border: '1px solid ' + (animMode === m ? '#EC4899' : '#2a2a30'),
                  }}>
                    {m === 'none' ? '⏸ Manuel' : m === 'circle' ? '○ Cercle' : m === 'horizontal' ? '⇔ H' : '🌊 Wander'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={`Vitesse anim : ${animSpeed.toFixed(2)}`}>
              <input type="range" min={0.1} max={3} step={0.05} value={animSpeed} onChange={e => setAnimSpeed(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Position X : ${parentPos.x.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.01} value={parentPos.x} onChange={e => { setAnimMode('none'); setParentPos(p => ({ ...p, x: Number(e.target.value) })) }} style={{ width: '100%' }} />
            </Field>
            <Field label={`Position Y : ${parentPos.y.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.01} value={parentPos.y} onChange={e => { setAnimMode('none'); setParentPos(p => ({ ...p, y: Number(e.target.value) })) }} style={{ width: '100%' }} />
            </Field>
          </Section>

          <Section title={`Enfants attachés (${children.length})`}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              <button onClick={addChild} style={btnStyle}>+ Ajouter un halo</button>
            </div>
            {children.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  onClick={() => setSelectedChildId(c.id)}
                  style={{
                    flex: 1, textAlign: 'left',
                    padding: '4px 8px',
                    background: selectedChildId === c.id ? '#2a2a30' : 'transparent',
                    border: '1px solid ' + (selectedChildId === c.id ? '#EC4899' : '#2a2a30'),
                    borderRadius: 4, color: '#ede9df', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c.color, marginRight: 6 }} />
                  {c.label}
                </button>
                <button onClick={() => removeChild(c.id)} style={{ width: 22, height: 22, padding: 0, background: 'transparent', border: '1px solid #3a3a42', borderRadius: 4, color: '#ef4444', cursor: 'pointer' }}>×</button>
              </div>
            ))}
          </Section>

          {selected && (
            <Section title={`Halo ${selected.label}`}>
              <Field label="Couleur">
                <input type="color" value={selected.color} onChange={e => updateSelected({ color: e.target.value })} style={{ width: '100%', height: 30, border: 'none', background: 'transparent' }} />
              </Field>
              <Field label="Mode">
                <select value={selected.mode} onChange={e => updateSelected({ mode: e.target.value as LightMode })} style={inputStyle}>
                  <option value="static">Statique</option>
                  <option value="flicker">Flicker</option>
                  <option value="pulse">Pulse</option>
                  <option value="strobe">Strobe</option>
                </select>
              </Field>
              <Field label={`Offset X (relatif au parent) : ${selected.offsetX.toFixed(3)}`}>
                <input type="range" min={-0.3} max={0.3} step={0.005} value={selected.offsetX} onChange={e => updateSelected({ offsetX: Number(e.target.value) })} style={{ width: '100%' }} />
              </Field>
              <Field label={`Offset Y : ${selected.offsetY.toFixed(3)}`}>
                <input type="range" min={-0.3} max={0.3} step={0.005} value={selected.offsetY} onChange={e => updateSelected({ offsetY: Number(e.target.value) })} style={{ width: '100%' }} />
              </Field>
              <Field label={`Rayon : ${selected.radius}px`}>
                <input type="range" min={20} max={300} value={selected.radius} onChange={e => updateSelected({ radius: Number(e.target.value) })} style={{ width: '100%' }} />
              </Field>
              <Field label={`Intensité : ${selected.intensity.toFixed(2)}`}>
                <input type="range" min={0} max={1} step={0.01} value={selected.intensity} onChange={e => updateSelected({ intensity: Number(e.target.value) })} style={{ width: '100%' }} />
              </Field>
              <Field label={`Flicker : ${selected.flickerAmount.toFixed(2)}`}>
                <input type="range" min={0} max={1} step={0.01} value={selected.flickerAmount} onChange={e => updateSelected({ flickerAmount: Number(e.target.value) })} style={{ width: '100%' }} />
              </Field>
              <Field label={`Vitesse : ${selected.speed.toFixed(1)}`}>
                <input type="range" min={0.1} max={5} step={0.1} value={selected.speed} onChange={e => updateSelected({ speed: Number(e.target.value) })} style={{ width: '100%' }} />
              </Field>
            </Section>
          )}

          <Section title="Ressources">
            <Field label="URL sprite du parent (vide = stick figure généré)">
              <input type="url" value={spriteUrl} onChange={e => setSpriteUrl(e.target.value)} placeholder="https://…/character.png" style={inputStyle} />
            </Field>
            <Field label="URL image de fond (optionnel)">
              <input type="url" value={bgUrl} onChange={e => setBgUrl(e.target.value)} placeholder="https://…/scene.jpg" style={inputStyle} />
            </Field>
          </Section>
        </div>

        <div style={{ marginTop: 20, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>Tests recommandés :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Active l&apos;animation <b>Wander</b> — le personnage se balade et la torche le suit</li>
            <li>Ajoute un 2ᵉ halo <b>Pulse cyan</b> au-dessus de la tête (offset Y = -0.08) → aura magique</li>
            <li>Drag à la souris → la torche suit le pointeur au travers du sprite</li>
            <li>Active <b>Circle</b> pour voir un mouvement complet avec tous les halos attachés</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
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

// ────────────────────────────────────────────────────────────────────────
// Sprite stick-figure généré procéduralement (4 frames : idle + 3 enjambées)
// ────────────────────────────────────────────────────────────────────────

function generateStickFigureSheet(): string {
  const frameW = 64
  const frameH = 96
  const count = 4
  const canvas = document.createElement('canvas')
  canvas.width = frameW * count
  canvas.height = frameH
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.strokeStyle = '#ede9df'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'

  const poses = [
    { leftLegDx: 0,  rightLegDx: 0,  armSwing: 0 },     // idle
    { leftLegDx: -8, rightLegDx: 8,  armSwing: 6 },     // step 1
    { leftLegDx: 0,  rightLegDx: 0,  armSwing: 0 },     // mid
    { leftLegDx: 8,  rightLegDx: -8, armSwing: -6 },    // step 2
  ]

  for (let i = 0; i < count; i++) {
    const cx = i * frameW + frameW / 2
    const cy = frameH / 2
    const pose = poses[i]

    // Head
    ctx.beginPath()
    ctx.arc(cx, cy - 28, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#ede9df'
    ctx.fill()

    // Body
    ctx.beginPath()
    ctx.moveTo(cx, cy - 18)
    ctx.lineTo(cx, cy + 10)
    ctx.stroke()

    // Arms (slight swing)
    ctx.beginPath()
    ctx.moveTo(cx, cy - 12)
    ctx.lineTo(cx - 14, cy + pose.armSwing)
    ctx.moveTo(cx, cy - 12)
    ctx.lineTo(cx + 14, cy - pose.armSwing)
    ctx.stroke()

    // Legs
    ctx.beginPath()
    ctx.moveTo(cx, cy + 10)
    ctx.lineTo(cx + pose.leftLegDx, cy + 30)
    ctx.moveTo(cx, cy + 10)
    ctx.lineTo(cx + pose.rightLegDx, cy + 30)
    ctx.stroke()
  }

  return canvas.toDataURL('image/png')
}

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
  padding: '4px 10px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
