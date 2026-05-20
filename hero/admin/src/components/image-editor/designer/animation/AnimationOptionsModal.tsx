'use client'
/**
 * AnimationOptionsModal — petite modal pour éditer les paramètres d'un SHOT
 * spécifique d'une pellicule : Cadrage, Caméra, Durée.
 *
 * Refacto multi-shots β.1+ 2026-05-06 : avant la modal éditait la pellicule
 * en mono-shot ; maintenant elle édite UN shot précis (par défaut le premier
 * de la pellicule). Pour les pellicules multi-shots, il faudra ajouter une
 * navigation entre shots dans la modal — V1 minimaliste : édite shots[0].
 *
 * Backdrop + Esc ferment. Les changements s'appliquent immédiatement.
 */

import React, { useEffect } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEditorState, type AnimationPellicule, type Shot } from '@/components/image-editor/EditorStateContext'
import { SHOT_LABELS, CAMERA_LABELS, DURATION_OPTIONS } from './labels'

interface AnimationOptionsModalProps {
  pellicule: AnimationPellicule
  /** Optionnel — id du shot à éditer. Si non fourni, édite le 1er shot. */
  shotId?: string
  onClose: () => void
}

export default function AnimationOptionsModal({ pellicule, shotId, onClose }: AnimationOptionsModalProps) {
  const { updateAnimationShot } = useEditorState()

  // Sélectionne le shot ciblé ou le 1er par défaut. Si pas de shot du tout
  // (ne devrait pas arriver vu que addAnimationPellicule en crée toujours 1),
  // on retourne null pour ne pas crasher.
  const shot: Shot | undefined = shotId
    ? pellicule.shots.find(s => s.id === shotId)
    : pellicule.shots[0]

  // Esc ferme la modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!shot) {
    // Cas dégénéré : on ferme tranquillement
    return null
  }

  const shotIndex = pellicule.shots.findIndex(s => s.id === shot.id)
  const totalShots = pellicule.shots.length

  return (
    <motion.div
      className="dz-anim-options-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      role="dialog"
      aria-modal="true"
      aria-label="Options du shot"
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
          <h3>
            Options du shot
            {totalShots > 1 ? ` ${shotIndex + 1} / ${totalShots}` : ''}
          </h3>
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
          <label className="dz-anim-options-field">
            <span>Cadrage</span>
            <select
              value={shot.shot}
              onChange={e => updateAnimationShot(pellicule.id, shot.id, { shot: e.target.value as Shot['shot'] })}
              autoFocus
            >
              {Object.entries(SHOT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label className="dz-anim-options-field">
            <span>Caméra</span>
            <select
              value={shot.camera}
              onChange={e => updateAnimationShot(pellicule.id, shot.id, { camera: e.target.value as Shot['camera'] })}
            >
              {Object.entries(CAMERA_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label className="dz-anim-options-field">
            <span>Durée (s)</span>
            <select
              value={shot.duration}
              onChange={e => updateAnimationShot(pellicule.id, shot.id, { duration: Number(e.target.value) })}
            >
              {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d}s</option>)}
            </select>
            <small style={{ marginTop: '0.3rem', color: 'var(--ie-text-faint)', fontSize: '0.65rem', fontStyle: 'italic' }}>
              Étendue auto si TTS plus long que cette valeur (jamais réduite).
            </small>
          </label>
        </div>

        <footer className="dz-anim-options-footer">
          <button
            type="button"
            className="dz-anim-options-done"
            onClick={onClose}
          >
            Terminé
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
