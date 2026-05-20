'use client'
/**
 * PelliculeExitEditor — modal d'édition de l'exit d'une pellicule.
 * Step 2 refonte 2026-05-11 (Plan choix).
 *
 * 3 types d'exit possibles :
 *   - 'auto'        : enchaîne sur la pellicule suivante (default)
 *   - 'choices'     : présente des options à l'auteur, branche selon clic
 *   - 'end_section' : fin du plan, retour au moteur de Section
 *
 * Pour 'choices', chaque option a un label + targetPelliculeId (pellicule du
 * plan, ou null = fin de section → trigger Choices Section parente côté lecteur).
 *
 * Le bouton n'est affiché que sur la DERNIÈRE pellicule du plan (cf
 * AnimationStudioInner). Les exits intermédiaires n'ont pas de sens en V1.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, ArrowDown, ArrowUp, Check, AlertTriangle } from 'lucide-react'
import type {
  AnimationPellicule,
  PelliculeExit,
  PelliculeExitChoice,
} from '@/components/image-editor/EditorStateContext'
import './PelliculeExitEditor.css'

interface PelliculeExitEditorProps {
  open: boolean
  onClose: () => void
  /** Pellicule en cours d'édition (= la dernière du plan en V1). */
  pellicule: AnimationPellicule | null
  /** Toutes les pellicules du plan (= candidates pour la cible des choices). */
  allPellicules: AnimationPellicule[]
  /** Callback save : remplace tout l'exit de la pellicule. */
  onSave: (exit: PelliculeExit) => void
  /** Callback "Créer nouvelle pellicule cible" : crée une pellicule vide,
   *  retourne son id pour qu'on l'auto-sélectionne dans le picker. */
  onCreateNewPellicule: () => string | null
}

function newChoiceId(): string {
  return `exitchoice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function emptyChoice(): PelliculeExitChoice {
  return { id: newChoiceId(), label: '', targetPelliculeId: null }
}

function defaultExit(): PelliculeExit {
  return { kind: 'auto' }
}

export default function PelliculeExitEditor({
  open, onClose, pellicule, allPellicules, onSave, onCreateNewPellicule,
}: PelliculeExitEditorProps) {
  const [draft, setDraft] = useState<PelliculeExit>(() => pellicule?.exit ?? defaultExit())

  useEffect(() => {
    if (open) setDraft(pellicule?.exit ?? defaultExit())
  }, [open, pellicule])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /** Switche entre les 3 kinds en gardant les options[] si on revient sur 'choices'. */
  const setKind = useCallback((kind: 'auto' | 'choices' | 'end_section') => {
    setDraft(prev => {
      if (kind === 'auto') return { kind: 'auto' }
      if (kind === 'end_section') return { kind: 'end_section' }
      // kind === 'choices' : conserve les options si déjà présentes, sinon init avec 1 vide
      if (prev.kind === 'choices') return prev
      return { kind: 'choices', options: [emptyChoice()] }
    })
  }, [])

  const updateChoice = useCallback((idx: number, patch: Partial<PelliculeExitChoice>) => {
    setDraft(prev => {
      if (prev.kind !== 'choices') return prev
      const next: PelliculeExit = { kind: 'choices', options: [...prev.options] }
      next.options[idx] = { ...next.options[idx], ...patch }
      return next
    })
  }, [])

  const addChoice = useCallback(() => {
    setDraft(prev => {
      if (prev.kind !== 'choices') return prev
      return { kind: 'choices', options: [...prev.options, emptyChoice()] }
    })
  }, [])

  const removeChoice = useCallback((idx: number) => {
    setDraft(prev => {
      if (prev.kind !== 'choices') return prev
      const next = prev.options.filter((_, i) => i !== idx)
      if (next.length === 0) next.push(emptyChoice())
      return { kind: 'choices', options: next }
    })
  }, [])

  const moveChoice = useCallback((idx: number, dir: -1 | 1) => {
    setDraft(prev => {
      if (prev.kind !== 'choices') return prev
      const target = idx + dir
      if (target < 0 || target >= prev.options.length) return prev
      const next = [...prev.options]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return { kind: 'choices', options: next }
    })
  }, [])

  const handleSave = useCallback(() => {
    if (draft.kind === 'choices') {
      const cleaned = draft.options.filter(o => o.label.trim().length > 0)
      if (cleaned.length === 0) {
        alert('Au moins un choix avec un label doit être défini.')
        return
      }
      onSave({ kind: 'choices', options: cleaned })
    } else {
      onSave(draft)
    }
    onClose()
  }, [draft, onSave, onClose])

  // Pellicules candidates pour la cible (toutes du plan, on ne filtre pas la
  // courante — l'auteur peut vouloir boucler si c'est sa narration)
  const pelliculeOptions = allPellicules.map((p, idx) => ({
    id: p.id,
    label: `Pellicule ${idx + 1}${p.id === pellicule?.id ? ' (courante)' : ''}`,
  }))

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="pee-backdrop"
          className="pee-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
          <motion.div
            key="pee-modal"
            className="pee-modal"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Configurer l'exit de fin de plan"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="pee-header">
              <h3 className="pee-title">Que se passe-t-il à la fin du plan ?</h3>
              <button type="button" className="pee-close" onClick={onClose} aria-label="Fermer">
                <X size={14} />
              </button>
            </header>

            <div className="pee-body">
              {/* Section : type d'exit */}
              <section className="pee-section">
                <h4 className="pee-section-title">Type d'exit</h4>
                <div className="pee-kind-row">
                  <KindCard
                    selected={draft.kind === 'auto'}
                    onClick={() => setKind('auto')}
                    icon="↪"
                    title="Enchaînement auto"
                    desc="Joue le plan suivant de la section sans pause"
                  />
                  <KindCard
                    selected={draft.kind === 'choices'}
                    onClick={() => setKind('choices')}
                    icon="🎯"
                    title="Choix joueur"
                    desc="Propose des options à l'auteur, branche selon le clic"
                  />
                  <KindCard
                    selected={draft.kind === 'end_section'}
                    onClick={() => setKind('end_section')}
                    icon="🏁"
                    title="Fin de section"
                    desc="Retour au moteur narratif (Choices de Section)"
                  />
                </div>
              </section>

              {/* Section : choix (si kind='choices') */}
              {draft.kind === 'choices' && (
                <section className="pee-section">
                  <header className="pee-section-header">
                    <h4 className="pee-section-title">Options proposées ({draft.options.length})</h4>
                    <button type="button" className="pee-add-choice" onClick={addChoice}>
                      <Plus size={12} /> Ajouter une option
                    </button>
                  </header>
                  <div className="pee-choices-list">
                    {draft.options.map((option, idx) => (
                      <ChoiceRow
                        key={option.id}
                        option={option}
                        idx={idx}
                        total={draft.options.length}
                        pelliculeOptions={pelliculeOptions}
                        onUpdate={patch => updateChoice(idx, patch)}
                        onRemove={() => removeChoice(idx)}
                        onMoveUp={() => moveChoice(idx, -1)}
                        onMoveDown={() => moveChoice(idx, 1)}
                        onCreateNewPellicule={() => {
                          const newId = onCreateNewPellicule()
                          if (newId) updateChoice(idx, { targetPelliculeId: newId })
                        }}
                      />
                    ))}
                  </div>
                  <p className="pee-help">
                    Cible <strong>« Fin de section »</strong> = sortir du plan, déclenche les Choices de la Section parente côté lecteur livre-jeu.
                  </p>
                </section>
              )}
            </div>

            <footer className="pee-footer">
              <button type="button" className="pee-btn pee-btn-cancel" onClick={onClose}>
                Annuler
              </button>
              <button type="button" className="pee-btn pee-btn-primary" onClick={handleSave}>
                <Check size={12} /> Enregistrer
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Sous-composant : carte de sélection du kind ──────────────────────────

function KindCard({
  selected, onClick, icon, title, desc,
}: { selected: boolean; onClick: () => void; icon: string; title: string; desc: string }) {
  return (
    <button
      type="button"
      className={`pee-kind-card ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <span className="pee-kind-icon">{icon}</span>
      <strong className="pee-kind-title">{title}</strong>
      <span className="pee-kind-desc">{desc}</span>
    </button>
  )
}

// ─── Sous-composant : une ligne de choix ──────────────────────────────────

function ChoiceRow({
  option, idx, total, pelliculeOptions,
  onUpdate, onRemove, onMoveUp, onMoveDown, onCreateNewPellicule,
}: {
  option: PelliculeExitChoice
  idx: number
  total: number
  pelliculeOptions: Array<{ id: string; label: string }>
  onUpdate: (patch: Partial<PelliculeExitChoice>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onCreateNewPellicule: () => void
}) {
  // Warn si la cible référence un id qui n'existe plus (dégradé)
  const targetPid = option.targetPelliculeId
  const targetWarning = targetPid && !pelliculeOptions.some(o => o.id === targetPid)
    ? 'Pellicule cible introuvable (peut-être supprimée)'
    : null

  return (
    <div className="pee-choice-row">
      <header className="pee-choice-header">
        <span className="pee-choice-num">#{idx + 1}</span>
        <div className="pee-choice-actions">
          <button type="button" className="pee-icon-btn" onClick={onMoveUp} disabled={idx === 0} title="Monter">
            <ArrowUp size={11} />
          </button>
          <button type="button" className="pee-icon-btn" onClick={onMoveDown} disabled={idx === total - 1} title="Descendre">
            <ArrowDown size={11} />
          </button>
          <button type="button" className="pee-icon-btn pee-icon-btn-danger" onClick={onRemove} title="Supprimer">
            <Trash2 size={11} />
          </button>
        </div>
      </header>

      <label className="pee-field">
        <span className="pee-field-label">Texte affiché à l'auteur</span>
        <input
          type="text"
          className="pee-input"
          value={option.label}
          onChange={e => onUpdate({ label: e.target.value })}
          placeholder="Ex : Tu fonces dans la ruelle"
        />
      </label>

      <div className="pee-field">
        <span className="pee-field-label">Cible (où ça mène)</span>
        <div className="pee-target-picker">
          <select
            className="pee-select"
            value={option.targetPelliculeId ?? '__end__'}
            onChange={e => {
              const v = e.target.value
              onUpdate({ targetPelliculeId: v === '__end__' ? null : v })
            }}
          >
            <option value="__end__">🏁 Fin de section (= sortir du plan)</option>
            {pelliculeOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <button type="button" className="pee-btn pee-btn-secondary" onClick={onCreateNewPellicule} title="Crée une pellicule vide et la sélectionne comme cible">
            <Plus size={11} /> Nouvelle pellicule
          </button>
        </div>
        {targetWarning && (
          <p className="pee-warning">
            <AlertTriangle size={11} /> {targetWarning}
          </p>
        )}
      </div>
    </div>
  )
}
