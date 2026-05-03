'use client'
/**
 * Démo Points d'ancrage nommés — primitive §6.
 * URL : http://localhost:3000/editor-test/anchors
 *
 * L'auteur place des points d'intérêt sur l'image ("lampadaire", "perchoir",
 * "passage PNJ"). Les calques référencent ces points par `anchorId` plutôt
 * que par position absolue. Déplacer un point = déplacer tout ce qui y est
 * attaché.
 */

import React, { useEffect, useRef, useState } from 'react'
import LightLayer from '@/components/image-editor/LightLayer'
import SpriteLayer from '@/components/image-editor/SpriteLayer'

interface Anchor {
  id: string
  name: string
  x: number  // 0-1
  y: number  // 0-1
}

interface Attachment {
  id: string
  anchorId: string
  kind: 'light' | 'sprite'
  // light params
  color?: string
  radius?: number
  intensity?: number
  // sprite params (utilise le sprite procédural par défaut)
  scale?: number
}

const DEFAULT_ANCHORS: Anchor[] = [
  { id: 'a1', name: 'Lampadaire',   x: 0.2, y: 0.4 },
  { id: 'a2', name: 'Porte',        x: 0.75, y: 0.55 },
  { id: 'a3', name: 'Perchoir',     x: 0.5, y: 0.25 },
]

const DEFAULT_ATTACHMENTS: Attachment[] = [
  { id: 't1', anchorId: 'a1', kind: 'light',  color: '#ffd580', radius: 180, intensity: 0.85 },
  { id: 't2', anchorId: 'a2', kind: 'light',  color: '#ff4da6', radius: 100, intensity: 1 },
  { id: 't3', anchorId: 'a3', kind: 'sprite', scale: 1.5 },
]

export default function AnchorsTestPage() {
  const [anchors, setAnchors] = useState<Anchor[]>(DEFAULT_ANCHORS)
  const [attachments, setAttachments] = useState<Attachment[]>(DEFAULT_ATTACHMENTS)
  const [selectedAnchorId, setSelectedAnchorId] = useState<string | null>('a1')
  const [dragAnchorId, setDragAnchorId] = useState<string | null>(null)
  const [placingMode, setPlacingMode] = useState(false)
  const [bgUrl, setBgUrl] = useState('')
  const [spriteSheet, setSpriteSheet] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setSpriteSheet(generateBirdSheet()) }, [])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!placingMode || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const id = `a${Date.now()}`
    const name = prompt('Nom de ce point d\'ancrage ?', `Point ${anchors.length + 1}`)
    if (!name) { setPlacingMode(false); return }
    setAnchors([...anchors, { id, name, x, y }])
    setSelectedAnchorId(id)
    setPlacingMode(false)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragAnchorId || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    setAnchors(anchors.map(a => a.id === dragAnchorId ? { ...a, x, y } : a))
  }

  function removeAnchor(id: string) {
    setAnchors(anchors.filter(a => a.id !== id))
    setAttachments(attachments.filter(t => t.anchorId !== id))
  }

  function addAttachment(anchorId: string, kind: 'light' | 'sprite') {
    const id = `t${Date.now()}`
    const newAtt: Attachment = kind === 'light'
      ? { id, anchorId, kind: 'light', color: '#ffd580', radius: 120, intensity: 0.8 }
      : { id, anchorId, kind: 'sprite', scale: 1.5 }
    setAttachments([...attachments, newAtt])
  }

  function removeAttachment(id: string) {
    setAttachments(attachments.filter(t => t.id !== id))
  }

  const selectedAnchor = anchors.find(a => a.id === selectedAnchorId)
  const attachmentsByAnchor = selectedAnchor ? attachments.filter(t => t.anchorId === selectedAnchor.id) : []

  const bgStyle: React.CSSProperties = bgUrl.trim()
    ? { backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: 'linear-gradient(135deg, #1a1a2e 0%, #0a0a12 100%)' }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          Points d&apos;ancrage nommés — primitive §6
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 20 }}>
          L&apos;auteur place des points d&apos;intérêt nommés sur l&apos;image. Les calques s&apos;attachent à ces
          points par référence. Déplacer un point = déplacer tout ce qui y est accroché.
          <br />
          <strong style={{ color: '#d4a84c' }}>Essaye</strong> : drag un point rose ci-dessous et vois les lumières/sprites le suivre.
        </p>

        {/* Preview */}
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => setDragAnchorId(null)}
          onPointerLeave={() => setDragAnchorId(null)}
          style={{
            position: 'relative',
            aspectRatio: '16/9',
            border: '1px solid #2a2a30',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
            cursor: placingMode ? 'crosshair' : 'default',
            ...bgStyle,
          }}
        >
          {/* Render attachments */}
          {attachments.map(att => {
            const anchor = anchors.find(a => a.id === att.anchorId)
            if (!anchor) return null
            if (att.kind === 'light') {
              return (
                <LightLayer
                  key={att.id}
                  position={{ x: anchor.x, y: anchor.y }}
                  color={att.color}
                  radius={att.radius}
                  intensity={att.intensity}
                  mode="flicker"
                  flickerAmount={0.3}
                  speed={1.2}
                />
              )
            }
            if (att.kind === 'sprite' && spriteSheet) {
              return (
                <SpriteLayer
                  key={att.id}
                  sheetUrl={spriteSheet}
                  frameWidth={48}
                  frameHeight={48}
                  frameCount={4}
                  frameDuration={150}
                  loop="loop"
                  scale={att.scale ?? 1}
                  position={{ x: anchor.x, y: anchor.y }}
                />
              )
            }
            return null
          })}

          {/* Render anchor markers (pastilles draggables) */}
          {anchors.map(a => (
            <div
              key={a.id}
              onPointerDown={e => {
                if (placingMode) return
                e.stopPropagation()
                setDragAnchorId(a.id)
                setSelectedAnchorId(a.id)
              }}
              style={{
                position: 'absolute',
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: 18, height: 18,
                borderRadius: '50%',
                background: selectedAnchorId === a.id ? '#EC4899' : 'rgba(236,72,153,0.5)',
                border: '2px solid white',
                cursor: 'grab',
                zIndex: 20,
                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
              }}
              title={a.name}
            >
              <div style={{
                position: 'absolute',
                top: 22, left: '50%',
                transform: 'translateX(-50%)',
                fontSize: 10, fontWeight: 600,
                color: 'white',
                background: 'rgba(0,0,0,0.7)',
                padding: '2px 6px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
              }}>
                {a.name}
              </div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={sectionBox}>
            <div style={sectionTitle}>Points d&apos;ancrage ({anchors.length})</div>
            <button onClick={() => setPlacingMode(!placingMode)} style={{ ...btnStyle, marginBottom: 6, background: placingMode ? '#EC4899' : '#1a1a1e' }}>
              {placingMode ? '✕ Annuler placement' : '+ Placer un point (clic sur la scène)'}
            </button>
            {anchors.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
                <button
                  onClick={() => setSelectedAnchorId(a.id)}
                  style={{
                    flex: 1, textAlign: 'left',
                    padding: '4px 8px',
                    background: selectedAnchorId === a.id ? '#2a2a30' : 'transparent',
                    border: '1px solid ' + (selectedAnchorId === a.id ? '#EC4899' : '#2a2a30'),
                    borderRadius: 4, color: '#ede9df', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  📍 {a.name} <span style={{ color: '#6e6e85' }}>({a.x.toFixed(2)}, {a.y.toFixed(2)})</span>
                </button>
                <button onClick={() => removeAnchor(a.id)} style={{ width: 22, height: 22, padding: 0, background: 'transparent', border: '1px solid #3a3a42', borderRadius: 4, color: '#ef4444', cursor: 'pointer' }}>×</button>
              </div>
            ))}
          </div>

          <div style={sectionBox}>
            <div style={sectionTitle}>
              {selectedAnchor ? `Attachements sur "${selectedAnchor.name}"` : 'Sélectionne un point'}
            </div>
            {selectedAnchor && (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button onClick={() => addAttachment(selectedAnchor.id, 'light')} style={btnStyle}>+ Lumière</button>
                  <button onClick={() => addAttachment(selectedAnchor.id, 'sprite')} style={btnStyle}>+ Sprite</button>
                </div>
                {attachmentsByAnchor.length === 0 && <div style={{ color: '#6e6e85', fontSize: 12, fontStyle: 'italic' }}>Aucun attachement.</div>}
                {attachmentsByAnchor.map(t => (
                  <div key={t.id} style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 8px', background: '#1a1a1e', borderRadius: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: '#ede9df', flex: 1 }}>
                      {t.kind === 'light' ? '💡' : '🎭'} {t.kind}
                    </span>
                    <button onClick={() => removeAttachment(t.id)} style={{ width: 22, height: 22, padding: 0, background: 'transparent', border: '1px solid #3a3a42', borderRadius: 4, color: '#ef4444', cursor: 'pointer' }}>×</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6 }}>
          <input type="url" value={bgUrl} onChange={e => setBgUrl(e.target.value)} placeholder="URL image de fond (optionnel) — permet de tester sur une vraie scène" style={inputStyle} />
        </div>

        <div style={{ marginTop: 12, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>Cas d&apos;usage réels :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Plan de taverne : points « comptoir », « cheminée », « table du fond » → l&apos;IA place les PNJ et lumières sur ces points</li>
            <li>Ruelle Bronx : points « lampadaire », « poubelle », « porte de squat » → lumières + hotspots s&apos;y accrochent</li>
            <li>Donjon : points « entrée », « coffre », « torche murale » → sprites + lumières attachés</li>
            <li>Si l&apos;image est régénérée (IA qui refait l&apos;illustration), l&apos;auteur replace les 3-4 points, tout le reste suit automatiquement sans re-paramétrer</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function generateBirdSheet(): string {
  const frameW = 48, frameH = 48, count = 4
  const canvas = document.createElement('canvas')
  canvas.width = frameW * count
  canvas.height = frameH
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  for (let i = 0; i < count; i++) {
    const cx = i * frameW + 24
    const cy = 24
    // Body
    ctx.fillStyle = '#2a2a30'
    ctx.beginPath()
    ctx.ellipse(cx, cy, 8, 6, 0, 0, Math.PI * 2)
    ctx.fill()
    // Wings (up/down per frame)
    const wingY = [0, -6, 0, 6][i]
    ctx.beginPath()
    ctx.ellipse(cx - 6, cy + wingY, 8, 4, -0.3, 0, Math.PI * 2)
    ctx.ellipse(cx + 6, cy + wingY, 8, 4, 0.3, 0, Math.PI * 2)
    ctx.fill()
    // Head
    ctx.beginPath()
    ctx.arc(cx + 8, cy - 2, 4, 0, Math.PI * 2)
    ctx.fill()
    // Beak
    ctx.fillStyle = '#ffa040'
    ctx.beginPath()
    ctx.moveTo(cx + 12, cy - 2)
    ctx.lineTo(cx + 16, cy - 1)
    ctx.lineTo(cx + 12, cy)
    ctx.closePath()
    ctx.fill()
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
  padding: '6px 10px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
