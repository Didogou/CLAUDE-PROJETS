'use client'
/**
 * SpriteLayer — lecture d'une sprite-sheet en boucle sur canvas 2D.
 *
 * Pattern identique à ParticleLayer : rAF + refs, zéro re-render React
 * pendant la boucle d'animation. Chargement de l'image une seule fois par
 * changement de `sheetUrl`.
 *
 * Modes de lecture :
 *   - 'loop'     : 0 → 1 → … → N-1 → 0 → … (par défaut)
 *   - 'once'     : 0 → 1 → … → N-1 puis fige
 *   - 'pingpong' : 0 → 1 → … → N-1 → N-2 → … → 0 → 1 …
 *
 * Layout de la sprite-sheet :
 *   - `rows` = 1 (défaut) → toutes les frames sur une ligne horizontale
 *   - `rows` > 1 → grille (frames ordonnées gauche→droite, haut→bas)
 *
 * Positionnement : `position` en fraction 0-1 de la zone parent (invariant
 * au resize de l'affichage). L'anchor est le centre du sprite.
 */
import React, { useEffect, useRef } from 'react'

export interface SpriteLayerProps {
  /** URL de la sprite-sheet (image PNG/WebP). */
  sheetUrl: string
  /** Largeur d'une frame en pixels source. */
  frameWidth: number
  /** Hauteur d'une frame en pixels source. */
  frameHeight: number
  /** Nombre total de frames dans la sheet. */
  frameCount: number
  /** Nombre de rangées (pour sprite-sheets en grille). Défaut 1 (ligne unique). */
  rows?: number
  /** Durée d'affichage de chaque frame en ms. */
  frameDuration: number
  /** Mode de lecture. Défaut 'loop'. */
  loop?: 'loop' | 'once' | 'pingpong'
  /** Échelle d'affichage (1 = taille source). Défaut 1. */
  scale?: number
  /** Position du centre du sprite en fraction (0-1) de la zone parent. Défaut (0.5, 0.5). */
  position?: { x: number; y: number }
  /** Mettre l'animation en pause. */
  paused?: boolean
  /** Flip horizontal. */
  flipX?: boolean
  /** Opacité 0-1. Défaut 1. */
  opacity?: number
  /** Blend mode CSS (pour cumul additif / multiplicatif avec d'autres calques). Défaut 'normal'. */
  mixBlendMode?: React.CSSProperties['mixBlendMode']
}

export default function SpriteLayer({
  sheetUrl,
  frameWidth,
  frameHeight,
  frameCount,
  rows = 1,
  frameDuration,
  loop = 'loop',
  scale = 1,
  position = { x: 0.5, y: 0.5 },
  paused = false,
  flipX = false,
  opacity = 1,
  mixBlendMode = 'normal',
}: SpriteLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const imgReadyRef = useRef(false)
  const frameIdxRef = useRef(0)
  const lastFrameTimeRef = useRef(0)
  const directionRef = useRef<1 | -1>(1)
  // Props passées via ref pour que la boucle rAF lise toujours les valeurs courantes
  // sans avoir à se relancer à chaque changement de prop.
  const propsRef = useRef({ frameWidth, frameHeight, frameCount, rows, frameDuration, loop, scale, position, paused, flipX, opacity })
  propsRef.current = { frameWidth, frameHeight, frameCount, rows, frameDuration, loop, scale, position, paused, flipX, opacity }

  // Chargement de l'image (déclenché uniquement quand sheetUrl change)
  useEffect(() => {
    imgReadyRef.current = false
    imgRef.current = null
    frameIdxRef.current = 0
    directionRef.current = 1
    if (!sheetUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      imgReadyRef.current = true
    }
    img.onerror = (e) => {
      console.warn('[SpriteLayer] image load failed:', sheetUrl, e)
    }
    img.src = sheetUrl
  }, [sheetUrl])

  // Boucle rAF de rendu
  useEffect(() => {
    let rafId = 0
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    lastFrameTimeRef.current = performance.now()

    const tick = (now: number) => {
      const p = propsRef.current

      // Redimensionnement au conteneur parent (si changement)
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

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (imgReadyRef.current && imgRef.current && p.frameCount > 0 && p.frameDuration > 0) {
        // Avancer l'index de frame selon l'écoulé
        if (!p.paused) {
          const elapsed = now - lastFrameTimeRef.current
          if (elapsed >= p.frameDuration) {
            const steps = Math.floor(elapsed / p.frameDuration)
            for (let i = 0; i < steps; i++) {
              advanceFrame(p.loop, p.frameCount, frameIdxRef, directionRef)
            }
            lastFrameTimeRef.current = now - (elapsed % p.frameDuration)
          }
        } else {
          lastFrameTimeRef.current = now
        }

        // Calcul de la position source dans la sheet
        const cols = Math.max(1, Math.ceil(p.frameCount / Math.max(1, p.rows)))
        const idx = Math.max(0, Math.min(p.frameCount - 1, frameIdxRef.current))
        const col = idx % cols
        const row = Math.floor(idx / cols)
        const sx = col * p.frameWidth
        const sy = row * p.frameHeight

        // Calcul position destination (centrée sur p.position fraction)
        const rect = parent ? parent.getBoundingClientRect() : { width: 0, height: 0 } as DOMRect
        const dw = p.frameWidth * p.scale
        const dh = p.frameHeight * p.scale
        const dx = rect.width * p.position.x - dw / 2
        const dy = rect.height * p.position.y - dh / 2

        ctx.save()
        ctx.globalAlpha = Math.max(0, Math.min(1, p.opacity))
        ctx.imageSmoothingEnabled = true
        if (p.flipX) {
          ctx.translate(dx + dw / 2, dy + dh / 2)
          ctx.scale(-1, 1)
          ctx.translate(-dw / 2, -dh / 2)
          ctx.drawImage(imgRef.current, sx, sy, p.frameWidth, p.frameHeight, 0, 0, dw, dh)
        } else {
          ctx.drawImage(imgRef.current, sx, sy, p.frameWidth, p.frameHeight, dx, dy, dw, dh)
        }
        ctx.restore()
      }

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

function advanceFrame(
  mode: 'loop' | 'once' | 'pingpong',
  count: number,
  idxRef: React.MutableRefObject<number>,
  dirRef: React.MutableRefObject<1 | -1>,
) {
  if (mode === 'loop') {
    idxRef.current = (idxRef.current + 1) % count
    return
  }
  if (mode === 'once') {
    if (idxRef.current < count - 1) idxRef.current++
    return
  }
  // pingpong
  const next = idxRef.current + dirRef.current
  if (next >= count) {
    dirRef.current = -1
    idxRef.current = count - 2 >= 0 ? count - 2 : 0
  } else if (next < 0) {
    dirRef.current = 1
    idxRef.current = count > 1 ? 1 : 0
  } else {
    idxRef.current = next
  }
}
