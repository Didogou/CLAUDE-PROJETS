'use client'
/**
 * POC vanta.js — backgrounds animés WebGL (FOG, CLOUDS, BIRDS, NET, WAVES…).
 * URL : http://localhost:3000/editor-test/vanta
 *
 * Cas d'usage Hero : couches d'ambiance (brouillard, nuages, vagues) qui se
 * superposent ou remplacent une image statique. Idée : pour une scène brumeuse,
 * vanta FOG par-dessus l'illustration statique = bcp plus vivant.
 *
 * Stack : vanta + three (déjà installé).
 *
 * ⚠️ Recommandation officielle : ne pas afficher 2+ effets vanta simultanés
 * sur la même page (perfs WebGL). Pour Hero on garde 1 effet par "couche météo".
 */

import React, { useEffect, useRef, useState } from 'react'
// ⚠️ Vanta a été buildé contre THREE r134 (2021). Les versions ≥ r150 ont
// supprimé/renommé des classes → "X is not a constructor". On utilise un
// alias npm 'three-r134' (installé en parallèle de la version r184 utilisée
// par Pano360Viewer). On le passe explicitement à factory({THREE}) pour
// override la capture module-level interne de vanta.
import * as THREE from 'three-r134'

// Pose THREE r134 sur window IMMÉDIATEMENT à l'évaluation du module (avant
// tout useEffect / dynamic import). Vanta capture window.THREE à son top-level
// quand son bundle est chargé — il faut donc être prêt avant. 'use client' →
// ce code ne tourne que dans le navigateur, mais on garde le check window
// pour ne pas péter en cas d'évaluation SSR du module.
if (typeof window !== 'undefined') {
  const w = window as unknown as { THREE?: unknown }
  if (!w.THREE) w.THREE = THREE
}

// Type minimal pour les retours vanta (objet avec setOptions/destroy).
interface VantaInstance {
  setOptions(opts: Record<string, unknown>): void
  destroy(): void
}
type VantaFactory = (opts: Record<string, unknown>) => VantaInstance

const TEST_BG_URLS = [
  'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=1200&h=800&fit=crop',  // forêt
  'https://images.unsplash.com/photo-1465056836041-7f43ac27dcb5?w=1200&h=800&fit=crop',  // montagne
  'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1200&h=800&fit=crop',  // château
]

type EffectKey = 'FOG' | 'CLOUDS' | 'CLOUDS2' | 'BIRDS' | 'NET' | 'WAVES' | 'HALO' | 'TOPOLOGY' | 'CELLS' | 'GLOBE' | 'RINGS'

const EFFECT_LABELS: Record<EffectKey, string> = {
  FOG: '🌫️ Brouillard',
  CLOUDS: '☁️ Nuages',
  CLOUDS2: '☁️ Nuages 2',
  BIRDS: '🐦 Oiseaux',
  NET: '🕸️ Réseau',
  WAVES: '🌊 Vagues',
  HALO: '🌀 Halo',
  TOPOLOGY: '🗺️ Topologie',
  CELLS: '🧬 Cellules',
  GLOBE: '🌐 Globe',
  RINGS: '⭕ Anneaux',
}

// Defaults curés pour faire ressortir l'effet sur fond sombre.
const EFFECT_DEFAULTS: Record<EffectKey, Record<string, unknown>> = {
  FOG: {
    highlightColor: 0xd4a84c,
    midtoneColor: 0x6e3a8c,
    lowlightColor: 0x1a1a30,
    baseColor: 0x000000,
    blurFactor: 0.6,
    speed: 1.5,
    zoom: 1,
  },
  CLOUDS: {
    skyColor: 0x68b8d7,
    cloudColor: 0xadc1de,
    cloudShadowColor: 0x183550,
    sunColor: 0xff9919,
    sunGlareColor: 0xff6633,
    sunlightColor: 0xff9933,
    speed: 1,
  },
  CLOUDS2: {
    backgroundColor: 0x0d0d0d,
    skyColor: 0x000022,
    cloudColor: 0xffffff,
    lightColor: 0xffffff,
    speed: 1,
  },
  BIRDS: {
    backgroundColor: 0x0d0d0d,
    color1: 0xff6699,
    color2: 0xd4a84c,
    quantity: 3,
    birdSize: 1.2,
    wingSpan: 25,
    speedLimit: 5,
  },
  NET: {
    backgroundColor: 0x0d0d0d,
    color: 0xec4899,
    points: 10,
    maxDistance: 25,
    spacing: 18,
  },
  WAVES: {
    color: 0x1a3a5c,
    shininess: 60,
    waveHeight: 15,
    waveSpeed: 0.8,
    zoom: 0.9,
  },
  HALO: {
    backgroundColor: 0x0d0d0d,
    baseColor: 0x6e3a8c,
    amplitudeFactor: 1.5,
    size: 1.5,
  },
  TOPOLOGY: {
    backgroundColor: 0x0d0d0d,
    color: 0xd4a84c,
  },
  CELLS: {
    color1: 0x0d0d0d,
    color2: 0xd4a84c,
    size: 1.5,
    speed: 1,
  },
  GLOBE: {
    backgroundColor: 0x0d0d0d,
    color: 0xec4899,
    color2: 0xffffff,
    size: 1,
  },
  RINGS: {
    backgroundColor: 0x0d0d0d,
    color: 0xd4a84c,
  },
}

// Map effect → import dynamique (Next.js code-split chacune des libs).
async function loadVantaEffect(key: EffectKey): Promise<VantaFactory> {
  switch (key) {
    case 'FOG': return (await import('vanta/dist/vanta.fog.min')).default as VantaFactory
    case 'CLOUDS': return (await import('vanta/dist/vanta.clouds.min')).default as VantaFactory
    case 'CLOUDS2': return (await import('vanta/dist/vanta.clouds2.min')).default as VantaFactory
    case 'BIRDS': return (await import('vanta/dist/vanta.birds.min')).default as VantaFactory
    case 'NET': return (await import('vanta/dist/vanta.net.min')).default as VantaFactory
    case 'WAVES': return (await import('vanta/dist/vanta.waves.min')).default as VantaFactory
    case 'HALO': return (await import('vanta/dist/vanta.halo.min')).default as VantaFactory
    case 'TOPOLOGY': return (await import('vanta/dist/vanta.topology.min')).default as VantaFactory
    case 'CELLS': return (await import('vanta/dist/vanta.cells.min')).default as VantaFactory
    case 'GLOBE': return (await import('vanta/dist/vanta.globe.min')).default as VantaFactory
    case 'RINGS': return (await import('vanta/dist/vanta.rings.min')).default as VantaFactory
  }
}

export default function VantaTestPage() {
  const [effectKey, setEffectKey] = useState<EffectKey>('FOG')
  const [bgUrl, setBgUrl] = useState(TEST_BG_URLS[0])
  const [overlayMode, setOverlayMode] = useState<'mix' | 'pure'>('mix')
  const [opacity, setOpacity] = useState(0.7)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<VantaInstance | null>(null)

  // À chaque changement d'effet, monter une instance vanta. Try/catch sur
  // destroy() pour absorber l'erreur React 19 strict-mode "removeChild on
  // detached node" (vanta tente de retirer un canvas déjà nettoyé par React).
  // window.THREE est déjà posé au top-level du module.
  useEffect(() => {
    let cancelled = false

    if (instanceRef.current) {
      try { instanceRef.current.destroy() } catch { /* ignore double-destroy */ }
      instanceRef.current = null
    }

    if (!containerRef.current) return

    loadVantaEffect(effectKey)
      .then((factory) => {
        if (cancelled || !containerRef.current) return
        try {
          instanceRef.current = factory({
            el: containerRef.current,
            THREE,  // r134 via alias npm → compat vanta
            mouseControls: true,
            touchControls: true,
            gyroControls: false,
            minHeight: 200,
            minWidth: 200,
            ...EFFECT_DEFAULTS[effectKey],
          })
          setError(null)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      })
      .catch((e) => {
        setError(`Import effect ${effectKey} failed: ${e instanceof Error ? e.message : String(e)}`)
      })

    return () => {
      cancelled = true
      if (instanceRef.current) {
        try { instanceRef.current.destroy() } catch { /* ignore */ }
        instanceRef.current = null
      }
    }
  }, [effectKey])

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC vanta.js — backgrounds WebGL animés
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          11 effets testables. Mode <em>mix</em> = vanta en overlay sur l&apos;image (avec opacity), mode <em>pure</em> = vanta seul.
          Idée Hero : couche d&apos;ambiance (brouillard, nuages) par-dessus illustration statique.
        </p>

        {/* Preview */}
        <div style={{
          position: 'relative',
          aspectRatio: '16/9',
          background: overlayMode === 'mix' ? `url(${bgUrl}) center/cover` : '#000',
          border: '1px solid #2a2a30',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 16,
        }}>
          <div
            ref={containerRef}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: overlayMode === 'mix' ? opacity : 1,
              pointerEvents: 'none',
            }}
          />
        </div>

        {error && (
          <div style={{ padding: 8, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 4, color: '#ef4444', marginBottom: 12, fontSize: 12 }}>
            <strong>Erreur :</strong> {error}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Effet">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {(Object.keys(EFFECT_LABELS) as EffectKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setEffectKey(k)}
                  style={{ ...btnStyle, background: effectKey === k ? '#EC4899' : '#1a1a1e' }}
                >
                  {EFFECT_LABELS[k]}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Mode rendu">
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setOverlayMode('mix')} style={{ ...btnStyle, flex: 1, background: overlayMode === 'mix' ? '#EC4899' : '#1a1a1e' }}>
                Overlay (mix)
              </button>
              <button onClick={() => setOverlayMode('pure')} style={{ ...btnStyle, flex: 1, background: overlayMode === 'pure' ? '#EC4899' : '#1a1a1e' }}>
                Pur
              </button>
            </div>
            {overlayMode === 'mix' && (
              <div>
                <label style={{ fontSize: 11, color: '#9898b4' }}>Opacity vanta : {opacity.toFixed(2)}</label>
                <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ width: '100%' }} />
              </div>
            )}
          </Section>

          <Section title="Image de fond (mix)">
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
          </Section>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À évaluer :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>FOG / CLOUDS / CLOUDS2 → calques brouillard sur scène (priorité Hero)</li>
            <li>BIRDS → ambiance vivante extérieur</li>
            <li>WAVES → scènes maritimes / sci-fi</li>
            <li>HALO / RINGS / GLOBE → portails magiques / sci-fi</li>
            <li>NET / TOPOLOGY / CELLS → moins évidents pour livre-jeu narratif</li>
            <li>Perfs : 1 effet WebGL plein écran ≈ OK ; 2+ = chute drastique de FPS</li>
            <li>Bundle : three (~120kb) déjà inclus + chaque effet ~30kb = code-split crucial</li>
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
