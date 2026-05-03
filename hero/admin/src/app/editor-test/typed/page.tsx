'use client'
/**
 * POC typed.js — effet machine à écrire pour révélation narrative.
 * URL : http://localhost:3000/editor-test/typed
 *
 * Cas d'usage Hero : révélation progressive du texte d'une section,
 * dialogues NPC frappés à la machine, intro typewriter pour transitions.
 *
 * Lib : typed.js (la référence depuis ~10 ans, ~5 kb gzip).
 */

import React, { useEffect, useRef, useState } from 'react'
import Typed from 'typed.js'

type DemoKey = 'narrative' | 'dialogue' | 'cycling' | 'glitch'

const DEMO_LABELS: Record<DemoKey, string> = {
  narrative: '📖 Narration de section',
  dialogue: '💬 Dialogue NPC',
  cycling: '🔄 Phrases qui cyclent',
  glitch: '⚡ Effet glitch (backspace)',
}

const DEMO_STRINGS: Record<DemoKey, string[]> = {
  narrative: [
    'Tu pénètres dans la salle obscure. Une silhouette familière se découpe dans la pénombre.<br><br>Tu reconnais Travis, ton ami d&apos;enfance. Il porte sur lui un revolver Colt Python qui semble t&apos;être destiné.',
  ],
  dialogue: [
    '<span style="color:#d4a84c">Travis :</span> "T&apos;as failli ne pas venir, vieille branche…"',
    '<span style="color:#d4a84c">Travis :</span> "Le Bronx est en feu. Les Freaks ont besoin de toi."',
    '<span style="color:#d4a84c">Travis :</span> "Prends ce flingue. Tu vas en avoir besoin."',
  ],
  cycling: [
    'Cherche un indice…',
    'Examine la porte…',
    'Fouille la pièce…',
    'Reste sur tes gardes…',
  ],
  glitch: [
    'SYSTEM ONLINE',
    'SYSTE& *RR0R',
    'SYS7EM C0RRUPT',
    'CONNEXION ÉTABLIE',
    'BIENVENUE, CHIALVA.',
  ],
}

export default function TypedTestPage() {
  const [demoKey, setDemoKey] = useState<DemoKey>('narrative')
  const [typeSpeed, setTypeSpeed] = useState(35)
  const [backSpeed, setBackSpeed] = useState(20)
  const [backDelay, setBackDelay] = useState(1500)
  const targetRef = useRef<HTMLSpanElement | null>(null)
  const typedRef = useRef<Typed | null>(null)

  // Re-init typed à chaque changement de demo ou paramètre
  useEffect(() => {
    if (!targetRef.current) return
    typedRef.current?.destroy()

    const strings = DEMO_STRINGS[demoKey]
    const isCycling = demoKey === 'cycling' || demoKey === 'glitch'

    typedRef.current = new Typed(targetRef.current, {
      strings,
      typeSpeed,
      backSpeed: isCycling ? backSpeed : 0,
      backDelay: isCycling ? backDelay : 0,
      loop: isCycling,
      showCursor: true,
      cursorChar: '▌',
      contentType: 'html',
    })
    return () => { typedRef.current?.destroy() }
  }, [demoKey, typeSpeed, backSpeed, backDelay])

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC typed.js — machine à écrire narrative
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          4 démos : narration progressive, dialogue NPC, phrases qui cyclent,
          effet glitch (backspace + retap).
        </p>

        {/* Stage */}
        <div style={{
          padding: '32px',
          minHeight: 200,
          background: '#0f0f13',
          border: '1px solid #2a2a30',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 18,
          lineHeight: 1.7,
          color: '#ede9df',
          fontFamily: demoKey === 'glitch' ? 'monospace' : 'inherit',
        }}>
          <span ref={targetRef} />
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

          <Section title="Vitesse">
            <Field label={`Vitesse de frappe : ${typeSpeed} ms/char`}>
              <input type="range" min={5} max={150} step={5} value={typeSpeed} onChange={e => setTypeSpeed(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            {(demoKey === 'cycling' || demoKey === 'glitch') && (
              <>
                <Field label={`Vitesse backspace : ${backSpeed} ms/char`}>
                  <input type="range" min={5} max={100} step={5} value={backSpeed} onChange={e => setBackSpeed(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
                <Field label={`Délai avant backspace : ${backDelay} ms`}>
                  <input type="range" min={500} max={4000} step={100} value={backDelay} onChange={e => setBackDelay(Number(e.target.value))} style={{ width: '100%' }} />
                </Field>
              </>
            )}
          </Section>

          <Section title="À évaluer">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#9898b4', lineHeight: 1.7 }}>
              <li>Immersion narrative immédiate (read-along)</li>
              <li>Support HTML inline (couleurs NPC, gras, italic)</li>
              <li>Bundle ~5 kb gzip</li>
              <li>Limite : pour des CHOIX qui s&apos;affichent un par un, mieux vaut GSAP stagger</li>
              <li>Idée : combine avec son de frappe via Web Audio</li>
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
