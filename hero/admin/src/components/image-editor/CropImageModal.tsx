'use client'
/**
 * CropImageModal — modal réutilisable pour recadrer une image source.
 *
 * Pourquoi : LTX-Video préserve mieux l'identité quand les persos occupent
 * une grande portion de la frame source (cf bug Roman/Marvyn devenus
 * joueurs génériques 2026-05-10 sur cas basket — référence forte sur image,
 * dérive sur faces dans frames suivantes). Donner un outil de crop évite à
 * l'auteur de re-générer l'image fixe complète juste pour un meilleur cadrage.
 *
 * Stack 2026-05-10 : react-easy-crop (vs react-image-crop initial qui avait
 * des bugs de coords display vs natural). Pattern Instagram : cadre fixe à
 * l'aspect choisi, l'auteur drag l'image dessous + slider zoom. La lib
 * retourne directement les coords en pixels source via croppedAreaPixels —
 * zéro confusion display/natural.
 *
 * Aspect ratios proposés (alignés avec les sorties LTX courantes) :
 *   - 16:9    : ratio paysage cinéma / vidéo horizontale (default)
 *   - 9:16    : portrait mobile (Instagram reel, TikTok, mobile fullscreen)
 *   - 1:1     : carré (posts square)
 *   - 4:3     : ratio classique TV / tablette
 */

import React, { useCallback, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { X, Check, Loader2, ZoomIn, Smartphone, Square } from 'lucide-react'
import './crop-image-modal.css'

/** Presets de cadrage. Refonte 2026-05-10 : libellés métier + icônes
 *  (auteurs non-tech) au lieu de ratios bruts ("16:9" → "Paysage"). */
export type AspectPreset = '9:16' | '16:9' | '1:1'

const ASPECT_VALUES: Record<AspectPreset, number> = {
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '1:1':  1,
}

const ASPECT_LABELS: Record<AspectPreset, string> = {
  '9:16': 'Tel portrait',
  '16:9': 'Paysage',
  '1:1':  'Carré',
}

interface CropImageModalProps {
  open: boolean
  /** URL de l'image source à recadrer. Peut être Supabase, blob, ou data URL. */
  sourceUrl: string | null
  /** Aspect ratio par défaut. */
  defaultAspect?: AspectPreset
  /** Titre affiché en header. Défaut : "Recadrer l'image". */
  title?: string
  onClose: () => void
  /** Callback quand l'auteur applique le crop. Reçoit la data URL JPG (qualité
   *  0.92) + l'aspect choisi (le caller peut s'en servir pour ajuster le format
   *  d'affichage du canvas — sinon une image 9:16 affichée dans un wrapper
   *  16:9 avec object-fit:cover apparaît zoomée/croppée à l'écran). Async pour
   *  permettre des upload multi-étapes (Storage + bank entry par exemple) — le
   *  modal montre un spinner pendant l'await. */
  onCropped: (dataUrl: string, aspect: AspectPreset) => Promise<void> | void
}

/** Charge une URL image dans un HTMLImageElement (avec crossOrigin pour permettre
 *  l'export canvas). Wrap en Promise pour await dans le handler d'apply. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Impossible de charger l\'image source'))
    img.src = url
  })
}

/** Rasterise la zone source en data URL JPEG. croppedAreaPixels vient
 *  directement de react-easy-crop en coordonnées pixels SOURCE (= naturelles).
 *  Aucune conversion display→natural à faire (vs react-image-crop). */
async function getCroppedDataUrl(sourceUrl: string, area: Area): Promise<string> {
  const img = await loadImage(sourceUrl)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(area.width)
  canvas.height = Math.round(area.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D non disponible')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    img,
    area.x, area.y, area.width, area.height,
    0, 0, area.width, area.height,
  )
  try {
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch (err) {
    // SecurityError : canvas tainted (CORS missing sur l'image source).
    // Sur Supabase Storage public ça doit marcher — sinon problème de config.
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Image bloquée par CORS — vérifie la config Supabase Storage. (${msg})`)
  }
}

export default function CropImageModal({
  open, sourceUrl, defaultAspect = '16:9', title = "Recadrer l'image",
  onClose, onCropped,
}: CropImageModalProps) {
  const [aspect, setAspect] = useState<AspectPreset>(defaultAspect)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  /** Zone source en pixels naturels — fournie par react-easy-crop à chaque
   *  changement de crop/zoom. C'est ce qu'on raster dans le canvas à l'apply. */
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels)
  }, [])

  /** Quand on change l'aspect, on reset zoom + crop pour que la lib recentre
   *  proprement (sinon le rectangle peut sortir de l'image avec l'ancien zoom). */
  function changeAspect(next: AspectPreset) {
    setAspect(next)
    setZoom(1)
    setCrop({ x: 0, y: 0 })
  }

  async function handleApply() {
    setError(null)
    if (!sourceUrl || !croppedAreaPixels) {
      setError('Sélectionne une zone à recadrer')
      return
    }
    setBusy(true)
    try {
      const dataUrl = await getCroppedDataUrl(sourceUrl, croppedAreaPixels)
      await onCropped(dataUrl, aspect)
      // Le caller décide de fermer (en passant onClose).
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="cim-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="cim-panel">
        <header className="cim-header">
          <h3>{title}</h3>
          <button type="button" className="cim-close" onClick={onClose} disabled={busy} aria-label="Fermer">
            <X size={14} />
          </button>
        </header>

        <div className="cim-body">
          {sourceUrl ? (
            <div className="cim-cropper-wrap">
              <Cropper
                image={sourceUrl}
                crop={crop}
                zoom={zoom}
                aspect={ASPECT_VALUES[aspect]}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                showGrid
                /* objectFit "horizontal-cover" = l'image prend toute la largeur
                 * du conteneur dispo (avec scrolling vertical si nécessaire).
                 * Évite que de petites images soient zoomées par défaut. */
                objectFit="contain"
              />
            </div>
          ) : (
            <div className="cim-empty">Aucune image à recadrer.</div>
          )}
        </div>

        <footer className="cim-footer">
          <div className="cim-controls-row">
            <div className="cim-aspect-row">
              <span className="cim-aspect-label">Format :</span>
              {(['9:16', '16:9', '1:1'] as AspectPreset[]).map(p => {
                // Icône métier — Smartphone vertical pour portrait, Smartphone
                // tourné 90° pour paysage (Lucide n'a pas d'icône phone landscape
                // dédiée, rotate CSS = solution propre), Square pour carré.
                const Icon = p === '1:1' ? Square : Smartphone
                const rotate = p === '16:9' ? 'rotate(90deg)' : undefined
                return (
                  <button
                    key={p}
                    type="button"
                    className={`cim-aspect-btn ${aspect === p ? 'active' : ''}`}
                    onClick={() => changeAspect(p)}
                    disabled={busy}
                    title={`${ASPECT_LABELS[p]} (${p})`}
                  >
                    <Icon
                      size={13}
                      strokeWidth={2.2}
                      style={rotate ? { transform: rotate } : undefined}
                      aria-hidden
                    />
                    <span>{ASPECT_LABELS[p]}</span>
                  </button>
                )
              })}
            </div>
            <div className="cim-zoom-row">
              <ZoomIn size={13} aria-hidden />
              <input
                type="range"
                min={1}
                max={4}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                disabled={busy}
                className="cim-zoom-slider"
                aria-label="Zoom"
              />
              <span className="cim-zoom-value">{zoom.toFixed(1)}×</span>
            </div>
          </div>
          {error && <div className="cim-error">⚠ {error}</div>}
          <div className="cim-actions">
            <button
              type="button"
              className="cim-btn-ghost"
              onClick={onClose}
              disabled={busy}
            >
              Annuler
            </button>
            <button
              type="button"
              className="cim-btn-primary"
              onClick={handleApply}
              disabled={busy || !croppedAreaPixels}
            >
              {busy ? (
                <><Loader2 size={14} className="cim-spin" /> Enregistrement…</>
              ) : (
                <><Check size={14} /> Appliquer</>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
