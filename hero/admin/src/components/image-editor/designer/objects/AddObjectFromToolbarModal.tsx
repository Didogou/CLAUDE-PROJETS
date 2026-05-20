'use client'
/**
 * AddObjectFromToolbarModal — modal au clic sur l'icône Objet du toolbar.
 *
 * Permet d'insérer un objet dans la scène avec 3 modes au choix :
 *   1. Lier à un objet existant — l'auteur choisit dans la liste, l'insertion
 *      crée un positioned_items lié à cet item.
 *   2. Créer un nouvel objet — un nouvel item est créé avec le nom dérivé de
 *      la description, et positioned_items lié.
 *   3. Sans objet (juste insérer) — Qwen Edit modifie la scène, pas de
 *      tracking d'objet.
 *
 * Refonte 2026-05-12. Theme-aware. ESC + bouton X pour fermer (pas de
 * click-outside).
 */

import React, { useEffect, useState } from 'react'
import { X as XIcon, Plus, Package, Image as ImageIcon, Wand2 } from 'lucide-react'

export type AddObjectMode = 'existing' | 'new' | 'noitem'

export interface ToolbarItemBrief {
  id: string
  name: string
  illustration_url: string | null
  belongsToCurrentSection: boolean
}

interface AddObjectFromToolbarModalProps {
  open: boolean
  onClose: () => void
  /** Items du livre — affichés dans le mode "existant" avec section au top. */
  bookItems: ToolbarItemBrief[]
  /** Callback final. Reçoit description + localisation + mode + (si mode
   *  existing) l'item ciblé. Le parent orchestre Qwen Edit + side effects. */
  onConfirm: (params: {
    description: string
    location: string
    mode: AddObjectMode
    existingItemId?: string
  }) => Promise<void> | void
}

export default function AddObjectFromToolbarModal({
  open, onClose, bookItems, onConfirm,
}: AddObjectFromToolbarModalProps) {
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [mode, setMode] = useState<AddObjectMode>('noitem')
  const [pickedItemId, setPickedItemId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setDescription('')
      setLocation('')
      setMode('noitem')
      setPickedItemId(null)
      setSearch('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const canConfirm = description.trim().length > 0
    && location.trim().length > 0
    && !submitting
    && (mode !== 'existing' || !!pickedItemId)

  // Filtre items pour mode existant
  const q = search.trim().toLowerCase()
  const filtered = q
    ? bookItems.filter(i => i.name.toLowerCase().includes(q))
    : bookItems
  const sectionItems = filtered.filter(i => i.belongsToCurrentSection)
  const otherItems = filtered.filter(i => !i.belongsToCurrentSection)

  async function handleSubmit() {
    if (!canConfirm) return
    setSubmitting(true)
    try {
      await onConfirm({
        description: description.trim(),
        location: location.trim(),
        mode,
        existingItemId: mode === 'existing' ? (pickedItemId ?? undefined) : undefined,
      })
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Insertion échouée : ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="aotm-overlay">
      <div className="aotm-modal">
        <header className="aotm-header">
          <h2 className="aotm-title">Insérer un objet dans la scène</h2>
          <button type="button" className="aotm-close" onClick={onClose} aria-label="Fermer">
            <XIcon size={18} />
          </button>
        </header>

        <div className="aotm-body">
          {/* Description */}
          <label className="aotm-field">
            <span className="aotm-label">
              Description visuelle
              <span className="aotm-label-hint">— à quoi ressemble l&apos;objet</span>
            </span>
            <textarea
              className="aotm-input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="ex: enveloppe en parchemin sépia avec sceau de cire rouge marqué d'un blason de la Junte"
              rows={3}
              autoFocus
              spellCheck
            />
          </label>

          {/* Localisation */}
          <label className="aotm-field">
            <span className="aotm-label">
              Localisation dans la scène
              <span className="aotm-label-hint">— où et comment placer</span>
            </span>
            <textarea
              className="aotm-input"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="ex: posée sur le bureau à droite, à côté de la lampe, format A4"
              rows={2}
              spellCheck
            />
          </label>

          {/* Mode : 3 radio cards */}
          <div className="aotm-modes">
            <ModeCard
              active={mode === 'existing'}
              onClick={() => setMode('existing')}
              icon={<Package size={16} />}
              title="Lier à un objet existant"
              desc="Insère et associe à un objet déjà créé"
            />
            <ModeCard
              active={mode === 'new'}
              onClick={() => setMode('new')}
              icon={<Plus size={16} />}
              title="Créer un nouvel objet"
              desc="Insère et crée une fiche objet avec ce nom"
            />
            <ModeCard
              active={mode === 'noitem'}
              onClick={() => setMode('noitem')}
              icon={<ImageIcon size={16} />}
              title="Sans créer d'objet"
              desc="Modifie juste la scène, pas de fiche"
            />
          </div>

          {/* Si mode = existing → afficher picker inline */}
          {mode === 'existing' && (
            <div className="aotm-picker">
              <input
                type="search"
                className="aotm-search"
                placeholder="Rechercher un objet…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {filtered.length === 0 ? (
                <div className="aotm-empty">Aucun objet ne correspond.</div>
              ) : (
                <div className="aotm-picker-list">
                  {sectionItems.length > 0 && (
                    <>
                      <div className="aotm-picker-label">Section courante ({sectionItems.length})</div>
                      {sectionItems.map(item => (
                        <PickerRow
                          key={item.id} item={item}
                          selected={pickedItemId === item.id}
                          onClick={() => setPickedItemId(item.id)}
                        />
                      ))}
                    </>
                  )}
                  {otherItems.length > 0 && (
                    <>
                      <div className="aotm-picker-label">Autres objets du livre ({otherItems.length})</div>
                      {otherItems.map(item => (
                        <PickerRow
                          key={item.id} item={item}
                          selected={pickedItemId === item.id}
                          onClick={() => setPickedItemId(item.id)}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="aotm-footer">
          <button type="button" className="aotm-btn aotm-btn-ghost" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button
            type="button"
            className="aotm-btn aotm-btn-primary"
            onClick={() => void handleSubmit()}
            disabled={!canConfirm}
          >
            <Wand2 size={14} />
            <span>{submitting ? 'Insertion…' : 'Insérer'}</span>
          </button>
        </footer>
      </div>
    </div>
  )
}

function ModeCard({
  active, onClick, icon, title, desc,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      className={`aotm-mode${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="aotm-mode-icon">{icon}</span>
      <span className="aotm-mode-text">
        <span className="aotm-mode-title">{title}</span>
        <span className="aotm-mode-desc">{desc}</span>
      </span>
    </button>
  )
}

function PickerRow({
  item, selected, onClick,
}: {
  item: ToolbarItemBrief
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`aotm-picker-row${selected ? ' selected' : ''}`}
      onClick={onClick}
    >
      {item.illustration_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.illustration_url} alt="" className="aotm-picker-thumb" />
      ) : (
        <div className="aotm-picker-thumb aotm-picker-thumb-empty">
          <Package size={11} />
        </div>
      )}
      <span className="aotm-picker-name">{item.name}</span>
    </button>
  )
}
