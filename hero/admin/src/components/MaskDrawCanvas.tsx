'use client'

import React, { useEffect, useRef, useState } from 'react'

interface Props {
  /** URL de l'image source à afficher en fond (le masque aura la même résolution) */
  sourceImageUrl: string
  /** Appelé quand l'utilisateur sauve — fournit un Blob PNG noir/blanc à la résolution de la source */
  onSave: (blob: Blob) => Promise<void> | void
  onClose: () => void
  /** Masque existant à pré-charger (URL) — optionnel */
  initialMaskUrl?: string
}

type Tool = 'brush' | 'eraser'

/**
 * Éditeur de masque en canvas HTML5.
 * - Fond : image source (affichée en semi-transparent pour guider)
 * - Dessus : canvas où l'utilisateur peint
 * - Peinture blanche = zone à animer ; transparent/noir = zone statique
 * - Export : PNG noir/blanc à la résolution EXACTE de l'image source
 */
export default function MaskDrawCanvas({ sourceImageUrl, onSave, onClose, initialMaskUrl }: Props) {
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null) // image source (bg)
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)   // zone peinte (full resolution)
  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(40)
  const [sourceDims, setSourceDims] = useState<{ w: number; h: number } | null>(null)
  const [history, setHistory] = useState<ImageData[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [saving, setSaving] = useState(false)
  const isDrawingRef = useRef(false)

  // ── Charge l'image source + initMask (si fourni) dans les canvases ─────────
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      setSourceDims({ w, h })
      // Source canvas
      const srcCanvas = sourceCanvasRef.current
      if (srcCanvas) {
        srcCanvas.width = w
        srcCanvas.height = h
        const ctx = srcCanvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h)
        }
      }
      // Mask canvas
      const maskCanvas = maskCanvasRef.current
      if (maskCanvas) {
        maskCanvas.width = w
        maskCanvas.height = h
        const mctx = maskCanvas.getContext('2d')
        if (mctx) {
          // Fond noir
          mctx.fillStyle = 'black'
          mctx.fillRect(0, 0, w, h)
          // Si masque initial fourni, on le charge comme point de départ
          if (initialMaskUrl) {
            const maskImg = new Image()
            maskImg.crossOrigin = 'anonymous'
            maskImg.onload = () => {
              mctx.drawImage(maskImg, 0, 0, w, h)
              pushHistory(mctx)
            }
            maskImg.onerror = () => pushHistory(mctx)
            maskImg.src = initialMaskUrl
          } else {
            pushHistory(mctx)
          }
        }
      }
    }
    img.onerror = () => {
      console.warn('[MaskDraw] failed to load source image', sourceImageUrl)
    }
    img.src = sourceImageUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceImageUrl, initialMaskUrl])

  function pushHistory(ctx: CanvasRenderingContext2D) {
    const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
    setHistory(h => [...h.slice(0, historyIndex + 1), data])
    setHistoryIndex(i => i + 1)
  }

  function undo() {
    if (historyIndex <= 0) return
    const newIdx = historyIndex - 1
    setHistoryIndex(newIdx)
    const ctx = maskCanvasRef.current?.getContext('2d')
    if (ctx && history[newIdx]) {
      ctx.putImageData(history[newIdx], 0, 0)
    }
  }

  function clearAll() {
    const ctx = maskCanvasRef.current?.getContext('2d')
    if (!ctx || !sourceDims) return
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, sourceDims.w, sourceDims.h)
    pushHistory(ctx)
  }

  // ── Traçage ────────────────────────────────────────────────────────────────
  function getMousePos(e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null {
    const overlay = e.currentTarget
    const rect = overlay.getBoundingClientRect()
    if (!sourceDims) return null
    const scaleX = sourceDims.w / rect.width
    const scaleY = sourceDims.h / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const pos = getMousePos(e)
    if (!pos) return
    isDrawingRef.current = true
    drawAt(pos.x, pos.y, true)
  }

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isDrawingRef.current) return
    const pos = getMousePos(e)
    if (!pos) return
    drawAt(pos.x, pos.y, false)
  }

  function onMouseUp() {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    const ctx = maskCanvasRef.current?.getContext('2d')
    if (ctx) pushHistory(ctx)
  }

  const lastPosRef = useRef<{ x: number; y: number } | null>(null)
  function drawAt(x: number, y: number, isStart: boolean) {
    const ctx = maskCanvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brushSize
    ctx.strokeStyle = tool === 'brush' ? 'white' : 'black'
    ctx.fillStyle = tool === 'brush' ? 'white' : 'black'
    // Trait continu
    if (isStart || !lastPosRef.current) {
      ctx.beginPath()
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
    lastPosRef.current = { x, y }
  }

  // ── Export PNG ─────────────────────────────────────────────────────────────
  async function handleSave() {
    const canvas = maskCanvasRef.current
    if (!canvas) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'))
      if (!blob) throw new Error('Export PNG échoué')
      await onSave(blob)
      onClose()
    } catch (err) {
      alert('Erreur sauvegarde masque : ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', maxWidth: '90vw', maxHeight: '92vh' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.9rem', color: '#f0a742' }}>🎨 Dessiner le masque d'animation</strong>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>
            Peins en <strong style={{ color: '#fff' }}>blanc</strong> la zone qui doit bouger. Le reste reste statique.
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button onClick={() => setTool('brush')} style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '5px', border: `1px solid ${tool === 'brush' ? '#f0a742' : 'var(--border)'}`, background: tool === 'brush' ? '#f0a74222' : 'var(--surface-2)', color: tool === 'brush' ? '#f0a742' : 'var(--foreground)', cursor: 'pointer', fontWeight: tool === 'brush' ? 'bold' : 'normal' }}>✏️ Pinceau</button>
            <button onClick={() => setTool('eraser')} style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '5px', border: `1px solid ${tool === 'eraser' ? '#f0a742' : 'var(--border)'}`, background: tool === 'eraser' ? '#f0a74222' : 'var(--surface-2)', color: tool === 'eraser' ? '#f0a742' : 'var(--foreground)', cursor: 'pointer', fontWeight: tool === 'eraser' ? 'bold' : 'normal' }}>🧽 Gomme</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
              Taille
              <input type="range" min={5} max={200} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} style={{ width: 80 }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--foreground)', fontWeight: 'bold', minWidth: 28 }}>{brushSize}</span>
            </label>
            <button onClick={undo} disabled={historyIndex <= 0} style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '5px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', cursor: historyIndex <= 0 ? 'default' : 'pointer', opacity: historyIndex <= 0 ? 0.4 : 1 }}>↶ Annuler</button>
            <button onClick={clearAll} style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '5px', border: '1px solid #c94c4c66', background: '#c94c4c22', color: '#c94c4c', cursor: 'pointer' }}>✕ Effacer tout</button>
          </div>
        </div>

        {/* Zone canvas : background image + overlay semi-transparent du masque */}
        <div
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{
            position: 'relative',
            width: sourceDims ? `min(${sourceDims.w}px, 86vw)` : '86vw',
            aspectRatio: sourceDims ? `${sourceDims.w} / ${sourceDims.h}` : '16 / 9',
            maxHeight: '74vh',
            cursor: tool === 'brush' ? 'crosshair' : 'crosshair',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            overflow: 'hidden',
            userSelect: 'none',
            background: '#000',
          }}
        >
          {/* Image source en fond */}
          <canvas
            ref={sourceCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
          {/* Overlay du masque (semi-transparent pour voir l'image dessous) */}
          <canvas
            ref={maskCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5, mixBlendMode: 'normal', pointerEvents: 'none' }}
          />
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'flex-end' }}>
          {sourceDims && <span style={{ fontSize: '0.65rem', color: 'var(--muted)', marginRight: 'auto' }}>{sourceDims.w} × {sourceDims.h} px</span>}
          <button onClick={onClose} style={{ fontSize: '0.75rem', padding: '0.35rem 0.9rem', borderRadius: '5px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', cursor: 'pointer' }}>Annuler</button>
          <button onClick={handleSave} disabled={saving} style={{ fontSize: '0.75rem', padding: '0.35rem 1.1rem', borderRadius: '5px', background: '#f0a742', border: 'none', color: '#0f0f14', cursor: saving ? 'default' : 'pointer', fontWeight: 'bold' }}>
            {saving ? '⏳ Sauvegarde…' : '💾 Sauvegarder le masque'}
          </button>
        </div>
      </div>
    </div>
  )
}
