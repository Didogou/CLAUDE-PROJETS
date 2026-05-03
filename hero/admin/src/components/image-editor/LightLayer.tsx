'use client'
/**
 * LightLayer — point lumineux avec halo radial et flicker animé.
 *
 * Pattern identique à ParticleLayer / SpriteLayer : rAF + refs, zéro
 * re-render React pendant la boucle d'animation.
 *
 * Modes d'intensité :
 *   - 'static'  : halo fixe
 *   - 'flicker' : vacillement irrégulier multi-fréquence (bougie, torche, ampoule)
 *   - 'pulse'   : pulsation sinusoïdale régulière (cristal, LED, respiration)
 *   - 'strobe'  : on/off brutal (gyrophare, stroboscope)
 *
 * Blend CSS conseillé pour superposer plusieurs lumières additivement :
 *   mix-blend-mode: 'screen' | 'lighten' | 'plus-lighter'
 */
import React, { useEffect, useRef } from 'react'

export type LightMode = 'static' | 'flicker' | 'pulse' | 'strobe'

export interface LightLayerProps {
  /** Position du centre en fraction (0-1) de la zone parent. */
  position?: { x: number; y: number }
  /** Couleur de la lumière (hex #RRGGBB ou nom CSS). */
  color?: string
  /** Intensité max (0-1). Défaut 1. */
  intensity?: number
  /** Rayon du halo en pixels de la zone parent. Défaut 120. */
  radius?: number
  /** Mode d'animation de l'intensité. */
  mode?: LightMode
  /** Amplitude du flicker / pulse (0-1). 0 = statique malgré le mode. Défaut 0.4. */
  flickerAmount?: number
  /** Vitesse du flicker (0.1-5). Plus élevé = plus rapide. Défaut 1. */
  speed?: number
  /** Blend mode CSS sur le canvas (pour cumul additif avec d'autres lumières). */
  mixBlendMode?: React.CSSProperties['mixBlendMode']
}

export default function LightLayer({
  position = { x: 0.5, y: 0.5 },
  color = '#ffb366',
  intensity = 1,
  radius = 120,
  mode = 'flicker',
  flickerAmount = 0.4,
  speed = 1,
  mixBlendMode = 'screen',
}: LightLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ position, color, intensity, radius, mode, flickerAmount, speed })
  propsRef.current = { position, color, intensity, radius, mode, flickerAmount, speed }

  useEffect(() => {
    let rafId = 0
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const t0 = performance.now()

    const tick = (now: number) => {
      const p = propsRef.current

      // Resize si nécessaire
      const parent = canvas.parentElement
      if (parent) {
        const rect = parent.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const targetW = Math.max(1, Math.floor(rect.width * dpr))
        const targetH = Math.max(1, Math.floor(rect.height * dpr))
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW
          canvas.height = targetH
          canvas.style.width = rect.width + 'px'
          canvas.style.height = rect.height + 'px'
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }

      const rect = parent?.getBoundingClientRect() ?? { width: 0, height: 0 } as DOMRect
      ctx.clearRect(0, 0, rect.width, rect.height)

      // Calcul de l'intensité courante selon le mode
      const t = (now - t0) / 1000
      const curIntensity = computeIntensity(t, p)

      if (curIntensity <= 0.001 || p.radius <= 0) {
        rafId = requestAnimationFrame(tick)
        return
      }

      const cx = rect.width * p.position.x
      const cy = rect.height * p.position.y
      const r = p.radius

      const rgb = parseColor(p.color)

      // Halo radial : centre saturé, bord transparent, falloff doux
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${curIntensity})`)
      grad.addColorStop(0.25, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${curIntensity * 0.7})`)
      grad.addColorStop(0.6, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${curIntensity * 0.25})`)
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)

      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()

      // Core plus saturé au centre (cœur de la flamme/ampoule)
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.15)
      coreGrad.addColorStop(0, `rgba(255, 255, 255, ${curIntensity * 0.8})`)
      coreGrad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${curIntensity * 0.5})`)
      coreGrad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)
      ctx.fillStyle = coreGrad
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.15, 0, Math.PI * 2)
      ctx.fill()

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        mixBlendMode,
      }}
    />
  )
}

/** Calcule l'intensité courante selon le mode et le temps écoulé (secondes). */
function computeIntensity(
  t: number,
  p: { intensity: number; mode: LightMode; flickerAmount: number; speed: number },
): number {
  const base = p.intensity
  const amp = Math.max(0, Math.min(1, p.flickerAmount))

  switch (p.mode) {
    case 'static':
      return base
    case 'flicker': {
      // Combinaison de 3 sinusoïdes à fréquences irrégulières → bruit non-périodique
      // visuellement (bougie, torche, ampoule qui vacille).
      const noise = 0.4 * Math.sin(t * p.speed * 2.1)
                  + 0.3 * Math.sin(t * p.speed * 5.3)
                  + 0.3 * Math.sin(t * p.speed * 11.7)
      const n = (noise + 1) / 2  // normaliser 0-1
      return base * (1 - amp + amp * n)
    }
    case 'pulse': {
      const wave = 0.5 + 0.5 * Math.sin(t * p.speed * Math.PI)
      return base * (1 - amp + amp * wave)
    }
    case 'strobe': {
      const period = 1 / Math.max(0.1, p.speed)
      const on = Math.floor(t / period) % 2 === 0
      return on ? base : base * (1 - amp)
    }
  }
}

/** Parse une couleur CSS (#RRGGBB ou #RGB) en {r, g, b}. Fallback blanc sur échec. */
function parseColor(color: string): { r: number; g: number; b: number } {
  const hex = color.trim()
  if (hex.startsWith('#')) {
    const short = hex.length === 4
    const r = parseInt(short ? hex[1] + hex[1] : hex.slice(1, 3), 16)
    const g = parseInt(short ? hex[2] + hex[2] : hex.slice(3, 5), 16)
    const b = parseInt(short ? hex[3] + hex[3] : hex.slice(5, 7), 16)
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return { r, g, b }
  }
  // Named colors courants (fallback simple)
  const named: Record<string, [number, number, number]> = {
    white: [255, 255, 255],
    yellow: [255, 235, 100],
    orange: [255, 160, 60],
    red: [255, 80, 80],
    blue: [100, 160, 255],
    cyan: [120, 240, 255],
    magenta: [255, 100, 220],
    green: [120, 240, 150],
  }
  const rgb = named[hex.toLowerCase()]
  if (rgb) return { r: rgb[0], g: rgb[1], b: rgb[2] }
  return { r: 255, g: 255, b: 255 }
}
