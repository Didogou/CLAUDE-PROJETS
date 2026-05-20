'use client'
/**
 * PlanAddPanel — tuile de création d'un Plan, même largeur qu'un Plan cell.
 *
 * Affiche les 3 types directement (Static / Animation / Conversation), pas
 * de dropdown : 1 clic = create immédiat.
 *
 * Garde le nom de fichier `PlanAddDropdown.tsx` pour minimiser les changements
 * d'imports — ce qui est exporté est un panneau, plus un dropdown.
 */

import React from 'react'
import { PLAN_TYPE_OPTIONS, type PlanType } from './types'

interface PlanAddPanelProps {
  onCreate: (type: PlanType) => void
}

export default function PlanAddDropdown({ onCreate }: PlanAddPanelProps) {
  return (
    <div className="ss-plan-add-panel" role="group" aria-label="Ajouter un Plan">
      <div className="ss-plan-add-panel-header">+ Ajouter un Plan</div>
      <div className="ss-plan-add-panel-options">
        {PLAN_TYPE_OPTIONS.map(opt => (
          <button
            key={opt.type}
            type="button"
            className={`ss-plan-add-option ${opt.type}`}
            onClick={() => onCreate(opt.type)}
            title={opt.description}
          >
            <span className="ss-plan-add-option-icon">{opt.icon}</span>
            <span className="ss-plan-add-option-label">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
