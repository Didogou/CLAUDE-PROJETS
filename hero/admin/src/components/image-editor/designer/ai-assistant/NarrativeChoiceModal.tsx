'use client'
/**
 * NarrativeChoiceModal — modal qui s'ouvre après confirmation IA d'un
 * "ajout d'objet narratif" (cf AIAssistantPanel.onAddNarrativeObject).
 *
 * 3 options A/B/C (cf project_objet_feature_spec.md + decision C 2026-05-13) :
 *   A — Créer un nouvel objet : ajoute à la banque items + applique l'édition
 *   B — Lier à un objet existant : sélection dans la banque + applique l'édition
 *   C — Visuel seul : aucun ajout banque, juste l'édition
 *
 * V1 (2026-05-13) : les 3 options déclenchent Qwen Edit normal côté parent.
 * La différence est uniquement la metadata (linked_item_id) + side-effect banque.
 * L'extraction de calque transparent réutilisable arrivera en V2.
 *
 * NB : ne pas confondre avec ItemAttachmentPickerModal (objects/) qui sert le
 * flow différent "découper une zone → attacher à objet" avec cutImageUrl en input.
 */

import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Plus, Link2, Image as ImageIcon, AlertTriangle } from 'lucide-react'

export type NarrativeChoiceResult =
  | { kind: 'create_new'; objectName: string }
  | { kind: 'attach_existing'; itemId: string }
  | { kind: 'visual_only' }

export interface NarrativeBankItem {
  id: string
  name: string
  thumbUrl?: string
}

interface NarrativeChoiceModalProps {
  open: boolean
  onClose: () => void
  /** Nom suggéré par Mistral (pré-rempli pour A). */
  suggestedObjectName: string
  /** Prompt d'édition final qui sera envoyé à Qwen Edit (affiché en preview). */
  editPrompt: string
  /** Banque d'items du livre (pour l'option B). Vide = B disabled. */
  bankItems?: NarrativeBankItem[]
  /** Callback appelé après pick. Le parent exécute Qwen Edit + side-effects. */
  onPick: (choice: NarrativeChoiceResult) => void
}

export default function NarrativeChoiceModal({
  open, onClose,
  suggestedObjectName,
  editPrompt,
  bankItems = [],
  onPick,
}: NarrativeChoiceModalProps) {
  const [mode, setMode] = useState<'menu' | 'create' | 'attach'>('menu')
  const [objectName, setObjectName] = useState(suggestedObjectName)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMode('menu')
      setObjectName(suggestedObjectName)
      setSelectedItemId(null)
    }
  }, [open, suggestedObjectName])

  // ESC ferme
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function handleCreate() {
    const name = objectName.trim()
    if (!name) return
    onPick({ kind: 'create_new', objectName: name })
    onClose()
  }
  function handleAttach() {
    if (!selectedItemId) return
    onPick({ kind: 'attach_existing', itemId: selectedItemId })
    onClose()
  }
  function handleVisualOnly() {
    onPick({ kind: 'visual_only' })
    onClose()
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="ncm-backdrop"
          className="ncm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            key="ncm-modal"
            className="ncm-modal"
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
          >
            <div className="ncm-header">
              <div className="ncm-header-title">Comment ranger ce nouvel objet ?</div>
              <button type="button" className="ncm-close" onClick={onClose} aria-label="Fermer">
                <X size={14} />
              </button>
            </div>

            <div className="ncm-prompt-preview">
              <span className="ncm-prompt-preview-label">Édition prévue</span>
              <code className="ncm-prompt-preview-code">{editPrompt}</code>
            </div>

            {mode === 'menu' && (
              <div className="ncm-cards">
                <button type="button" className="ncm-card ncm-card-a" onClick={() => setMode('create')}>
                  <div className="ncm-card-ico"><Plus size={22} /></div>
                  <div className="ncm-card-title">A — Créer un nouvel objet</div>
                  <div className="ncm-card-desc">
                    Ajoute <strong>{suggestedObjectName || 'cet objet'}</strong> à
                    la banque du livre. Réutilisable, cliquable au runtime.
                  </div>
                </button>

                <button
                  type="button"
                  className={`ncm-card ncm-card-b ${bankItems.length === 0 ? 'ncm-card-disabled' : ''}`}
                  onClick={() => bankItems.length > 0 && setMode('attach')}
                  disabled={bankItems.length === 0}
                  title={bankItems.length === 0 ? 'Aucun objet dans la banque pour l\'instant' : ''}
                >
                  <div className="ncm-card-ico"><Link2 size={22} /></div>
                  <div className="ncm-card-title">B — Lier à un objet existant</div>
                  <div className="ncm-card-desc">
                    {bankItems.length === 0
                      ? "Banque vide — pas d'objet à attacher."
                      : `Choisis parmi ${bankItems.length} objet${bankItems.length > 1 ? 's' : ''} déjà créé${bankItems.length > 1 ? 's' : ''}.`}
                  </div>
                </button>

                <button type="button" className="ncm-card ncm-card-c" onClick={handleVisualOnly}>
                  <div className="ncm-card-ico"><ImageIcon size={22} /></div>
                  <div className="ncm-card-title">C — Visuel seul</div>
                  <div className="ncm-card-desc">
                    Juste un détail décor, pas d'entité narrative. Pas
                    cliquable, pas dans la banque.
                  </div>
                </button>
              </div>
            )}

            {mode === 'create' && (
              <div className="ncm-form">
                <div className="ncm-form-back">
                  <button type="button" className="ncm-link-back" onClick={() => setMode('menu')}>
                    ← Retour aux options
                  </button>
                </div>
                <label className="ncm-form-label">Nom de l'objet</label>
                <input
                  type="text"
                  className="ncm-form-input"
                  value={objectName}
                  onChange={e => setObjectName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && objectName.trim()) {
                      e.preventDefault()
                      handleCreate()
                    }
                  }}
                  autoFocus
                />
                <div className="ncm-form-hint">
                  Ce nom apparaîtra dans la banque et au survol au runtime.
                </div>
                <div className="ncm-form-actions">
                  <button type="button" className="ncm-btn ncm-btn-secondary" onClick={() => setMode('menu')}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="ncm-btn ncm-btn-primary"
                    onClick={handleCreate}
                    disabled={!objectName.trim()}
                  >
                    <Plus size={12} /> Créer + appliquer
                  </button>
                </div>
              </div>
            )}

            {mode === 'attach' && (
              <div className="ncm-form">
                <div className="ncm-form-back">
                  <button type="button" className="ncm-link-back" onClick={() => setMode('menu')}>
                    ← Retour aux options
                  </button>
                </div>
                <label className="ncm-form-label">Choisir un objet à lier</label>
                <div className="ncm-items-grid">
                  {bankItems.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={`ncm-item ${selectedItemId === item.id ? 'ncm-item-selected' : ''}`}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      {item.thumbUrl ? (
                        <img src={item.thumbUrl} alt={item.name} className="ncm-item-thumb" />
                      ) : (
                        <div className="ncm-item-thumb ncm-item-thumb-empty">{item.name.charAt(0)}</div>
                      )}
                      <span className="ncm-item-name">{item.name}</span>
                    </button>
                  ))}
                </div>
                <div className="ncm-form-actions">
                  <button type="button" className="ncm-btn ncm-btn-secondary" onClick={() => setMode('menu')}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="ncm-btn ncm-btn-primary"
                    onClick={handleAttach}
                    disabled={!selectedItemId}
                  >
                    <Link2 size={12} /> Lier + appliquer
                  </button>
                </div>
              </div>
            )}

            <div className="ncm-footer-hint">
              <AlertTriangle size={11} /> V1 : extraction du calque transparent
              réutilisable arrivera en V2. L'édition reste appliquée à l'image base.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
