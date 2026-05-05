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
import { X } from 'lucide-react'
import { useEditorState, type AnimationPellicule } from '@/components/image-editor/EditorStateContext'
import { SHOT_LABELS, CAMERA_LABELS, DURATION_OPTIONS } from './labels'

interface AnimationOptionsModalProps {
  pellicule: AnimationPellicule
  onClose: () => void
}

export default function AnimationOptionsModal({ pellicule, onClose }: AnimationOptionsModalProps) {
  const { updateAnimationPellicule } = useEditorState()

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
          <label className="dz-anim-options-field">
            <span>Cadrage</span>
            <select
              value={pellicule.shot}
              onChange={e => updateAnimationPellicule(pellicule.id, { shot: e.target.value as AnimationPellicule['shot'] })}
              autoFocus
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

          <label className="dz-anim-options-field">
            <span>Durée</span>
            <select
              value={pellicule.duration}
              onChange={e => updateAnimationPellicule(pellicule.id, { duration: Number(e.target.value) })}
            >
              {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} secondes</option>)}
            </select>
          </label>
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
