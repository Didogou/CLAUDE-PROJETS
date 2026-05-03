'use client'
/**
 * Fold « Type d'animation » — choix du kind appliqué au calque actif.
 *
 * Règles UX :
 *   - Auto-ouvert via Sidebar quand aucun kind n'est encore défini
 *   - Auto-fermé via Sidebar dès qu'un kind est choisi
 *   - Ré-ouverture manuelle possible (re-clic sur le header)
 *   - Changer de kind : **reset les params** (chaque kind a ses propres),
 *     **garde le masque** (applicable quel que soit le kind)
 *   - Confirmation légère si des params étaient renseignés
 */
import React from 'react'
import { useEditorState } from '../EditorStateContext'
import {
  ANIMATION_KIND_LABELS,
  ANIMATION_KIND_HINTS,
  type LayerAnimationKind,
} from '../types'

const KIND_ORDER: LayerAnimationKind[] = [
  // Les 2 kinds câblés en priorité (cinemagraph = qualité supérieure, motion_brush
  // = rapide). Les autres suivent, fonctionnels = "à venir" dans FoldAnimationBake.
  'cinemagraph', 'motion_brush',
  'video_wan', 'wan_camera', 'travelling', 'derivation', 'latent_sync',
]

export default function FoldAnimationKind() {
  const { layers, activeLayerIdx, updateLayer } = useEditorState()
  const layer = layers[activeLayerIdx]
  const currentKind = layer?.animation?.kind
  const hasParams =
    layer?.animation?.params && Object.keys(layer.animation.params).length > 0

  function selectKind(kind: LayerAnimationKind) {
    if (kind === currentKind) return

    // Confirmation uniquement si des params avaient été renseignés (sinon
    // le changement est "gratuit" et la friction est inutile).
    if (currentKind && hasParams) {
      const ok = confirm(
        `Changer le type d'animation va réinitialiser les paramètres de « ${ANIMATION_KIND_LABELS[currentKind]} ». Le masque est conservé. Continuer ?`,
      )
      if (!ok) return
    }

    updateLayer(activeLayerIdx, {
      animation: {
        // On préserve le masque (applicable tous kinds), on reset params
        mask: layer?.animation?.mask ?? null,
        kind,
        params: {},
      },
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-2)' }}>
      {KIND_ORDER.map(kind => {
        const isActive = currentKind === kind
        return (
          <button
            key={kind}
            onClick={() => selectKind(kind)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 'var(--ie-space-1)',
              padding: 'var(--ie-space-2) var(--ie-space-3)',
              background: isActive ? 'var(--ie-accent-faint)' : 'var(--ie-surface)',
              border: `1px solid ${isActive ? 'var(--ie-accent)' : 'var(--ie-border)'}`,
              borderRadius: 'var(--ie-radius)',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
              transition: 'all var(--ie-transition)',
            }}
          >
            <span style={{
              fontSize: 'var(--ie-text-base)',
              fontWeight: 500,
              color: isActive ? 'var(--ie-accent-dark)' : 'var(--ie-text)',
            }}>
              {ANIMATION_KIND_LABELS[kind]}
            </span>
            <span style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)' }}>
              {ANIMATION_KIND_HINTS[kind]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
