'use client'
/**
 * POC glfx.js — filtres image WebGL pour preview de variations.
 * URL : http://localhost:3000/editor-test/glfx
 *
 * Cas d'usage Hero : preview rapide de variations d'illustration sans
 * regenerer via IA (humeur sombre, sépia, glitch, vignette, déformation).
 * Pour une jeune SaaS où chaque génération coûte du temps/argent, des
 * filtres GPU instantanés sur l'image générée = ergonomie + économies.
 *
 * Lib : glfx (Evan Wallace, 2010 mais toujours fonctionnelle, ~10 kb).
 */

import React, { useEffect, useRef, useState } from 'react'

const TEST_BG_URLS = [
  'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=1200&h=800&fit=crop',
  'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1200&h=800&fit=crop',
  'https://images.unsplash.com/photo-1465056836041-7f43ac27dcb5?w=1200&h=800&fit=crop',
]

type FilterKey = 'none' | 'vignette' | 'sepia' | 'noise' | 'hue_saturation' | 'brightness_contrast' | 'denoise' | 'bulge_pinch' | 'swirl' | 'edge_work' | 'ink' | 'triangle_blur'

const FILTER_LABELS: Record<FilterKey, string> = {
  none: '⬜ Aucun filtre',
  vignette: '🎬 Vignette',
  sepia: '📜 Sépia',
  noise: '📺 Bruit (TV)',
  hue_saturation: '🎨 Hue / Saturation',
  brightness_contrast: '☀️ Brightness / Contrast',
  denoise: '✨ Denoise',
  bulge_pinch: '🔮 Bulge / Pinch (loupe)',
  swirl: '🌀 Swirl (vortex)',
  edge_work: '✏️ Edges (croquis)',
  ink: '🖋️ Ink',
  triangle_blur: '🔺 Triangle blur',
}

// Type minimal pour glfx (lib JS sans typings)
interface GlfxCanvas extends HTMLCanvasElement {
  texture(img: HTMLImageElement): GlfxTexture
  draw(tex: GlfxTexture): GlfxCanvas
  vignette(size: number, amount: number): GlfxCanvas
  sepia(amount: number): GlfxCanvas
  noise(amount: number): GlfxCanvas
  hueSaturation(hue: number, saturation: number): GlfxCanvas
  brightnessContrast(brightness: number, contrast: number): GlfxCanvas
  denoise(exponent: number): GlfxCanvas
  bulgePinch(cx: number, cy: number, radius: number, strength: number): GlfxCanvas
  swirl(cx: number, cy: number, radius: number, angle: number): GlfxCanvas
  edgeWork(radius: number): GlfxCanvas
  ink(strength: number): GlfxCanvas
  triangleBlur(radius: number): GlfxCanvas
  update(): GlfxCanvas
}
interface GlfxTexture { destroy(): void }
interface GlfxModule { canvas(): GlfxCanvas }

export default function GlfxTestPage() {
  const [bgUrl, setBgUrl] = useState(TEST_BG_URLS[0])
  const [filterKey, setFilterKey] = useState<FilterKey>('vignette')
  // Sliders génériques
  const [param1, setParam1] = useState(0.5)
  const [param2, setParam2] = useState(0.5)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fxCanvasRef = useRef<GlfxCanvas | null>(null)
  const textureRef = useRef<GlfxTexture | null>(null)

  // Init glfx canvas + load image
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    setError(null)

    async function init() {
      try {
        // glfx n'est pas ESM-friendly nativement → import dynamique
        const mod = await import('glfx') as unknown as { default?: GlfxModule } & GlfxModule
        const fx = (mod.default ?? mod) as GlfxModule
        if (cancelled || !containerRef.current) return

        let canvas: GlfxCanvas
        try {
          canvas = fx.canvas()
        } catch (e) {
          throw new Error(`WebGL non disponible : ${e instanceof Error ? e.message : String(e)}`)
        }
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.objectFit = 'contain'
        containerRef.current.innerHTML = ''
        containerRef.current.appendChild(canvas)
        fxCanvasRef.current = canvas

        // Load image
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          if (cancelled || !fxCanvasRef.current) return
          if (textureRef.current) textureRef.current.destroy()
          textureRef.current = fxCanvasRef.current.texture(img)
          applyFilter()
        }
        img.onerror = () => setError('Image background échec chargement')
        img.src = bgUrl
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    init()

    return () => {
      cancelled = true
      if (textureRef.current) { textureRef.current.destroy(); textureRef.current = null }
      fxCanvasRef.current = null
    }
  }, [bgUrl])

  // Re-apply filter à chaque changement de filtre / paramètre
  useEffect(() => {
    applyFilter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, param1, param2])

  function applyFilter() {
    const canvas = fxCanvasRef.current
    const tex = textureRef.current
    if (!canvas || !tex) return
    let chain = canvas.draw(tex)
    switch (filterKey) {
      case 'none': break
      case 'vignette': chain = chain.vignette(param1, param2); break
      case 'sepia': chain = chain.sepia(param1); break
      case 'noise': chain = chain.noise(param1); break
      case 'hue_saturation': chain = chain.hueSaturation(param1 * 2 - 1, param2 * 2 - 1); break
      case 'brightness_contrast': chain = chain.brightnessContrast(param1 * 2 - 1, param2 * 2 - 1); break
      case 'denoise': chain = chain.denoise(20 + param1 * 30); break
      case 'bulge_pinch': chain = chain.bulgePinch(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.4, param1 * 2 - 1); break
      case 'swirl': chain = chain.swirl(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.5, (param1 * 2 - 1) * 5); break
      case 'edge_work': chain = chain.edgeWork(1 + param1 * 5); break
      case 'ink': chain = chain.ink(param1); break
      case 'triangle_blur': chain = chain.triangleBlur(param1 * 30); break
    }
    chain.update()
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC glfx.js — filtres image WebGL
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          12 filtres pour preview rapide de variations d&apos;illustration sans regen IA.
          Tous les filtres sont GPU-accelerated, application instantanée.
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
            marginBottom: 16,
            overflow: 'hidden',
          }}
        />
        {error && (
          <div style={{ padding: 8, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 4, color: '#ef4444', marginBottom: 12, fontSize: 12 }}>
            <strong>Erreur :</strong> {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Filtre">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {(Object.keys(FILTER_LABELS) as FilterKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => { setFilterKey(k); setParam1(0.5); setParam2(0.5) }}
                  style={{ ...btnStyle, background: filterKey === k ? '#EC4899' : '#1a1a1e' }}
                >
                  {FILTER_LABELS[k]}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Paramètres">
            <Field label={`Param 1 : ${param1.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.01} value={param1} onChange={e => setParam1(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <Field label={`Param 2 : ${param2.toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.01} value={param2} onChange={e => setParam2(Number(e.target.value))} style={{ width: '100%' }} />
            </Field>
            <div style={{ fontSize: 10, color: '#9898b4' }}>
              Sémantique des params dépend du filtre — consulte le code source pour les labels exacts.
            </div>
          </Section>

          <Section title="Image">
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
            <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: 11, color: '#9898b4', lineHeight: 1.6 }}>
              <li>Tous filtres GPU, instantanés</li>
              <li>Bundle ~10 kb gzip</li>
              <li>Lib datée mais robuste (Evan Wallace)</li>
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
  padding: '6px 8px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 11,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
