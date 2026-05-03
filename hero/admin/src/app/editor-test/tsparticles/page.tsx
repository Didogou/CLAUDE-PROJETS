'use client'
/**
 * POC tsParticles — système de particules moderne, alternative au home-made ParticleLayer.
 * URL : http://localhost:3000/editor-test/tsparticles
 *
 * Couvre : neige, feuilles tombantes, étincelles, lucioles, poussière, feu.
 * Si OK, on remplace le code maison particules dans ParticleLayer.tsx.
 *
 * Stack :
 *  - @tsparticles/engine (engine principal)
 *  - @tsparticles/slim (preset léger : tous les movers/shapes courants sans plugins lourds)
 *  - @tsparticles/react (wrapper React)
 */

import React, { useEffect, useState } from 'react'
import Particles, { initParticlesEngine } from '@tsparticles/react'
import { loadSlim } from '@tsparticles/slim'
import { loadEmittersPlugin } from '@tsparticles/plugin-emitters'
import type { ISourceOptions } from '@tsparticles/engine'

// ── Backgrounds de test ─────────────────────────────────────────────────
const TEST_BG_URLS = [
  'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200&h=800&fit=crop',  // route nuit
  'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=1200&h=800&fit=crop',  // forêt soleil
  'https://images.unsplash.com/photo-1465056836041-7f43ac27dcb5?w=1200&h=800&fit=crop',  // montagne
  'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1200&h=800&fit=crop',  // château
]

// ── Presets ─────────────────────────────────────────────────────────────
type PresetKey = 'snow' | 'leaves' | 'sparks' | 'fireflies' | 'dust' | 'rain' | 'embers'

const PRESETS: Record<PresetKey, ISourceOptions> = {
  snow: {
    particles: {
      number: { value: 200, density: { enable: true } },
      color: { value: '#ffffff' },
      shape: { type: 'circle' },
      opacity: { value: { min: 0.3, max: 0.8 } },
      size: { value: { min: 1, max: 4 } },
      move: {
        enable: true,
        direction: 'bottom',
        speed: { min: 1, max: 3 },
        straight: false,
        random: true,
      },
      wobble: { enable: true, distance: 10, speed: { min: -5, max: 5 } },
    },
    detectRetina: true,
    fullScreen: { enable: false },
  },
  leaves: {
    particles: {
      number: { value: 30, density: { enable: true } },
      color: { value: ['#d4a84c', '#b8721b', '#8b4513', '#cd853f'] },
      shape: { type: 'polygon', options: { polygon: { sides: 5 } } },
      opacity: { value: { min: 0.6, max: 1 } },
      size: { value: { min: 4, max: 10 } },
      rotate: { value: { min: 0, max: 360 }, animation: { enable: true, speed: 8 } },
      move: {
        enable: true,
        direction: 'bottom',
        speed: { min: 0.5, max: 2 },
        random: true,
        straight: false,
      },
      wobble: { enable: true, distance: 30, speed: 5 },
    },
    detectRetina: true,
    fullScreen: { enable: false },
  },
  sparks: {
    particles: {
      number: { value: 0 },
      color: { value: ['#ffaa00', '#ff6600', '#ffdd00'] },
      shape: { type: 'circle' },
      opacity: { value: { min: 0.4, max: 1 }, animation: { enable: true, speed: 1.5, sync: false } },
      size: { value: { min: 1, max: 3 } },
      life: { duration: { value: { min: 0.4, max: 1.2 } }, count: 1 },
      move: {
        enable: true,
        speed: { min: 3, max: 8 },
        direction: 'top',
        outModes: 'destroy',
        gravity: { enable: true, acceleration: 4 },
      },
    },
    emitters: [{
      direction: 'top',
      rate: { quantity: 4, delay: 0.05 },
      position: { x: 50, y: 100 },
      size: { width: 30, height: 0 },
    }],
    detectRetina: true,
    fullScreen: { enable: false },
  },
  fireflies: {
    particles: {
      number: { value: 40, density: { enable: true } },
      color: { value: '#ffe680' },
      shape: { type: 'circle' },
      opacity: {
        value: { min: 0.1, max: 1 },
        animation: { enable: true, speed: 1, sync: false },
      },
      size: { value: { min: 1, max: 3 } },
      move: {
        enable: true,
        speed: { min: 0.3, max: 1.2 },
        direction: 'none',
        random: true,
        straight: false,
        outModes: 'bounce',
      },
    },
    detectRetina: true,
    fullScreen: { enable: false },
  },
  dust: {
    // Motes de poussière dorée flottant à contre-jour. Opacity élevée pour
    // être visible sur fond sombre comme clair, taille variable, mvt lent.
    particles: {
      number: { value: 80, density: { enable: true, width: 800, height: 600 } },
      color: { value: ['#fff5d4', '#ffeaa8', '#d4c8a8'] },
      shape: { type: 'circle' },
      opacity: {
        value: { min: 0.4, max: 0.9 },
        animation: { enable: true, speed: 0.5, sync: false, startValue: 'random' },
      },
      size: { value: { min: 1.5, max: 3.5 } },
      move: {
        enable: true,
        speed: { min: 0.3, max: 0.9 },
        direction: 'right',
        random: true,
        straight: false,
        outModes: { default: 'out' },
      },
    },
    detectRetina: true,
    fullScreen: { enable: false },
  },
  rain: {
    particles: {
      number: { value: 400, density: { enable: true } },
      color: { value: '#b8c5d6' },
      shape: { type: 'line' },
      opacity: { value: { min: 0.3, max: 0.7 } },
      size: { value: { min: 1, max: 2 } },
      move: {
        enable: true,
        direction: 'bottom',
        speed: { min: 18, max: 25 },
        straight: true,
      },
      stroke: { width: 1, color: { value: '#b8c5d6' } },
    },
    detectRetina: true,
    fullScreen: { enable: false },
  },
  embers: {
    particles: {
      number: { value: 0 },
      color: { value: ['#ff4400', '#ff8800', '#ffaa00'] },
      shape: { type: 'circle' },
      opacity: { value: { min: 0.2, max: 0.9 }, animation: { enable: true, speed: 2 } },
      size: { value: { min: 1, max: 4 } },
      life: { duration: { value: { min: 1, max: 3 } }, count: 1 },
      move: {
        enable: true,
        speed: { min: 1, max: 3 },
        direction: 'top',
        random: true,
        straight: false,
        outModes: 'destroy',
      },
    },
    emitters: [{
      direction: 'top',
      rate: { quantity: 3, delay: 0.1 },
      position: { x: 50, y: 95 },
      size: { width: 80, height: 0 },
    }],
    detectRetina: true,
    fullScreen: { enable: false },
  },
}

const PRESET_LABELS: Record<PresetKey, string> = {
  snow: '❄️ Neige',
  leaves: '🍂 Feuilles',
  sparks: '✨ Étincelles',
  fireflies: '🌟 Lucioles',
  dust: '💨 Poussière',
  rain: '🌧️ Pluie',
  embers: '🔥 Braises',
}

export default function TsParticlesTestPage() {
  const [bgUrl, setBgUrl] = useState(TEST_BG_URLS[0])
  const [presetKey, setPresetKey] = useState<PresetKey>('snow')
  const [engineReady, setEngineReady] = useState(false)

  // Init de l'engine (singleton, une seule fois pour toute l'app).
  // loadSlim = movers/shapes de base. loadEmittersPlugin = nécessaire pour
  // les presets sparks/embers (number=0 + emitters[]).
  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine)
      await loadEmittersPlugin(engine)
    }).then(() => setEngineReady(true))
  }, [])

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC tsParticles — système de particules moderne
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Test de 7 presets (neige, feuilles, étincelles, lucioles, poussière, pluie, braises).
          Si visuellement OK + perfs OK, on remplacera le ParticleLayer maison.
        </p>

        {/* Preview */}
        <div style={{
          position: 'relative',
          aspectRatio: '16/9',
          background: `url(${bgUrl}) center/cover`,
          border: '1px solid #2a2a30',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 16,
        }}>
          {engineReady && (
            <Particles
              key={presetKey}
              id={`tsparticles-${presetKey}`}
              options={PRESETS[presetKey]}
              style={{ position: 'absolute', inset: 0 }}
            />
          )}
          {!engineReady && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9898b4' }}>
              Initialisation engine…
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Preset">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {(Object.keys(PRESETS) as PresetKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setPresetKey(k)}
                  style={{ ...btnStyle, background: presetKey === k ? '#EC4899' : '#1a1a1e' }}
                >
                  {PRESET_LABELS[k]}
                </button>
              ))}
            </div>
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
          </Section>

          <Section title="À évaluer">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#9898b4', lineHeight: 1.7 }}>
              <li>Qualité visuelle vs maison</li>
              <li>Perfs (CPU/FPS) avec 200+ particules</li>
              <li>Customisation (zones, vitesse, taille)</li>
              <li>Bundle impact (~slim = ~70kb gzip)</li>
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
