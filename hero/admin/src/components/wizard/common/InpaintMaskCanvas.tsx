'use client'
/**
 * Mini-éditeur "peindre le mask" pour inpainting SDXL.
 *
 * L'utilisateur :
 *   1. Voit l'image source (en transparence semi-opaque pour repère)
 *   2. Peint en blanc (alpha 1) la zone à RECONSTRUIRE
 *   3. Saisit un prompt court (ex: "hands, detailed fingers")
 *   4. Clic Lancer → upload mask Supabase → appel inpaint
 *
 * Le canvas du mask est un overlay au-dessus de l'image source. La sortie
 * est un PNG noir & blanc (mask binaire) uploadé puis passé à l'API inpaint.
 */
import React, { useEffect, useRef, useState } from 'react'

export interface InpaintMaskCanvasProps {
  imageUrl: string
  /** Appelé avec le résultat inpainté (URL Supabase) après succès. */
  onCompleted: (resultUrl: string) => void
  /** Appelé si annulation. */
  onCancel: () => void
  /** Prompt par défaut (peut être suggéré par le caller, ex: "hands, detailed fingers"). */
  defaultPrompt?: string
  /** Filename checkpoint SDXL pour l'inpaint. */
  checkpoint: string
  /** Préfixe Supabase pour stocker mask + résultat. */
  storagePathPrefix: string
  /** Helper d'inpaint injecté (test friendly). Défaut : inpaintRegion réel. */
  runInpaint?: (params: { imageUrl: string; maskUrl: string; checkpoint: string; promptPositive: string; storagePath: string }) => Promise<string>
}

import { inpaintRegion } from '../helpers/inpaintRegion'

export default function InpaintMaskCanvas({
  imageUrl, onCompleted, onCancel, defaultPrompt = 'hands, detailed fingers, anatomically correct',
  checkpoint, storagePathPrefix,
  runInpaint = ({ imageUrl: u, maskUrl, checkpoint: c, promptPositive, storagePath }) =>
    inpaintRegion({ imageUrl: u, maskUrl, checkpoint: c, promptPositive, storagePath }),
}: InpaintMaskCanvasProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [brushSize, setBrushSize] = useState(40)
  const [drawing, setDrawing] = useState(false)
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const ratioRef = useRef<{ x: number; y: number }>({ x: 1, y: 1 })

  // Init mask canvas dès que l'image est chargée
  function handleImgLoad() {
    const img = imgRef.current
    const canvas = maskCanvasRef.current
    if (!img || !canvas) return
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setImgLoaded(true)
    setTimeout(updateRatio, 0)
  }

  function updateRatio() {
    const canvas = maskCanvasRef.current
    if (!canvas) return
    ratioRef.current = {
      x: canvas.width / canvas.clientWidth,
      y: canvas.height / canvas.clientHeight,
    }
  }
  useEffect(() => {
    window.addEventListener('resize', updateRatio)
    return () => window.removeEventListener('resize', updateRatio)
  }, [])

  function getCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = maskCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * ratioRef.current.x,
      y: (e.clientY - rect.top) * ratioRef.current.y,
    }
  }
  function paintAt(x: number, y: number) {
    const ctx = maskCanvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(x, y, brushSize * ratioRef.current.x, 0, Math.PI * 2)
    ctx.fill()
  }
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (processing) return
    setDrawing(true)
    const { x, y } = getCoords(e); paintAt(x, y)
  }
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing || processing) return
    const { x, y } = getCoords(e); paintAt(x, y)
  }
  function stopDrawing() { setDrawing(false) }
  function handleClear() {
    const canvas = maskCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  /** Vérifie qu'au moins quelques pixels sont peints en blanc. */
  function maskIsEmpty(): boolean {
    const canvas = maskCanvasRef.current
    if (!canvas) return true
    const ctx = canvas.getContext('2d')!
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < data.length; i += 4 * 100) {  // sample 1/100 pixels pour speed
      if (data[i] > 200) return false
    }
    return true
  }

  async function handleRun() {
    if (maskIsEmpty()) { setError('Peins d\'abord la zone à corriger en blanc.'); return }
    if (!prompt.trim()) { setError('Saisis un prompt court (ex: "hands, detailed fingers").'); return }
    setError(null)
    setProcessing(true)
    try {
      // Upload mask en blob
      const blob: Blob = await new Promise((resolve, reject) => {
        maskCanvasRef.current!.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
      })
      const form = new FormData()
      form.append('file', blob, 'inpaint_mask.png')
      form.append('path', `${storagePathPrefix}_mask_${Date.now()}`)
      const upRes = await fetch('/api/upload-image', { method: 'POST', body: form })
      if (!upRes.ok) {
        const txt = await upRes.text().catch(() => '')
        throw new Error(`Upload mask échoué (${upRes.status}) : ${txt.slice(0, 200)}`)
      }
      const upData = await upRes.json()
      if (!upData.url) throw new Error(upData.error || 'Upload mask : URL manquante')

      const resultUrl = await runInpaint({
        imageUrl,
        maskUrl: upData.url,
        checkpoint,
        promptPositive: prompt.trim(),
        storagePath: `${storagePathPrefix}_inpainted_${Date.now()}`,
      })
      onCompleted(resultUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
        🩹 <strong>Inpaint</strong> — peins en blanc la zone à reconstruire (mains cassées, partie tronquée…). Le prompt local guide la régen.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.65rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Pinceau : <strong style={{ color: 'var(--accent)' }}>{brushSize}px</strong>
          <input type="range" min={5} max={150} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} style={{ width: 140 }} />
        </label>
        <button onClick={handleClear} disabled={processing || !imgLoaded} style={{ fontSize: '0.7rem', padding: '0.35rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: processing ? 'wait' : 'pointer' }}>
          ↻ Effacer mask
        </button>
        <input
          type="text" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="ex: hands, detailed fingers"
          style={{ flex: 1, minWidth: 200, fontSize: '0.7rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem 0.5rem', color: 'var(--foreground)' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={onCancel} disabled={processing} style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: processing ? 'wait' : 'pointer' }}>
            ← Annuler
          </button>
          <button onClick={() => void handleRun()} disabled={processing || !imgLoaded} style={{ fontSize: '0.72rem', fontWeight: 'bold', padding: '0.45rem 1rem', borderRadius: '4px', border: 'none', background: 'var(--accent)', color: '#0f0f14', cursor: processing ? 'wait' : 'pointer', opacity: processing ? 0.6 : 1 }}>
            {processing ? '⏳ Inpaint en cours…' : '🩹 Lancer l\'inpaint'}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>⚠ {error}</div>}

      {/* Stack image source + mask canvas (overlay) */}
      <div ref={wrapRef} style={{ position: 'relative', alignSelf: 'center', maxWidth: '100%', maxHeight: 'calc(95vh - 350px)', display: 'inline-block' }}>
        <img
          ref={imgRef}
          src={imageUrl}
          alt="source"
          crossOrigin="anonymous"
          onLoad={handleImgLoad}
          draggable={false}
          style={{ maxWidth: '100%', maxHeight: 'calc(95vh - 350px)', height: 'auto', display: 'block', borderRadius: '6px', border: '1px solid var(--border)' }}
        />
        <canvas
          ref={maskCanvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: processing ? 'wait' : 'crosshair', userSelect: 'none', mixBlendMode: 'screen', opacity: 0.55 }}
        />
      </div>
    </div>
  )
}
