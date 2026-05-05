'use client'
/**
 * DesignerBankPanel — panneau "Banque d'images" qui slide-open en Phase A.
 *
 * Affiche une grille thumbnails (uploads + plans précédents + bankings).
 * Click sur une tuile → callback onPick(image) qui ajoute l'image aux variantes.
 *
 * Phase 6b : UI shell uniquement. Les vraies données viennent en Phase 8+.
 * Pour l'instant : reçoit un BankImage[] depuis le parent (mock ou réel).
 */

import React, { useMemo, useRef, useState } from 'react'
import { Search, X, Upload, Loader2 } from 'lucide-react'
import type { BankImage } from './types'

interface DesignerBankPanelProps {
  /** Images disponibles dans la banque */
  images: BankImage[]
  /** ID de l'image actuellement sélectionnée (border accent) */
  pickedId?: string | null
  /** Callback quand l'utilisateur clique une tuile */
  onPick: (image: BankImage) => void
  /** Callback pour fermer manuellement le panel (X header) */
  onClose?: () => void
  /** Callback d'upload depuis le PC. Reçoit le file et doit retourner la
   *  BankImage créée (URL Supabase + métadonnées) qui sera ensuite ajoutée
   *  à la liste affichée par le parent. Si non fourni → bouton upload caché. */
  onUpload?: (file: File) => Promise<BankImage>
}

export default function DesignerBankPanel({
  images, pickedId, onPick, onClose, onUpload,
}: DesignerBankPanelProps) {
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''  // reset pour permettre re-upload même fichier
    if (!file || !onUpload) return
    if (!file.type.startsWith('image/')) {
      setUploadError('Format invalide (image uniquement)')
      return
    }
    setUploading(true); setUploadError(null)
    try {
      const newImage = await onUpload(file)
      // Sélectionne auto l'image fraîchement uploadée pour confort UX
      onPick(newImage)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setUploadError(msg)
    } finally {
      setUploading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return images
    return images.filter(img => {
      if (img.label?.toLowerCase().includes(q)) return true
      if (img.tags?.some(t => t.toLowerCase().includes(q))) return true
      return false
    })
  }, [images, query])

  return (
    <aside className="dz-bank-panel">
      <header className="dz-bank-header">
        <span className="dz-bank-title">📁 Banque d&apos;images</span>
        <span className="dz-bank-count">
          {images.length} image{images.length > 1 ? 's' : ''}
        </span>
        {onClose && (
          <button
            type="button"
            className="dz-bank-close"
            onClick={onClose}
            title="Fermer la banque"
            aria-label="Fermer la banque"
          >
            <X size={14} />
          </button>
        )}
      </header>

      <div className="dz-bank-search">
        <Search size={13} className="dz-bank-search-icon" />
        <input
          type="text"
          placeholder="Rechercher (forêt, bar, nuit…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {onUpload && (
        <div className="dz-bank-upload">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
          <button
            type="button"
            className="dz-bank-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload une image depuis ton PC"
          >
            {uploading
              ? <><Loader2 size={12} className="dz-bank-upload-spin" /><span>Upload…</span></>
              : <><Upload size={12} /><span>Upload depuis PC</span></>}
          </button>
          {uploadError && <div className="dz-bank-upload-err">{uploadError}</div>}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="dz-bank-empty">
          {query
            ? `Aucune image ne correspond à "${query}"`
            : 'Aucune image dans la banque pour l\'instant.'}
        </div>
      ) : (
        <div className="dz-bank-grid">
          {filtered.map(img => (
            <BankTile
              key={img.id}
              image={img}
              isPicked={img.id === pickedId}
              onPick={() => onPick(img)}
            />
          ))}
        </div>
      )}
    </aside>
  )
}

// ── Tuile individuelle ────────────────────────────────────────────────────

function BankTile({
  image, isPicked, onPick,
}: { image: BankImage; isPicked: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      className={`dz-bank-tile ${isPicked ? 'picked' : ''}`}
      onClick={onPick}
      title={image.label ?? 'Sélectionner cette image'}
    >
      <img
        src={image.thumbnailUrl ?? image.url}
        alt={image.label ?? 'image banque'}
        loading="lazy"
      />
      {image.tags && image.tags.length > 0 && (
        <span className="dz-bank-tile-tag">{image.tags[0]}</span>
      )}
    </button>
  )
}
