'use client'
/**
 * DropPromptModal — modal qui s'ouvre AU DROP d'une tile Objet sur le canvas.
 *
 * Refonte 2026-05-12 — étape de confirmation entre drop et pipeline pour :
 *   1. Affiner le prompt de POSITION (ex: "sur le bureau, format A4")
 *   2. Si l'objet n'a pas d'image, demander en plus une DESCRIPTION pour
 *      générer le visuel sans lequel Kontext ne peut pas opérer.
 *
 * UX :
 *   - Modal centrée, fond noirci
 *   - Pré-rempli avec un placement par défaut basé sur la zone de drop
 *   - L'auteur affine puis confirme → trigger pipeline
 *   - Cancel = pas d'insertion
 */

import React, { useEffect, useState } from 'react'
import { X as XIcon, Loader2, Wand2 } from 'lucide-react'

interface DropPromptModalProps {
  open: boolean
  onClose: () => void
  /** Nom de l'objet déposé (affiché dans le titre). */
  itemName: string
  /** True si l'objet n'a pas encore d'illustration_url (= besoin de la
   *  description en plus de la position). */
  needsDescription: boolean
  /** Suggestion auto-générée de placement basée sur la zone de drop
   *  (ex: "in the upper-right area"). Pré-rempli dans le champ position. */
  defaultPositionPrompt: string
  /** Description courante de l'objet (pré-rempli si déjà saisie dans la fiche). */
  defaultDescription?: string | null
  /** Callback confirmation. Reçoit le prompt position + description (si demandée). */
  onConfirm: (positionPrompt: string, description: string | null) => void
}

export default function DropPromptModal({
  open, onClose, itemName, needsDescription,
  defaultPositionPrompt, defaultDescription, onConfirm,
}: DropPromptModalProps) {
  const [positionPrompt, setPositionPrompt] = useState(defaultPositionPrompt)
  const [description, setDescription] = useState(defaultDescription ?? '')

  // Reset les champs à chaque ouverture (= chaque drop)
  useEffect(() => {
    if (open) {
      setPositionPrompt(defaultPositionPrompt)
      setDescription(defaultDescription ?? '')
    }
  }, [open, defaultPositionPrompt, defaultDescription])

  // ESC ferme le modal (seul moyen clavier — pas de click-outside).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const canConfirm = positionPrompt.trim().length > 0
    && (!needsDescription || description.trim().length > 0)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canConfirm) return
    onConfirm(
      positionPrompt.trim(),
      needsDescription ? description.trim() : null,
    )
  }

  return (
    // Pas de click-outside-to-close (principe Hero : les popups d'action
    // ne ferment qu'au bouton X ou Annuler explicite, pour éviter pertes
    // accidentelles). ESC ferme aussi (cf useEffect ci-dessous).
    <div className="dpm-overlay">
      <div className="dpm-modal">
        <header className="dpm-header">
          <h2 className="dpm-title">
            Insérer <strong>{itemName}</strong>
          </h2>
          <button type="button" className="dpm-close" onClick={onClose} aria-label="Annuler">
            <XIcon size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="dpm-body">
          {needsDescription && (
            <div className="dpm-field">
              <label className="dpm-label">
                Description visuelle de l&apos;objet
                <span className="dpm-label-hint">— ce que Qwen doit dessiner</span>
              </label>
              <textarea
                className="dpm-input"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="ex: enveloppe en parchemin sépia avec sceau de cire rouge marqué d'un blason de la Junte"
                rows={3}
                autoFocus
                spellCheck
              />
              <div className="dpm-hint">
                Qwen Edit travaille uniquement avec du texte (pas d&apos;image en input). Sois
                précis sur l&apos;apparence — couleur, matière, taille, détails visibles. Si une
                description existe en fiche, elle est pré-remplie et tu peux l&apos;affiner ici
                sans toucher à la fiche d&apos;origine.
              </div>
            </div>
          )}

          <div className="dpm-field">
            <label className="dpm-label">
              Placement dans la scène
              <span className="dpm-label-hint">— où et comment placer l&apos;objet</span>
            </label>
            <textarea
              className="dpm-input"
              value={positionPrompt}
              onChange={e => setPositionPrompt(e.target.value)}
              placeholder="ex: sur le bureau, à côté de la lampe, format A4"
              rows={2}
              autoFocus={!needsDescription}
              spellCheck
            />
            <div className="dpm-hint">
              Sois précis : le repère visuel (sur la table, devant la fenêtre…) aide énormément
              le modèle à placer l&apos;objet correctement.
            </div>
          </div>

          <footer className="dpm-footer">
            <button type="button" className="dpm-btn dpm-btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="dpm-btn dpm-btn-primary" disabled={!canConfirm}>
              <Wand2 size={14} />
              <span>Insérer</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
