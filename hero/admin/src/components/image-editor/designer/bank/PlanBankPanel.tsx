'use client'
/**
 * PlanBankPanel — banque d'images/animations qui s'auto-ouvre à la création
 * d'un nouveau plan dans le Studio Designer.
 *
 * Décisions sources (cf MEMORY.md) :
 *   - `project_plan_kind_data_model.md` : ségrégation totale, vignette anim
 *     ▶️+galerie, modale 3 boutons (intégrée dans la vignette ici)
 *   - `project_plan_bank_order.md` : ordre 1) plans section en cours,
 *     2) transitions amont, 3) autres sections, 4) recherche, 5) upload
 *   - `project_plan_tags_strategy.md` : tags hybrides (auto + manuel + Qwen VL)
 *
 * V1 : composant **présentationnel pur**, le caller fournit les données via
 * props (responsabilité de fetch hors composant). Permet de tester en page
 * isolée avec mocks et d'intégrer dans le book editor sans refacto.
 *
 * Phase 3b à venir : recherche par tags + upload externe + Qwen VL suggestion.
 */

import React, { useState, useMemo } from 'react'
import { Play, Plus, Upload, X, Search, Image as ImageIcon, Film, Sparkles } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────

/** Item affichable dans la banque. */
export interface PlanBankItem {
  /** Identifiant unique (sectionId+planIdx, choiceId, ou bankUploadId selon source) */
  id: string
  kind: 'image' | 'animation'
  /** URL de l'image (kind='image') OU 1ère frame de l'animation (kind='animation') */
  thumbnailUrl: string
  /** UNIQUEMENT si kind='animation' : URL du MP4 */
  videoUrl?: string
  /** UNIQUEMENT si kind='animation' : URL dernière frame (état figé) */
  lastFrameUrl?: string
  /** Pour debug/affichage : nom court (ex: "Section 12 / plan 2") */
  label?: string
  /** Tags pour recherche (V1 = juste affichés en tooltip, recherche en Phase 3b) */
  tags?: string[]
  /** Origine : pour grouper et afficher la source */
  source: 'current_section' | 'transition_to_current' | 'other_section' | 'bank_upload'
}

/** Sélection émise au clic. Pour kind='image' → 'whole'.
 *  Pour kind='animation' → 'whole' (anim entière) | 'first' | 'last' (frames). */
export type SelectionMode = 'whole' | 'first' | 'last'
export interface PlanBankSelection {
  item: PlanBankItem
  mode: SelectionMode
}

interface PlanBankPanelProps {
  items: PlanBankItem[]
  /** Permet de filtrer la recherche en V1 (sur tags + label). */
  searchEnabled?: boolean
  /** Callback à la sélection d'un item (clic principal vignette ou frame de la galerie). */
  onSelect: (selection: PlanBankSelection) => void
  /** Callback "Générer image AI" (ouvre le form de génération image). */
  onGenerateImage?: () => void
  /** Callback "Générer animation AI" (ouvre CatalogAnimation storyboard). */
  onGenerateAnimation?: () => void
  /** Callback "Upload externe" (Phase 3b — ouvre file picker). */
  onUploadExternal?: () => void
  /** Callback "Fermer" la banque. */
  onClose?: () => void
}

// ─── Section labels ───────────────────────────────────────────────────────

const SOURCE_LABELS: Record<PlanBankItem['source'], { label: string; icon: React.ReactNode; hint: string }> = {
  current_section:        { label: 'Plans de cette section',     icon: <Sparkles size={11} />, hint: 'continuité intra-section' },
  transition_to_current:  { label: 'Transitions vers ici',       icon: <Sparkles size={11} />, hint: 'images de transitions amont' },
  other_section:          { label: 'Autres sections',            icon: <Sparkles size={11} />, hint: 'récents du livre' },
  bank_upload:            { label: 'Uploads externes',           icon: <Upload size={11} />,   hint: 'images hors sections' },
}
const SOURCE_ORDER: PlanBankItem['source'][] = [
  'current_section',
  'transition_to_current',
  'other_section',
  'bank_upload',
]

// ─── Composant ────────────────────────────────────────────────────────────

export default function PlanBankPanel({
  items, searchEnabled = true,
  onSelect, onGenerateImage, onGenerateAnimation, onUploadExternal, onClose,
}: PlanBankPanelProps) {
  const [search, setSearch] = useState('')

  // Filtre par texte (V1 : sur label + tags)
  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(it => {
      if (it.label?.toLowerCase().includes(q)) return true
      if (it.tags?.some(t => t.toLowerCase().includes(q))) return true
      return false
    })
  }, [items, search])

  // Groupage par source dans l'ordre canonique
  const groupedBySource = useMemo(() => {
    const map = new Map<PlanBankItem['source'], PlanBankItem[]>()
    for (const src of SOURCE_ORDER) map.set(src, [])
    for (const it of filtered) map.get(it.source)?.push(it)
    return SOURCE_ORDER.map(src => ({ source: src, items: map.get(src) ?? [] }))
  }, [filtered])

  return (
    <div className="pbp-root">
      {/* Header */}
      <div className="pbp-header">
        <div className="pbp-title">
          <ImageIcon size={14} />
          <span>Banque d'images</span>
        </div>
        {onClose && (
          <button type="button" className="pbp-close" onClick={onClose} aria-label="Fermer">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Actions de génération (en haut, anti-friction) */}
      <div className="pbp-actions">
        {onGenerateImage && (
          <button type="button" className="pbp-action" onClick={onGenerateImage}>
            <ImageIcon size={13} />
            <span>Générer image AI</span>
          </button>
        )}
        {onGenerateAnimation && (
          <button type="button" className="pbp-action pbp-action-anim" onClick={onGenerateAnimation}>
            <Film size={13} />
            <span>Générer animation AI</span>
          </button>
        )}
        {onUploadExternal && (
          <button type="button" className="pbp-action pbp-action-upload" onClick={onUploadExternal}>
            <Upload size={13} />
            <span>Upload</span>
          </button>
        )}
      </div>

      {/* Recherche */}
      {searchEnabled && (
        <div className="pbp-search">
          <Search size={12} className="pbp-search-icon" />
          <input
            type="text"
            placeholder="Rechercher par tag, nom…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pbp-search-input"
          />
        </div>
      )}

      {/* Sections groupées */}
      <div className="pbp-groups">
        {groupedBySource.map(({ source, items: groupItems }) => {
          if (groupItems.length === 0) return null
          const meta = SOURCE_LABELS[source]
          return (
            <div key={source} className="pbp-group">
              <div className="pbp-group-title">
                {meta.icon}
                <span className="pbp-group-label">{meta.label}</span>
                <span className="pbp-group-count">{groupItems.length}</span>
                <span className="pbp-group-hint">{meta.hint}</span>
              </div>
              <div className="pbp-grid">
                {groupItems.map(it => (
                  <BankCard
                    key={`${it.source}-${it.id}`}
                    item={it}
                    onSelect={mode => onSelect({ item: it, mode })}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="pbp-empty">
            {search.trim()
              ? `Aucun résultat pour "${search}"`
              : 'Banque vide. Génère un plan ou uploade une image pour commencer.'}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Carte vignette ───────────────────────────────────────────────────────

interface BankCardProps {
  item: PlanBankItem
  onSelect: (mode: SelectionMode) => void
}

function BankCard({ item, onSelect }: BankCardProps) {
  const isAnimation = item.kind === 'animation'

  return (
    <div className="pbp-card">
      {/* Vignette principale (clic = sélectionner l'asset entier) */}
      <button
        type="button"
        className="pbp-card-main"
        onClick={() => onSelect('whole')}
        title={isAnimation ? 'Utiliser l\'animation entière' : 'Utiliser cette image'}
      >
        <img src={item.thumbnailUrl} alt={item.label ?? ''} className="pbp-card-img" />
        {isAnimation && (
          <div className="pbp-card-play-overlay" aria-hidden>
            <Play size={20} fill="currentColor" />
          </div>
        )}
        {/* Badge type */}
        <div className={`pbp-card-badge ${isAnimation ? 'anim' : 'img'}`}>
          {isAnimation ? <Film size={9} /> : <ImageIcon size={9} />}
          <span>{isAnimation ? 'Anim' : 'Image'}</span>
        </div>
      </button>

      {/* Mini-galerie (uniquement si animation) : Image début / Image fin */}
      {isAnimation && (
        <div className="pbp-card-gallery">
          <button
            type="button"
            className="pbp-card-gal-btn"
            onClick={() => onSelect('first')}
            title="Copier la 1ère image (état initial)"
          >
            <img
              src={item.thumbnailUrl}
              alt="première"
              className="pbp-card-gal-thumb"
            />
            <span className="pbp-card-gal-label">Début</span>
          </button>
          {item.lastFrameUrl && (
            <button
              type="button"
              className="pbp-card-gal-btn"
              onClick={() => onSelect('last')}
              title="Copier la dernière image (état final)"
            >
              <img
                src={item.lastFrameUrl}
                alt="dernière"
                className="pbp-card-gal-thumb"
              />
              <span className="pbp-card-gal-label">Fin</span>
            </button>
          )}
        </div>
      )}

      {/* Label */}
      {item.label && (
        <div className="pbp-card-label">{item.label}</div>
      )}
    </div>
  )
}
