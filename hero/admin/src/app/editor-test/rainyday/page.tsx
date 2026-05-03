'use client'
/**
 * POC isolé pour valider rainyday.js (lib externe pour effet pluie sur vitre).
 * URL : http://localhost:3000/editor-test/rainyday
 *
 * On charge une image background, puis init RainyDay sur un canvas + l'image.
 * Si visuellement OK, on intégrera dans le système d'impact zones (surface 'glass').
 */

import React, { useEffect, useRef, useState } from 'react'

// Import dynamique côté client uniquement (le code de rainyday.js fait
// référence à document.getElementById, pas safe pour SSR).
interface RainyDayPreset { min: number; base: number; quan: number }
interface RainyDayInstance {
  rain(presets: RainyDayPreset[], speed: number): void
  gravity: unknown
  trail: unknown
  reflection: unknown
  GRAVITY_SIMPLE: unknown
  TRAIL_DROPS: unknown
  REFLECTION_NONE: unknown
  REFLECTION_HQ: unknown
}
type RainyDayClass = new (
  canvasid: string,
  sourceid: string,
  width: number,
  height: number,
  opacity?: number,
  blur?: number,
) => RainyDayInstance

const TEST_BG_URLS = [
  'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200&h=800&fit=crop',
  'https://images.unsplash.com/photo-1465056836041-7f43ac27dcb5?w=1200&h=800&fit=crop',
  'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=1200&h=800&fit=crop',
]

export default function RainyDayTestPage() {
  const [bgUrl, setBgUrl] = useState(TEST_BG_URLS[0])
  const [opacity, setOpacity] = useState(0.9)
  const [blur, setBlur] = useState(20)
  const [presetKey, setPresetKey] = useState<'light' | 'medium' | 'heavy'>('medium')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<unknown>(null)
  const sessionId = useRef(0)

  async function start() {
    setError(null)
    setRunning(false)
    sessionId.current += 1
    const mySession = sessionId.current

    // Wait next tick to ensure DOM is ready
    await new Promise(r => setTimeout(r, 50))

    if (sessionId.current !== mySession) return  // session changed during wait

    const canvas = document.getElementById('rd-canvas') as HTMLCanvasElement | null
    const img = document.getElementById('rd-img') as HTMLImageElement | null
    if (!canvas || !img) {
      setError('Canvas ou image source non trouvé.')
      return
    }
    // Wait for image load if not ready
    if (!img.complete || img.naturalWidth === 0) {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Image background failed to load'))
      }).catch((e) => {
        setError(String(e))
        return
      })
    }
    if (sessionId.current !== mySession) return

    try {
      const mod = await import('@/lib/rainyday/rainyday.js')
      const RainyDay = (mod.default || (window as unknown as { RainyDay?: RainyDayClass }).RainyDay) as RainyDayClass
      if (!RainyDay) {
        setError('Module RainyDay introuvable après import.')
        return
      }
      const w = containerRef.current?.clientWidth ?? 800
      const h = containerRef.current?.clientHeight ?? 600
      const engine = new RainyDay('rd-canvas', 'rd-img', w, h, opacity, blur)
      // CRUCIAL : assigner gravity/trail/reflection AVANT rain(), sinon
      // putDrop() ne déclenche pas l'animation et aucune goutte ne tombe.
      engine.gravity = engine.GRAVITY_SIMPLE
      engine.trail = engine.TRAIL_DROPS
      engine.reflection = engine.REFLECTION_HQ
      // Presets format : { min, base, quan } (pas un tableau).
      // `quan` = seuil de probabilité cumulatif (1ʳᵉ entrée qui dépasse random est sélectionnée).
      const presets: RainyDayPreset[] =
        presetKey === 'light'  ? [{ min: 0, base: 3, quan: 0.5 }, { min: 3, base: 3, quan: 0.88 }] :
        presetKey === 'medium' ? [{ min: 1, base: 2, quan: 0.7 }, { min: 3, base: 3, quan: 0.95 }, { min: 5, base: 4, quan: 1 }] :
                                 [{ min: 2, base: 3, quan: 0.6 }, { min: 4, base: 4, quan: 0.9 }, { min: 8, base: 6, quan: 1 }]
      engine.rain(presets, 100)
      engineRef.current = engine
      setRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function stop() {
    sessionId.current += 1  // invalide la session courante
    setRunning(false)
    engineRef.current = null
    // Force re-render du canvas (RainyDay garde une boucle interne, pas de
    // .stop() exposée → on nettoie le canvas avec un clearRect)
    const canvas = document.getElementById('rd-canvas') as HTMLCanvasElement | null
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  useEffect(() => {
    return () => { stop() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC rainyday.js — pluie sur vitre
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Test isolé de la lib externe avant de l&apos;intégrer dans le système d&apos;impact zones.
          Image en arrière-plan, RainyDay rend les gouttes par-dessus avec réfraction.
        </p>

        {/* Preview */}
        <div ref={containerRef} style={{ position: 'relative', aspectRatio: '16/9', background: '#000', border: '1px solid #2a2a30', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <img
            id="rd-img"
            src={bgUrl}
            alt=""
            crossOrigin="anonymous"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', visibility: 'hidden' }}
          />
          <canvas
            id="rd-canvas"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        </div>

        {error && (
          <div style={{ padding: 8, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 4, color: '#ef4444', marginBottom: 12 }}>
            <strong>Erreur :</strong> {error}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Image de fond">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {TEST_BG_URLS.map((u, i) => (
                <button key={u} onClick={() => setBgUrl(u)} style={{ ...btnStyle, background: bgUrl === u ? '#EC4899' : '#1a1a1e' }}>
                  Image {i + 1}
                </button>
              ))}
            </div>
            <input type="url" value={bgUrl} onChange={e => setBgUrl(e.target.value)} placeholder="URL custom" style={inputStyle} />
          </Section>

          <Section title="Paramètres">
            <Field label={`Opacity : ${opacity.toFixed(2)}`}>
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Blur : ${blur}`}>
              <input type="range" min={0} max={40} step={1} value={blur} onChange={e => setBlur(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label="Preset de pluie">
              <select value={presetKey} onChange={e => setPresetKey(e.target.value as 'light' | 'medium' | 'heavy')} style={inputStyle}>
                <option value="light">Légère</option>
                <option value="medium">Moyenne</option>
                <option value="heavy">Forte</option>
              </select>
            </Field>
          </Section>

          <Section title="Contrôle">
            <button onClick={start} style={{ ...btnStyle, background: '#10B981', color: 'white' }}>
              ▶ Lancer
            </button>
            <button onClick={stop} disabled={!running} style={{ ...btnStyle, opacity: running ? 1 : 0.5 }}>
              ⏸ Arrêter
            </button>
            <div style={{ fontSize: 11, color: '#9898b4' }}>
              Statut : {running ? 'En cours' : 'Arrêté'}
            </div>
          </Section>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#9898b4' }}>
          <strong style={{ color: '#d4a84c' }}>À évaluer :</strong>
          <ul style={{ margin: '6px 0 0 16px', lineHeight: 1.6 }}>
            <li>Le rendu visuel (gouttes, réfraction, accumulation, glissement)</li>
            <li>La performance (CPU usage, FPS perçu)</li>
            <li>Les limites de l&apos;API (peut-on contraindre à une zone ? changer params en live ?)</li>
            <li>Si OK → on intègre comme rendu de la surface &apos;glass&apos; en remplacement du code maison</li>
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
  padding: '6px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
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
