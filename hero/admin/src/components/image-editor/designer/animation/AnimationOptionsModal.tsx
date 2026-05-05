'use client'
/**
 * AnimationOptionsModal — petite modal pour éditer les paramètres d'une
 * pellicule : Cadrage, Caméra, Durée.
 *
 * Déclenchée par le bouton "Options" dans la cellule timeline. Permet de
 * garder la cellule compacte (juste titre + thumbnail + bouton) tout en
 * donnant accès aux contrôles quand l'auteur en a besoin.
 *
 * Backdrop + Esc ferment. Les changements s'appliquent immédiatement à
 * la pellicule (pas de save/cancel) — fermer = tout est déjà persisté.
 */

import React, { useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Plus, Trash2 } from 'lucide-react'
import { useEditorState, type AnimationPellicule, type PelliculeType, type PelliculeExit, type ChoiceOption } from '@/components/image-editor/EditorStateContext'
import { SHOT_LABELS, CAMERA_LABELS, DURATION_OPTIONS } from './labels'

/** Labels FR pour les types de pellicule (UI). */
const TYPE_LABELS: Record<PelliculeType, string> = {
  animation: '🎬 Animation (vidéo générée par IA)',
  image_static: '🖼 Image fixe (statique pendant la durée)',
  conversation: '💬 Conversation (à venir — Studio Creator)',
}

interface AnimationOptionsModalProps {
  pellicule: AnimationPellicule
  onClose: () => void
}

/** Helpers pour l'édition de l'exit. */
function genChoiceId(): string {
  return `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export default function AnimationOptionsModal({ pellicule, onClose }: AnimationOptionsModalProps) {
  const { updateAnimationPellicule, animationPellicules } = useEditorState()

  /** Change le kind d'exit, en réinitialisant les options si on passe à choices. */
  function setExitKind(kind: PelliculeExit['kind']) {
    let newExit: PelliculeExit
    if (kind === 'choices') {
      // Si déjà choices, garde les options existantes ; sinon démarre avec 2 choix vides
      newExit = pellicule.exit.kind === 'choices'
        ? pellicule.exit
        : { kind: 'choices', options: [
            { id: genChoiceId(), label: '', targetPelliculeId: null },
            { id: genChoiceId(), label: '', targetPelliculeId: null },
          ] }
    } else {
      newExit = { kind } as PelliculeExit
    }
    updateAnimationPellicule(pellicule.id, { exit: newExit })
  }

  function updateChoice(choiceId: string, patch: Partial<ChoiceOption>) {
    if (pellicule.exit.kind !== 'choices') return
    const newOptions = pellicule.exit.options.map(c =>
      c.id === choiceId ? { ...c, ...patch } : c
    )
    updateAnimationPellicule(pellicule.id, { exit: { kind: 'choices', options: newOptions } })
  }

  function addChoice() {
    if (pellicule.exit.kind !== 'choices') return
    const newOptions = [
      ...pellicule.exit.options,
      { id: genChoiceId(), label: '', targetPelliculeId: null },
    ]
    updateAnimationPellicule(pellicule.id, { exit: { kind: 'choices', options: newOptions } })
  }

  function removeChoice(choiceId: string) {
    if (pellicule.exit.kind !== 'choices') return
    const newOptions = pellicule.exit.options.filter(c => c.id !== choiceId)
    updateAnimationPellicule(pellicule.id, { exit: { kind: 'choices', options: newOptions } })
  }

  // Liste des pellicules disponibles comme target de choix (toutes sauf
  // la pellicule courante elle-même = évite les loops triviaux).
  const targetCandidates = animationPellicules.filter(p => p.id !== pellicule.id)

  // Esc ferme la modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      className="dz-anim-options-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Options de la pellicule"
    >
      <motion.div
        className="dz-anim-options-modal"
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dz-anim-options-header">
          <h3>Options de la pellicule</h3>
          <button
            type="button"
            className="dz-anim-options-close"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </header>

        <div className="dz-anim-options-body">
          {/* Sélecteur de type — première option car drive les champs suivants. */}
          <label className="dz-anim-options-field">
            <span>Type de pellicule</span>
            <select
              value={pellicule.type}
              onChange={e => updateAnimationPellicule(pellicule.id, { type: e.target.value as PelliculeType })}
              autoFocus
            >
              <option value="animation">{TYPE_LABELS.animation}</option>
              <option value="image_static">{TYPE_LABELS.image_static}</option>
              <option value="conversation" disabled>{TYPE_LABELS.conversation}</option>
            </select>
          </label>

          {/* Cadrage et Caméra UNIQUEMENT pour type='animation' (paramètres LTX). */}
          {pellicule.type === 'animation' && (
            <>
              <label className="dz-anim-options-field">
                <span>Cadrage</span>
                <select
                  value={pellicule.shot}
                  onChange={e => updateAnimationPellicule(pellicule.id, { shot: e.target.value as AnimationPellicule['shot'] })}
                >
                  {Object.entries(SHOT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>

              <label className="dz-anim-options-field">
                <span>Caméra</span>
                <select
                  value={pellicule.camera}
                  onChange={e => updateAnimationPellicule(pellicule.id, { camera: e.target.value as AnimationPellicule['camera'] })}
                >
                  {Object.entries(CAMERA_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </>
          )}

          {/* Durée applicable à TOUS les types — drive le wf LTX (animation)
           *  ou la durée d'affichage en lecture séquence (image_static). */}
          <label className="dz-anim-options-field">
            <span>Durée {pellicule.type === 'image_static' ? '(temps d\'affichage)' : '(durée vidéo)'}</span>
            <select
              value={pellicule.duration}
              onChange={e => updateAnimationPellicule(pellicule.id, { duration: Number(e.target.value) })}
            >
              {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} secondes</option>)}
            </select>
          </label>

          {/* Phase E3 — section Sortie : drive ce qui se passe à la fin de
           *  cette pellicule en lecture séquence. */}
          <div className="dz-anim-options-exit-section">
            <label className="dz-anim-options-field">
              <span>Sortie de cette pellicule</span>
              <select
                value={pellicule.exit.kind}
                onChange={e => setExitKind(e.target.value as PelliculeExit['kind'])}
              >
                <option value="auto">▶ Enchaîner sur la pellicule suivante</option>
                <option value="choices">◆ Choix joueur (branching)</option>
                <option value="end_section">⏹ Fin de section (déclenche les choix de Section)</option>
              </select>
            </label>

            {pellicule.exit.kind === 'choices' && (
              <div className="dz-anim-options-choices">
                <div className="dz-anim-options-choices-header">
                  <span>Choix proposés au joueur ({pellicule.exit.options.length})</span>
                  <button
                    type="button"
                    className="dz-anim-options-add-choice"
                    onClick={addChoice}
                    title="Ajouter un choix"
                  >
                    <Plus size={11} />
                    <span>Ajouter</span>
                  </button>
                </div>
                {pellicule.exit.options.map((choice, idx) => (
                  <div key={choice.id} className="dz-anim-options-choice">
                    <div className="dz-anim-options-choice-num">R{idx + 1}</div>
                    <input
                      type="text"
                      className="dz-anim-options-choice-label"
                      placeholder="Texte du choix (ex: Engager la conversation)"
                      value={choice.label}
                      onChange={e => updateChoice(choice.id, { label: e.target.value })}
                    />
                    <select
                      className="dz-anim-options-choice-target"
                      value={choice.targetPelliculeId ?? ''}
                      onChange={e => updateChoice(choice.id, {
                        targetPelliculeId: e.target.value || null,
                      })}
                      title="Pellicule cible si l'auteur sélectionne ce choix"
                    >
                      <option value="">→ Fin de section</option>
                      {targetCandidates.map(p => {
                        const targetIdx = animationPellicules.findIndex(x => x.id === p.id)
                        return (
                          <option key={p.id} value={p.id}>
                            → P{targetIdx + 1}
                          </option>
                        )
                      })}
                    </select>
                    <button
                      type="button"
                      className="dz-anim-options-choice-remove"
                      onClick={() => removeChoice(choice.id)}
                      disabled={pellicule.exit.kind === 'choices' && pellicule.exit.options.length <= 1}
                      title="Supprimer ce choix"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                {pellicule.exit.options.length === 0 && (
                  <div className="dz-anim-options-choices-empty">
                    Aucun choix — clique <strong>Ajouter</strong> pour en créer un.
                  </div>
                )}
              </div>
            )}

            {pellicule.exit.kind === 'end_section' && (
              <div className="dz-anim-options-exit-info">
                Cette pellicule termine la Section. Les choix configurés dans le
                Studio Creator (Section.choices) seront affichés au joueur.
              </div>
            )}
          </div>
        </div>

        <footer className="dz-anim-options-footer">
          <button type="button" className="dz-anim-options-done" onClick={onClose}>
            Terminé
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
