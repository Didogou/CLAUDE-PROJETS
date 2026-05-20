'use client'
/**
 * ItemLayerInspector — panneau contextuel affiché en haut de l'inspector
 * du Designer quand le calque actif est un calque-objet (= a un `item_id`).
 *
 * Refonte Objet 2026-05-12 — steps 11+12.
 *
 * Actions :
 *   - "Baker dans la base" (step 11) : flatten le calque dans la base +
 *     sauve le PNG transparent dans items.illustration_url. L'objet acquiert
 *     son identité visuelle officielle. Les insertions futures dans d'autres
 *     scènes utiliseront cette ref via Kontext multi-image.
 *   - "Régénérer ici" (step 12) : re-lance Kontext multi-image avec la
 *     position actuelle du calque pour adapter ombres/lumière au nouveau
 *     placement. ~5-10 min.
 */

import React from 'react'
import { Loader2, Layers as LayersIcon, RefreshCw, Image as ImageIcon } from 'lucide-react'

interface ItemLayerInspectorProps {
  /** Nom de l'item lié au calque (affiché dans le titre). */
  itemName: string
  /** True si l'item a déjà une `illustration_url` officielle (= déjà baked
   *  ou créé via "Générer" dans la fiche). Conditionne le label du bouton
   *  Baker (Sauver l'identité vs Mettre à jour l'identité). */
  itemHasIllustration: boolean
  /** Action en cours sur le calque (bake ou regen). Verrouille les boutons. */
  busy?: 'bake' | 'regen' | null
  busyLabel?: string
  onBake: () => void
  onRegenerate: () => void
}

export default function ItemLayerInspector({
  itemName, itemHasIllustration, busy, busyLabel, onBake, onRegenerate,
}: ItemLayerInspectorProps) {
  const isBaking = busy === 'bake'
  const isRegen = busy === 'regen'
  const anyBusy = isBaking || isRegen

  return (
    <div className="dz-item-layer-inspector">
      <header className="dz-item-layer-header">
        <ImageIcon size={14} />
        <span className="dz-item-layer-name">{itemName}</span>
        <span className="dz-item-layer-tag">objet</span>
      </header>

      <div className="dz-item-layer-actions">
        <button
          type="button"
          className="dz-item-layer-btn dz-item-layer-btn-primary"
          onClick={onBake}
          disabled={anyBusy}
          title={
            itemHasIllustration
              ? 'Aplatit le calque dans la base et met à jour l\'image officielle de l\'objet'
              : 'Aplatit le calque dans la base et fixe cette image comme identité officielle de l\'objet'
          }
        >
          {isBaking ? (
            <>
              <Loader2 size={13} className="dz-item-layer-spin" />
              <span>{busyLabel || 'Bake…'}</span>
            </>
          ) : (
            <>
              <LayersIcon size={13} />
              <span>{itemHasIllustration ? 'Mettre à jour l\'image officielle' : 'Baker (fixer l\'identité)'}</span>
            </>
          )}
        </button>

        <button
          type="button"
          className="dz-item-layer-btn dz-item-layer-btn-ghost"
          onClick={onRegenerate}
          disabled={anyBusy}
          title="Re-lance Kontext multi-image à la position actuelle pour adapter ombres/lumière (~5-10 min)"
        >
          {isRegen ? (
            <>
              <Loader2 size={13} className="dz-item-layer-spin" />
              <span>{busyLabel || 'Régen…'}</span>
            </>
          ) : (
            <>
              <RefreshCw size={13} />
              <span>Régénérer ici</span>
            </>
          )}
        </button>
      </div>

      <div className="dz-item-layer-hint">
        {itemHasIllustration
          ? 'L\'objet a déjà une image officielle. Bake = mettre à jour avec la version actuelle.'
          : 'Bake pour donner à cet objet son identité visuelle (réutilisable dans d\'autres scènes).'}
      </div>
    </div>
  )
}
