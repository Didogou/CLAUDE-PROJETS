'use client'
/**
 * AnimationStudioRail — rail vertical à gauche avec icônes catégories.
 *
 * Refonte 2026-05-07 : minimalist, juste 2 boutons (Persos + Banque images).
 * Refonte 2026-05-15ca : retrait du bouton ✨ Effets — la modale Effets est
 * désormais accessible uniquement via hover (banque + bloc timeline).
 * Click toggle l'ouverture du drawer correspondant. Click bouton actif = ferme.
 */

import React from 'react'
import { Users, Image as ImageIcon } from 'lucide-react'

interface AnimationStudioRailProps {
  drawer: 'closed' | 'characters' | 'images'
  onOpenCharacters: () => void
  onOpenImages: () => void
}

export default function AnimationStudioRail({
  drawer, onOpenCharacters, onOpenImages,
}: AnimationStudioRailProps) {
  return (
    <nav className="as-rail" aria-label="Banques">
      <button
        type="button"
        className={`as-rail-btn ${drawer === 'characters' ? 'active' : ''}`}
        onClick={onOpenCharacters}
        title="Banque de personnages"
        aria-pressed={drawer === 'characters'}
      >
        <Users size={18} />
      </button>
      <button
        type="button"
        className={`as-rail-btn ${drawer === 'images' ? 'active' : ''}`}
        onClick={onOpenImages}
        title="Banque d'images"
        aria-pressed={drawer === 'images'}
      >
        <ImageIcon size={18} />
      </button>
    </nav>
  )
}
