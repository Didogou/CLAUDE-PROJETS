'use client'
/**
 * Galerie de variantes (colonne de droite).
 *
 * S'affiche quand il y a au moins une variante en cours/terminée/en erreur.
 * Chaque variante correspond à un modèle ComfyUI et montre son statut en live
 * (queued → translating → generating → uploading → done/error).
 *
 * Clic sur une vignette done = elle devient l'image principale du Canvas.
 */
import React from 'react'
import { motion } from 'framer-motion'
import { Loader2, AlertCircle, Check, PanelRightClose, Images } from 'lucide-react'
import type { GenerationVariantStatus } from './hooks/useImageGeneration'

interface VariantsGalleryProps {
  variants: GenerationVariantStatus[]
  selectedUrl?: string | null
  onSelect: (url: string) => void
  /** Callback pour plier la gallery en rail. Affiche un bouton dans le header. */
  onCollapse?: () => void
}

export default function VariantsGallery({ variants, selectedUrl, onSelect, onCollapse }: VariantsGalleryProps) {
  const doneCount = variants.filter(v => v.stage === 'done').length
  const totalCount = variants.length

  return (
    <motion.aside
      className="ie-sidebar-right"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        style={{
          fontSize: 'var(--ie-text-xs)',
          fontWeight: 600,
          letterSpacing: '0.05em',
          color: 'var(--ie-text-faint)',
          textTransform: 'uppercase',
          marginBottom: 'var(--ie-space-3)',
          padding: '0 var(--ie-space-2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Variantes</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ie-space-2)' }}>
          <span style={{ color: doneCount === totalCount && totalCount > 0 ? 'var(--ie-success)' : 'var(--ie-text-muted)' }}>
            {doneCount}/{totalCount}
          </span>
          {onCollapse && (
            <motion.button
              onClick={onCollapse}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              title="Plier la gallery"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22,
                background: 'transparent',
                color: 'var(--ie-text-faint)',
                borderRadius: 'var(--ie-radius-sm)',
                cursor: 'pointer', border: 'none',
              }}
            >
              <PanelRightClose size={14} />
            </motion.button>
          )}
        </div>
      </div>

      {variants.length === 0 ? (
        <div
          className="ie-placeholder"
          style={{ fontSize: 'var(--ie-text-sm)', padding: 'var(--ie-space-4)', minHeight: 200 }}
        >
          Pas encore de variantes.<br />Lance une génération multi-modèles pour comparer.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-3)' }}>
          {variants.map((v) => (
            <VariantTile
              key={v.modelKey}
              status={v}
              isSelected={v.url === selectedUrl}
              onSelect={() => v.url && onSelect(v.url)}
            />
          ))}
        </div>
      )}
    </motion.aside>
  )
}

// ── Rail replié ─────────────────────────────────────────────────────────

/**
 * Version repliée de la gallery — colonne étroite (~44px) avec bouton d'expansion
 * et badge du nombre de variantes done. Affiché quand l'utilisateur passe en
 * édition (clic sur un fold sidebar) pour maximiser la place du canvas.
 */
export function GalleryRail({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <motion.aside
      className="ie-sidebar-rail"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ alignItems: 'center', paddingTop: 'var(--ie-space-3)', gap: 'var(--ie-space-2)', borderRight: 'none', borderLeft: '1px solid var(--ie-border)' }}
    >
      <motion.button
        onClick={onExpand}
        className="ie-btn ie-btn-icon"
        title={`Déplier la gallery (${count} variante${count > 1 ? 's' : ''})`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.92 }}
      >
        <Images size={18} />
      </motion.button>
      {count > 0 && (
        <div
          style={{
            fontSize: 'var(--ie-text-xs)',
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 999,
            background: 'var(--ie-accent)',
            color: 'white',
            minWidth: 18,
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </div>
      )}
    </motion.aside>
  )
}

// ── Tuile individuelle ──────────────────────────────────────────────────

function VariantTile({
  status, isSelected, onSelect,
}: { status: GenerationVariantStatus; isSelected: boolean; onSelect: () => void }) {
  const isDone = status.stage === 'done' && !!status.url
  const isError = status.stage === 'error'
  const isBusy = !isDone && !isError

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'relative',
        borderRadius: 'var(--ie-radius-md)',
        overflow: 'hidden',
        border: isSelected
          ? '2px solid var(--ie-accent)'
          : isError
            ? '1px solid var(--ie-danger)'
            : '1px solid var(--ie-border)',
        background: 'var(--ie-surface)',
        boxShadow: isSelected ? 'var(--ie-shadow)' : 'var(--ie-shadow-sm)',
        width: '100%',
        aspectRatio: '1',
        cursor: isDone ? 'pointer' : 'default',
      }}
    >
      {/* Background selon état */}
      {isDone && status.url ? (
        <motion.button
          onClick={onSelect}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          style={{
            width: '100%', height: '100%',
            padding: 0, background: 'transparent',
            border: 'none', cursor: 'pointer',
            display: 'block', position: 'relative',
          }}
        >
          <img
            src={status.url}
            alt={status.modelLabel}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {isSelected && (
            <div style={{
              position: 'absolute', top: 8, right: 8,
              background: 'var(--ie-accent)',
              borderRadius: '50%',
              width: 24, height: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--ie-shadow)',
            }}>
              <Check size={14} color="white" strokeWidth={3} />
            </div>
          )}
        </motion.button>
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isError ? 'rgba(239, 68, 68, 0.04)' : 'var(--ie-surface-2)',
          padding: 'var(--ie-space-3)',
        }}>
          {isError ? (
            <div style={{ textAlign: 'center', color: 'var(--ie-danger)' }}>
              <AlertCircle size={24} style={{ marginBottom: 6 }} />
              <div style={{ fontSize: 'var(--ie-text-xs)', lineHeight: 1.3 }}>
                {truncate(status.error ?? 'Erreur', 80)}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--ie-text-muted)' }}>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                style={{ marginBottom: 6 }}
              >
                <Loader2 size={24} />
              </motion.div>
              <div style={{ fontSize: 'var(--ie-text-xs)', fontWeight: 500 }}>
                {stageLabel(status.stage)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Label modèle en bas */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        padding: '4px 8px',
        background: isDone ? 'rgba(0,0,0,0.6)' : 'transparent',
        color: isDone ? 'white' : 'var(--ie-text-muted)',
        fontSize: 'var(--ie-text-xs)',
        textAlign: 'left',
        fontWeight: 500,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        pointerEvents: 'none',
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {status.modelLabel}
        </span>
        {isBusy && (
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            {stageIcon(status.stage)}
          </span>
        )}
      </div>
    </motion.div>
  )
}

function stageLabel(stage: GenerationVariantStatus['stage']): string {
  switch (stage) {
    case 'queued':      return 'En attente…'
    case 'translating': return 'Traduction…'
    case 'queuing':     return 'Envoi ComfyUI…'
    case 'generating':  return 'Génération…'
    case 'uploading':   return 'Upload…'
    default:            return ''
  }
}

function stageIcon(stage: GenerationVariantStatus['stage']): string {
  switch (stage) {
    case 'queued':      return '⏳'
    case 'translating': return '🌐'
    case 'queuing':     return '📤'
    case 'generating':  return '✨'
    case 'uploading':   return '☁️'
    default:            return ''
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…'
}
