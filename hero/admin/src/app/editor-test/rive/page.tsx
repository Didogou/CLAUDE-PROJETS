'use client'
/**
 * POC Rive — animations vectorielles interactives 2D.
 * URL : http://localhost:3000/editor-test/rive
 *
 * Cas d'usage Hero : animations de personnages / NPJs / objets interactifs
 * (chat qui s'étire, NPJ qui salue, item qui tourne) — alternative aux sprite
 * sheets et aux vidéos AnimateDiff/Wan. Avantages :
 *   - 60fps, 10-15× plus léger que Lottie
 *   - State machines : transitions déclarées dans l'éditeur, fire depuis le code
 *   - Vectoriel : zoom infini, file <50KB pour un perso complet
 *   - Runtime open-source (gratuit). Compte requis uniquement côté éditeur.
 *
 * Cette page charge un sample CDN public de Rive et expose les inputs de la
 * state machine (booleans, numbers, triggers) pour valider :
 *   - Le rendu visuel + perf (60 fps stable ?)
 *   - Le control flow : fire() trigger, set() value → animation réagit
 *   - L'intégration React avec @rive-app/react-canvas (taille bundle, mount time)
 */

import React, { useEffect, useState } from 'react'
import { useRive, useStateMachineInput } from '@rive-app/react-canvas'

// Samples publics de Rive. URLs stables, libres pour test/POC.
const SAMPLES = [
  {
    id: 'vehicles',
    label: '🚗 Vehicles (morphing)',
    src: 'https://cdn.rive.app/animations/vehicles.riv',
    stateMachine: 'bumpy',
    inputs: [
      { name: 'bump', kind: 'trigger', label: 'Bump (secousse)' },
    ] as InputConfig[],
    notes: 'Voiture qui rebondit sur trigger. State machine simple = idle + bump.',
  },
  {
    id: 'rating',
    label: '⭐ Rating animé',
    src: 'https://public.rive.app/community/runtime-files/2244-4463-animated-login-screen.riv',
    stateMachine: 'Login Machine',
    inputs: [],
    notes: 'Login screen avec personnage qui réagit. State machine complexe.',
  },
] as const

interface InputConfig {
  name: string
  kind: 'trigger' | 'boolean' | 'number'
  label: string
  min?: number
  max?: number
  step?: number
}

export default function RiveTestPage() {
  const [sampleIdx, setSampleIdx] = useState(0)
  const sample = SAMPLES[sampleIdx]

  // Mesure du temps de mount + taille du fichier (perf check)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [mountTime, setMountTime] = useState<number | null>(null)
  const [fps, setFps] = useState<number | null>(null)

  // Fetch HEAD pour récup la taille du .riv (Content-Length)
  useEffect(() => {
    setFileSize(null)
    fetch(sample.src, { method: 'HEAD' })
      .then(res => {
        const len = res.headers.get('content-length')
        if (len) setFileSize(parseInt(len, 10))
      })
      .catch(() => setFileSize(null))
  }, [sample.src])

  // Compteur FPS via requestAnimationFrame (mesure perf navigateur global)
  useEffect(() => {
    let frames = 0
    let lastTime = performance.now()
    let raf: number | null = null
    function tick() {
      frames++
      const now = performance.now()
      if (now - lastTime >= 1000) {
        setFps(frames)
        frames = 0
        lastTime = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf !== null) cancelAnimationFrame(raf) }
  }, [])

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Rive — animations vectorielles interactives
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Charge des samples Rive publics, expose les inputs de la state machine,
          mesure perf. <strong style={{ color: '#d4a84c' }}>Cible :</strong> 60fps,
          fichier &lt;50KB, mount &lt;500ms.
        </p>

        {/* Sample picker */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {SAMPLES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setSampleIdx(i)}
              style={{ ...btnStyle, background: i === sampleIdx ? '#EC4899' : '#1a1a1e' }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Stage : remount complet quand sample change pour reset propre */}
        <RiveStage
          key={sample.id}
          src={sample.src}
          stateMachine={sample.stateMachine}
          inputs={[...sample.inputs]}
          onMount={t => setMountTime(t)}
        />

        {/* Perf strip */}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#9898b4' }}>
          <Metric label="Taille .riv" value={fileSize !== null ? `${(fileSize / 1024).toFixed(1)} KB` : '…'} />
          <Metric label="Mount time" value={mountTime !== null ? `${mountTime.toFixed(0)} ms` : '…'} />
          <Metric label="FPS (browser global)" value={fps !== null ? `${fps}` : '…'} />
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>{sample.label}</strong>
          <p style={{ margin: '6px 0 0' }}>{sample.notes}</p>
          <p style={{ margin: '8px 0 0', fontSize: 11, opacity: 0.7 }}>
            Source : <code>{sample.src}</code>
          </p>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À évaluer :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Mount time &lt; 500ms (fetch + parse + render initial)</li>
            <li>FPS stable à 60 (l&apos;animation tourne sur le main thread, mais Canvas 2D)</li>
            <li>Fire trigger / toggle bool → réaction visuelle immédiate (pas de lag)</li>
            <li>File size .riv : 10-200KB pour un perso. Comparer avec un GIF/WebP équivalent</li>
            <li>Bundle JS ajouté : ~120KB gzipped pour <code>@rive-app/react-canvas</code></li>
          </ul>
          <p style={{ margin: '10px 0 0', padding: '8px 10px', background: '#1a1a1e', borderRadius: 4 }}>
            <strong style={{ color: '#10B981' }}>Prochaine étape</strong> : si POC validé,
            créer un fichier <code>.riv</code> custom (chat qui s&apos;étire) dans Rive Editor,
            puis intégrer comme nouveau type de calque <code>rive</code> dans
            ImageEditor (à côté de <code>composition</code>, <code>media</code>, <code>weather</code>).
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Composant qui monte la rive instance + expose les inputs ──────────────

interface RiveStageProps {
  src: string
  stateMachine: string
  inputs: InputConfig[]
  onMount: (durationMs: number) => void
}

function RiveStage({ src, stateMachine, inputs, onMount }: RiveStageProps) {
  const mountStart = React.useRef(performance.now())

  const { rive, RiveComponent } = useRive({
    src,
    stateMachines: stateMachine,
    autoplay: true,
    onLoad: () => {
      onMount(performance.now() - mountStart.current)
    },
  })

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12 }}>
      <div
        style={{
          aspectRatio: '4/3',
          background: '#1a1a1e',
          border: '1px solid #2a2a30',
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <RiveComponent style={{ width: '100%', height: '100%' }} />
        {!rive && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#9898b4', fontSize: 13,
          }}>
            Chargement Rive…
          </div>
        )}
      </div>

      {/* Panel des inputs */}
      <div style={{
        padding: 12, background: '#0f0f13',
        border: '1px solid #2a2a30', borderRadius: 6,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase' }}>
          State Machine Inputs
        </div>
        {inputs.length === 0 ? (
          <div style={{ fontSize: 12, color: '#666' }}>
            Aucun input exposé pour ce sample (animation autonome ou state machine
            interne). L&apos;animation joue par défaut au mount.
          </div>
        ) : (
          inputs.map(input => (
            <RiveInputControl
              key={input.name}
              rive={rive}
              stateMachine={stateMachine}
              config={input}
            />
          ))
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: '#666' }}>
          Artboard : <code>{rive?.activeArtboard ?? '…'}</code>
        </div>
      </div>
    </div>
  )
}

// ── Contrôle d'un input de state machine (boolean / number / trigger) ──────

interface InputControlProps {
  rive: ReturnType<typeof useRive>['rive']
  stateMachine: string
  config: InputConfig
}

function RiveInputControl({ rive, stateMachine, config }: InputControlProps) {
  const input = useStateMachineInput(rive, stateMachine, config.name)

  if (config.kind === 'trigger') {
    return (
      <button
        onClick={() => input?.fire()}
        disabled={!input}
        style={{ ...btnStyle, background: '#EC4899', textAlign: 'left' }}
      >
        ▶ {config.label}
      </button>
    )
  }

  if (config.kind === 'boolean') {
    const checked = input?.value === true
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => { if (input) input.value = e.target.checked }}
          disabled={!input}
        />
        {config.label}
      </label>
    )
  }

  // number
  const value = typeof input?.value === 'number' ? input.value : (config.min ?? 0)
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
      <span>{config.label} : <code>{value.toFixed(1)}</code></span>
      <input
        type="range"
        min={config.min ?? 0}
        max={config.max ?? 100}
        step={config.step ?? 1}
        value={value}
        onChange={e => { if (input) input.value = Number(e.target.value) }}
        disabled={!input}
        style={{ width: '100%' }}
      />
    </label>
  )
}

// ── Atomes UI ──────────────────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '6px 10px', background: '#1a1a1e',
      border: '1px solid #2a2a30', borderRadius: 4,
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#ede9df', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
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
