'use client'
/**
 * Mini-éditeur de retouche : brush gomme sur une image.
 *
 * Usage typique : nettoyer les artefacts laissés par SAM (bouts de personnage
 * voisin, fragments d'arrière-plan accrochés au détourage).
 *
 * Modèle :
 *   - Image source affichée dans un canvas
 *   - Clic-glisser → met l'alpha à 0 dans un disque de rayon `brushSize`
 *   - Undo (Ctrl+Z ou bouton) : remplit avec la couleur du fond gris #808080
 *     (pas un undo stricto sensu — un "repeindre" qui suffit pour cet usage)
 *   - Reset : recharge l'image source
 *   - Valider → toBlob → upload Supabase → callback `onCompleted(url)`
 *
 * L'image finale conserve la composition fond gris #808080 (les zones
 * effacées deviennent grises, conformes au format portrait standard).
 */
import React, { useEffect, useRef, useState } from 'react'

export interface EraserCanvasProps {
  imageUrl: string
  /** Appelé avec l'URL Supabase de l'image retouchée (déjà uploadée). */
  onCompleted: (url: string) => void
  /** Appelé si l'utilisateur annule la retouche (image inchangée). */
  onCancel: () => void
  /** Préfixe Supabase pour l'upload du résultat. */
  storagePathPrefix: string
  /** Couleur de "remplissage" pour les zones effacées. Défaut #808080. */
  backgroundColor?: string
}

export default function EraserCanvas({
  imageUrl, onCompleted, onCancel, storagePathPrefix, backgroundColor = '#808080',
}: EraserCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [brushSize, setBrushSize] = useState(40)
  const [drawing, setDrawing] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  /** Détection "curseur sur fond gris" → bloque la peinture mais garde le curseur visible. */
  const [overBackground, setOverBackground] = useState(false)
  /** Position display du curseur pour le cercle-preview du brush. */
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  const sourceImg = useRef<HTMLImageElement | null>(null)
  /** Ratio coords display → coords natives du canvas (recalculé au resize). */
  const ratioRef = useRef<{ x: number; y: number }>({ x: 1, y: 1 })

  // Charge l'image et initialise le canvas
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      sourceImg.current = img
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      setImgLoaded(true)
      setTimeout(updateRatio, 0)
    }
    img.onerror = () => setError('Chargement image source échoué (CORS ?)')
    img.src = imageUrl
  }, [imageUrl])

  function updateRatio() {
    const canvas = canvasRef.current
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
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * ratioRef.current.x,
      y: (e.clientY - rect.top) * ratioRef.current.y,
    }
  }

  function paintAt(x: number, y: number) {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = backgroundColor
    ctx.beginPath()
    ctx.arc(x, y, brushSize * ratioRef.current.x, 0, Math.PI * 2)
    ctx.fill()
  }

  /** Détecte si le pixel sous le curseur est le fond gris (#808080 ±15 tolérance). */
  function isOverBackgroundAt(x: number, y: number): boolean {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return false
    const xi = Math.floor(Math.max(0, Math.min(canvasRef.current!.width - 1, x)))
    const yi = Math.floor(Math.max(0, Math.min(canvasRef.current!.height - 1, y)))
    try {
      const [r, g, b] = ctx.getImageData(xi, yi, 1, 1).data
      // #808080 = 128. Tolérance ±15 pour tenir compte du JPEG et anti-aliasing.
      return Math.abs(r - 128) < 15 && Math.abs(g - 128) < 15 && Math.abs(b - 128) < 15
    } catch { return false }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (processing) return
    const { x, y } = getCoords(e)
    if (isOverBackgroundAt(x, y)) return // pas de peinture sur le fond gris
    setDrawing(true)
    paintAt(x, y)
  }
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (processing) return
    const { x, y } = getCoords(e)
    // Position display pour le cercle-preview
    const rect = canvasRef.current!.getBoundingClientRect()
    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    const overBg = isOverBackgroundAt(x, y)
    if (overBg !== overBackground) setOverBackground(overBg)
    if (!drawing) return
    if (overBg) return // skip paint if over bg (évite d'élargir le gris vers le perso)
    paintAt(x, y)
  }
  function stopDrawing() { setDrawing(false) }

  function handleReset() {
    const canvas = canvasRef.current
    const img = sourceImg.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
  }

  async function handleValidate() {
    const canvas = canvasRef.current
    if (!canvas) return
    setError(null)
    setProcessing(true)
    try {
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
      })
      const form = new FormData()
      form.append('file', blob, 'retouched.png')
      form.append('path', `${storagePathPrefix}_retouched_${Date.now()}`)
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Upload échoué (${res.status}) : ${txt.slice(0, 200)}`)
      }
      const d = await res.json()
      if (!d.url) throw new Error(d.error || 'Upload : URL manquante')
      onCompleted(d.url as string)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
        ✏️ <strong>Retouche</strong> — clic-glisser pour effacer (peint en gris #808080). Idéal pour nettoyer les bouts de voisins ou de fond restés accrochés.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.65rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Taille du pinceau : <strong style={{ color: 'var(--accent)' }}>{brushSize}px</strong>
          <input type="range" min={5} max={150} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} style={{ width: 160 }} />
        </label>
        <button onClick={handleReset} disabled={processing || !imgLoaded} style={{ fontSize: '0.7rem', padding: '0.35rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: processing ? 'wait' : 'pointer' }}>
          ↻ Reset
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button onClick={onCancel} disabled={processing} style={{ fontSize: '0.7rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: processing ? 'wait' : 'pointer' }}>
            ← Annuler
          </button>
          <button onClick={() => void handleValidate()} disabled={processing || !imgLoaded} style={{ fontSize: '0.72rem', fontWeight: 'bold', padding: '0.45rem 1rem', borderRadius: '4px', border: 'none', background: 'var(--accent)', color: '#0f0f14', cursor: processing ? 'wait' : 'pointer', opacity: processing ? 0.6 : 1 }}>
            {processing ? '⏳ Upload…' : '✓ Valider la retouche'}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>⚠ {error}</div>}

      <div ref={wrapRef} style={{ alignSelf: 'center', maxWidth: '100%', maxHeight: 'calc(95vh - 320px)', display: 'flex', justifyContent: 'center', position: 'relative' }}>
        {/* Wrapper relatif pour positionner le cercle-preview par-dessus */}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopDrawing}
            onMouseLeave={() => { stopDrawing(); setOverBackground(false); setCursorPos(null) }}
            style={{
              maxWidth: '100%', maxHeight: 'calc(95vh - 320px)', height: 'auto',
              borderRadius: '6px', border: '1px solid var(--border)',
              userSelect: 'none', background: '#808080',
              display: 'block',
              // Curseur système caché — on dessine notre propre cercle-preview par-dessus.
              cursor: processing ? 'wait' : 'none',
            }}
          />
          {/* Cercle-preview : suit la souris, affiche la taille du brush et
              change d'apparence quand on est sur le fond gris (grisé = inactif). */}
          {cursorPos && !processing && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: cursorPos.x - brushSize,
                top: cursorPos.y - brushSize,
                width: brushSize * 2,
                height: brushSize * 2,
                borderRadius: '50%',
                border: overBackground ? '1.5px dashed rgba(255,255,255,0.4)' : '2px solid rgba(255,255,255,0.9)',
                boxShadow: overBackground ? 'none' : '0 0 0 1px rgba(0,0,0,0.35)',
                pointerEvents: 'none',
                mixBlendMode: 'difference',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
