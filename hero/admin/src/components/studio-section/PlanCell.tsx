'use client'
/**
 * PlanCell — cellule d'un Plan dans le storyboard de la Section.
 *
 * Affiche : thumbnail (image ou icône type) + badge type + durée. Sélection
 * = bordure accent + glow + restoration de visibilité (les autres sont
 * dimmed via .ss-track-content:has(.selected) cf studio-section.css).
 *
 * Auto-scroll horizontal au mount/sélection : la cellule sélectionnée se
 * recentre dans la timeline (focus mode visuel).
 */

import React, { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import type { Plan } from './types'

interface PlanCellProps {
  plan: Plan
  selected: boolean
  onSelect: (planId: string) => void
  /** Demande de suppression — le parent ouvre ConfirmDialog. */
  onRequestDelete?: (planId: string) => void
  /** Click sur le bouton "Éditer" — le parent navigue vers Studio Designer. */
  onEdit?: (planId: string) => void
}

export default function PlanCell({ plan, selected, onSelect, onRequestDelete, onEdit }: PlanCellProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Quand cette cellule devient sélectionnée → scroll horizontal smooth pour
  // la centrer dans la timeline. Évite que l'utilisateur perde de vue le
  // Plan en cours quand la timeline a beaucoup de cellules.
  useEffect(() => {
    if (!selected || !ref.current) return
    ref.current.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',  // centre horizontal dans le scroll container
    })
  }, [selected])

  return (
    <div
      ref={ref}
      className={`ss-plan-cell type-${plan.type} ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(plan.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(plan.id) }}
    >
      <div className="ss-plan-thumb">
        <PlanThumbContent plan={plan} />
        <span className="ss-plan-type-badge">
          {typeIcon(plan.type)} {typeLabel(plan.type)}
        </span>
        <span className="ss-plan-duration">{plan.durationLabel}</span>
        {onRequestDelete && (
          <button
            type="button"
            className="ss-plan-delete-btn"
            onClick={(e) => { e.stopPropagation(); onRequestDelete(plan.id) }}
            title="Supprimer ce Plan"
            aria-label={`Supprimer ${plan.title}`}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Zone INFO 2026-05-06 — vignettes perso + objets + résumé.
       *  Apparaît uniquement si au moins 1 info à montrer (sinon cellule
       *  reste compacte = juste l'image). */}
      {(plan.characters?.length || plan.items?.length || plan.summary) && (
        <div className="ss-plan-info">
          {plan.characters && plan.characters.length > 0 && (
            <div className="ss-plan-info-row">
              {plan.characters.map(c => (
                <div key={c.id} className="ss-plan-info-chip-vignette" title={c.name}>
                  {c.portraitUrl ? (
                    <img src={c.portraitUrl} alt={c.name} />
                  ) : (
                    <span className="ss-plan-info-vignette-fallback">{c.name.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="ss-plan-info-chip-vignette-name">{c.name}</span>
                </div>
              ))}
            </div>
          )}
          {plan.items && plan.items.length > 0 && (
            <div className="ss-plan-info-row">
              {plan.items.map(it => (
                <div key={it.id} className="ss-plan-info-chip-vignette item" title={it.name}>
                  {it.iconUrl ? (
                    <img src={it.iconUrl} alt={it.name} />
                  ) : (
                    <span className="ss-plan-info-vignette-fallback">📦</span>
                  )}
                  <span className="ss-plan-info-chip-vignette-name">{it.name}</span>
                </div>
              ))}
            </div>
          )}
          {plan.summary && (
            <div className="ss-plan-info-summary" title={plan.summary}>
              {plan.summary}
            </div>
          )}
        </div>
      )}

      {/* Bouton Éditer — Palier 1 : navigue vers Studio Designer.
       *  Le data flow (Designer charge le plan via planId) viendra Palier 2. */}
      {onEdit && (
        <button
          type="button"
          className="ss-plan-edit-btn"
          onClick={(e) => { e.stopPropagation(); onEdit(plan.id) }}
          title="Éditer ce Plan dans le Studio Designer"
        >
          ✎ Éditer
        </button>
      )}
    </div>
  )
}

function PlanThumbContent({ plan }: { plan: Plan }) {
  // Conversation : pas d'image, on affiche une carte stylisée avec icône + label
  // (dérivé du titre ou d'un NPC référencé — V0 mock).
  if (plan.type === 'conversation') {
    return (
      <div className="ss-plan-thumb-conv">
        <span className="ss-plan-thumb-conv-icon">💬</span>
        <span className="ss-plan-thumb-conv-label">{plan.title.slice(0, 18)}</span>
      </div>
    )
  }
  if (plan.thumb.url) {
    return <img src={plan.thumb.url} alt={plan.title} />
  }
  // Placeholder : icône qui correspond au type (manque image / pas encore généré)
  return <span className="ss-plan-thumb-placeholder">{typeIcon(plan.type)}</span>
}

function typeIcon(type: Plan['type']): string {
  switch (type) {
    case 'static': return '🖼'
    case 'animation': return '🎬'
    case 'conversation': return '💬'
    case 'choice': return '🎯'
  }
}

function typeLabel(type: Plan['type']): string {
  switch (type) {
    case 'static': return 'Static'
    case 'animation': return 'Animation'
    case 'conversation': return 'Conversation'
    case 'choice': return 'Choix'
  }
}
