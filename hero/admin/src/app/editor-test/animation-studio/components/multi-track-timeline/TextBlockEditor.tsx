'use client'
/**
 * TextBlockEditor — popover/modal d'édition d'un bloc texte overlay sélectionné
 * dans la timeline multi-pistes.
 *
 * Phase 3 V1 (2026-05-12). UX : modal compact qui propose
 *   - Texte (textarea multi-ligne)
 *   - Template : Fade · Typewriter · Slide up (radios)
 *   - Position : Haut · Centre · Bas (radios)
 *   - Taille : S · M · L · XL (radios)
 *   - Durée (slider 0.5-10s)
 *   - Boutons Supprimer · Annuler · Enregistrer
 *
 * Le caller passe un TextBlock + callbacks update/delete. Le composant gère
 * son state local (forme dirty) et persist au Enregistrer.
 */

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Trash2, Check } from 'lucide-react'
import type { TextOverlayData } from '@/components/image-editor/EditorStateContext'

interface TextBlockEditorProps {
  open: boolean
  onClose: () => void
  /** Valeurs initiales (lues depuis le bloc cliqué). */
  initial: Partial<TextOverlayData> | null
  /** Sauvegarde — le caller récupère le patch et update via le mapper inverse
   *  (ou directement via updateAnimationShot). */
  onSave: (patch: Omit<TextOverlayData, 'id'>) => void
  /** Suppression — le caller retire le bloc du shot.textOverlays. */
  onDelete?: () => void
}

export default function TextBlockEditor({
  open, onClose, initial, onSave, onDelete,
}: TextBlockEditorProps) {
  const [text, setText] = useState('')
  const [template, setTemplate] = useState<TextOverlayData['template']>('fade')
  const [position, setPosition] = useState<TextOverlayData['position']>('center')
  const [size, setSize] = useState<TextOverlayData['size']>('lg')
  const [durationSec, setDurationSec] = useState(3)

  // Hydrate à l'ouverture
  useEffect(() => {
    if (open && initial) {
      setText(initial.text ?? '')
      setTemplate(initial.template ?? 'fade')
      setPosition(initial.position ?? 'center')
      setSize(initial.size ?? 'lg')
      setDurationSec(initial.durationSec ?? 3)
    }
  }, [open, initial])

  function handleSave() {
    onSave({
      text: text.trim(),
      template,
      position,
      size,
      startSec: initial?.startSec ?? 0,
      durationSec,
    })
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="tbe-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="tbe-modal"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
          >
            <header className="tbe-header">
              <span className="tbe-title">Texte affiché</span>
              <button type="button" className="tbe-close" onClick={onClose} aria-label="Fermer">
                <X size={16} />
              </button>
            </header>

            <div className="tbe-body">
              <label className="tbe-field">
                <span className="tbe-label">Texte</span>
                <textarea
                  className="tbe-textarea"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="ex : Planète Cirius, Fief de la Junte Révolutionnaire"
                  rows={3}
                  autoFocus
                />
              </label>

              <div className="tbe-row">
                <label className="tbe-field">
                  <span className="tbe-label">Style</span>
                  <select
                    className="tbe-select"
                    value={template}
                    onChange={e => setTemplate(e.target.value as TextOverlayData['template'])}
                  >
                    <option value="fade">Fondu (apparition / disparition)</option>
                    <option value="typewriter">Machine à écrire</option>
                    <option value="slide_up">Glisse depuis le bas</option>
                  </select>
                </label>

                <label className="tbe-field">
                  <span className="tbe-label">Position</span>
                  <select
                    className="tbe-select"
                    value={position}
                    onChange={e => setPosition(e.target.value as TextOverlayData['position'])}
                  >
                    <option value="top">Haut</option>
                    <option value="center">Centre</option>
                    <option value="bottom">Bas</option>
                  </select>
                </label>
              </div>

              <div className="tbe-row">
                <label className="tbe-field">
                  <span className="tbe-label">Taille</span>
                  <div className="tbe-radios">
                    {(['sm', 'md', 'lg', 'xl'] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        className={`tbe-radio-btn ${size === s ? 'active' : ''}`}
                        onClick={() => setSize(s)}
                      >
                        {s.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="tbe-field">
                  <span className="tbe-label">Durée : <strong>{durationSec.toFixed(1)}s</strong></span>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={durationSec}
                    onChange={e => setDurationSec(parseFloat(e.target.value))}
                  />
                </label>
              </div>
            </div>

            <footer className="tbe-footer">
              {onDelete && (
                <button
                  type="button"
                  className="tbe-btn-danger"
                  onClick={() => { onDelete(); onClose() }}
                  title="Supprimer ce texte"
                >
                  <Trash2 size={11} /> Supprimer
                </button>
              )}
              <button type="button" className="tbe-btn-ghost" onClick={onClose}>
                Annuler
              </button>
              <button
                type="button"
                className="tbe-btn-primary"
                onClick={handleSave}
                disabled={!text.trim()}
              >
                <Check size={12} /> Enregistrer
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
