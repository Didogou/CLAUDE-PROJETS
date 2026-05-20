'use client'
/**
 * PlanInspector — panneau qui s'affiche sous la timeline storyboard et montre
 * les détails du Plan sélectionné. Bouton principal "Ouvrir dans Studio
 * Designer →" qui navigue vers l'éditeur du Plan.
 *
 * Champs affichés varient selon le type (durée pour animation, choix pour
 * static, nœuds pour conversation, etc.).
 */

import React from 'react'
import type { Plan } from './types'

interface PlanInspectorProps {
  plan: Plan | null
  /** Callback quand l'auteur clique "Ouvrir dans Studio Designer". Phase 0
   *  = juste un log, Phase 1 = navigation vers /editor-test/new-layout. */
  onOpenInDesigner: (planId: string) => void
}

export default function PlanInspector({ plan, onOpenInDesigner }: PlanInspectorProps) {
  if (!plan) {
    return (
      <div className="ss-plan-inspector">
        <div className="ss-insp-empty">
          Sélectionne un Plan dans la timeline pour voir ses détails.
        </div>
      </div>
    )
  }

  return (
    <div className="ss-plan-inspector">
      <header className="ss-insp-header">
        <div className="ss-insp-header-left">
          <h3>P{plan.order} — {plan.title}</h3>
          <span className={`ss-insp-pill type-${plan.type}`}>
            {typeIconLabel(plan.type)}
          </span>
        </div>
        <button
          type="button"
          className="ss-insp-open"
          onClick={() => onOpenInDesigner(plan.id)}
        >
          Ouvrir dans Studio Designer →
        </button>
      </header>
      <div className="ss-insp-body">
        <InspField label="Durée">
          {plan.durationLabel}
        </InspField>

        {plan.type === 'animation' && (
          <InspField label="Séquences">
            {plan.sequenceCount ?? 0} séquence{(plan.sequenceCount ?? 0) > 1 ? 's' : ''}
          </InspField>
        )}

        {plan.type === 'static' && (
          <InspField label="Choix attachés">
            {plan.hasChoiceEffect
              ? <span style={{ color: 'var(--ss-anim)' }}>⊕ Effet Choix actif (référence section.choices)</span>
              : <span className="muted">Aucun (image décorative)</span>}
          </InspField>
        )}

        {plan.type === 'conversation' && (
          <>
            <InspField label="Nœuds de dialogue">
              {plan.conversationNodes ?? 0}
            </InspField>
            <InspField label="Branches">
              {plan.conversationBranches ?? 0}
            </InspField>
          </>
        )}

        {plan.type === 'choice' && (
          <>
            <InspField label="Image">
              {plan.thumb.url
                ? <span style={{ color: 'var(--ss-choice)' }}>✓ Image définie</span>
                : <span className="muted">Aucune (à sélectionner)</span>}
            </InspField>
            <InspField label="Options">
              {(plan.chips.find(c => c.kind === 'choice')?.label) ?? '0 option'}
            </InspField>
          </>
        )}

        {plan.characterIds && plan.characterIds.length > 0 && (
          <InspField label="Personnages">
            {plan.characterIds.length} <span className="muted">({plan.characterIds.join(', ')})</span>
          </InspField>
        )}

        <InspField label="Musique">
          {plan.musicUrl
            ? <span style={{ color: 'var(--ss-music)' }}>♪ {plan.musicLabel ?? plan.musicUrl}</span>
            : <span className="muted">Aucune</span>}
        </InspField>

        <InspField label="Effet visuel">
          {plan.effectPreset
            ? <span style={{ textTransform: 'capitalize' }}>{plan.effectPreset}</span>
            : <span className="muted">Aucun</span>}
        </InspField>
      </div>
    </div>
  )
}

function InspField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ss-insp-field">
      <span className="ss-insp-field-label">{label}</span>
      <span className="ss-insp-field-value">{children}</span>
    </div>
  )
}

function typeIconLabel(type: Plan['type']): string {
  switch (type) {
    case 'static': return '🖼 Static'
    case 'animation': return '🎬 Animation'
    case 'conversation': return '💬 Conversation'
    case 'choice': return '🎯 Plan choix'
  }
}
