'use client'
/**
 * POC PixiJS — renderer 2D WebGL, alternative haute-perf au canvas 2D.
 * URL : http://localhost:3000/editor-test/pixi
 *
 * Cas d'usage Hero : si tsParticles ne suffit pas en perfs (1000+ particules,
 * filtres complexes type displacement map pour eau/distorsion), Pixi est la
 * référence. C'est ce que rainyday.js utilise sous le capot.
 *
 * Démos :
 *  1. Sprite + filtre blur dynamique (preview slider)
 *  2. Many sprites stress test (compte ajustable, mesure FPS)
 *  3. Displacement map (effet "verre déformant" sur image)
 */

import React, { useEffect, useRef, useState } from 'react'
import * as PIXI from 'pixi.js'

type DemoKey = 'blur' | 'stress' | 'displacement'

const DEMO_LABELS: Record<DemoKey, string> = {
  blur: '🌫️ Filtre blur dynamique',
  stress: '🚀 Stress test (N sprites)',
  displacement: '🌊 Displacement map (eau/verre)',
}

const TEST_BG = 'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1200&h=800&fit=crop'

export default function PixiTestPage() {
  const [demoKey, setDemoKey] = useState<DemoKey>('blur')
  const [blurAmount, setBlurAmount] = useState(8)
  const [spriteCount, setSpriteCount] = useState(500)
  const [fps, setFps] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const blurFilterRef = useRef<PIXI.BlurFilter | null>(null)

  // Init PIXI app
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    let cleanup: (() => void) | null = null

    async function init() {
      const app = new PIXI.Application()
      await app.init({
        width: containerRef.current!.clientWidth,
        height: containerRef.current!.clientHeight,
        background: '#000000',
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      if (cancelled) { app.destroy(true); return }
      containerRef.current!.innerHTML = ''
      containerRef.current!.appendChild(app.canvas)
      appRef.current = app

      await mountDemo(app, demoKey)

      // FPS monitor
      let frames = 0
      let lastTime = performance.now()
      const ticker = () => {
        frames++
        const now = performance.now()
        if (now - lastTime >= 1000) {
          setFps(Math.round((frames * 1000) / (now - lastTime)))
          frames = 0
          lastTime = now
        }
      }
      app.ticker.add(ticker)

      cleanup = () => {
        app.ticker.remove(ticker)
        app.destroy(true)
        appRef.current = null
      }
    }

    init().catch(console.error)
    return () => { cancelled = true; cleanup?.() }
    // demoKey, spriteCount → on remount complet pour cleaner
  }, [demoKey, spriteCount])

  // Update blur filter sans remount
  useEffect(() => {
    if (blurFilterRef.current) {
      blurFilterRef.current.strength = blurAmount
    }
  }, [blurAmount])

  async function mountDemo(app: PIXI.Application, key: DemoKey) {
    blurFilterRef.current = null

    // PixiJS v8 — pour images externes, on charge l'image via HTMLImageElement
    // PUIS on crée la texture/sprite. C'est plus robuste que Assets.load qui
    // peut renvoyer null sur certaines URLs CORS externes.
    function loadImg(url: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
        img.src = url
      })
    }
    async function makeSprite(url: string): Promise<PIXI.Sprite> {
      const img = await loadImg(url)
      const source = new PIXI.ImageSource({ resource: img })
      const texture = new PIXI.Texture({ source })
      return new PIXI.Sprite(texture)
    }

    switch (key) {
      case 'blur': {
        const sprite = await makeSprite(TEST_BG)
        sprite.width = app.canvas.width / (window.devicePixelRatio || 1)
        sprite.height = app.canvas.height / (window.devicePixelRatio || 1)
        const blur = new PIXI.BlurFilter({ strength: blurAmount, quality: 4 })
        sprite.filters = [blur]
        app.stage.addChild(sprite)
        blurFilterRef.current = blur
        break
      }
      case 'stress': {
        const img = await loadImg('https://pixijs.com/assets/bunny.png')
        const source = new PIXI.ImageSource({ resource: img })
        const texture = new PIXI.Texture({ source })
        const w = app.canvas.width / (window.devicePixelRatio || 1)
        const h = app.canvas.height / (window.devicePixelRatio || 1)
        const sprites: { sprite: PIXI.Sprite; vx: number; vy: number }[] = []
        for (let i = 0; i < spriteCount; i++) {
          const s = new PIXI.Sprite(texture)
          s.anchor.set(0.5)
          s.x = Math.random() * w
          s.y = Math.random() * h
          s.scale.set(0.5)
          app.stage.addChild(s)
          sprites.push({ sprite: s, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 })
        }
        app.ticker.add(() => {
          for (const { sprite, vx, vy } of sprites) {
            sprite.x += vx
            sprite.y += vy
            if (sprite.x < 0) sprite.x = w
            else if (sprite.x > w) sprite.x = 0
            if (sprite.y < 0) sprite.y = h
            else if (sprite.y > h) sprite.y = 0
            sprite.rotation += 0.02
          }
        })
        break
      }
      case 'displacement': {
        const sprite = await makeSprite(TEST_BG)
        sprite.width = app.canvas.width / (window.devicePixelRatio || 1)
        sprite.height = app.canvas.height / (window.devicePixelRatio || 1)
        app.stage.addChild(sprite)

        const dispImg = await loadImg('https://pixijs.com/assets/pixi-filters/displacement_map_repeat.jpg')
        const dispSource = new PIXI.ImageSource({ resource: dispImg, addressMode: 'repeat' })
        const dispTex = new PIXI.Texture({ source: dispSource })
        const dispSprite = new PIXI.Sprite(dispTex)
        dispSprite.alpha = 0
        const disp = new PIXI.DisplacementFilter({ sprite: dispSprite, scale: { x: 80, y: 60 } })
        sprite.filters = [disp]
        app.stage.addChild(dispSprite)

        app.ticker.add(() => {
          dispSprite.x += 1
          dispSprite.y += 0.5
        })
        break
      }
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC PixiJS — renderer 2D WebGL
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          3 démos : blur dynamique (filtre live), stress test (N sprites avec FPS),
          displacement map (effet eau/verre déformant).
        </p>

        {/* Stage */}
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16/9',
            background: '#000',
            border: '1px solid #2a2a30',
            borderRadius: 8,
            marginBottom: 8,
            overflow: 'hidden',
          }}
        />
        <div style={{ marginBottom: 16, padding: '4px 12px', background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, fontSize: 12, color: '#10B981', fontFamily: 'monospace' }}>
          FPS : {fps}
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
            {demoKey === 'blur' && (
              <Field label={`Blur strength : ${blurAmount}`}>
                <input type="range" min={0} max={50} step={1} value={blurAmount} onChange={e => setBlurAmount(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
            )}
            {demoKey === 'stress' && (
              <Field label={`Sprites : ${spriteCount}`}>
                <input type="range" min={50} max={5000} step={50} value={spriteCount} onChange={e => setSpriteCount(Number(e.target.value))} style={{ width: '100%' }} />
              </Field>
            )}
            {demoKey === 'displacement' && (
              <div style={{ fontSize: 11, color: '#9898b4', lineHeight: 1.6 }}>
                Displacement map fixe (anime auto). Scale x:80 y:60. Modifier le code pour ajuster.
              </div>
            )}
          </Section>

          <Section title="À évaluer">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#9898b4', lineHeight: 1.7 }}>
              <li>Stress test : combien de sprites avant chute &lt; 60 FPS ?</li>
              <li>Filtres GPU (blur, displacement) sans cost CPU</li>
              <li>Bundle ~150 kb gzip (gros mais justifié si on l&apos;utilise)</li>
              <li>Si Pixi est validé, on peut remplacer ParticleLayer maison</li>
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
