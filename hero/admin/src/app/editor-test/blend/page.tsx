'use client'
/**
 * Démo Blend modes — primitive §10.
 * URL : http://localhost:3000/editor-test/blend
 *
 * Montre l'impact des modes de fusion CSS sur des calques posés sur une image.
 * Cas d'usage :
 *   - multiply    → ombre / teinte sombre (nuit bleue par-dessus une scène jour)
 *   - screen      → lumière / halo (ajouté au-dessus)
 *   - overlay     → contraste renforcé (ambiance dramatique)
 *   - darken      → ne garde que le plus sombre (effet brume)
 *   - lighten     → ne garde que le plus clair (effet brouillard lumineux)
 *   - color       → teinte l'image sans toucher luminance (filtre colorimétrique)
 */

import React, { useState } from 'react'

type BlendMode = NonNullable<React.CSSProperties['mixBlendMode']>

const MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
]

const PRESETS = [
  { label: '☀️ Ambiance jour',      color: '#fff8e1', blend: 'overlay' as BlendMode,   opacity: 0.3 },
  { label: '🌙 Nuit bleue',         color: '#1a3a7a', blend: 'multiply' as BlendMode,  opacity: 0.6 },
  { label: '🔥 Apocalypse rouge',   color: '#ff2a00', blend: 'multiply' as BlendMode,  opacity: 0.45 },
  { label: '💚 Toxique',            color: '#1fff80', blend: 'color' as BlendMode,     opacity: 0.35 },
  { label: '🎞️ Sépia',              color: '#c08040', blend: 'color' as BlendMode,     opacity: 0.5 },
  { label: '💙 Heure bleue',        color: '#5080ff', blend: 'soft-light' as BlendMode, opacity: 0.6 },
  { label: '💛 Heure dorée',        color: '#ffb840', blend: 'soft-light' as BlendMode, opacity: 0.6 },
  { label: '🌫️ Brume',              color: '#ffffff', blend: 'lighten' as BlendMode,   opacity: 0.3 },
]

export default function BlendTestPage() {
  const [bgUrl, setBgUrl] = useState('https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1344&h=768&fit=crop')
  const [color, setColor] = useState('#1a3a7a')
  const [blend, setBlend] = useState<BlendMode>('multiply')
  const [opacity, setOpacity] = useState(0.6)

  function applyPreset(p: typeof PRESETS[number]) {
    setColor(p.color)
    setBlend(p.blend)
    setOpacity(p.opacity)
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          Blend modes — primitive §10
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 20 }}>
          Pose un calque de couleur uniforme sur une image et fais varier le blend mode + opacité.
          Démontre les teintes globales (ambiance jour/nuit/apocalypse) typiques des plans Hero.
        </p>

        {/* Preview */}
        <div style={{ position: 'relative', aspectRatio: '16/9', background: '#0a0a12', border: '1px solid #2a2a30', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <img src={bgUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: color, opacity,
            mixBlendMode: blend,
            pointerEvents: 'none',
          }} />
        </div>

        {/* Presets */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Presets d&apos;ambiance</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => applyPreset(p)} style={btnStyle}>{p.label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div style={sectionBox}>
            <Field label="Image de fond (URL)">
              <input type="url" value={bgUrl} onChange={e => setBgUrl(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Couleur du calque">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: '100%', height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }} />
            </Field>
          </div>

          <div style={sectionBox}>
            <Field label="Blend mode">
              <select value={blend} onChange={e => setBlend(e.target.value as BlendMode)} style={inputStyle}>
                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label={`Opacité : ${opacity.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
          </div>
        </div>

        <div style={{ marginTop: 20, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À retenir :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li><code>multiply</code> = assombrit (parfait pour nuit, ombre globale)</li>
            <li><code>screen</code> / <code>lighten</code> = éclaircit (halos, brume lumineuse)</li>
            <li><code>overlay</code> / <code>soft-light</code> = contraste renforcé, vivant</li>
            <li><code>color</code> = teinte sans toucher la luminance (sépia, filtre instagram)</li>
          </ul>
          Les mêmes modes existent sur <code>SpriteLayer</code> et <code>LightLayer</code> via le prop <code>mixBlendMode</code>.
        </div>
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
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
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
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
