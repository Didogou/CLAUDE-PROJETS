'use client'
/**
 * POC GSAP — orchestration de timelines complexes.
 * URL : http://localhost:3000/editor-test/gsap
 *
 * Cas d'usage Hero : transitions de section avec plusieurs éléments
 * synchronisés (rideau qui descend + texte qui apparaît + son), reveals
 * narratifs ciselés, animations de combat. Là où framer-motion devient
 * pénible (multi-élément avec timing strict), GSAP excelle.
 *
 * Démos :
 *  1. Transition de section (curtain + texte + UI)
 *  2. Combat hit (impact + flash + recul + texte dégâts)
 *  3. Reveal de texte char-by-char (alternative à typed.js, plus contrôlable)
 *  4. Stagger de cartes (intro de plan)
 */

import React, { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'

type DemoKey = 'curtain' | 'combat_hit' | 'text_reveal' | 'card_stagger'

const DEMO_LABELS: Record<DemoKey, string> = {
  curtain: '🎭 Transition rideau',
  combat_hit: '⚔️ Coup de combat',
  text_reveal: '📝 Reveal texte char-by-char',
  card_stagger: '🃏 Stagger de cartes',
}

const SAMPLE_TEXT = 'Tu pénètres dans la salle obscure. Une silhouette familière se découpe dans la pénombre…'

export default function GsapTestPage() {
  const [demoKey, setDemoKey] = useState<DemoKey>('curtain')
  const [progress, setProgress] = useState(0)  // pour le scrub
  const stageRef = useRef<HTMLDivElement | null>(null)
  const tlRef = useRef<gsap.core.Timeline | null>(null)

  // Construit la timeline à chaque changement de demo
  useEffect(() => {
    if (!stageRef.current) return
    tlRef.current?.kill()
    const stage = stageRef.current

    // Reset des éléments
    gsap.set(stage.querySelectorAll('[data-anim]'), { clearProps: 'all' })

    let tl: gsap.core.Timeline
    switch (demoKey) {
      case 'curtain':
        tl = buildCurtainTimeline(stage)
        break
      case 'combat_hit':
        tl = buildCombatHitTimeline(stage)
        break
      case 'text_reveal':
        tl = buildTextRevealTimeline(stage)
        break
      case 'card_stagger':
        tl = buildCardStaggerTimeline(stage)
        break
    }
    tl.eventCallback('onUpdate', () => setProgress(tl.progress()))
    tlRef.current = tl
    return () => { tl.kill() }
  }, [demoKey])

  function play() { tlRef.current?.restart() }
  function pause() { tlRef.current?.pause() }
  function resume() { tlRef.current?.resume() }
  function scrub(p: number) {
    setProgress(p)
    tlRef.current?.pause().progress(p)
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC GSAP — orchestration de timelines
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          4 timelines pré-configurées. Le scrub permet d&apos;avancer manuellement dans
          l&apos;animation pour comprendre le séquencement.
        </p>

        {/* Stage */}
        <div
          ref={stageRef}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16/9',
            background: '#1a1a1e',
            border: '1px solid #2a2a30',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          {/* Background scène */}
          <div data-anim="bg" style={{
            position: 'absolute', inset: 0,
            background: 'url(https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1200&h=800&fit=crop) center/cover',
            opacity: 0.6,
          }} />

          {/* Rideaux (curtain demo) */}
          <div data-anim="curtain-left" style={{
            position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%',
            background: 'linear-gradient(90deg, #000 0%, #1a0a1a 100%)',
            transform: 'translateX(-100%)',
          }} />
          <div data-anim="curtain-right" style={{
            position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%',
            background: 'linear-gradient(-90deg, #000 0%, #1a0a1a 100%)',
            transform: 'translateX(100%)',
          }} />

          {/* Texte */}
          <div data-anim="text-container" style={{
            position: 'absolute', bottom: '15%', left: '10%', right: '10%',
            padding: '16px 20px',
            background: 'rgba(0,0,0,0.7)',
            border: '1px solid #d4a84c',
            borderRadius: 4,
            color: '#ede9df',
            fontSize: 16,
            lineHeight: 1.5,
            opacity: 0,
            transform: 'translateY(20px)',
          }}>
            <span data-anim="text-content">{SAMPLE_TEXT}</span>
          </div>

          {/* Sprite combat */}
          <div data-anim="combat-sprite" style={{
            position: 'absolute', top: '40%', left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 80,
            opacity: 0,
          }}>🗡️</div>

          {/* Damage number */}
          <div data-anim="damage-number" style={{
            position: 'absolute', top: '35%', left: '55%',
            fontSize: 32,
            color: '#ef4444',
            fontWeight: 700,
            textShadow: '0 0 10px rgba(0,0,0,0.8)',
            opacity: 0,
          }}>-42</div>

          {/* Flash blanc */}
          <div data-anim="flash" style={{
            position: 'absolute', inset: 0,
            background: 'white',
            opacity: 0,
            pointerEvents: 'none',
          }} />

          {/* Cartes (stagger demo) */}
          <div style={{ position: 'absolute', top: '30%', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 16 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                data-anim={`card-${i}`}
                style={{
                  width: 80, height: 110,
                  background: '#d4a84c',
                  border: '2px solid #fde68a',
                  borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 36,
                  opacity: 0,
                  transform: 'translateY(50px) rotate(-10deg)',
                }}
              >
                {['🗡️', '🛡️', '🧪', '📜', '💎'][i - 1]}
              </div>
            ))}
          </div>
        </div>

        {/* Scrub */}
        <div style={{ marginBottom: 16, padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: '#9898b4', marginBottom: 6 }}>
            Scrub timeline : {(progress * 100).toFixed(0)}%
          </div>
          <input type="range" min={0} max={1} step={0.01} value={progress} onChange={e => scrub(Number(e.target.value))} style={{ width: '100%' }} />
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Timeline">
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

          <Section title="Contrôle lecture">
            <button onClick={play} style={{ ...btnStyle, background: '#10B981' }}>▶ Rejouer</button>
            <button onClick={pause} style={btnStyle}>⏸ Pause</button>
            <button onClick={resume} style={btnStyle}>▶ Reprendre</button>
          </Section>

          <Section title="À évaluer">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#9898b4', lineHeight: 1.7 }}>
              <li>Synchronisation multi-éléments (qq fps de précision)</li>
              <li>Easing avancé (back, elastic, bounce…)</li>
              <li>Stagger automatique sur N éléments</li>
              <li>Bundle gsap ~50 kb gzip</li>
              <li>Free depuis 2024 (avant : commercial)</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  )
}

// ── Timelines individuelles ─────────────────────────────────────────────

function buildCurtainTimeline(stage: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  tl.set(stage.querySelector('[data-anim="bg"]'), { opacity: 0.6 })
  tl.fromTo('[data-anim="curtain-left"]',
    { xPercent: -100 },
    { xPercent: -10, duration: 0.6, ease: 'power2.inOut' })
  tl.fromTo('[data-anim="curtain-right"]',
    { xPercent: 100 },
    { xPercent: 10, duration: 0.6, ease: 'power2.inOut' }, '<')
  tl.to('[data-anim="text-container"]',
    { opacity: 1, y: 0, duration: 0.4, ease: 'back.out(1.7)' }, '+=0.1')
  return tl
}

function buildCombatHitTimeline(_stage: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  // Sprite apparaît
  tl.fromTo('[data-anim="combat-sprite"]',
    { opacity: 0, scale: 0.5, rotate: -45 },
    { opacity: 1, scale: 1.2, rotate: 0, duration: 0.2, ease: 'back.out(2)' })
  // Flash
  tl.fromTo('[data-anim="flash"]',
    { opacity: 0 },
    { opacity: 0.8, duration: 0.05, yoyo: true, repeat: 1 }, '+=0.05')
  // Sprite recule
  tl.to('[data-anim="combat-sprite"]',
    { x: 30, scale: 0.9, duration: 0.15, ease: 'power3.out' }, '<')
  // Damage number monte
  tl.fromTo('[data-anim="damage-number"]',
    { opacity: 0, y: 0, scale: 0.5 },
    { opacity: 1, y: -40, scale: 1.4, duration: 0.4, ease: 'back.out(1.7)' }, '<0.05')
  // Damage number disparaît
  tl.to('[data-anim="damage-number"]',
    { opacity: 0, y: -80, duration: 0.3, ease: 'power2.in' }, '+=0.2')
  // Sprite revient à sa place
  tl.to('[data-anim="combat-sprite"]',
    { x: 0, scale: 1, duration: 0.3, ease: 'elastic.out(1, 0.5)' }, '<')
  return tl
}

function buildTextRevealTimeline(stage: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  // On split le texte char-by-char manuellement (sans plugin SplitText)
  const textEl = stage.querySelector('[data-anim="text-content"]') as HTMLElement | null
  const containerEl = stage.querySelector('[data-anim="text-container"]') as HTMLElement | null
  if (!textEl || !containerEl) return tl

  // Reset du texte original (pour qu'au replay on ait pas de duplicates)
  if (!textEl.dataset.original) textEl.dataset.original = textEl.textContent || ''
  const original = textEl.dataset.original
  textEl.innerHTML = original.split('').map(c =>
    c === ' ' ? ' ' : `<span style="display:inline-block;opacity:0;transform:translateY(8px)">${c}</span>`
  ).join('')

  tl.set(containerEl, { opacity: 1, y: 0 })
  tl.to(textEl.querySelectorAll('span'),
    { opacity: 1, y: 0, duration: 0.05, stagger: 0.025, ease: 'power2.out' })
  return tl
}

function buildCardStaggerTimeline(_stage: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline()
  tl.fromTo('[data-anim^="card-"]',
    { opacity: 0, y: 50, rotate: -10 },
    {
      opacity: 1, y: 0, rotate: 0,
      duration: 0.5,
      stagger: { each: 0.1, from: 'center' },
      ease: 'back.out(1.5)',
    })
  return tl
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
  padding: '8px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
