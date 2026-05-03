'use client'
/**
 * DesignerLeftRail — rail vertical étroit (48px) avec 7 catégories permanentes.
 *
 * Pattern Canva / Figma plugins / VSCode activity bar.
 *
 * Chaque clic sur une catégorie ouvre/ferme le DesignerCatalog (panneau
 * secondaire à droite du rail). La catégorie active a une barre verticale
 * accent à gauche (style "tab actif" Notion/VSCode).
 *
 * Pas de Studio Creator ni Réglages dans le rail (vivent dans le Creator).
 */

import React from 'react'
import { Image as ImageIcon, Sparkles, CloudRain, Film, MessageSquare, Volume2 } from 'lucide-react'
import type { DesignerPhase } from './types'

export type RailCategory =
  | 'banks'
  | 'generate'
  | 'effects'
  | 'animations'
  | 'edit'
  | 'annotations'
  | 'audio'

interface RailItem {
  key: RailCategory
  icon: React.ReactNode
  label: string
  tooltip: string
}

const RAIL_ITEMS: RailItem[] = [
  { key: 'banks',       icon: <ImageIcon size={18} />,    label: 'Banques',     tooltip: 'Banques (images, NPCs, objets…)' },
  { key: 'generate',    icon: <Sparkles size={18} />,     label: 'Génération',  tooltip: 'Génération AI (image, vidéo, son…)' },
  { key: 'effects',     icon: <CloudRain size={18} />,    label: 'Effets',      tooltip: 'Effets visuels (atmosphère, particles…)' },
  { key: 'animations',  icon: <Film size={18} />,         label: 'Animations',  tooltip: 'Animations (Lottie, GSAP, transitions)' },
  // ❌ 'edit' retiré du rail : Découpe + Crop + Filtres sont maintenant des
  // actions dans la DesignerActionsToolbar au-dessus du canvas (cohérent avec
  // leur nature "action sur l'image rendue", pas "catégorie de calque").
  { key: 'annotations', icon: <MessageSquare size={18} />,label: 'Annotations', tooltip: 'Annotations narratives (choix, dialogues)' },
  { key: 'audio',       icon: <Volume2 size={18} />,      label: 'Audio',       tooltip: 'Sons & musiques' },
]

interface DesignerLeftRailProps {
  /** Catégorie active (catalogue ouvert sur cette catégorie). null = aucune. */
  activeCategory: RailCategory | null
  /** Toggle d'une catégorie : ouvre si fermée, ferme si déjà ouverte. */
  onToggleCategory: (key: RailCategory) => void
  /** Phase courante du Designer. En 'creation', seule la banque (1ère icône)
   * est active : les autres catégories sont dimmées (apparaissent après Commencer). */
  phase?: DesignerPhase
}

export default function DesignerLeftRail({
  activeCategory, onToggleCategory, phase = 'editing',
}: DesignerLeftRailProps) {
  const isCreationPhase = phase === 'creation'

  return (
    <div className="dz-rail" role="toolbar" aria-label="Catégories d'ajout">
      {RAIL_ITEMS.map(item => {
        const isActive = activeCategory === item.key
        // En Phase A, seule la banque reste cliquable. Les autres sont dimmées
        // (apparaîtront pleinement après Commencer).
        const isDimmed = isCreationPhase && item.key !== 'banks'
        const isHighlighted = isCreationPhase && item.key === 'banks'

        return (
          <button
            key={item.key}
            type="button"
            className={`dz-rail-btn${isActive || isHighlighted ? ' active' : ''}${isDimmed ? ' dimmed' : ''}`}
            onClick={() => { if (!isDimmed) onToggleCategory(item.key) }}
            disabled={isDimmed}
            title={isDimmed
              ? `${item.label} — disponible après "Commencer l'édition"`
              : item.tooltip}
            aria-pressed={isActive}
            aria-label={item.label}
          >
            <span className="dz-rail-icon">{item.icon}</span>
          </button>
        )
      })}
    </div>
  )
}
