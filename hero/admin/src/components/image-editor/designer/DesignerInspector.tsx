'use client'
/**
 * DesignerInspector — panneau droite collapsible (~320px ↔ 32px).
 *
 * Affiche les paramètres du calque actuellement sélectionné. Phase 2 : on
 * réutilisera les fold components existants (FoldAtmosphere, etc.) en les
 * rendant ICI au lieu de la sidebar gauche.
 *
 * Phase 1 : structure minimale + toggle collapse/expand. Le contenu enfant
 * est passé en `children` pour que le parent décide quoi afficher selon le
 * calque actif.
 */

import React from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'

interface DesignerInspectorProps {
  /** État replié (32px) ou déplié (~320px). Géré par le parent. */
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Titre affiché dans le header (ex: "🌧 Pluie forte"). null = "Pas de calque" */
  title: React.ReactNode
  /** Contenu du panneau (params du calque, sliders, etc.). En Phase 2 = rendu
   *  des fold components existants. En Phase 1 = placeholder. */
  children?: React.ReactNode
}

export default function DesignerInspector({ collapsed, onToggleCollapsed, title, children }: DesignerInspectorProps) {
  return (
    <aside className={`dz-inspector${collapsed ? ' collapsed' : ''}`} aria-label="Paramètres du calque">
      <button
        type="button"
        className="dz-inspector-toggle"
        onClick={onToggleCollapsed}
        title={collapsed ? 'Déplier l’inspecteur' : 'Replier l’inspecteur'}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {!collapsed && (
        <>
          <header className="dz-inspector-header">{title}</header>
          <div className="dz-inspector-body">{children}</div>
        </>
      )}
    </aside>
  )
}
