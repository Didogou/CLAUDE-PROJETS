'use client'
/**
 * Modale d'effacement d'objet/zone sur un panorama.
 *
 * 2 modes de sélection :
 *   - Box : drag d'un rectangle autour de la zone à effacer (rapide, grossier)
 *   - Point (SAM) : clic sur l'objet → SAM 2 segmente précisément → mask propre
 *
 * Au submit :
 *   1. Récupère le mask_url :
 *      • mode Box → génère mask PNG local (canvas) + upload Supabase
 *      • mode SAM → appelle /api/comfyui/segment qui renvoie directement un mask_url
 *   2. Appelle /api/comfyui/erase (LAMA) avec image_url + mask_url
 *   3. Renvoie au parent l'URL du pano effacé (onErased)
 *
 * LAMA (big-lama.pt) reconstitue plausiblement le background sans halluciner.
 *
 * Pré-requis :
 *   - Custom node Acly : comfyui-inpaint-nodes + models/inpaint/big-lama.pt
 *   - Custom node kijai : ComfyUI-segment-anything-2 + HeroSAM2Individual
 */
import React, { useRef, useState } from 'react'
import BoxSelector, { type Box } from './BoxSelector'
import SAMSelector, { type SAMPoint } from './SAMSelector'

export interface Pano360EraserProps {
  /** URL du pano source à nettoyer. */
  panoramaUrl: string
  /** Préfixe Supabase pour stocker mask intermédiaire + résultat effacé. */
  storagePathPrefix: string
  /** Callback appelé quand l'effacement a abouti avec l'URL du nouveau pano. */
  onErased: (newPanoramaUrl: string) => void
  onCancel: () => void
}

type SelectionMode = 'box' | 'sam'

async function uploadBlobPng(blob: Blob, storagePath: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'erase.png')
  form.append('path', storagePath)
  const res = await fetch('/api/upload-image', { method: 'POST', body: form })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Upload échoué (${res.status}): ${txt.slice(0, 200)}`)
  }
  const d = await res.json()
  if (!d.url) throw new Error(d.error || 'Upload : pas d\'URL')
  return d.url as string
}

export default function Pano360Eraser({ panoramaUrl, storagePathPrefix, onErased, onCancel }: Pano360EraserProps) {
  const [mode, setMode] = useState<SelectionMode>('sam')
  const [box, setBox] = useState<Box | null>(null)
  const [points, setPoints] = useState<SAMPoint[]>([])
  /** Marge à ajouter autour de la box (en %) pour aider LAMA à combler les bords.
   *  Ignoré en mode SAM car le mask est déjà taillé au pixel. */
  const [padPct, setPadPct] = useState(8)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const imgRef = useRef<HTMLImageElement | null>(null)

  function resetSelection() { setBox(null); setPoints([]) }

  async function getMaskUrlFromBox(img: HTMLImageElement, b: Box): Promise<string> {
    const sx = img.naturalWidth / img.clientWidth
    const sy = img.naturalHeight / img.clientHeight
    const bx = Math.round(b.x * sx)
    const by = Math.round(b.y * sy)
    const bw = Math.round(b.w * sx)
    const bh = Math.round(b.h * sy)

    const padX = Math.round((bw * padPct) / 100)
    const padY = Math.round((bh * padPct) / 100)
    const mx = Math.max(0, bx - padX)
    const my = Math.max(0, by - padY)
    const mw = Math.min(img.naturalWidth - mx, bw + padX * 2)
    const mh = Math.min(img.naturalHeight - my, bh + padY * 2)

    const mask = document.createElement('canvas')
    mask.width = img.naturalWidth
    mask.height = img.naturalHeight
    const mctx = mask.getContext('2d')!
    mctx.fillStyle = 'black'
    mctx.fillRect(0, 0, mask.width, mask.height)
    mctx.fillStyle = 'white'
    mctx.fillRect(mx, my, mw, mh)

    const blob: Blob = await new Promise((resolve, reject) =>
      mask.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    )
    return uploadBlobPng(blob, `${storagePathPrefix}_erase_mask_${Date.now()}`)
  }

  async function getMaskUrlFromSAM(img: HTMLImageElement, pts: SAMPoint[]): Promise<string> {
    const sx = img.naturalWidth / img.clientWidth
    const sy = img.naturalHeight / img.clientHeight
    const naturalPoints = pts.map(p => ({
      x: Math.round(p.x * sx),
      y: Math.round(p.y * sy),
      positive: p.positive,
    }))
    const res = await fetch('/api/comfyui/segment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: panoramaUrl, points: naturalPoints }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`SAM a échoué (${res.status}). ${txt.slice(0, 200)}`)
    }
    const d = await res.json()
    if (!d.mask_url) throw new Error(d.error || 'SAM : pas de mask retourné')
    return d.mask_url as string
  }

  async function handleErase() {
    const img = imgRef.current
    if (!img) { setError('Image non chargée.'); return }

    if (mode === 'box' && (!box || box.w < 5 || box.h < 5)) {
      setError('Dessine une zone valide sur le pano.'); return
    }
    if (mode === 'sam' && points.filter(p => p.positive).length === 0) {
      setError('Clique au moins un point positif sur l\'objet à effacer.'); return
    }

    setError(null); setBusy(true)
    try {
      setProgress(mode === 'sam' ? 'Segmentation SAM…' : 'Génération du mask…')
      const maskUrl = mode === 'box'
        ? await getMaskUrlFromBox(img, box!)
        : await getMaskUrlFromSAM(img, points)

      setProgress('Effacement LAMA (~10-30s)…')
      const res = await fetch('/api/comfyui/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: panoramaUrl,
          mask_url: maskUrl,
          storage_path: `${storagePathPrefix}_erased_${Date.now()}`,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `Erreur ${res.status}`)
      if (!d.image_url) throw new Error('Pas d\'URL en retour')
      onErased(d.image_url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = mode === 'box'
    ? !!box && box.w >= 5 && box.h >= 5
    : points.filter(p => p.positive).length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
        Sélectionne l&apos;élément à supprimer. LAMA reconstitue le décor sans halluciner de nouveaux personnages.
      </div>

      {/* Toggle mode */}
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.62rem' }}>
        <span style={{ color: 'var(--muted)' }}>Mode :</span>
        <button onClick={() => { setMode('sam'); resetSelection() }} disabled={busy}
          style={{ padding: '0.25rem 0.6rem', borderRadius: '3px', border: `1px solid ${mode === 'sam' ? '#52c484' : 'var(--border)'}`, background: mode === 'sam' ? 'rgba(82,196,132,0.15)' : 'var(--surface-2)', color: mode === 'sam' ? '#52c484' : 'var(--muted)', cursor: busy ? 'wait' : 'pointer', fontWeight: mode === 'sam' ? 'bold' : 'normal' }}>
          ✨ Point magique (SAM)
        </button>
        <button onClick={() => { setMode('box'); resetSelection() }} disabled={busy}
          style={{ padding: '0.25rem 0.6rem', borderRadius: '3px', border: `1px solid ${mode === 'box' ? '#52c484' : 'var(--border)'}`, background: mode === 'box' ? 'rgba(82,196,132,0.15)' : 'var(--surface-2)', color: mode === 'box' ? '#52c484' : 'var(--muted)', cursor: busy ? 'wait' : 'pointer', fontWeight: mode === 'box' ? 'bold' : 'normal' }}>
          ▭ Rectangle
        </button>
        <span style={{ color: 'var(--muted)', opacity: 0.7, marginLeft: '0.3rem' }}>
          {mode === 'sam'
            ? 'Clic = point positif · Shift+clic = négatif · Clic droit sur pastille = retirer'
            : 'Drag pour tracer la zone'}
        </span>
      </div>

      {mode === 'box' ? (
        <BoxSelector
          imageUrl={panoramaUrl}
          box={box}
          onBoxChange={setBox}
          disabled={busy}
          maxHeight="calc(95vh - 350px)"
          imgRefCallback={el => { imgRef.current = el }}
        />
      ) : (
        <SAMSelector
          imageUrl={panoramaUrl}
          points={points}
          onPointsChange={setPoints}
          disabled={busy}
          maxHeight="calc(95vh - 350px)"
          imgRefCallback={el => { imgRef.current = el }}
        />
      )}

      {mode === 'box' && box && (
        <div style={{ fontSize: '0.62rem', color: 'var(--muted)', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Zone : {Math.round(box.w)}×{Math.round(box.h)}px</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            Marge {padPct}%
            <input type="range" min={0} max={30} step={1} value={padPct}
              onChange={e => setPadPct(Number(e.target.value))}
              disabled={busy}
              style={{ width: 80 }} />
          </label>
          <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>(padding pour raccord LAMA)</span>
        </div>
      )}
      {mode === 'sam' && points.length > 0 && (
        <div style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>
          {points.filter(p => p.positive).length} positif{points.filter(p => p.positive).length > 1 ? 's' : ''} · {points.filter(p => !p.positive).length} négatif{points.filter(p => !p.positive).length > 1 ? 's' : ''}
        </div>
      )}

      {error && (
        <div style={{ fontSize: '0.68rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px' }}>
          ⚠ {error}
        </div>
      )}

      {busy && (
        <div style={{ fontSize: '0.7rem', color: '#e0a742', padding: '0.4rem 0.6rem', background: 'rgba(224,167,66,0.1)', border: '1px solid #e0a74266', borderRadius: '4px' }}>
          ⏳ {progress}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} disabled={busy}
          style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: busy ? 'wait' : 'pointer' }}>
          ← Annuler
        </button>
        <button onClick={() => void handleErase()} disabled={busy || !canSubmit}
          style={{ background: busy || !canSubmit ? 'var(--surface-2)' : '#52c484', border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: busy || !canSubmit ? 'var(--muted)' : '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer', opacity: busy || !canSubmit ? 0.5 : 1 }}>
          🧽 Effacer cette zone
        </button>
      </div>
    </div>
  )
}
