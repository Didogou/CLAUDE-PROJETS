'use client'
/**
 * VariantsStrip — carrousel horizontal des variantes candidates pour la base.
 *
 * Refonte Phase 6b (modèle 2 phases) :
 *  - Accepte des DesignerVariant (banque OU générées) dans la même collection
 *  - Chaque tuile a : badge source (📁 banque ou ✨ modèle), checkbox Référence,
 *    bouton delete au hover
 *  - Référence en mode radio (1-at-a-time, V1 = img2img simple)
 *
 * Vit dans le drawer bottom de DesignerLayout en Phase A uniquement.
 */

import React from 'react'
import { motion } from 'framer-motion'
import { Loader2, AlertCircle, Check, X, FolderOpen, Sparkles } from 'lucide-react'
import type { DesignerVariant } from './types'

interface VariantsStripProps {
  variants: DesignerVariant[]
  /** ID de la variante actuellement affichée au centre */
  selectedId?: string | null
  /** Callback quand l'utilisateur clique une vignette done */
  onSelect: (variant: DesignerVariant) => void
  /** Callback pour cocher une variante comme référence (radio : 1 à la fois) */
  onToggleReference: (variantId: string) => void
  /** Callback pour supprimer une variante */
  onDelete: (variantId: string) => void
}

export default function VariantsStrip({
  variants, selectedId, onSelect, onToggleReference, onDelete,
}: VariantsStripProps) {
  const total = variants.length
  const doneCount = variants.filter(v => v.stage === 'done' || !v.stage).length
  const refCount = variants.filter(v => v.isReference).length

  return (
    <div className="dz-variants-strip">
      <div className="dz-variants-strip-header">
        <div className="dz-variants-strip-title">
          {total === 0 ? 'Variantes' : `${total} variante${total > 1 ? 's' : ''}`}
        </div>
        <div className="dz-variants-strip-sub">
          {total === 0 && 'Choisis une image dans la banque'}
          {total > 0 && doneCount === total && (
            refCount > 0
              ? `${refCount} référence${refCount > 1 ? 's' : ''} cochée${refCount > 1 ? 's' : ''}`
              : 'Coche Référence pour utiliser'
          )}
          {total > 0 && doneCount < total && `${doneCount}/${total} prêtes`}
        </div>
      </div>

      <div className="dz-variants-strip-list">
        {variants.map(v => (
          <VariantTile
            key={v.id}
            variant={v}
            isSelected={v.id === selectedId}
            onSelect={() => onSelect(v)}
            onToggleReference={() => onToggleReference(v.id)}
            onDelete={() => onDelete(v.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Tuile individuelle ────────────────────────────────────────────────────

function VariantTile({
  variant, isSelected, onSelect, onToggleReference, onDelete,
}: {
  variant: DesignerVariant
  isSelected: boolean
  onSelect: () => void
  onToggleReference: () => void
  onDelete: () => void
}) {
  const isDone = (variant.stage === 'done' || !variant.stage) && !!variant.url
  const isError = variant.stage === 'error'
  const isBusy = !isDone && !isError

  return (
    <motion.div
      className={`dz-variant ${isSelected ? 'selected' : ''} ${isError ? 'error' : ''} ${isBusy ? 'busy' : ''}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => { if (isDone) onSelect() }}
      role={isDone ? 'button' : undefined}
      tabIndex={isDone ? 0 : undefined}
      onKeyDown={(e) => { if (isDone && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect() } }}
      title={isDone ? `${variant.label} — sélectionner` : variant.label}
    >
      {isDone && variant.url ? (
        <>
          <img src={variant.url} alt={variant.label} />

          {/* Badge source (top-left) */}
          <span className={`dz-variant-source ${variant.source.kind}`}>
            {variant.source.kind === 'bank'
              ? <><FolderOpen size={9} /> banque</>
              : <><Sparkles size={9} /> {variant.label}</>
            }
          </span>

          {/* Coche sélection (top-right si selected) */}
          {isSelected && (
            <div className="dz-variant-check" title="Variante affichée au centre">
              <Check size={10} strokeWidth={3} />
            </div>
          )}

          {/* Checkbox Référence (bottom-left) */}
          <label
            className={`dz-variant-ref ${variant.isReference ? 'checked' : ''}`}
            onClick={(e) => e.stopPropagation()}
            title="Utiliser comme image de référence pour la prochaine génération"
          >
            <input
              type="checkbox"
              checked={variant.isReference}
              onChange={onToggleReference}
            />
            <span>Réf.</span>
          </label>

          {/* Bouton delete (bottom-right au hover) */}
          <button
            type="button"
            className="dz-variant-delete"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="Supprimer cette variante"
            aria-label="Supprimer"
          >
            <X size={11} />
          </button>
        </>
      ) : isError ? (
        <div className="dz-variant-state">
          <AlertCircle size={20} />
          <div className="dz-variant-state-label">{truncate(variant.error ?? 'Erreur', 40)}</div>
        </div>
      ) : (
        <>
          <div className="dz-variant-skeleton" />
          <div className="dz-variant-state">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            >
              <Loader2 size={18} />
            </motion.div>
            <div className="dz-variant-state-label">{stageLabel(variant.stage)}</div>
          </div>
        </>
      )}
    </motion.div>
  )
}

function stageLabel(stage?: DesignerVariant['stage']): string {
  switch (stage) {
    case 'queued':      return 'En attente'
    case 'translating': return 'Traduction'
    case 'queuing':     return 'Envoi'
    case 'generating':  return 'Génération'
    case 'uploading':   return 'Upload'
    default:            return ''
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
