'use client'
/**
 * WeatherZoneBrushEditor — overlay interactif pinceau pour définir une zone
 * météo en mode 'brush' (strokes paint/erase). Refonte 2026-05-15dj — M4.
 *
 * Strokes sont stockés en coordonnées normalisées 0-1, avec radius en fraction
 * de min(w, h) du parent (cohérent avec WeatherBrushStroke des images).
 *
 * Visualisation pendant édition : trace overlay live (cyan paint, rouge erase)
 * + cercle représentant la taille du pinceau qui suit la souris.
 * Hors édition : pas de visu — c'est ParticleLayer qui clip naturellement.
 */

import React, { useEffect, useRef, useState } from 'react'

export interface BrushStroke {
  points: { x: number; y: number }[]
  radius: number
  mode: 'paint' | 'erase'
}

interface WeatherZoneBrushEditorProps {
  /** 'editing' active la capture pointer + UI hint. */
  mode: 'editing' | 'view'
  /** Strokes existants. Affichés en outline subtle pendant édition. */
  committedStrokes?: BrushStroke[]
  /** Taille pinceau en fraction de min(w,h). Default 0.04. */
  brushSize?: number
  /** Mode courant : paint ou erase. */
  brushMode?: 'paint' | 'erase'
  /** Couleur accent (default bleu). */
  accent?: string
  /** Callback à chaque stroke complet (mouseup). Le caller append à zone.strokes. */
  onCommitStroke?: (stroke: BrushStroke) => void
  /** Callback annulation (Échap). */
  onCancel?: () => void
}

export default function WeatherZoneBrushEditor({
  mode, committedStrokes = [], brushSize = 0.04, brushMode = 'paint',
  accent = '#60A5FA', onCommitStroke, onCancel,
}: WeatherZoneBrushEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [drafting, setDrafting] = useState<BrushStroke | null>(null)
  const draftRef = useRef<BrushStroke | null>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [cursorXY, setCursorXY] = useState<{ x: number; y: number } | null>(null)

  // Escape pour annuler
  useEffect(() => {
    if (mode !== 'editing') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onCancel])

  // Resize canvas pour matcher le parent
  useEffect(() => {
    if (mode !== 'editing') return
    const el = containerRef.current
    const cv = canvasRef.current
    if (!el || !cv) return
    const update = () => {
      const r = el.getBoundingClientRect()
      cv.width = Math.max(1, Math.round(r.width))
      cv.height = Math.max(1, Math.round(r.height))
      redraw()
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Redraw quand strokes ou drafting changent
  useEffect(() => {
    if (mode !== 'editing') return
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, drafting, committedStrokes])

  function redraw() {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    const minSide = Math.min(cv.width, cv.height)
    // Helper draw stroke avec mode-specific style
    function drawStroke(s: BrushStroke, opacity: number) {
      ctx!.strokeStyle = s.mode === 'paint' ? accent : '#F87171'
      ctx!.fillStyle = s.mode === 'paint' ? accent : '#F87171'
      ctx!.globalAlpha = opacity
      ctx!.lineCap = 'round'
      ctx!.lineJoin = 'round'
      ctx!.lineWidth = s.radius * 2 * minSide
      ctx!.beginPath()
      s.points.forEach((p, i) => {
        const px = p.x * cv!.width
        const py = p.y * cv!.height
        if (i === 0) ctx!.moveTo(px, py)
        else ctx!.lineTo(px, py)
      })
      ctx!.stroke()
    }
    // Strokes committed (semi-opaques)
    for (const s of committedStrokes) drawStroke(s, 0.25)
    // Stroke en cours (plus opaque)
    if (drafting) drawStroke(drafting, 0.5)
    ctx.globalAlpha = 1
  }

  function pointNorm(ev: React.PointerEvent | PointerEvent): { x: number; y: number } | null {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const x = (ev.clientX - rect.left) / rect.width
    const y = (ev.clientY - rect.top) / rect.height
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
  }

  function handlePointerDown(ev: React.PointerEvent) {
    if (mode !== 'editing') return
    ev.preventDefault()
    const p = pointNorm(ev)
    if (!p) return
    const stroke: BrushStroke = { points: [p], radius: brushSize, mode: brushMode }
    draftRef.current = stroke
    setDrafting(stroke)
    lastPointRef.current = p
    ;(ev.target as Element).setPointerCapture?.(ev.pointerId)
  }

  function handlePointerMove(ev: React.PointerEvent) {
    if (mode !== 'editing') return
    const p = pointNorm(ev)
    if (!p) return
    setCursorXY(p)
    if (!draftRef.current) return
    // Throttle : ajoute un point seulement si déplacement > brushSize/4 (lisse + light)
    const last = lastPointRef.current
    const minDist = brushSize * 0.25
    if (last) {
      const dx = p.x - last.x
      const dy = p.y - last.y
      if (Math.hypot(dx, dy) < minDist) return
    }
    draftRef.current.points.push(p)
    setDrafting({ ...draftRef.current, points: [...draftRef.current.points] })
    lastPointRef.current = p
  }

  function handlePointerUp() {
    const s = draftRef.current
    draftRef.current = null
    lastPointRef.current = null
    if (s && s.points.length > 0) {
      onCommitStroke?.(s)
    }
    setDrafting(null)
  }

  function handlePointerLeave() {
    setCursorXY(null)
    handlePointerUp()
  }

  if (mode !== 'editing') return null

  return (
    <div
      ref={containerRef}
      className="efx-brush-editor"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      style={{
        position: 'absolute', inset: 0, zIndex: 26,
        cursor: 'crosshair',
        background: 'rgba(0, 0, 0, 0.18)',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      {/* Cercle pinceau qui suit le curseur */}
      {cursorXY && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: `${(cursorXY.x * 100).toFixed(2)}%`,
            top: `${(cursorXY.y * 100).toFixed(2)}%`,
            width: `${brushSize * 200}%`,  // ÷2 du diamètre car % parent
            aspectRatio: '1 / 1',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: `0.0625rem solid ${brushMode === 'paint' ? accent : '#F87171'}`,
            background: `${brushMode === 'paint' ? accent : '#F87171'}15`,
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute', top: '0.5rem', left: '50%',
          transform: 'translateX(-50%)',
          padding: '0.4rem 0.85rem',
          background: 'rgba(0, 0, 0, 0.78)',
          color: '#fff', fontSize: '0.78rem', fontWeight: 500,
          borderRadius: '0.3rem',
          pointerEvents: 'none',
          border: `0.0625rem solid ${brushMode === 'paint' ? accent : '#F87171'}`,
        }}
      >
        Peindre la zone {brushMode === 'paint' ? '(ajoute)' : '(retire)'} — Échap pour terminer
      </div>
    </div>
  )
}
