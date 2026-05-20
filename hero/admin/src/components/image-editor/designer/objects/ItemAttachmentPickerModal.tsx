'use client'
/**
 * ItemAttachmentPickerModal — modal qui s'ouvre au clic sur l'action
 * secondaire "Objet" du drawer Découper (refonte 2026-05-12).
 *
 * L'auteur a découpé une zone sur l'image (= cut PNG transparent). Cette
 * modal propose 2 options :
 *   1. Créer un nouvel objet — ouvre ItemCreatorModal pré-rempli avec
 *      illustration_url = la découpe.
 *   2. Attacher à un objet existant — liste des objets du livre, avec
 *      les objets de la section courante en haut, puis le reste. Clic
 *      sur un objet → PATCH item.illustration_url = la découpe.
 *
 * Pas de click-outside-to-close (cohérent Hero). ESC ferme.
 */

import React, { useEffect, useState } from 'react'
import { X as XIcon, Plus, Package, Loader2 } from 'lucide-react'

export interface BookItemBrief {
  id: string
  name: string
  illustration_url: string | null
  /** True si l'item appartient à la section courante (sections_used). */
  belongsToCurrentSection: boolean
}

interface ItemAttachmentPickerModalProps {
  open: boolean
  onClose: () => void
  /** Items du livre — déjà triés (section en haut). */
  bookItems: BookItemBrief[]
  /** Aperçu de la découpe (URL Supabase déjà uploadée) — affichée en haut
   *  de la modal pour que l'auteur voie ce qu'il va attacher. */
  cutImageUrl: string
  /** Callback "Créer un nouvel objet" : reçoit l'URL de la découpe. Le
   *  parent ouvre ItemCreatorModal pré-rempli avec cette image. */
  onCreateNew: (cutImageUrl: string) => void
  /** Callback "Attacher à un objet existant" : reçoit l'item cible.
   *  Le parent fait PATCH /api/items/:id avec illustration_url=cutImageUrl. */
  onAttachToExisting: (item: BookItemBrief, cutImageUrl: string) => Promise<void> | void
}

export default function ItemAttachmentPickerModal({
  open, onClose, bookItems, cutImageUrl, onCreateNew, onAttachToExisting,
}: ItemAttachmentPickerModalProps) {
  const [attaching, setAttaching] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // Filtre simple par nom (case-insensitive)
  const q = search.trim().toLowerCase()
  const filtered = q
    ? bookItems.filter(i => i.name.toLowerCase().includes(q))
    : bookItems
  const sectionItems = filtered.filter(i => i.belongsToCurrentSection)
  const otherItems = filtered.filter(i => !i.belongsToCurrentSection)

  async function handleAttach(item: BookItemBrief) {
    setAttaching(item.id)
    try {
      await onAttachToExisting(item, cutImageUrl)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Attachement échoué : ${msg}`)
    } finally {
      setAttaching(null)
    }
  }

  return (
    <div className="iapm-overlay">
      <div className="iapm-modal">
        <header className="iapm-header">
          <h2 className="iapm-title">Attacher la découpe à un objet</h2>
          <button type="button" className="iapm-close" onClick={onClose} aria-label="Fermer">
            <XIcon size={18} />
          </button>
        </header>

        <div className="iapm-body">
          {/* Aperçu de la découpe en haut */}
          <div className="iapm-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cutImageUrl} alt="Découpe à attacher" />
          </div>

          {/* Option 1 : créer nouveau */}
          <button
            type="button"
            className="iapm-create-btn"
            onClick={() => { onCreateNew(cutImageUrl); onClose() }}
          >
            <Plus size={16} />
            <span>Créer un nouvel objet avec cette image</span>
          </button>

          <div className="iapm-divider">OU attacher à un objet existant</div>

          {/* Search */}
          <input
            type="search"
            className="iapm-search"
            placeholder="Rechercher un objet…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {/* Liste : section en haut, autres ensuite */}
          {filtered.length === 0 ? (
            <div className="iapm-empty">Aucun objet ne correspond.</div>
          ) : (
            <div className="iapm-list">
              {sectionItems.length > 0 && (
                <>
                  <div className="iapm-section-label">Section courante ({sectionItems.length})</div>
                  {sectionItems.map(item => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      busy={attaching === item.id}
                      disabled={!!attaching && attaching !== item.id}
                      onClick={() => void handleAttach(item)}
                    />
                  ))}
                </>
              )}
              {otherItems.length > 0 && (
                <>
                  <div className="iapm-section-label">Autres objets du livre ({otherItems.length})</div>
                  {otherItems.map(item => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      busy={attaching === item.id}
                      disabled={!!attaching && attaching !== item.id}
                      onClick={() => void handleAttach(item)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ItemRow({
  item, busy, disabled, onClick,
}: {
  item: BookItemBrief
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="iapm-row"
      onClick={onClick}
      disabled={busy || disabled}
      title={`Attacher la découpe à "${item.name}"${item.illustration_url ? ' (remplace l\'image existante)' : ''}`}
    >
      {item.illustration_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.illustration_url} alt="" className="iapm-row-thumb" />
      ) : (
        <div className="iapm-row-thumb iapm-row-thumb-empty">
          <Package size={14} />
        </div>
      )}
      <span className="iapm-row-name">{item.name}</span>
      {busy && <Loader2 size={12} className="iapm-row-spin" />}
      {item.illustration_url && !busy && (
        <span className="iapm-row-replace">remplacer</span>
      )}
    </button>
  )
}
