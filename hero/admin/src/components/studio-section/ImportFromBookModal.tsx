'use client'
/**
 * ImportFromBookModal — modal V2 pour importer un asset d'un autre livre.
 *
 * Flow :
 *   1. Sélection du livre source (dropdown des livres autres que current)
 *   2. Sélection du type d'asset (image / animation / audio / text)
 *   3. Liste des assets du livre source (paginée si beaucoup)
 *   4. Click sur un asset → POST /api/asset-usage avec book_id=current,
 *      section_id=current → l'asset apparaît dans la library de la section
 *      courante (sans duplication, juste une nouvelle ref).
 *
 * V2 2026-05-13.
 */

import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Search, BookOpen, Loader2, Check } from 'lucide-react'

interface Book {
  id: string
  title: string
}

interface AssetRow {
  id: string
  url?: string
  audio_url?: string
  label?: string | null
  first_frame_url?: string | null
}

type AssetType = 'image' | 'animation' | 'audio' | 'text'

interface ImportFromBookModalProps {
  open: boolean
  onClose: () => void
  /** ID du livre courant (= où on importe). */
  currentBookId: string
  /** ID de la section courante (= optionnel, où ajouter la ref aussi). */
  currentSectionId?: string | null
  /** Callback après import réussi → refetch banques côté parent. */
  onImported?: () => void
}

export default function ImportFromBookModal({
  open, onClose, currentBookId, currentSectionId, onImported,
}: ImportFromBookModalProps) {
  const [books, setBooks] = useState<Book[]>([])
  const [selectedBookId, setSelectedBookId] = useState<string>('')
  const [assetType, setAssetType] = useState<AssetType>('image')
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [search, setSearch] = useState('')
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [imported, setImported] = useState<Set<string>>(new Set())

  // Reset à l'ouverture
  useEffect(() => {
    if (!open) return
    setAssetType('image')
    setSearch('')
    setSelectedBookId('')
    setAssets([])
    setImported(new Set())
  }, [open])

  // ESC ferme
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Fetch livres au mount
  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const res = await fetch('/api/books')
        if (!res.ok) return
        const data = await res.json() as Book[]
        // Exclut le livre courant
        setBooks(data.filter(b => b.id !== currentBookId))
      } catch (err) {
        console.warn('[ImportFromBookModal] fetch books failed:', err)
      }
    })()
  }, [open, currentBookId])

  // Fetch assets quand book + type sélectionnés
  useEffect(() => {
    if (!open || !selectedBookId) return
    void (async () => {
      setLoadingAssets(true)
      try {
        const params = new URLSearchParams({ bookId: selectedBookId })
        if (search.trim()) params.set('search', search.trim())
        const res = await fetch(`/api/assets/${assetType}?${params.toString()}`)
        if (!res.ok) {
          setAssets([])
          return
        }
        const data = await res.json() as { assets: AssetRow[] }
        setAssets(data.assets ?? [])
      } catch (err) {
        console.warn('[ImportFromBookModal] fetch assets failed:', err)
        setAssets([])
      } finally {
        setLoadingAssets(false)
      }
    })()
  }, [open, selectedBookId, assetType, search])

  async function handleImport(asset: AssetRow) {
    if (importing) return
    setImporting(asset.id)
    try {
      const res = await fetch('/api/asset-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: assetType,
          asset_id: asset.id,
          book_id: currentBookId,
          section_id: currentSectionId ?? null,
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errBody.error ?? `HTTP ${res.status}`)
      }
      setImported(prev => new Set(prev).add(asset.id))
      onImported?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Import échoué : ${msg}`)
    } finally {
      setImporting(null)
    }
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="ifbm-backdrop"
          className="ifbm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            key="ifbm-modal"
            className="ifbm-modal"
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
          >
            <div className="ifbm-header">
              <div className="ifbm-header-title">
                <BookOpen size={16} /> Importer depuis un livre
              </div>
              <button type="button" className="ifbm-close" onClick={onClose} aria-label="Fermer">
                <X size={14} />
              </button>
            </div>

            {/* Sélection livre + type */}
            <div className="ifbm-controls">
              <div className="ifbm-control">
                <label htmlFor="ifbm-book">Livre source</label>
                <select
                  id="ifbm-book"
                  value={selectedBookId}
                  onChange={e => setSelectedBookId(e.target.value)}
                >
                  <option value="">— Choisir un livre —</option>
                  {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
              </div>
              <div className="ifbm-control">
                <label htmlFor="ifbm-type">Type</label>
                <select
                  id="ifbm-type"
                  value={assetType}
                  onChange={e => setAssetType(e.target.value as AssetType)}
                >
                  <option value="image">Images</option>
                  <option value="animation">Animations</option>
                  <option value="audio">Audio (SFX + Musique)</option>
                  <option value="text">Texte overlay</option>
                </select>
              </div>
              <div className="ifbm-control ifbm-search">
                <label htmlFor="ifbm-search">Recherche</label>
                <div className="ifbm-search-wrap">
                  <Search size={12} />
                  <input
                    id="ifbm-search"
                    type="text"
                    placeholder="Filtrer par label…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Liste assets */}
            <div className="ifbm-assets">
              {!selectedBookId ? (
                <div className="ifbm-empty">Sélectionne un livre source pour voir ses assets.</div>
              ) : loadingAssets ? (
                <div className="ifbm-empty"><Loader2 size={14} className="ifbm-spin" /> Chargement…</div>
              ) : assets.length === 0 ? (
                <div className="ifbm-empty">Aucun asset {assetType} dans ce livre.</div>
              ) : (
                <div className="ifbm-grid">
                  {assets.map(a => {
                    const thumb = a.url ?? a.first_frame_url ?? null
                    const isImported = imported.has(a.id)
                    const isImporting = importing === a.id
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`ifbm-asset ${isImported ? 'imported' : ''}`}
                        onClick={() => !isImported && handleImport(a)}
                        disabled={isImporting || isImported}
                      >
                        {thumb ? (
                          <img src={thumb} alt={a.label ?? ''} className="ifbm-asset-thumb" />
                        ) : (
                          <div className="ifbm-asset-thumb-empty">
                            {assetType === 'audio' ? '🔊' : '📄'}
                          </div>
                        )}
                        <span className="ifbm-asset-label">{a.label ?? `${assetType} ${a.id.slice(0, 4)}`}</span>
                        {isImporting && <span className="ifbm-asset-state"><Loader2 size={11} className="ifbm-spin" /></span>}
                        {isImported && <span className="ifbm-asset-state ok"><Check size={11} /> Importé</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
