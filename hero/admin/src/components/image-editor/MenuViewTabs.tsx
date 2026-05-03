'use client'
/**
 * Onglets de vues du menu — en haut de la sidebar, au même niveau Y que les
 * LayerTabs de la colonne canvas.
 *
 * Chaque calque mémorise sa dernière vue (`EditorLayer.activeView`) : basculer
 * entre calques restaure la vue précédemment utilisée. Défaut : 'image'.
 *
 * Hauteur : `var(--ie-tab-height)` — identique aux LayerTabs, garantit
 * l'alignement des deux rangées au même Y.
 */
import React from 'react'
import type { MenuView } from './types'
import { useEditorState } from './EditorStateContext'

const ACTIVE_TRAIT_COLOR = 'var(--ie-accent)'

const VIEWS: { id: MenuView; label: string }[] = [
  { id: 'image',     label: 'Image' },
  { id: 'animation', label: 'Animation' },
]

interface MenuViewTabsProps {
  /** Quand rendu à l'INTÉRIEUR d'un conteneur déjà étendu aux bords de la
   *  sidebar (ex : StickyLayerHeader), les negative margins par défaut
   *  provoquent un double-débordement → tab collé au bord. `embedded: true`
   *  supprime ces margins et ajoute un paddingLeft pour aligner sur le
   *  contenu principal de la sidebar (ex : le nom "Base" du header). */
  embedded?: boolean
}

export default function MenuViewTabs({ embedded = false }: MenuViewTabsProps = {}) {
  const { layers, activeLayerIdx, setActiveLayerView } = useEditorState()
  const isBase = activeLayerIdx === 0
  // Sur la Base, on ne montre que l'onglet Image (la Base est statique —
  // les animations vivent sur des calques additionnels).
  const visibleViews = isBase ? VIEWS.filter(v => v.id === 'image') : VIEWS
  // Safety : si la base hérite d'un activeView='animation' (cas théorique
  // via historique ou données importées), on force le rendu sur 'image'.
  const activeView: MenuView = isBase ? 'image' : (layers[activeLayerIdx]?.activeView ?? 'image')

  function selectView(view: MenuView) {
    if (view === activeView) return
    setActiveLayerView(view)
  }

  // Padding horizontal dépend du contexte :
  //   - autonome (legacy) : les negative margins annulent le padding sidebar,
  //     padding intérieur var(--ie-space-3) aligne avec les tabs de calques.
  //   - embedded : pas de negative margins, padding-left aligne avec le contenu
  //     principal de la sidebar (titre "Base" à var(--ie-space-4)), moins le
  //     padding intérieur du bouton (var(--ie-space-3)).
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 0,
        padding: embedded
          ? '0 var(--ie-space-1) 0 calc(var(--ie-space-4) - var(--ie-space-3))'
          : '0 var(--ie-space-3)',
        height: 'var(--ie-tab-height)',
        background: 'var(--ie-surface-2)',
        borderBottom: '1px solid var(--ie-border)',
        flexShrink: 0,
        width: 'auto',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        // Négatif sur les 3 côtés qui subissent le padding de .ie-sidebar-left
        // (var(--ie-space-4) = 1rem) → uniquement en mode autonome.
        ...(embedded ? {} : {
          marginLeft: 'calc(-1 * var(--ie-space-4))',
          marginRight: 'calc(-1 * var(--ie-space-4))',
          marginTop: 'calc(-1 * var(--ie-space-4))',
        }),
      }}
    >
      {visibleViews.map(view => {
        const isActive = view.id === activeView
        return (
          <button
            key={view.id}
            onClick={() => selectView(view.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--ie-space-2)',
              height: 'var(--ie-tab-inner-height)',
              padding: '0 var(--ie-space-3)',
              background: isActive ? 'var(--ie-bg)' : 'transparent',
              border: 'none',
              borderTop: `0.1875rem solid ${isActive ? ACTIVE_TRAIT_COLOR : 'transparent'}`,
              borderTopLeftRadius: 'var(--ie-radius)',
              borderTopRightRadius: 'var(--ie-radius)',
              cursor: 'pointer',
              opacity: isActive ? 1 : 0.55,
              filter: isActive ? 'none' : 'saturate(0.6)',
              marginBottom: -1,
              fontSize: 'var(--ie-text-sm)',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--ie-text)' : 'var(--ie-text-muted)',
              transition: 'background 150ms, opacity 150ms, filter 150ms',
              flexShrink: 0,
              userSelect: 'none',
              fontFamily: 'inherit',
            }}
          >
            {view.label}
          </button>
        )
      })}
    </div>
  )
}
