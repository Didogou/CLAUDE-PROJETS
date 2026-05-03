'use client'
/**
 * Page de test LightLayer — primitive §3 (point lumineux + flicker).
 * URL : http://localhost:3000/editor-test/light
 *
 * Permet d'ajuster les paramètres d'un halo lumineux + flicker en live,
 * et de superposer plusieurs lumières pour voir le cumul additif (scène
 * taverne, ruelle, atelier de forgeron, etc.).
 */

import React, { useState } from 'react'
import LightLayer, { type LightMode, type LightLayerProps } from '@/components/image-editor/LightLayer'

interface LightInstance extends LightLayerProps {
  id: string
  label: string
}

// Presets rapides pour tester des ambiances typiques
const PRESETS: Array<{ label: string; icon: string; props: Omit<LightInstance, 'id' | 'label'> }> = [
  {
    label: 'Bougie', icon: '🕯️',
    props: { color: '#ffb366', intensity: 0.9, radius: 80, mode: 'flicker', flickerAmount: 0.35, speed: 1.2, position: { x: 0.5, y: 0.5 } },
  },
  {
    label: 'Torche', icon: '🔥',
    props: { color: '#ff8c40', intensity: 1, radius: 150, mode: 'flicker', flickerAmount: 0.45, speed: 1.5, position: { x: 0.5, y: 0.5 } },
  },
  {
    label: 'Néon défectueux', icon: '💡',
    props: { color: '#ff4da6', intensity: 1, radius: 100, mode: 'strobe', flickerAmount: 0.8, speed: 3, position: { x: 0.5, y: 0.5 } },
  },
  {
    label: 'Cristal magique', icon: '💎',
    props: { color: '#7ec8ff', intensity: 0.8, radius: 110, mode: 'pulse', flickerAmount: 0.5, speed: 0.8, position: { x: 0.5, y: 0.5 } },
  },
  {
    label: 'Lampadaire', icon: '🪔',
    props: { color: '#ffd580', intensity: 0.85, radius: 200, mode: 'flicker', flickerAmount: 0.12, speed: 0.5, position: { x: 0.5, y: 0.5 } },
  },
  {
    label: 'Lune', icon: '🌙',
    props: { color: '#c0d8ff', intensity: 0.6, radius: 220, mode: 'static', flickerAmount: 0, speed: 1, position: { x: 0.5, y: 0.5 } },
  },
  {
    label: 'Gyrophare', icon: '🚨',
    props: { color: '#ff3333', intensity: 1, radius: 140, mode: 'strobe', flickerAmount: 1, speed: 2, position: { x: 0.5, y: 0.5 } },
  },
  {
    label: 'LED pulse', icon: '🔵',
    props: { color: '#6fd3ff', intensity: 0.8, radius: 60, mode: 'pulse', flickerAmount: 0.7, speed: 1.5, position: { x: 0.5, y: 0.5 } },
  },
]

const DEFAULT_BG = 'radial-gradient(circle at 30% 40%, #1a1a2e 0%, #0d0d14 100%)'

export default function LightTestPage() {
  const [lights, setLights] = useState<LightInstance[]>([
    { id: 'l1', label: 'Bougie', ...PRESETS[0].props, position: { x: 0.3, y: 0.5 } },
  ])
  const [selectedId, setSelectedId] = useState<string>('l1')
  const [bgUrl, setBgUrl] = useState('')

  const selected = lights.find(l => l.id === selectedId)

  function addPreset(preset: typeof PRESETS[number]) {
    const id = `l${Date.now()}`
    setLights([...lights, { id, label: preset.label, ...preset.props, position: { x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4 } }])
    setSelectedId(id)
  }

  function updateSelected(patch: Partial<LightInstance>) {
    setLights(lights.map(l => l.id === selectedId ? { ...l, ...patch } : l))
  }

  function removeLight(id: string) {
    const next = lights.filter(l => l.id !== id)
    setLights(next)
    if (selectedId === id && next.length > 0) setSelectedId(next[0].id)
  }

  function clearAll() {
    if (!confirm('Supprimer toutes les lumières ?')) return
    setLights([])
  }

  const bgStyle: React.CSSProperties = bgUrl.trim()
    ? { backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: DEFAULT_BG }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 4 }}>
          LightLayer — primitive §3 (point lumineux + flicker)
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 20 }}>
          Ajoute des lumières (presets ou manuelles), superpose-les, ajuste en live.
          Les halos s&apos;additionnent via <code>mix-blend-mode: screen</code> pour un rendu réaliste.
        </p>

        {/* Preview */}
        <div style={{ position: 'relative', aspectRatio: '16/9', border: '1px solid #2a2a30', borderRadius: 8, overflow: 'hidden', marginBottom: 16, ...bgStyle }}>
          {lights.map(l => (
            <LightLayer
              key={l.id}
              position={l.position}
              color={l.color}
              intensity={l.intensity}
              radius={l.radius}
              mode={l.mode}
              flickerAmount={l.flickerAmount}
              speed={l.speed}
              mixBlendMode={l.mixBlendMode}
            />
          ))}
          {/* Marqueurs cliquables pour sélectionner une lumière */}
          {lights.map(l => (
            <button
              key={`marker-${l.id}`}
              onClick={() => setSelectedId(l.id)}
              style={{
                position: 'absolute',
                left: `${(l.position?.x ?? 0.5) * 100}%`,
                top: `${(l.position?.y ?? 0.5) * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: 14, height: 14,
                borderRadius: '50%',
                background: selectedId === l.id ? '#EC4899' : 'rgba(255,255,255,0.4)',
                border: selectedId === l.id ? '2px solid white' : '1px solid rgba(255,255,255,0.6)',
                cursor: 'pointer',
                padding: 0,
                zIndex: 10,
              }}
              title={l.label}
            />
          ))}
        </div>

        {/* Presets */}
        <Section title="Ajouter une lumière (preset)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => addPreset(p)} style={presetBtn}>
                <span style={{ fontSize: 16 }}>{p.icon}</span>
                <span>{p.label}</span>
              </button>
            ))}
            {lights.length > 0 && (
              <button onClick={clearAll} style={{ ...presetBtn, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
                🗑 Tout effacer
              </button>
            )}
          </div>
        </Section>

        {/* Liste + édition */}
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, marginTop: 12 }}>
          <Section title={`Lumières (${lights.length})`}>
            {lights.length === 0 && <div style={{ color: '#6e6e85', fontSize: 12 }}>Aucune. Ajoute un preset ci-dessus.</div>}
            {lights.map(l => (
              <div key={l.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  onClick={() => setSelectedId(l.id)}
                  style={{
                    flex: 1, textAlign: 'left',
                    padding: '6px 8px',
                    background: selectedId === l.id ? '#2a2a30' : 'transparent',
                    border: '1px solid ' + (selectedId === l.id ? '#EC4899' : '#2a2a30'),
                    borderRadius: 4, color: '#ede9df', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: l.color, marginRight: 6 }} />
                  {l.label}
                </button>
                <button onClick={() => removeLight(l.id)} style={{ width: 22, height: 22, padding: 0, background: 'transparent', border: '1px solid #3a3a42', borderRadius: 4, color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
              </div>
            ))}
          </Section>

          {selected && (
            <Section title={`Éditer : ${selected.label}`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                <Field label="Couleur">
                  <input type="color" value={selected.color ?? '#ffffff'} onChange={e => updateSelected({ color: e.target.value })} style={{ width: '100%', height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                </Field>
                <Field label="Mode">
                  <select value={selected.mode ?? 'flicker'} onChange={e => updateSelected({ mode: e.target.value as LightMode })} style={inputStyle}>
                    <option value="static">Statique</option>
                    <option value="flicker">Flicker (bougie/torche)</option>
                    <option value="pulse">Pulse (cristal/LED)</option>
                    <option value="strobe">Strobe (gyrophare)</option>
                  </select>
                </Field>
                <Field label={`Intensité : ${(selected.intensity ?? 1).toFixed(2)}`}>
                  <input type="range" min={0} max={1} step={0.01} value={selected.intensity ?? 1} onChange={e => updateSelected({ intensity: Number(e.target.value) })} style={{ width: '100%' }} />
                </Field>
                <Field label={`Rayon : ${selected.radius}px`}>
                  <input type="range" min={20} max={400} value={selected.radius ?? 120} onChange={e => updateSelected({ radius: Number(e.target.value) })} style={{ width: '100%' }} />
                </Field>
                <Field label={`Flicker : ${(selected.flickerAmount ?? 0.4).toFixed(2)}`}>
                  <input type="range" min={0} max={1} step={0.01} value={selected.flickerAmount ?? 0.4} onChange={e => updateSelected({ flickerAmount: Number(e.target.value) })} style={{ width: '100%' }} />
                </Field>
                <Field label={`Vitesse : ${(selected.speed ?? 1).toFixed(1)}`}>
                  <input type="range" min={0.1} max={5} step={0.1} value={selected.speed ?? 1} onChange={e => updateSelected({ speed: Number(e.target.value) })} style={{ width: '100%' }} />
                </Field>
                <Field label={`Position X : ${(selected.position?.x ?? 0.5).toFixed(2)}`}>
                  <input type="range" min={0} max={1} step={0.01} value={selected.position?.x ?? 0.5} onChange={e => updateSelected({ position: { x: Number(e.target.value), y: selected.position?.y ?? 0.5 } })} style={{ width: '100%' }} />
                </Field>
                <Field label={`Position Y : ${(selected.position?.y ?? 0.5).toFixed(2)}`}>
                  <input type="range" min={0} max={1} step={0.01} value={selected.position?.y ?? 0.5} onChange={e => updateSelected({ position: { x: selected.position?.x ?? 0.5, y: Number(e.target.value) } })} style={{ width: '100%' }} />
                </Field>
              </div>
            </Section>
          )}
        </div>

        {/* Background URL */}
        <Section title="Image de fond (optionnelle)">
          <input
            type="url"
            value={bgUrl}
            onChange={e => setBgUrl(e.target.value)}
            placeholder="https://…/scene.jpg  — permet de tester sur une vraie scène"
            style={inputStyle}
          />
        </Section>

        <div style={{ marginTop: 20, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>Tests recommandés :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Ajoute 3-4 lumières de types différents (Bougie + Torche + Lampadaire) et déplace-les → vérifie que les halos se cumulent bien (mix-blend-mode: screen)</li>
            <li>Ajoute un Gyrophare + une Lune → contraste animé vs statique</li>
            <li>Charge une image de ruelle Bronx en bg et pose un Lampadaire + un Néon défectueux dessus → scène ambiance</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
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

const presetBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
