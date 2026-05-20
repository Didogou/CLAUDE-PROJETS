'use client'
/**
 * CatalogChoix — panneau gauche de l'outil Choix.
 *
 * Visible uniquement quand le Plan en cours est de type 'choice'. Affiché
 * sous l'icône Annotations du rail.
 *
 * Contenu :
 *  - Toggle style markers (pin discret vs aperçu joueur WYSIWYG)
 *  - Liste des choix de la Section parente (clic = pose un marker au centre,
 *    grisé si déjà placé)
 *  - Bouton "+ choix vers un autre Plan" + form inline (label + cible plan)
 */

import React, { useState } from 'react'
import { Plus, MapPin, Eye, X as XIcon } from 'lucide-react'
import CatalogShell from '../catalogs/CatalogShell'
import { useChoicePlan, type SectionChoice } from './ChoicePlanContext'

interface CatalogChoixProps {
  onClose: () => void
}

export default function CatalogChoix({ onClose }: CatalogChoixProps) {
  const {
    sectionChoices, options,
    addSectionMarker, addPlanMarker, removeOption, setSelectedOptionId,
    markerStyle, setMarkerStyle,
  } = useChoicePlan()

  const [showPlanForm, setShowPlanForm] = useState(false)

  return (
    <CatalogShell title="🎯 Choix" onClose={onClose} showSearch={false}>
      {/* Toggle style d'affichage des markers ------------------------------ */}
      <div className="dz-choix-toggle">
        <span className="dz-choix-toggle-label">Affichage</span>
        <div className="dz-choix-toggle-row" role="radiogroup">
          <button
            type="button"
            role="radio"
            aria-checked={markerStyle === 'pin'}
            className={`dz-choix-toggle-btn${markerStyle === 'pin' ? ' active' : ''}`}
            onClick={() => setMarkerStyle('pin')}
            title="Pastilles numérotées discrètes"
          >
            <MapPin size={14} />
            <span>Pin</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={markerStyle === 'preview'}
            className={`dz-choix-toggle-btn${markerStyle === 'preview' ? ' active' : ''}`}
            onClick={() => setMarkerStyle('preview')}
            title="Aperçu joueur (WYSIWYG)"
          >
            <Eye size={14} />
            <span>Aperçu</span>
          </button>
        </div>
      </div>

      {/* Liste choix Section ---------------------------------------------- */}
      <div className="dz-catalog-section">
        <div className="dz-catalog-section-title">Choix de la Section parente</div>
        {sectionChoices.length === 0 ? (
          <div className="dz-choix-empty">
            Aucun choix défini sur la Section. Crée-les d&apos;abord dans Studio Section.
          </div>
        ) : (
          <ul className="dz-choix-list">
            {sectionChoices.map(c => {
              const placed = options.some(
                o => o.source.kind === 'section' && o.source.section_choice_id === c.id,
              )
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`dz-choix-source-card${placed ? ' placed' : ''}`}
                    onClick={() => { if (!placed) addSectionMarker(c.id) }}
                    disabled={placed}
                    title={placed ? 'Déjà posé sur l\'image' : 'Cliquer pour poser au centre'}
                  >
                    <span className="dz-choix-source-num">{c.sort_order + 1}</span>
                    <span className="dz-choix-source-text">
                      <span className="dz-choix-source-label">{truncate(c.label, 60)}</span>
                      <span className="dz-choix-source-target">
                        {c.target_section_number != null
                          ? `→ §${c.target_section_number}`
                          : '→ (cible non définie)'}
                      </span>
                    </span>
                    {placed && <span className="dz-choix-source-pill">posé</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Choix interne au Plan -------------------------------------------- */}
      <div className="dz-catalog-section">
        <div className="dz-catalog-section-title">Choix interne au Plan</div>
        {!showPlanForm ? (
          <button
            type="button"
            className="dz-choix-add-plan-btn"
            onClick={() => setShowPlanForm(true)}
          >
            <Plus size={14} />
            <span>Ajouter un choix vers un autre Plan</span>
          </button>
        ) : (
          <PlanChoiceForm
            onSubmit={(label, targetIdx) => {
              addPlanMarker(label, targetIdx)
              setShowPlanForm(false)
            }}
            onCancel={() => setShowPlanForm(false)}
          />
        )}
      </div>

      {/* Markers déjà posés ----------------------------------------------- */}
      {options.length > 0 && (
        <div className="dz-catalog-section">
          <div className="dz-catalog-section-title">Markers posés ({options.length})</div>
          <ul className="dz-choix-list">
            {options.map((o, i) => (
              <li key={o.id}>
                <div
                  className="dz-choix-placed-card"
                  onClick={() => setSelectedOptionId(o.id)}
                  role="button"
                  tabIndex={0}
                >
                  <span className="dz-choix-placed-num">{i + 1}</span>
                  <span className="dz-choix-placed-text">
                    <span className="dz-choix-placed-label">{markerLabel(o, sectionChoices)}</span>
                    <span className="dz-choix-placed-target">{markerTarget(o, sectionChoices)}</span>
                  </span>
                  <button
                    type="button"
                    className="dz-choix-placed-del"
                    onClick={e => { e.stopPropagation(); removeOption(o.id) }}
                    title="Retirer ce marker"
                    aria-label="Retirer"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CatalogShell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Form inline : ajout choix interne (label + cible plan)
// ────────────────────────────────────────────────────────────────────────
function PlanChoiceForm({
  onSubmit, onCancel,
}: {
  onSubmit: (label: string, targetPlanIndex: number) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState('')
  const [targetIdx, setTargetIdx] = useState('')

  const valid = label.trim().length > 0 && /^\d+$/.test(targetIdx.trim())

  return (
    <div className="dz-choix-plan-form">
      <input
        type="text"
        className="dz-choix-plan-input"
        placeholder="Label du choix (ex: Examiner la fenêtre)"
        value={label}
        onChange={e => setLabel(e.target.value)}
        autoFocus
      />
      <input
        type="number"
        min={1}
        className="dz-choix-plan-input"
        placeholder="N° du Plan cible (ex: 4)"
        value={targetIdx}
        onChange={e => setTargetIdx(e.target.value)}
      />
      <div className="dz-choix-plan-form-actions">
        <button type="button" className="dz-choix-plan-cancel" onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="dz-choix-plan-submit"
          disabled={!valid}
          onClick={() => valid && onSubmit(label.trim(), parseInt(targetIdx, 10) - 1)}
        >
          Ajouter
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Helpers d'affichage des markers déjà posés
// ────────────────────────────────────────────────────────────────────────
function markerLabel(
  o: ReturnType<typeof useChoicePlan>['options'][number],
  sectionChoices: SectionChoice[],
): string {
  if (o.source.kind === 'plan') return o.source.label
  const sourceId = o.source.section_choice_id
  const choice = sectionChoices.find(c => c.id === sourceId)
  return choice ? truncate(choice.label, 50) : '(choix introuvable)'
}

function markerTarget(
  o: ReturnType<typeof useChoicePlan>['options'][number],
  sectionChoices: SectionChoice[],
): string {
  if (o.source.kind === 'plan') return `→ Plan ${o.source.target_plan_index + 1}`
  const sourceId = o.source.section_choice_id
  const choice = sectionChoices.find(c => c.id === sourceId)
  if (!choice) return ''
  return choice.target_section_number != null
    ? `→ §${choice.target_section_number}`
    : '→ (cible non définie)'
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
