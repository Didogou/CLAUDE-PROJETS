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
import { Image as ImageIcon, Sparkles, CloudRain, Film, MessageSquare, Volume2, Package, Users } from 'lucide-react'
import type { DesignerPhase } from './types'

export type RailCategory =
  | 'banks'
  | 'generate'
  | 'effects'
  | 'animations'
  | 'edit'
  | 'annotations'
  | 'audio'
  | 'objects'
  | 'characters'

interface RailItem {
  key: RailCategory
  icon: React.ReactNode
  label: string
  tooltip: string
}

const RAIL_ITEMS: RailItem[] = [
  { key: 'banks',       icon: <ImageIcon size={18} />,    label: 'Banques',     tooltip: 'Banques (images, NPCs, objets…)' },
  { key: 'generate',    icon: <Sparkles size={18} />,     label: 'Génération',  tooltip: 'Génération AI (image, vidéo, son…)' },
  { key: 'characters',  icon: <Users size={18} />,        label: 'Personnages', tooltip: 'Personnages du plan + persos de la section disponibles' },
  { key: 'objects',     icon: <Package size={18} />,      label: 'Objets',      tooltip: 'Objets de la section (positionner sur l\'image)' },
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
  /** Mode extraction actif (refonte 2026-05-09) : aucune catégorie du rail
   *  ne s'applique à un calque extraction (pas d'effets, pas d'animations, pas
   *  d'audio…). Toutes les icônes sont dimmées + tooltip explicite. L'auteur
   *  doit revenir sur un autre calque pour accéder à ces outils. */
  extractionMode?: boolean
  /** Badges affichés sur les icônes du rail (refonte Objet 2026-05-12).
   *  Exemple : { objects: { positioned: 1, total: 3 } } affiche "1/3" sur
   *  l'icône Objets. */
  badges?: Partial<Record<RailCategory, { positioned: number; total: number }>>
}

export default function DesignerLeftRail({
  activeCategory, onToggleCategory, phase = 'editing', extractionMode = false, badges,
}: DesignerLeftRailProps) {
  const isCreationPhase = phase === 'creation'

  return (
    <div className="dz-rail" role="toolbar" aria-label="Catégories d'ajout">
      {RAIL_ITEMS.map(item => {
        const isActive = activeCategory === item.key
        // En Phase A, seule la banque reste cliquable. Les autres sont dimmées
        // (apparaîtront pleinement après Commencer).
        // En mode extraction, TOUTES les catégories sont dimmées : un calque
        // extraction est dédié à l'extraction de sujets, pas à l'application
        // d'effets / animations / etc.
        const isDimmed = (isCreationPhase && item.key !== 'banks') || extractionMode
        const isHighlighted = isCreationPhase && item.key === 'banks'

        const badge = badges?.[item.key]
        // Affiche le badge UNIQUEMENT si total > 0 (= au moins 1 élément à
        // tracker). Format "X/Y" si X < Y, "✓ Y" en accent si tout positionné.
        const showBadge = !!badge && badge.total > 0
        const badgeAllDone = showBadge && badge!.positioned >= badge!.total

        return (
          <button
            key={item.key}
            type="button"
            className={`dz-rail-btn${isActive || isHighlighted ? ' active' : ''}${isDimmed ? ' dimmed' : ''}`}
            onClick={() => { if (!isDimmed) onToggleCategory(item.key) }}
            disabled={isDimmed}
            title={
              extractionMode
                ? `${item.label} — non disponible sur un calque d'extraction`
                : isDimmed
                  ? `${item.label} — disponible après "Commencer l'édition"`
                  : showBadge
                    ? `${item.label} — ${badge!.positioned}/${badge!.total} positionnés sur cette image`
                    : item.tooltip
            }
            aria-pressed={isActive}
            aria-label={item.label}
          >
            <span className="dz-rail-icon">{item.icon}</span>
            {showBadge && (
              <span className={`dz-rail-badge${badgeAllDone ? ' dz-rail-badge-done' : ''}`}>
                {badge!.positioned}/{badge!.total}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
