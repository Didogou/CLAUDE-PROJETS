'use client'
/**
 * POC Lottie — animations vectorielles JSON exportées d'After Effects.
 * URL : http://localhost:3000/editor-test/lottie
 *
 * Cas d'usage Hero : icônes magiques, sigils, glow d'items, animations
 * d'inventaire (ouverture coffre, level-up, badge), micro-interactions.
 * Avantage clé : un designer livre un .json, intégration zéro friction côté code.
 *
 * Source des animations : LottieFiles (lottiefiles.com), URLs publiques pour le POC.
 */

import React, { useState, useRef, useEffect } from 'react'
import Lottie, { type LottieRefCurrentProps } from 'lottie-react'

// Animations gratuites depuis lottiefiles.com (CDN public). URLs vérifiées
// — certaines URLs de tutoriels datés renvoient 403 (LottieFiles a restructuré).
interface LottieDemo {
  key: string
  label: string
  url: string
  hint: string
}
const DEMOS: LottieDemo[] = [
  { key: 'fire', label: '🔥 Feu animé', url: 'https://assets1.lottiefiles.com/packages/lf20_zw0djhar.json', hint: 'Torche, brasero, scène nocturne' },
  { key: 'star_burst', label: '⭐ Star burst', url: 'https://assets10.lottiefiles.com/packages/lf20_touohxv0.json', hint: 'Critical hit / réussite' },
  { key: 'check', label: '✅ Validation', url: 'https://assets9.lottiefiles.com/packages/lf20_lk80fpsm.json', hint: 'Action confirmée, choix validé' },
  { key: 'loading_spinner', label: '⏳ Chargement', url: 'https://assets2.lottiefiles.com/packages/lf20_usmfx6bp.json', hint: 'Loading state' },
  { key: 'sparkle', label: '✨ Sparkle', url: 'https://assets5.lottiefiles.com/packages/lf20_kuhijlvx.json', hint: 'Item rare, hover sur élément précieux' },
  { key: 'magic_circle', label: '🔮 Cercle magique', url: 'https://assets6.lottiefiles.com/packages/lf20_iv4dsx3q.json', hint: 'Sortilège, runes, portail' },
  { key: 'badge', label: '🏆 Badge / trophy', url: 'https://assets7.lottiefiles.com/packages/lf20_jbrw3hcz.json', hint: 'Achievement, fin de chapitre' },
  { key: 'heart', label: '💖 Cœur', url: 'https://assets8.lottiefiles.com/packages/lf20_yom6uvgj.json', hint: 'Soins, romance NPC, item santé' },
  { key: 'rocket', label: '🚀 Lancement', url: 'https://assets10.lottiefiles.com/packages/lf20_M9p23l.json', hint: 'Action déclenchée, transition' },
]

export default function LottieTestPage() {
  const [demoKey, setDemoKey] = useState(DEMOS[0].key)
  const [animData, setAnimData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(true)
  const lottieRef = useRef<LottieRefCurrentProps | null>(null)

  const demo = DEMOS.find(d => d.key === demoKey)!

  // Fetch JSON Lottie depuis CDN à chaque changement. Les setState initiaux
  // sont déférés via queueMicrotask pour ne pas être "synchrones" dans le
  // body de l'effect (lint react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      setAnimData(null)
    })
    fetch(demo.url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setAnimData(data)
      })
      .catch(e => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [demo.url])

  // Met à jour la vitesse à la volée sans remonter le composant
  useEffect(() => {
    lottieRef.current?.setSpeed(speed)
  }, [speed, animData])

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Lottie — animations vectorielles design
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          JSON exporté d&apos;After Effects, lecture vectorielle légère. Designer-friendly :
          un fichier livré = une animation intégrée.
        </p>

        {/* Preview */}
        <div style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          background: '#0f0f13',
          border: '1px solid #2a2a30',
          borderRadius: 8,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {loading && <div style={{ color: '#9898b4' }}>Chargement…</div>}
          {error && <div style={{ color: '#ef4444', fontSize: 13 }}>Erreur : {error}</div>}
          {animData != null ? (
            <Lottie
              lottieRef={lottieRef}
              animationData={animData}
              loop={loop}
              autoplay
              style={{ width: '50%', height: '90%' }}
            />
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Animation">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {DEMOS.map(d => (
                <button
                  key={d.key}
                  onClick={() => setDemoKey(d.key)}
                  style={{ ...btnStyle, background: demoKey === d.key ? '#EC4899' : '#1a1a1e', textAlign: 'left' }}
                >
                  <div>{d.label}</div>
                  <div style={{ fontSize: 10, color: '#9898b4', marginTop: 2 }}>{d.hint}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Contrôle">
            <Field label={`Vitesse : ${speed.toFixed(2)}×`}>
              <input type="range" min={0.1} max={3} step={0.1} value={speed} onChange={e => setSpeed(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#ede9df', cursor: 'pointer' }}>
              <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
              Boucler
            </label>
            <button onClick={() => lottieRef.current?.goToAndPlay(0)} style={{ ...btnStyle, background: '#10B981' }}>
              ▶ Rejouer depuis le début
            </button>
            <button onClick={() => lottieRef.current?.pause()} style={btnStyle}>
              ⏸ Pause
            </button>
            <button onClick={() => lottieRef.current?.play()} style={btnStyle}>
              ▶ Reprendre
            </button>
          </Section>

          <Section title="À évaluer">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#9898b4', lineHeight: 1.7 }}>
              <li>Qualité visuelle (vectoriel = scale parfait)</li>
              <li>Fluidité 60fps, GPU-accel</li>
              <li>Designer livre un JSON → on l&apos;importe direct</li>
              <li>Bundle lottie-react ~85 kb gzip</li>
              <li>Workflow réel : LottieFiles est un marketplace gratuit + payant</li>
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
