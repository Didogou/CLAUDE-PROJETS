'use client'
/**
 * ChoiceOverlay — overlay des choix joueur en bas de stage.
 *
 * Utilisé pour 3 cas :
 *   1. Pellicule.exit kind='choices' — choix internes au plan
 *   2. Plan kind='choice' — Plan choix à options positionnées (variant 'image')
 *   3. Section.choices — choix sortants vers une autre section (à la fin)
 *
 * V1 = liste verticale en bas (option A du design 2026-05-06,
 * cf project_dialogue_overlay_poc_pending.md).
 *
 * V1 2026-05-13.
 */

import React from 'react'

export interface ChoiceOption {
  id: string
  label: string
  /** Type de cible — pour le caller il sait quoi faire au click. */
  target:
    | { kind: 'pellicule'; pelliculeId: string | null }      // pellicule exit
    | { kind: 'plan_index'; index: number }                  // plan choice variant
    | { kind: 'section'; sectionId: string | null }          // section sortante
}

interface ChoiceOverlayProps {
  /** Texte d'invite affiché au-dessus des options (optionnel). */
  prompt?: string
  options: ChoiceOption[]
  onPick: (option: ChoiceOption) => void
}

export default function ChoiceOverlay({ prompt, options, onPick }: ChoiceOverlayProps) {
  return (
    <div className="bp-choice-overlay">
      {prompt && <div className="bp-choice-prompt">{prompt}</div>}
      <div className="bp-choice-list">
        {options.map(opt => (
          <button
            key={opt.id}
            type="button"
            className="bp-choice-option"
            onClick={() => onPick(opt)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
