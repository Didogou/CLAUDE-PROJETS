'use client'
/**
 * Header de l'ImageEditor : breadcrumb contextuel + toggle thème + close.
 *
 * Contenu du breadcrumb dépend du contexte d'entrée :
 *   - character  → Nom + Type perso
 *   - object     → Nom
 *   - plan       → Section + Plan n° + résumé plan (en sous-titre)
 *   - transition → Section origine + choix cible + texte transition (sous-titre)
 *   - return     → Section origine + texte retour (sous-titre)
 */
import React from 'react'
import { Moon, Sun, X, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import type { EditorTheme, ImageEditorOpenParams } from './types'

interface HeaderProps {
  params: ImageEditorOpenParams
  theme: EditorTheme
  onToggleTheme: () => void
  onClose: () => void
  onValidate: () => void
  validating: boolean
  canValidate: boolean
}

export default function Header({ params, theme, onToggleTheme, onClose, onValidate, validating, canValidate }: HeaderProps) {
  const { title, subtitle } = buildBreadcrumb(params)

  return (
    <motion.header
      className="ie-header"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 'var(--ie-text-md)', fontWeight: 600, color: 'var(--ie-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ie-space-2)' }}>
        <motion.button
          className="ie-btn ie-btn-icon"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Thème clair actif — cliquer pour passer en sombre' : 'Thème sombre actif — cliquer pour passer en clair'}
          title={theme === 'light' ? 'Thème clair actif — cliquer pour passer en sombre' : 'Thème sombre actif — cliquer pour passer en clair'}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
        >
          {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
        </motion.button>
        {/* Bouton Valider principal — déclenche onValidate (save final + close) */}
        <motion.button
          onClick={onValidate}
          disabled={!canValidate || validating}
          aria-label="Valider et enregistrer"
          title={canValidate ? 'Valider et enregistrer (Ctrl+S)' : 'Génère ou sélectionne une image avant de valider'}
          whileHover={canValidate && !validating ? { scale: 1.03, boxShadow: 'var(--ie-shadow)' } : undefined}
          whileTap={canValidate && !validating ? { scale: 0.96 } : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px',
            background: canValidate && !validating ? 'var(--ie-accent)' : 'var(--ie-surface-3)',
            color: canValidate && !validating ? 'var(--ie-accent-text-on)' : 'var(--ie-text-faint)',
            border: 'none',
            borderRadius: 'var(--ie-radius)',
            fontSize: 'var(--ie-text-sm)',
            fontWeight: 600,
            cursor: canValidate && !validating ? 'pointer' : 'not-allowed',
            marginRight: 4,
          }}
        >
          <Check size={15} strokeWidth={3} />
          {validating ? 'Enregistrement…' : 'Valider'}
        </motion.button>
        <motion.button
          className="ie-btn ie-btn-icon"
          onClick={onClose}
          aria-label="Fermer l'éditeur"
          title="Fermer (Esc)"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
        >
          <X size={18} />
        </motion.button>
      </div>
    </motion.header>
  )
}

// ── Construction du breadcrumb selon le contexte ─────────────────────────

function buildBreadcrumb(params: ImageEditorOpenParams): { title: string; subtitle?: string } {
  const { target, npc, item, section, choice } = params

  switch (target.context) {
    case 'character': {
      const name = npc?.name ?? 'Personnage'
      const type = npc?.type ?? ''
      return { title: name, subtitle: type || undefined }
    }
    case 'object': {
      const name = item?.name ?? 'Objet'
      return { title: name }
    }
    case 'plan': {
      const sectionText = section?.summary || section?.content || ''
      const sectionLabel = sectionText ? truncate(sectionText, 60) : 'Section'
      const planLabel = `Plan ${target.planIdx + 1}`
      return { title: `${planLabel} — ${sectionLabel}` }
    }
    case 'transition': {
      const sectionText = section?.summary || section?.content || ''
      const sectionLabel = sectionText ? truncate(sectionText, 40) : 'Section'
      const choiceLabel = choice?.label ? `→ ${truncate(choice.label, 40)}` : '→ choix'
      return { title: `Transition : ${choiceLabel}`, subtitle: `Depuis : ${sectionLabel}` }
    }
    case 'return': {
      const sectionText = section?.summary || section?.content || ''
      const sectionLabel = sectionText ? truncate(sectionText, 50) : 'Section'
      const choiceLabel = choice?.label ? truncate(choice.label, 40) : ''
      return {
        title: `Retour : ${choiceLabel}`,
        subtitle: `Depuis : ${sectionLabel}`,
      }
    }
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max).trim() + '…'
}
