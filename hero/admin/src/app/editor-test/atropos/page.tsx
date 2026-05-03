'use client'
/**
 * POC Atropos — parallax 3D au survol (effet de profondeur).
 * URL : http://localhost:3000/editor-test/atropos
 *
 * Cas d'usage Hero : vignettes de plans / items / personnages avec effet
 * "wahoo" au hover. Plusieurs couches d'illustrations qui se décalent en
 * profondeur quand la souris bouge, donnant l'impression de relief 3D.
 *
 * Lib : atropos (par nolimits4web, le créateur de Swiper).
 */

import React, { useState } from 'react'
import Atropos from 'atropos/react'
import 'atropos/css'

type DemoKey = 'simple_card' | 'multi_layer' | 'plan_vignette'

const DEMO_LABELS: Record<DemoKey, string> = {
  simple_card: '🃏 Carte simple (1 image)',
  multi_layer: '🎴 Multi-couches (4 layers)',
  plan_vignette: '🖼️ Vignette de plan (style Hero)',
}

export default function AtroposTestPage() {
  const [demoKey, setDemoKey] = useState<DemoKey>('multi_layer')
  const [shadowScale, setShadowScale] = useState(1)
  const [highlight, setHighlight] = useState(true)
  const [activeOffset, setActiveOffset] = useState(50)
  const [rotateXMax, setRotateXMax] = useState(15)
  const [rotateYMax, setRotateYMax] = useState(15)

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Atropos — parallax 3D au survol
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          <strong style={{ color: '#d4a84c' }}>Survole les cartes ci-dessous</strong> pour voir l&apos;effet 3D.
          Utilise <code>data-atropos-offset</code> pour positionner chaque calque dans la profondeur (négatif = vers l&apos;arrière, positif = vers l&apos;avant).
        </p>

        {/* Stage */}
        <div style={{
          padding: '60px',
          background: '#0f0f13',
          border: '1px solid #2a2a30',
          borderRadius: 8,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 500,
        }}>
          {demoKey === 'simple_card' && (
            <Atropos
              shadowScale={shadowScale}
              highlight={highlight}
              activeOffset={activeOffset}
              rotateXMax={rotateXMax}
              rotateYMax={rotateYMax}
              style={{ width: 400, height: 280 }}
            >
              <img
                src="https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=800&h=600&fit=crop"
                alt="Forest"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, display: 'block' }}
              />
            </Atropos>
          )}

          {demoKey === 'multi_layer' && (
            <Atropos
              shadowScale={shadowScale}
              highlight={highlight}
              activeOffset={activeOffset}
              rotateXMax={rotateXMax}
              rotateYMax={rotateYMax}
              style={{ width: 400, height: 500 }}
            >
              {/* Layer 1 (le plus en arrière) : background */}
              <img
                src="https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=800&h=1000&fit=crop"
                alt=""
                data-atropos-offset="-5"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }}
              />
              {/* Layer 2 : voile sombre */}
              <div
                data-atropos-offset="0"
                style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.85) 100%)',
                  borderRadius: 8,
                }}
              />
              {/* Layer 3 : texte titre (mid) */}
              <div
                data-atropos-offset="3"
                style={{
                  position: 'absolute', bottom: 50, left: 20, right: 20,
                  color: 'white',
                  fontSize: 24,
                  fontWeight: 700,
                  textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                }}
              >
                La forêt sombre
              </div>
              {/* Layer 4 : badge "PLAN 1" (le plus en avant) */}
              <div
                data-atropos-offset="8"
                style={{
                  position: 'absolute', top: 16, right: 16,
                  padding: '6px 12px',
                  background: '#EC4899',
                  color: 'white',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 4,
                  letterSpacing: 1,
                }}
              >
                PLAN 1
              </div>
              {/* Layer 5 : icône action (max forward) */}
              <div
                data-atropos-offset="12"
                style={{
                  position: 'absolute', bottom: 16, right: 16,
                  width: 48, height: 48,
                  borderRadius: 24,
                  background: '#d4a84c',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 24,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              >
                ▶
              </div>
            </Atropos>
          )}

          {demoKey === 'plan_vignette' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
              {[
                { bg: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=600&h=400&fit=crop', title: 'Forêt sombre', n: 1 },
                { bg: 'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=600&h=400&fit=crop', title: 'Château hanté', n: 2 },
                { bg: 'https://images.unsplash.com/photo-1465056836041-7f43ac27dcb5?w=600&h=400&fit=crop', title: 'Crête venteuse', n: 3 },
              ].map(p => (
                <Atropos
                  key={p.n}
                  shadowScale={shadowScale}
                  highlight={highlight}
                  activeOffset={activeOffset}
                  rotateXMax={rotateXMax}
                  rotateYMax={rotateYMax}
                  style={{ width: 240, height: 160 }}
                >
                  <img src={p.bg} alt="" data-atropos-offset="-3" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
                  <div data-atropos-offset="0" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(0,0,0,0.8), transparent 70%)', borderRadius: 6 }} />
                  <div data-atropos-offset="5" style={{ position: 'absolute', bottom: 8, left: 12, color: 'white', fontSize: 14, fontWeight: 600, textShadow: '0 1px 4px black' }}>
                    {p.title}
                  </div>
                  <div data-atropos-offset="10" style={{ position: 'absolute', top: 8, left: 8, padding: '2px 6px', background: '#EC4899', color: 'white', fontSize: 9, fontWeight: 700, borderRadius: 3 }}>
                    PLAN {p.n}
                  </div>
                </Atropos>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Démo">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(Object.keys(DEMO_LABELS) as DemoKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setDemoKey(k)}
                  style={{ ...btnStyle, background: demoKey === k ? '#EC4899' : '#1a1a1e' }}
                >
                  {DEMO_LABELS[k]}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Paramètres">
            <Field label={`Rotation X max : ${rotateXMax}°`}>
              <input type="range" min={0} max={45} step={1} value={rotateXMax} onChange={e => setRotateXMax(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Rotation Y max : ${rotateYMax}°`}>
              <input type="range" min={0} max={45} step={1} value={rotateYMax} onChange={e => setRotateYMax(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Active offset : ${activeOffset}`}>
              <input type="range" min={0} max={150} step={5} value={activeOffset} onChange={e => setActiveOffset(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Shadow scale : ${shadowScale.toFixed(1)}`}>
              <input type="range" min={0} max={3} step={0.1} value={shadowScale} onChange={e => setShadowScale(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#ede9df', cursor: 'pointer' }}>
              <input type="checkbox" checked={highlight} onChange={e => setHighlight(e.target.checked)} />
              Highlight (reflet)
            </label>
          </Section>

          <Section title="À évaluer">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#9898b4', lineHeight: 1.7 }}>
              <li>Effet 3D fluide (CSS transform GPU-accel)</li>
              <li>Multi-couches via <code>data-atropos-offset</code></li>
              <li>Bundle ~7 kb gzip</li>
              <li>Idéal pour vignettes de plans / items rares / cartes NPC</li>
              <li>Pas de mobile gyroscope par défaut, à voir si on le veut</li>
            </ul>
          </Section>
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
  padding: '8px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
