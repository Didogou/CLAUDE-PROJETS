'use client'
/**
 * CatalogPlaceholder — utilisé pour les catégories pas encore implémentées
 * (Banques, Génération AI, Animations, Édition, Annotations, Audio).
 *
 * Affiche un message structuré qui décrit ce que la catégorie contiendra,
 * pour que l'utilisateur ait une idée claire de ce qui s'en vient.
 *
 * Sera remplacé par les vrais composants au fil des sprints.
 */

import React from 'react'
import CatalogShell from './CatalogShell'

interface CatalogPlaceholderProps {
  title: React.ReactNode
  onClose: () => void
  description: string
  upcoming: string[]
}

export default function CatalogPlaceholder({
  title,
  onClose,
  description,
  upcoming,
}: CatalogPlaceholderProps) {
  return (
    <CatalogShell title={title} onClose={onClose} showSearch={false}>
      <div className="dz-catalog-placeholder">
        <p className="dz-catalog-placeholder-desc">{description}</p>
        <div className="dz-catalog-placeholder-upcoming">
          <div className="dz-catalog-section-title">Prévu dans cette catégorie</div>
          <ul>
            {upcoming.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="dz-catalog-placeholder-tag">Phase suivante du roadmap</div>
      </div>
    </CatalogShell>
  )
}
