'use client'
/**
 * CharacterAttachmentRouterModal — modale de routage après extraction d'une
 * découpe ciblée "Personnage" dans le Designer.
 *
 * Mêmes ergonomiques que la modale Objet : 2 options claires.
 *   A. Créer un nouveau perso → ouvre CharacterCreatorModal pré-rempli
 *      (compose portrait + fullbody sur fond gris, etc.).
 *   B. Ajouter cette image à un perso existant → choix du perso + choix du
 *      slot (Portrait · Plein pied Face · Dos · Profil G · Profil D · Galerie
 *      variante). Met à jour la fiche perso directement.
 *
 * Slots → mapping Character store :
 *   - portrait      → patch { portraitUrl }
 *   - fullbody_face → patch { fullbodyUrl }
 *   - back / profil_l / profil_r → patch { images: replace by kind } (1 par kind)
 *   - variant       → patch { images: append } (peut y en avoir N)
 *
 * Refonte 2026-05-12 (pattern Objet répliqué pour Personnage).
 */

import React, { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Users, AlertTriangle } from 'lucide-react'
import type { Character } from '@/lib/character-store'

export type CharacterAttachmentSlot =
  | 'portrait' | 'fullbody_face'
  | 'view_back' | 'view_profile_left' | 'view_profile_right'
  | 'variant'

interface SlotDef {
  key: CharacterAttachmentSlot
  label: string
  /** Détecte si le slot est déjà occupé sur ce perso, pour afficher le badge
   *  "remplacera l'image actuelle" inline (économie de clic — un undo dans
   *  le Designer permet de revenir). */
  isOccupied: (c: Character) => boolean
}

const SLOTS: ReadonlyArray<SlotDef> = [
  {
    key: 'portrait', label: 'Portrait (tête/épaules)',
    isOccupied: c => !!c.portraitUrl,
  },
  {
    key: 'fullbody_face', label: 'Plein pied — Face',
    isOccupied: c => !!c.fullbodyUrl,
  },
  {
    key: 'view_back', label: 'Plein pied — Dos',
    isOccupied: c => (c.images ?? []).some(im => im.kind === 'view_back'),
  },
  {
    key: 'view_profile_left', label: 'Plein pied — Profil gauche',
    isOccupied: c => (c.images ?? []).some(im => im.kind === 'view_profile_left'),
  },
  {
    key: 'view_profile_right', label: 'Plein pied — Profil droit',
    isOccupied: c => (c.images ?? []).some(im => im.kind === 'view_profile_right'),
  },
  {
    key: 'variant', label: 'Galerie variante (ajout)',
    isOccupied: () => false,  // toujours ajout, jamais remplacement
  },
]

interface CharacterAttachmentRouterModalProps {
  open: boolean
  onClose: () => void
  /** URL Supabase du PNG transparent extrait (passée à both flows). */
  extractionUrl: string | null
  /** Persos existants du livre (depuis character store). */
  characters: Character[]
  /** Callback "Créer nouveau" → parent chaîne sur le flow CharacterCreatorModal
   *  (compose gris + ouvre modal). */
  onCreateNew: (extractionUrl: string) => void
  /** Callback "Attacher à existant". Le parent compose l'image selon le slot,
   *  PATCH /api/npcs/[id] et met à jour le store. */
  onAttach: (charId: string, slot: CharacterAttachmentSlot, extractionUrl: string) => Promise<void> | void
}

export default function CharacterAttachmentRouterModal({
  open, onClose, extractionUrl, characters, onCreateNew, onAttach,
}: CharacterAttachmentRouterModalProps) {
  // 'choose' = sélection initiale 2 cards
  // 'attach' = formulaire perso + slot (étape 2 après clic carte "existant")
  const [step, setStep] = useState<'choose' | 'attach'>('choose')
  const [charId, setCharId] = useState<string>('')
  const [slot, setSlot] = useState<CharacterAttachmentSlot>('portrait')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedChar = useMemo(
    () => characters.find(c => c.id === charId) ?? null,
    [characters, charId],
  )

  // Reset à chaque ouverture
  useEffect(() => {
    if (open) {
      setStep('choose')
      setCharId(characters[0]?.id ?? '')
      setSlot('portrait')
      setBusy(false)
      setError(null)
    }
  }, [open, characters])

  if (!open || !extractionUrl) return null

  async function handleAttachClick() {
    if (!selectedChar || busy || !extractionUrl) return
    setBusy(true)
    setError(null)
    try {
      await onAttach(selectedChar.id, slot, extractionUrl)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Attachement échoué : ${msg}`)
      setBusy(false)
    }
  }

  function handleCreateNewClick() {
    if (!extractionUrl) return
    onCreateNew(extractionUrl)
    onClose()
  }

  const slotOccupied = selectedChar
    ? SLOTS.find(s => s.key === slot)?.isOccupied(selectedChar) ?? false
    : false

  return (
    <AnimatePresence>
      <motion.div
        className="dz-attach-router-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <motion.div
          className="dz-attach-router-modal"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
        >
          <div className="dz-attach-router-header">
            <span className="dz-attach-router-title">
              {step === 'choose' ? 'Que faire de cette extraction ?' : 'Ajouter à un personnage existant'}
            </span>
            <button
              type="button"
              className="dz-attach-router-close"
              onClick={onClose}
              disabled={busy}
              aria-label="Fermer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Aperçu de l'image extraite */}
          <div className="dz-attach-router-preview">
            <img src={extractionUrl} alt="Extraction" className="dz-attach-router-preview-img" />
          </div>

          {step === 'choose' && (
            <div className="dz-attach-router-cards">
              <button
                type="button"
                className="dz-attach-router-card"
                onClick={handleCreateNewClick}
              >
                <Plus size={20} />
                <span className="dz-attach-router-card-title">Créer un nouveau personnage</span>
                <span className="dz-attach-router-card-desc">
                  Ouvre la fiche de création avec cette image pré-remplie
                  (portrait + plein pied auto-composés).
                </span>
              </button>
              <button
                type="button"
                className="dz-attach-router-card"
                onClick={() => {
                  if (characters.length === 0) {
                    setError("Aucun personnage existant. Crée d'abord un perso.")
                    return
                  }
                  setStep('attach')
                }}
                disabled={characters.length === 0}
                title={characters.length === 0 ? 'Aucun perso existant' : ''}
              >
                <Users size={20} />
                <span className="dz-attach-router-card-title">Ajouter à un perso existant</span>
                <span className="dz-attach-router-card-desc">
                  Enrichis un perso de la banque (portrait, dos, profil, variante…).
                </span>
              </button>
            </div>
          )}

          {step === 'attach' && (
            <div className="dz-attach-router-form">
              <label className="dz-attach-router-field">
                <span className="dz-attach-router-field-label">Personnage</span>
                <select
                  className="dz-attach-router-select"
                  value={charId}
                  onChange={e => setCharId(e.target.value)}
                  disabled={busy}
                >
                  {characters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>

              <label className="dz-attach-router-field">
                <span className="dz-attach-router-field-label">Emplacement</span>
                <div className="dz-attach-router-slots">
                  {SLOTS.map(s => {
                    const occupied = selectedChar ? s.isOccupied(selectedChar) : false
                    return (
                      <label
                        key={s.key}
                        className="dz-attach-router-slot"
                        data-checked={slot === s.key ? 'true' : undefined}
                      >
                        <input
                          type="radio"
                          name="char-attach-slot"
                          value={s.key}
                          checked={slot === s.key}
                          onChange={() => setSlot(s.key)}
                          disabled={busy}
                        />
                        <span className="dz-attach-router-slot-label">{s.label}</span>
                        {occupied && (
                          <span className="dz-attach-router-slot-warn" title="Image existante remplacée (réversible via Annuler du Designer)">
                            <AlertTriangle size={11} /> remplace
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </label>

              {slotOccupied && (
                <div className="dz-attach-router-warn">
                  <AlertTriangle size={12} /> L'image actuelle de cet emplacement sera remplacée.
                </div>
              )}

              {error && (
                <div className="dz-attach-router-error">
                  <AlertTriangle size={12} /> {error}
                </div>
              )}

              <div className="dz-attach-router-actions">
                <button
                  type="button"
                  className="dz-attach-router-btn dz-attach-router-btn-ghost"
                  onClick={() => setStep('choose')}
                  disabled={busy}
                >
                  ← Retour
                </button>
                <button
                  type="button"
                  className="dz-attach-router-btn dz-attach-router-btn-secondary"
                  onClick={onClose}
                  disabled={busy}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="dz-attach-router-btn dz-attach-router-btn-primary"
                  onClick={() => void handleAttachClick()}
                  disabled={!selectedChar || busy}
                >
                  {busy ? 'Attachement…' : 'Attacher'}
                </button>
              </div>
            </div>
          )}

          {error && step === 'choose' && (
            <div className="dz-attach-router-error" style={{ margin: '0.75rem 1rem' }}>
              <AlertTriangle size={12} /> {error}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
