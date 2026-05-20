'use client'
/**
 * LayerSourceModal — modal "Choisir la source du calque" (V1 minimal 2026-05-09).
 *
 * Implémente 3 des 6 sources du design 2026-05-07 (cf project_layer_source_menu_design) :
 *   1. Image depuis le calque principal (= base du plan)
 *   3. Image depuis la banque d'images du livre
 *   5. Charger une image (file picker)
 *
 * Les 3 sources avancées (autres calques, banque persos 4 vues, continuité
 * narrative via sections-parents) viendront en V2.
 *
 * Trigger : bouton "+ Ajouter un calque" dans LayerTabs.
 * Comportement post-création : l'auteur peut détourer ensuite (déjà existant).
 */

import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Layers, Folder, Upload, Loader2, ArrowLeft } from 'lucide-react'

interface BankItem {
  id: string
  thumbnailUrl: string
  label?: string
  kind: 'image' | 'animation'
}

export interface LayerSourceModalProps {
  open: boolean
  onClose: () => void
  /** URL de l'image base du plan (= source 1). Désactive la card si null. */
  baseImageUrl: string | null
  /** Book courant pour fetch la banque (= source 3). Désactive la card si null. */
  bookId: string | null
  /** Section courante pour ordonner la banque (plans de la section en haut).
   *  Optionnel — sans ça le tri sera générique. */
  sectionId?: string | null
  /** Appelé quand l'auteur a choisi sa source. La modal se ferme automatiquement
   *  derrière. Le parent (LayerTabs) appelle ensuite addLayer({ media_url, ... }).
   *  `source` permet au parent de différencier le mode du calque créé :
   *    - 'base'   → compositing (overlay sur la base, comportement historique)
   *    - 'bank' / 'upload' → extraction (workspace dédié, pas overlay) */
  onSourceSelected: (source: {
    url: string
    label: string
    source: 'base' | 'bank' | 'upload'
  }) => void
}

export default function LayerSourceModal({
  open, onClose, baseImageUrl, bookId, sectionId, onSourceSelected,
}: LayerSourceModalProps) {
  const [view, setView] = useState<'choose' | 'bank'>('choose')
  const [bankItems, setBankItems] = useState<BankItem[]>([])
  const [bankLoading, setBankLoading] = useState(false)
  const [bankError, setBankError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset view au ré-open (= si fermée puis réouverte, on revient au choix)
  useEffect(() => {
    if (open) {
      setView('choose')
      setUploadError(null)
    }
  }, [open])

  // ── Source 1 : image base ─────────────────────────────────────────
  function handleBaseClick() {
    if (!baseImageUrl) return
    onSourceSelected({ url: baseImageUrl, label: 'Calque', source: 'base' })
    onClose()
  }

  // ── Source 3 : banque d'images du livre ──────────────────────────
  async function handleBankClick() {
    setView('bank')
    // Fetch lazy : seulement à la première ouverture du mode bank
    if (!bookId || bankItems.length > 0) return
    setBankLoading(true); setBankError(null)
    try {
      const url = sectionId
        ? `/api/books/${bookId}/plan-bank?currentSectionId=${sectionId}`
        : `/api/books/${bookId}/plan-bank`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as BankItem[]
      // V1 : on ne garde que les items image (animation viendra V2 en tant que
      // source pour calque "vidéo dans calque" — pas le scope V1 actuel)
      setBankItems(data.filter(it => it.kind === 'image'))
    } catch (err) {
      setBankError(err instanceof Error ? err.message : String(err))
    } finally {
      setBankLoading(false)
    }
  }

  function handleBankPick(item: BankItem) {
    onSourceSelected({
      url: item.thumbnailUrl,
      label: item.label ?? 'Calque',
      source: 'bank',
    })
    onClose()
  }

  // ── Source 5 : upload depuis le PC ───────────────────────────────
  function handleUploadClick() {
    fileInputRef.current?.click()
  }
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''  // permet de re-uploader le même fichier
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('Format invalide (image uniquement)')
      return
    }
    setUploading(true); setUploadError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
        reader.readAsDataURL(file)
      })
      const res = await fetch('/api/storage/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_url: dataUrl,
          path: `studio/layers/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `upload HTTP ${res.status}`)
      }
      const fileNameNoExt = file.name.replace(/\.[^/.]+$/, '')
      onSourceSelected({ url: data.url, label: fileNameNoExt, source: 'upload' })
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setUploadError(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="lsm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label="Choisir la source du calque"
        >
          <motion.div
            className="lsm-modal"
            initial={{ y: 16, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="lsm-header">
              {view === 'bank' && (
                <button
                  type="button"
                  className="lsm-back"
                  onClick={() => setView('choose')}
                  title="Retour aux sources"
                  aria-label="Retour"
                >
                  <ArrowLeft size={14} />
                </button>
              )}
              <h2 className="lsm-title">
                {view === 'choose' ? 'Choisir la source du calque' : 'Banque d’images du livre'}
              </h2>
              <button
                type="button"
                className="lsm-close"
                onClick={onClose}
                title="Fermer"
                aria-label="Fermer"
              >
                <X size={14} />
              </button>
            </header>

            {view === 'choose' ? (
              <>
                <div className="lsm-cards">
                  {/* Source 1 : image base */}
                  <button
                    type="button"
                    className="lsm-card"
                    onClick={handleBaseClick}
                    disabled={!baseImageUrl}
                    title={baseImageUrl ? 'Reprendre l’image principale' : 'Aucune image base'}
                  >
                    <div className="lsm-card-icon"><Layers size={22} /></div>
                    <div className="lsm-card-body">
                      <div className="lsm-card-title">Image de base</div>
                      <div className="lsm-card-sub">Reprend l’image principale du plan</div>
                    </div>
                    {baseImageUrl && (
                      <div className="lsm-card-thumb">
                        <img src={baseImageUrl} alt="" />
                      </div>
                    )}
                  </button>

                  {/* Source 3 : banque d'images */}
                  <button
                    type="button"
                    className="lsm-card"
                    onClick={handleBankClick}
                    disabled={!bookId}
                    title={bookId ? 'Choisir dans la banque du livre' : 'Banque indisponible (livre non identifié)'}
                  >
                    <div className="lsm-card-icon"><Folder size={22} /></div>
                    <div className="lsm-card-body">
                      <div className="lsm-card-title">Banque d’images</div>
                      <div className="lsm-card-sub">Plans précédents + uploads du livre</div>
                    </div>
                  </button>

                  {/* Source 5 : upload PC */}
                  <button
                    type="button"
                    className="lsm-card"
                    onClick={handleUploadClick}
                    disabled={uploading}
                  >
                    <div className="lsm-card-icon">
                      {uploading
                        ? <Loader2 size={22} className="lsm-spin" />
                        : <Upload size={22} />}
                    </div>
                    <div className="lsm-card-body">
                      <div className="lsm-card-title">Charger une image</div>
                      <div className="lsm-card-sub">
                        {uploading ? 'Upload en cours…' : 'Depuis ton ordinateur'}
                      </div>
                    </div>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                </div>
                {uploadError && (
                  <div className="lsm-error">{uploadError}</div>
                )}
                <footer className="lsm-footer">
                  <span>Tu pourras détourer ensuite si besoin.</span>
                </footer>
              </>
            ) : (
              <div className="lsm-bank">
                {bankLoading ? (
                  <div className="lsm-bank-state">
                    <Loader2 size={18} className="lsm-spin" />
                    <span>Chargement de la banque…</span>
                  </div>
                ) : bankError ? (
                  <div className="lsm-bank-state lsm-bank-state-error">
                    Erreur : {bankError}
                  </div>
                ) : bankItems.length === 0 ? (
                  <div className="lsm-bank-state">
                    Aucune image dans la banque pour ce livre.
                  </div>
                ) : (
                  <div className="lsm-bank-grid">
                    {bankItems.map(item => (
                      <button
                        type="button"
                        key={item.id}
                        className="lsm-bank-cell"
                        onClick={() => handleBankPick(item)}
                        title={item.label ?? 'Image'}
                      >
                        <img src={item.thumbnailUrl} alt={item.label ?? ''} />
                        {item.label && (
                          <div className="lsm-bank-cell-label">{item.label}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
