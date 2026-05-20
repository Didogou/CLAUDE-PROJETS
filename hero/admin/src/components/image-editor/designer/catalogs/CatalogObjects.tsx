'use client'
/**
 * CatalogObjects v2 — panneau de la catégorie 'objects' du rail gauche.
 *
 * Ouverture : clic sur l'icône Objet du DesignerLeftRail.
 *
 * Contenu V1 (squelette) :
 *  1. Liste tile des objets de la section parente (lus depuis BDD via
 *     props `sectionItems`). Tile = miniature + nom. Click = ouvre la fiche.
 *     Drag-drop sur canvas (à venir) = positionne l'objet.
 *  2. Section "Ajout libre" : input texte pour ajouter un objet générique
 *     (ballon, etc.) via Qwen Edit (à venir, pour l'instant juste l'UI).
 *
 * À VENIR (steps suivants de la spec Objet) :
 *  - Drag-drop tile → canvas (step 7)
 *  - Pipeline branche selon illustration_url (step 8)
 *  - ItemCreatorModal au clic crayon (step 5)
 *  - Génération/Import image manquante (step 13)
 */

import React from 'react'
import { Loader2, Package, Pencil } from 'lucide-react'
import CatalogShell from './CatalogShell'

export interface SectionItem {
  id: string
  name: string
  illustration_url: string | null
  description: string | null
  item_type: string
  category?: string
}

interface CatalogObjectsProps {
  onClose: () => void
  /** Items du livre attachés à la section parente (filtre `sections_used`). */
  sectionItems: SectionItem[]
  /** Bouton "+ Nouveau" → callback pour ouvrir ItemCreatorModal en mode création. */
  onCreateNew?: () => void
  /** Click sur le crayon d'une tile → callback pour ouvrir ItemCreatorModal
   *  en mode édition sur l'item donné. */
  onEditItem?: (item: SectionItem) => void
}

export default function CatalogObjects({
  onClose, sectionItems, onCreateNew, onEditItem,
}: CatalogObjectsProps) {
  return (
    <CatalogShell title="📦 Objets de la section" onClose={onClose} showSearch={false}>
      {/* Zone 1 — Tiles des objets de la section ----------------------- */}
      <div className="dz-catalog-section">
        <div className="dz-catalog-section-title-row">
          <span className="dz-catalog-section-title">
            Objets ({sectionItems.length})
          </span>
          {onCreateNew && (
            <button
              type="button"
              className="dz-objects-new-btn"
              onClick={onCreateNew}
              title="Créer un nouvel objet"
            >
              + Nouveau
            </button>
          )}
        </div>

        {sectionItems.length === 0 ? (
          <div className="dz-objects-empty">
            Aucun objet attaché à cette section. Crée-en un avec « + Nouveau »
            ou modifie la fiche pour lier des objets existants.
          </div>
        ) : (
          <ul className="dz-objects-tiles">
            {sectionItems.map(item => (
              <li key={item.id}>
                <div
                  className={`dz-objects-tile${item.illustration_url ? '' : ' dz-objects-tile-empty'}`}
                  // V1 : drag-drop autorisé même sans illustration_url —
                  // dans ce cas la pipeline route vers Qwen Edit (texte seul)
                  // au lieu de Kontext multi-image. L'auteur peut compléter
                  // la fiche après pour préserver l'identité dans les
                  // futures insertions.
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('application/x-hero-item-id', item.id)
                    e.dataTransfer.setData('text/plain', item.name)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  title={item.description ?? item.name}
                >
                  {item.illustration_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.illustration_url} alt={item.name} className="dz-objects-tile-thumb" />
                  ) : (
                    <div className="dz-objects-tile-thumb dz-objects-tile-thumb-empty">
                      <Package size={22} />
                    </div>
                  )}
                  <span className="dz-objects-tile-name">{item.name}</span>
                  {onEditItem && (
                    <button
                      type="button"
                      className="dz-objects-tile-edit"
                      onClick={() => onEditItem(item)}
                      title="Modifier la fiche"
                      aria-label="Modifier"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Zone 2 — Ajout libre (V2 step 7+) ----------------------------- */}
      <div className="dz-catalog-section">
        <div className="dz-catalog-section-title">Ajout libre (objet générique)</div>
        <div className="dz-objects-freeadd-placeholder">
          <Loader2 size={14} />
          <span>À venir — input texte + Qwen Edit pour ajouter un objet sans fiche.</span>
        </div>
      </div>
    </CatalogShell>
  )
}
