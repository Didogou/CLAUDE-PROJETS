'use client'
/**
 * SectionTile — tuile section dans la grille du Studio Creator (tab Sections).
 *
 * Affiche : thumb (image preview ou placeholder) + numéro §NN + status badge
 * + type badge + ending marker si applicable + titre + summary + nb plans.
 * Click → callback navigation vers Studio Section.
 */

import React from 'react'
import { ImageOff, Pencil, ChevronDown } from 'lucide-react'
import {
  type SectionSummary,
  SECTION_STATUS_LABEL,
  SECTION_TYPE_BY_KEY,
} from './types'

interface SectionTileProps {
  section: SectionSummary
  /** Click sur le corps de la tuile = toggle expand (refonte UX 2026-05-12).
   *  Affiche les plans de la section en mini-tiles dans le panneau qui s'ouvre. */
  onToggleExpand: (sectionId: string) => void
  /** Click sur le bouton crayon = "Éditer la section" (= ouvrir Studio Section
   *  comme avant). */
  onOpen: (sectionId: string) => void
  /** True si cette tuile est actuellement étendue (= panneau plans visible). */
  expanded: boolean
  /** True si cette tuile vient d'être fermée — affiche un highlight rose
   *  pour signaler "tu viens de visiter ça". Disparaît au prochain expand. */
  recentlyVisited?: boolean
}

export default function SectionTile({
  section, onToggleExpand, onOpen, expanded, recentlyVisited,
}: SectionTileProps) {
  const typeOpt = SECTION_TYPE_BY_KEY[section.type ?? 'narration']

  return (
    <div
      className={`sc-tile${expanded ? ' sc-tile-expanded' : ''}${recentlyVisited ? ' sc-tile-recently-visited' : ''}`}
      data-section-id={section.id}
      onClick={() => onToggleExpand(section.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggleExpand(section.id)
        }
      }}
      title={section.title ?? `Section ${section.number}`}
    >
      <div className="sc-tile-thumb">
        {section.thumbUrl ? (
          <img src={section.thumbUrl} alt={section.title ?? `Section ${section.number}`} />
        ) : (
          <div className="sc-tile-thumb-placeholder">
            <ImageOff size={28} />
          </div>
        )}
        <span className="sc-tile-num">§{String(section.number).padStart(2, '0')}</span>
        <span className={`sc-tile-status ${section.status}`}>
          {SECTION_STATUS_LABEL[section.status]}
        </span>
        <span className="sc-tile-type-badge" style={{ color: typeOpt.color }}>
          {typeOpt.icon} {typeOpt.label}
        </span>
        {section.isEnding && (
          <span className="sc-tile-ending-marker">FIN</span>
        )}
        {/* Bouton Éditer — overlay top-right de la thumb, distinct du toggle expand. */}
        <button
          type="button"
          className="sc-tile-edit"
          onClick={e => { e.stopPropagation(); onOpen(section.id) }}
          title="Éditer la section (ouvrir Studio Section)"
          aria-label="Éditer la section"
        >
          <Pencil size={14} />
        </button>
      </div>
      <div className="sc-tile-body">
        <div className="sc-tile-title">
          {section.title || <span style={{ color: 'var(--ie-text-faint)', fontStyle: 'italic' }}>Sans titre</span>}
        </div>
        {section.summary && (
          <div className="sc-tile-summary">{section.summary}</div>
        )}
        <div className="sc-tile-meta">
          <span>🎞 {section.numPlans} plan{section.numPlans > 1 ? 's' : ''}</span>
          <ChevronDown size={14} className={`sc-tile-chevron${expanded ? ' rotated' : ''}`} />
        </div>
      </div>
    </div>
  )
}
