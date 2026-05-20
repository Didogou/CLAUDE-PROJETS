'use client'
/**
 * DesignerTopBar — barre supérieure du Studio Designer.
 *
 * Layout 3 zones :
 *  - Gauche : breadcrumb (titre du plan + résumé)
 *  - Centre : AICommandBar (input IA + raccourci Ctrl+K)
 *  - Droite : actions (undo/redo · 🖼 Base · ▶ Aperçu · 💎 crédits · ☀ · ← Retour)
 *
 * Phase 4 : tous les boutons fonctionnels (sauf wiring backend IA).
 */

import React from 'react'
import { ChevronLeft, Image as ImageIcon, Play, Sun, Moon, Undo2, Redo2, RefreshCw } from 'lucide-react'
import AICommandBar from './AICommandBar'
import CreditsButton from './CreditsButton'

interface DesignerTopBarProps {
  /** Titre court du plan édité (ex: "Plan 1") */
  planTitle: string
  /** Résumé narratif court (ex: "Tu rentres dans le bar enfumé…") */
  planSummary?: string
  /** Label du bouton retour selon le contexte d'origine */
  returnLabel: string
  /** Callback du bouton retour (autosave + ferme le Designer) */
  onReturn: () => void

  /** Phase 4 — actions optionnelles. Peuvent être omises (passé à null/undefined) */
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  /** Bouton "🖼 Base" / "⟲ Nouvelle base" → ouvre le panneau de génération
   * (Phase A entry, ou re-création de base depuis Phase B) */
  onOpenBase?: () => void
  /** Label affiché sur le bouton onOpenBase. Si non fourni :
   * - "Nouvelle base" + icône RefreshCw (cas Phase B refonte)
   * - "Base" + icône Image si on garde l'ancien comportement */
  openBaseLabel?: string
  /** Variante "rebase" : icône RefreshCw au lieu d'ImageIcon */
  openBaseVariant?: 'edit' | 'rebase'
  /** Bouton "▶ Aperçu" → ouvre le modal device picker (Phase 5) */
  onOpenPreview?: () => void
  /** Toggle du thème clair / sombre */
  theme?: 'light' | 'dark'
  onToggleTheme?: () => void

  /** Image courante de la scène — passé à AICommandBar pour permettre
   *  l'édition Qwen Image Edit via le prompt "Demande à l'IA…". Si null,
   *  les commandes d'édition non-cut sont disabled (alert). */
  aiEditCurrentImageUrl?: string | null
  /** Callback après édition Qwen réussie — typiquement câblé sur replaceBase. */
  onAiEditApplied?: (newImageUrl: string) => void
  /** Préfixe Storage pour ranger les résultats d'édition. */
  aiEditStoragePathPrefix?: string
}

export default function DesignerTopBar({
  planTitle,
  planSummary,
  returnLabel,
  onReturn,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onOpenBase,
  openBaseLabel,
  openBaseVariant = 'edit',
  onOpenPreview,
  theme,
  onToggleTheme,
  aiEditCurrentImageUrl,
  onAiEditApplied,
  aiEditStoragePathPrefix,
}: DesignerTopBarProps) {
  const baseIcon = openBaseVariant === 'rebase'
    ? <RefreshCw size={13} />
    : <ImageIcon size={13} />
  const baseLabel = openBaseLabel ?? (openBaseVariant === 'rebase' ? 'Nouvelle base' : 'Base')
  const baseTitle = openBaseVariant === 'rebase'
    ? 'Refaire la base (l\'actuelle sera versionnée)'
    : 'Modifier la base (prompt, style, génération)'
  return (
    <div className="dz-topbar">
      {/* Bouton Retour gauche (remplace breadcrumb 2026-05-06) */}
      <button
        type="button"
        className="dz-topbar-return"
        onClick={onReturn}
        title={returnLabel}
      >
        <ChevronLeft size={14} />
        <span>{returnLabel}</span>
      </button>

      {/* Centre : AI command bar */}
      <div className="dz-topbar-center">
        <AICommandBar
          currentImageUrl={aiEditCurrentImageUrl}
          onEditApplied={onAiEditApplied}
          storagePathPrefix={aiEditStoragePathPrefix}
        />
      </div>

      {/* Droite : actions, regroupées par fonction avec séparateurs verticaux */}
      <div className="dz-topbar-actions">
        {/* Groupe 1 : historique */}
        {(onUndo || onRedo) && (
          <>
            <div className="dz-topbar-group">
              <button
                type="button"
                className="dz-topbar-icon"
                onClick={onUndo}
                disabled={!canUndo}
                title="Annuler (Ctrl+Z)"
                aria-label="Annuler"
              >
                <Undo2 size={14} />
              </button>
              <button
                type="button"
                className="dz-topbar-icon"
                onClick={onRedo}
                disabled={!canRedo}
                title="Refaire (Ctrl+Shift+Z)"
                aria-label="Refaire"
              >
                <Redo2 size={14} />
              </button>
            </div>
            <div className="dz-topbar-sep" aria-hidden />
          </>
        )}

        {/* Groupe 2 : modifier la base (édition génération) */}
        {onOpenBase && (
          <>
            <div className="dz-topbar-group">
              <button
                type="button"
                className="dz-topbar-action"
                onClick={onOpenBase}
                title={baseTitle}
              >
                {baseIcon}
                <span>{baseLabel}</span>
              </button>
            </div>
            <div className="dz-topbar-sep" aria-hidden />
          </>
        )}

        {/* Groupe 3 : voir le rendu lecteur (action distincte de l'édition) */}
        {onOpenPreview && (
          <>
            <div className="dz-topbar-group">
              <button
                type="button"
                className="dz-topbar-action"
                onClick={onOpenPreview}
                title="Aperçu du plan sur device (iPhone/iPad/Desktop)"
              >
                <Play size={13} />
                <span>Aperçu</span>
              </button>
            </div>
            <div className="dz-topbar-sep" aria-hidden />
          </>
        )}

        {/* Groupe 3 : crédits */}
        <CreditsButton />

        {/* Groupe 4 : thème */}
        {onToggleTheme && (
          <>
            <div className="dz-topbar-sep" aria-hidden />
            <button
              type="button"
              className="dz-topbar-icon"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Passer au mode clair' : 'Passer au mode sombre'}
              aria-label="Toggle thème"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </>
        )}

        {/* Bouton Retour droite supprimé 2026-05-06 — déplacé en haut à gauche */}
      </div>
    </div>
  )
}
