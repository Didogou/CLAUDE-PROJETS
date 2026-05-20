'use client'
/**
 * SectionTimeline — composant central du tab Storyboard.
 *
 * Affiche 3 pistes parallèles (table de mixage) :
 *   - VISUEL  : cellules Plans + bouton "+ Plan" dropdown
 *   - MUSIQUE : blocs musique alignés aux Plans (V0 mock — mapping naïf)
 *   - CHOIX   : marqueurs là où l'effet "Choix" est actif sur un Plan
 *
 * V0 : largeur de chaque colonne = largeur fixe du Plan cell (12rem). La
 * "synchro" entre pistes est visuelle, pas piloté par un timeline scrub
 * unique. Phase ultérieure : axe temporel partagé pour vrai DAW behavior.
 */

import React from 'react'
import PlanCell from './PlanCell'
import PlanAddDropdown from './PlanAddDropdown'
import type { Plan, PlanType, SectionMusicBlock } from './types'

/** Largeur d'1 cellule Plan (utilisée pour aligner les blocs sur les pistes
 *  musique/choix qui doivent matcher la position d'un Plan donné). */
const CELL_WIDTH = '12rem'

interface SectionTimelineProps {
  plans: Plan[]
  musicBlocks: SectionMusicBlock[]
  selectedPlanId: string | null
  onSelectPlan: (planId: string) => void
  onCreatePlan: (type: PlanType) => void
  /** Demande de suppression — le parent ouvre ConfirmDialog. */
  onRequestDeletePlan?: (planId: string) => void
  /** Click sur "Éditer" d'une PlanCell — le parent navigue vers Studio Designer. */
  onEditPlan?: (planId: string) => void
}

export default function SectionTimeline({
  plans,
  musicBlocks,
  selectedPlanId,
  onSelectPlan,
  onCreatePlan,
  onRequestDeletePlan,
  onEditPlan,
}: SectionTimelineProps) {
  return (
    <div className="ss-timeline">

      {/* ─── PISTE VISUEL (Plans + tuile + Plan) ──────────────────────── */}
      <div className="ss-timeline-track">
        <div className="ss-track-content">
          {plans.map(plan => (
            <PlanCell
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedPlanId}
              onSelect={onSelectPlan}
              onRequestDelete={onRequestDeletePlan}
              onEdit={onEditPlan}
            />
          ))}
          <PlanAddDropdown onCreate={onCreatePlan} />
        </div>
      </div>

      {/* ─── PISTE MUSIQUE (blocs alignés sur les Plans + slot + piste) ── */}
      <div className="ss-timeline-track">
        <div className="ss-track-content">
          {plans.map((plan, idx) => {
            const block = findMusicBlockAt(musicBlocks, idx)
            if (block) {
              // Bloc musique : on le rend SEULEMENT à son fromPlanIdx (pour
              // éviter doublons). Largeur étirée selon le span de plans couverts.
              if (idx === block.fromPlanIdx) {
                const span = block.toPlanIdx - block.fromPlanIdx + 1
                // Largeur = N cells + (N-1) gaps de 10px (le gap CSS de track-content)
                const width = `calc(${span} * ${CELL_WIDTH} + ${(span - 1) * 10}px)`
                return (
                  <div
                    key={`music-${block.id}`}
                    className="ss-music-block"
                    style={{ width }}
                    title={block.label}
                  >
                    <span>♪</span>
                    <span>{block.label}</span>
                  </div>
                )
              }
              // Plan couvert par un bloc qui démarre avant : rien à rendre.
              return null
            }
            // Pas de musique sur ce Plan → bouton "+ piste"
            return (
              <button
                key={`music-empty-${plan.id}`}
                className="ss-music-add"
                style={{ width: CELL_WIDTH }}
                onClick={() => console.info(`[SectionTimeline] add music for plan ${plan.id} — TODO Phase 2`)}
              >
                ♪ + piste pour P{plan.order}
              </button>
            )
          })}
          {/* Espacement pour aligner avec la tuile + Plan (largeur 12rem) */}
          <div style={{ width: CELL_WIDTH, flex: '0 0 auto' }} />
        </div>
      </div>

      {/* ─── PISTE CHOIX (marqueurs sous les Plans qui ont l'effet Choix) ── */}
      <div className="ss-timeline-track">
        <div className="ss-track-content">
          {plans.map(plan => {
            if (plan.hasChoiceEffect) {
              return (
                <div
                  key={`choice-${plan.id}`}
                  className="ss-choice-marker"
                  style={{ width: CELL_WIDTH }}
                  title="Effet Choix actif — affiche les choix de Section au runtime"
                >
                  <span>⊕ Choix Section</span>
                </div>
              )
            }
            return (
              <div
                key={`choice-empty-${plan.id}`}
                className="ss-choice-marker-empty"
                style={{ width: CELL_WIDTH }}
              />
            )
          })}
          <div className="ss-choice-marker-empty" style={{ width: CELL_WIDTH }} />
        </div>
      </div>

    </div>
  )
}

/** Trouve le bloc musique qui couvre l'index `planIdx` (s'il existe). */
function findMusicBlockAt(blocks: SectionMusicBlock[], planIdx: number): SectionMusicBlock | null {
  return blocks.find(b => planIdx >= b.fromPlanIdx && planIdx <= b.toPlanIdx) ?? null
}
