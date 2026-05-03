'use client'
/**
 * POC rough-notation — annotations dessinées à la main animées.
 * URL : http://localhost:3000/editor-test/notation
 *
 * Cas d'usage Hero : marquer un mot-clé dans le texte d'une section,
 * entourer un choix critique, surligner une phrase clé, barrer un item
 * supprimé. Esthétique manuscrite cohérente avec l'univers livre-jeu.
 *
 * Lib : rough-notation (basée sur rough.js). Tous les types animés au draw.
 */

import React, { useEffect, useRef, useState } from 'react'
import { annotate, annotationGroup } from 'rough-notation'
// Les types sont dans le sous-module 'model', pas re-exportés par l'entry principal
import type { RoughAnnotation, RoughAnnotationType } from 'rough-notation/lib/model'

const TYPES: { key: RoughAnnotationType; label: string; color: string }[] = [
  { key: 'underline', label: 'Souligner', color: '#d4a84c' },
  { key: 'box', label: 'Encadrer', color: '#EC4899' },
  { key: 'circle', label: 'Entourer', color: '#10B981' },
  { key: 'highlight', label: 'Surligner', color: '#fde68a' },
  { key: 'strike-through', label: 'Barrer', color: '#ef4444' },
  { key: 'crossed-off', label: 'Cocher (croix)', color: '#ef4444' },
  { key: 'bracket', label: 'Crochets', color: '#6366F1' },
]

export default function NotationTestPage() {
  const [type, setType] = useState<RoughAnnotationType>('circle')
  const [color, setColor] = useState('#10B981')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [animDuration, setAnimDuration] = useState(800)
  const [iterations, setIterations] = useState(2)
  const [running, setRunning] = useState(false)

  const refs = useRef<HTMLSpanElement[]>([])
  const annotations = useRef<RoughAnnotation[]>([])

  // Refresh les annotations quand les params changent
  useEffect(() => {
    // Cleanup ancien
    annotations.current.forEach((a: RoughAnnotation) => a.remove())
    annotations.current = []

    // Crée les nouvelles
    annotations.current = refs.current
      .filter((el): el is HTMLSpanElement => !!el)
      .map(el => annotate(el, {
        type,
        color,
        strokeWidth,
        animationDuration: animDuration,
        iterations,
        padding: 4,
        animate: true,
      }))
  }, [type, color, strokeWidth, animDuration, iterations])

  function showAll() {
    setRunning(true)
    const group = annotationGroup(annotations.current)
    group.show()
    setTimeout(() => setRunning(false), animDuration + 100)
  }
  function hideAll() {
    annotations.current.forEach(a => a.hide())
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC rough-notation — annotations manuscrites
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Style dessiné main, animation au tracé. 7 types disponibles. Idéal pour
          mettre en relief un mot-clé, un choix, un item dans le narratif.
        </p>

        {/* Stage */}
        <div style={{
          padding: '32px',
          background: '#0f0f13',
          border: '1px solid #2a2a30',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 18,
          lineHeight: 2,
          color: '#ede9df',
        }}>
          <p>
            Tu pénètres dans la <span ref={(el) => { if (el) refs.current[0] = el }}>salle obscure</span>.
            Au fond, une silhouette familière se découpe. Tu reconnais{' '}
            <span ref={(el) => { if (el) refs.current[1] = el }}>Travis</span>, ton ami d&apos;enfance.
            Il porte sur lui un{' '}
            <span ref={(el) => { if (el) refs.current[2] = el }}>revolver Colt Python</span>{' '}
            qui semble t&apos;être destiné.
          </p>
          <p style={{ marginTop: 16 }}>
            Tu peux : <span ref={(el) => { if (el) refs.current[3] = el }}>l&apos;approcher pacifiquement</span>{' '}
            ou bien{' '}
            <span ref={(el) => { if (el) refs.current[4] = el }}>dégainer en premier</span>.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Type d'annotation">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {TYPES.map(t => (
                <button
                  key={t.key}
                  onClick={() => { setType(t.key); setColor(t.color) }}
                  style={{ ...btnStyle, background: type === t.key ? '#EC4899' : '#1a1a1e', textAlign: 'left' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Style">
            <Field label="Couleur">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: '100%', height: 28, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer' }} />
            </Field>
            <Field label={`Épaisseur trait : ${strokeWidth}`}>
              <input type="range" min={1} max={6} step={0.5} value={strokeWidth} onChange={e => setStrokeWidth(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Itérations (passes manuelles) : ${iterations}`}>
              <input type="range" min={1} max={4} step={1} value={iterations} onChange={e => setIterations(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Durée anim : ${animDuration} ms`}>
              <input type="range" min={200} max={3000} step={100} value={animDuration} onChange={e => setAnimDuration(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
          </Section>

          <Section title="Lecture">
            <button onClick={showAll} disabled={running} style={{ ...btnStyle, background: running ? '#1a1a1e' : '#10B981', opacity: running ? 0.5 : 1 }}>
              ▶ Tracer toutes les annotations
            </button>
            <button onClick={hideAll} style={btnStyle}>
              ✕ Effacer
            </button>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: '#9898b4', lineHeight: 1.7 }}>
              <li>Pure SVG, scalable, accessible (texte reste sélectionnable)</li>
              <li>Bundle ~14 kb gzip</li>
              <li>Animation au tracé (effet &laquo;&nbsp;à la main&nbsp;&raquo;)</li>
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
