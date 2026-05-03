'use client'
/**
 * ZoomLoupe — petite fenêtre de zoom flottante (220×220, 2.5×) en coin
 * haut-droit du canvas. Affiche en live la zone autour du curseur, agrandie,
 * pour aider à viser précisément avec lasso polygone / lasso libre / pinceau.
 *
 * MODULE COMPLÈTEMENT ISOLÉ :
 *   - 1 fichier : ce fichier (ZoomLoupe.tsx)
 *   - 1 bloc CSS : `.ie-zoom-loupe*` dans editor.css
 *   - 2 lignes dans CanvasOverlay : import + JSX (cf marqueurs ZOOM_LOUPE)
 *
 * Pour DÉSACTIVER complètement (au cas où ça gêne) :
 *   1. Commenter l'import en haut de CanvasOverlay
 *   2. Commenter le JSX `<ZoomLoupe ... />` en bas de CanvasOverlay
 * Aucun autre fichier touché → zéro risque de casser quoi que ce soit.
 *
 * Le composant gère TOUT en interne :
 *   - Charge sa propre instance de l'image source (browser cache → instant)
 *   - Attache son propre listener mousemove sur le containerRef passé en prop
 *   - Re-rend le canvas zoomé à chaque mousemove (drawImage avec source clip)
 *   - Crosshair rose au centre pour repérer le pixel ciblé
 */
import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

// Types légers (pas de coupling avec EditorStateContext / types.ts) pour
// permettre au caller de passer ses données telles quelles. Coords toujours
// en 0-1 normalisées par rapport à l'image source.
interface LoupePoint { x: number; y: number }
interface LoupeContour { points: LoupePoint[]; inner?: boolean }
interface LoupeMask { contours?: LoupeContour[] }
interface LoupeLassoDraft { points: LoupePoint[]; closed: boolean }
interface LoupeBrushStroke { points: LoupePoint[]; radius: number; mode: 'paint' | 'erase' }
interface LoupeRect { x1: number; y1: number; x2: number; y2: number; mode?: 'paint' | 'erase' }

interface ZoomLoupeProps {
  /** URL de l'image source à zoomer. */
  imageUrl: string | null
  /** Ref vers le container du canvas (pour cursor tracking + bbox). */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Active la loupe. Si false, le composant return null (zéro overhead). */
  enabled: boolean
  /** Facteur de zoom. Default 2.5×. */
  zoom?: number
  /** Taille du loupe en px (carré). Default 220. */
  size?: number
  /** Marge entre la loupe et le bord du canvas (px). Default 16. */
  margin?: number

  /** Couleur d'accent pour TOUS les overlays (lasso, strokes, rect, marching
   *  ants). Default rose. Permet d'adapter au contexte (teal pour weather
   *  zone main, orange pour weather impact, rose pour cut). */
  accentColor?: string

  /** Si défini (>0), affiche un cercle "brush" de ce rayon (en fraction de
   *  min(imgW, imgH)) au CENTRE de la loupe à la place du crosshair. Sert à
   *  matcher visuellement le curseur rond du pinceau qu'on voit sur le canvas. */
  centerBrushRadius?: number

  /** Optional overlays — affichés dans la loupe au-dessus de l'image source. */
  wandMasks?: LoupeMask[]
  lassoDraft?: LoupeLassoDraft | null
  brushStrokes?: LoupeBrushStroke[]
  /** Rectangle DRAFT en cours de tracé (drag rect mode). */
  rectDraft?: LoupeRect | null
  /** Rectangles déjà committés (additifs/soustractifs accumulés). */
  rects?: LoupeRect[]
}

type LoupePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

const OPPOSITE: Record<LoupePosition, LoupePosition> = {
  'top-right':    'bottom-left',
  'top-left':     'bottom-right',
  'bottom-right': 'top-left',
  'bottom-left':  'top-right',
}

export default function ZoomLoupe({
  imageUrl, containerRef, enabled, zoom = 2.5, size = 220, margin = 16,
  accentColor = '#ec4899',
  centerBrushRadius,
  wandMasks, lassoDraft, brushStrokes, rectDraft, rects,
}: ZoomLoupeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgReady, setImgReady] = useState(false)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [position, setPosition] = useState<LoupePosition>('top-right')

  // Track la taille du container — sert à calculer les positions absolues
  // (top/left en px) pour pouvoir animer entre coins via framer-motion.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setContainerSize({ w: width, h: height })
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [containerRef])

  // Charge l'image source (instance dédiée — browser HTTP cache rend ça instant
  // si elle est déjà loadée par CanvasOverlay).
  useEffect(() => {
    setImgReady(false)
    imgRef.current = null
    if (!imageUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { imgRef.current = img; setImgReady(true) }
    img.onerror = () => { imgRef.current = null }
    img.src = imageUrl
  }, [imageUrl])

  // Track le curseur. Listener attaché à `document` (pas au container) car
  // d'autres overlays (SceneDetectionsOverlay, layers, etc.) peuvent être
  // empilés au-dessus du container et catch les events avant qu'ils ne
  // bubblent. Le container sert uniquement à calculer la position normalisée
  // 0-1 par rapport à l'image affichée.
  useEffect(() => {
    if (!enabled) {
      setCursor(null)
      return
    }
    const container = containerRef.current
    if (!container) return

    function onMove(e: MouseEvent) {
      const rect = container!.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        setCursor(null)
        return
      }
      setCursor({ x, y })
    }

    document.addEventListener('mousemove', onMove)
    return () => {
      document.removeEventListener('mousemove', onMove)
    }
  }, [enabled, containerRef])

  // Dodge : si le curseur s'approche de la loupe (entre dans son rect + buffer),
  // saute vers le coin OPPOSÉ. Stable ensuite tant qu'on n'entre pas dans la
  // nouvelle zone — pas de jitter (hysteresis naturelle car on ne bouge que
  // quand cursor entre la zone CURRENT, pas tant qu'il est ailleurs).
  useEffect(() => {
    if (!cursor || containerSize.w === 0) return
    const cx = cursor.x * containerSize.w
    const cy = cursor.y * containerSize.h
    const buffer = 24 // px de marge — déclenche AVANT de toucher la loupe
    const left   = position.endsWith('right') ? containerSize.w - size - margin : margin
    const top    = position.startsWith('top')  ? margin : containerSize.h - size - margin
    const inX = cx >= left - buffer && cx <= left + size + buffer
    const inY = cy >= top - buffer  && cy <= top + size + buffer
    if (inX && inY) {
      setPosition(prev => OPPOSITE[prev])
    }
  }, [cursor, containerSize, size, margin, position])

  // Re-render le canvas zoomé à chaque move du curseur. Re-render aussi quand
  // les overlays changent (wandMasks ajoutés, lasso draft progressif, brush
  // stroke en cours) pour qu'on les voie évoluer dans la loupe en live.
  useEffect(() => {
    if (!enabled || !imgReady) return
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !cursor) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = img.naturalWidth
    const H = img.naturalHeight

    // Rectangle source (en coords pixel image) à dessiner zoomé.
    // Centré sur le pixel pointé par le curseur.
    const srcW = size / zoom
    const srcH = size / zoom
    const srcX = cursor.x * W - srcW / 2
    const srcY = cursor.y * H - srcH / 2

    // Helper : convertit un point en coords 0-1 (relatif à l'image source) vers
    // les coords pixel du canvas de la loupe.
    const toLoupe = (p: LoupePoint): [number, number] => [
      (p.x * W - srcX) * zoom,
      (p.y * H - srcY) * zoom,
    ]

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, size, size)

    // Fond noir pour les bords (si curseur près du coin de l'image)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, size, size)

    // Helper couleurs accent (avec alpha variable)
    const accent = accentColor
    const stroke = (a: number) => withAlpha(accent, a)

    // ── Overlay 1 : marching ants des wandMasks (contours pointillés) ────
    if (wandMasks && wandMasks.length > 0) {
      ctx.save()
      ctx.strokeStyle = stroke(0.85)
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 3])
      for (const mask of wandMasks) {
        if (!mask.contours) continue
        for (const c of mask.contours) {
          if (c.points.length < 2) continue
          ctx.beginPath()
          const [x0, y0] = toLoupe(c.points[0])
          ctx.moveTo(x0, y0)
          for (let i = 1; i < c.points.length; i++) {
            const [x, y] = toLoupe(c.points[i])
            ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // ── Overlay 2 : lasso draft en cours ─────────────────────────────────
    if (lassoDraft && lassoDraft.points.length >= 2) {
      ctx.save()
      ctx.strokeStyle = stroke(0.9)
      ctx.fillStyle = stroke(0.15)
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 3])
      ctx.beginPath()
      const [x0, y0] = toLoupe(lassoDraft.points[0])
      ctx.moveTo(x0, y0)
      for (let i = 1; i < lassoDraft.points.length; i++) {
        const [x, y] = toLoupe(lassoDraft.points[i])
        ctx.lineTo(x, y)
      }
      if (lassoDraft.closed) {
        ctx.closePath()
        ctx.fill()
      }
      ctx.stroke()
      ctx.restore()
    }

    // ── Overlay 3 : brush strokes (preview translucide accent color) ─────
    if (brushStrokes && brushStrokes.length > 0) {
      ctx.save()
      const brushScale = Math.min(W, H)
      for (const s of brushStrokes) {
        if (s.points.length === 0) continue
        const radiusPx = Math.max(1, s.radius * brushScale * zoom)
        const isErase = s.mode === 'erase'
        ctx.strokeStyle = isErase ? 'rgba(255, 80, 80, 0.5)' : stroke(0.45)
        ctx.fillStyle = ctx.strokeStyle
        ctx.lineWidth = radiusPx * 2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        if (s.points.length === 1) {
          const [px, py] = toLoupe(s.points[0])
          ctx.beginPath()
          ctx.arc(px, py, radiusPx, 0, Math.PI * 2)
          ctx.fill()
          continue
        }
        ctx.beginPath()
        const [x0, y0] = toLoupe(s.points[0])
        ctx.moveTo(x0, y0)
        for (let i = 1; i < s.points.length; i++) {
          const [x, y] = toLoupe(s.points[i])
          ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    // ── Overlay 4 : rectangles committed (weather rects) ────────────────
    if (rects && rects.length > 0) {
      ctx.save()
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 3])
      for (const r of rects) {
        const isErase = r.mode === 'erase'
        ctx.strokeStyle = isErase ? 'rgba(255, 80, 80, 0.7)' : stroke(0.7)
        ctx.fillStyle = isErase ? 'rgba(255, 80, 80, 0.1)' : stroke(0.12)
        const [x0, y0] = toLoupe({ x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2) })
        const [x1, y1] = toLoupe({ x: Math.max(r.x1, r.x2), y: Math.max(r.y1, r.y2) })
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
      }
      ctx.restore()
    }

    // ── Overlay 5 : rectangle DRAFT en cours de tracé ───────────────────
    if (rectDraft && Math.abs(rectDraft.x2 - rectDraft.x1) > 0.001) {
      ctx.save()
      const isErase = rectDraft.mode === 'erase'
      ctx.strokeStyle = isErase ? 'rgba(255, 80, 80, 0.9)' : stroke(0.9)
      ctx.fillStyle = isErase ? 'rgba(255, 80, 80, 0.15)' : stroke(0.15)
      ctx.lineWidth = 2
      ctx.setLineDash([5, 3])
      const [x0, y0] = toLoupe({ x: Math.min(rectDraft.x1, rectDraft.x2), y: Math.min(rectDraft.y1, rectDraft.y2) })
      const [x1, y1] = toLoupe({ x: Math.max(rectDraft.x1, rectDraft.x2), y: Math.max(rectDraft.y1, rectDraft.y2) })
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
      ctx.restore()
    }

    // ── Centre : brush circle (si centerBrushRadius défini) OU crosshair ─
    if (centerBrushRadius && centerBrushRadius > 0) {
      const brushScale = Math.min(W, H)
      const radiusPx = Math.max(2, centerBrushRadius * brushScale * zoom)
      ctx.save()
      ctx.strokeStyle = stroke(0.85)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, radiusPx, 0, Math.PI * 2)
      ctx.stroke()
      // Petit point central
      ctx.fillStyle = stroke(1)
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, 1.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      ctx.strokeStyle = stroke(0.65)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(size / 2, size / 2 - 14)
      ctx.lineTo(size / 2, size / 2 - 4)
      ctx.moveTo(size / 2, size / 2 + 4)
      ctx.lineTo(size / 2, size / 2 + 14)
      ctx.moveTo(size / 2 - 14, size / 2)
      ctx.lineTo(size / 2 - 4, size / 2)
      ctx.moveTo(size / 2 + 4, size / 2)
      ctx.lineTo(size / 2 + 14, size / 2)
      ctx.stroke()
      ctx.fillStyle = stroke(1)
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [cursor, enabled, imgReady, zoom, size, accentColor, centerBrushRadius,
      wandMasks, lassoDraft, brushStrokes, rectDraft, rects])

  if (!enabled) return null

  // Position absolue calculée en pixels (animable par framer-motion).
  // Tant que la container size n'est pas connue (1er render), on cache
  // visuellement la loupe pour éviter un flash en (0,0).
  const left = containerSize.w === 0
    ? -9999
    : position.endsWith('right') ? containerSize.w - size - margin : margin
  const top = containerSize.h === 0
    ? -9999
    : position.startsWith('top')  ? margin : containerSize.h - size - margin

  return (
    <motion.div
      className="ie-zoom-loupe"
      style={{ width: size, height: size }}
      animate={{ top, left }}
      transition={{ type: 'spring', stiffness: 280, damping: 32 }}
      aria-hidden
    >
      <canvas ref={canvasRef} width={size} height={size} />
      <div className="ie-zoom-loupe-badge">{zoom.toFixed(1)}×</div>
      {!cursor && (
        <div className="ie-zoom-loupe-empty">
          Bouge le curseur sur l&apos;image
        </div>
      )}
    </motion.div>
  )
}

/**
 * Convertit une couleur (hex #RRGGBB / rgb / rgba / nom CSS) en rgba(r,g,b,alpha).
 * Si la couleur est déjà rgba, on remplace son alpha. Sinon on parse via un
 * canvas temporaire pour récupérer les composantes RGB. Cache memoizé pour
 * éviter de re-parser les mêmes couleurs.
 */
const colorRgbCache = new Map<string, { r: number; g: number; b: number }>()
function withAlpha(color: string, alpha: number): string {
  // Cas rapide : rgba(...)  ou rgb(...)
  const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${alpha})`
  }
  // Cas hex / nom CSS : parser via canvas (1 fois, cached)
  let rgb = colorRgbCache.get(color)
  if (!rgb) {
    if (typeof document === 'undefined') return color
    const c = document.createElement('canvas')
    c.width = 1; c.height = 1
    const ctx = c.getContext('2d')
    if (!ctx) return color
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    rgb = { r: d[0], g: d[1], b: d[2] }
    colorRgbCache.set(color, rgb)
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}
