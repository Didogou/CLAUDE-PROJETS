'use client'
/**
 * StudioSectionLayout — shell du Studio Section.
 *
 * Layout aligné Studio Designer :
 *   ┌─────────────────────────────────────────────────────┐
 *   │ TOP BAR (breadcrumb + status + Aperçu + Publier)    │
 *   ├──┬──────────────────────────────────────────────────┤
 *   │R │  MAIN (contenu de la "section" active)           │
 *   │A │                                                   │
 *   │I │                                                   │
 *   │L │                                                   │
 *   └──┴──────────────────────────────────────────────────┘
 *
 * Le rail vertical à gauche (3rem) remplace les tabs horizontaux. Chaque
 * icône = une "section" (Storyboard, Texte, Choix, Companions, Settings).
 * Active = barre verticale rose à gauche + fond rose pâle (pattern
 * Notion/VSCode/Designer).
 */

import React, { type ReactNode } from 'react'
import { Image as ImageIcon, FileText, GitBranch, Users, Package, Settings as SettingsIcon, Sun, Moon, ArrowLeft, Eye } from 'lucide-react'
import './studio-section.css'

export type SectionTab = 'storyboard' | 'texte' | 'choix' | 'companions' | 'objets' | 'settings'

interface RailItem {
  id: SectionTab
  icon: ReactNode
  label: string
  tooltip: string
}

const RAIL_ITEMS: RailItem[] = [
  // Refonte 2026-05-16 (chantier 1) — icône Image (= identique Studio Animation
  // pour le drawer banque). Cohérence visuelle entre les 2 studios.
  { id: 'storyboard', icon: <ImageIcon size={18} />,    label: 'Storyboard',  tooltip: 'Banque animations + images + timeline storyboard' },
  { id: 'texte',      icon: <FileText size={18} />,     label: 'Texte',       tooltip: 'Texte narratif (prose, summary, hint)' },
  { id: 'choix',      icon: <GitBranch size={18} />,    label: 'Choix',       tooltip: 'Choix de Section + Trial (combat / éloquence / agilité)' },
  { id: 'companions', icon: <Users size={18} />,        label: 'Personnages', tooltip: 'Banque des personnages (NPC) du livre' },
  // Refonte 2026-05-19 — nouvel onglet Objets : banque items du livre.
  // Icône Package (alignée Studio Designer rail/objects).
  { id: 'objets',     icon: <Package size={18} />,      label: 'Objets',      tooltip: 'Banque des objets / items du livre' },
  { id: 'settings',   icon: <SettingsIcon size={18} />, label: 'Settings',    tooltip: 'reading_time, decision_time, location, narrative arc…' },
]

interface StudioSectionLayoutProps {
  bookTitle: string
  sectionNumber: number
  sectionTitle: string
  /** Compteurs pour les badges du rail (sur Storyboard, Choix, Companions). */
  badges?: Partial<Record<SectionTab, number>>
  children: ReactNode
  activeTab: SectionTab
  onTabChange: (tab: SectionTab) => void
  /** Refonte 2026-05-16 — click sur le tab DÉJÀ actif. Permet d'utiliser le
   *  tab Storyboard comme toggle banque (cf chantier 1 refinement). */
  onActiveTabReclick?: (tab: SectionTab) => void
  saveStatus?: string
  onPreview?: () => void
  onPublish?: () => void
  onBackToBookList?: () => void
  /** Theme courant. Default 'dark'. Le parent peut le persister (localStorage). */
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
}

export default function StudioSectionLayout({
  bookTitle,
  sectionNumber,
  sectionTitle,
  badges = {},
  children,
  activeTab,
  onTabChange,
  onActiveTabReclick,
  saveStatus = 'Sauvegardé',
  onPreview,
  onPublish,
  onBackToBookList,
  theme = 'dark',
  onToggleTheme,
}: StudioSectionLayoutProps) {
  return (
    <div className={`ss-root ${theme === 'light' ? 'theme-light' : ''}`}>

      {/* ── TOP BAR : Retour aux sections + status + theme toggle ────── */}
      <header className="ss-topbar">
        <button
          type="button"
          className="ss-topbar-back"
          onClick={onBackToBookList}
          title={`Retour aux sections de ${bookTitle}`}
        >
          <ArrowLeft size={14} />
          <span>Retour aux sections</span>
        </button>
        <div className="ss-topbar-spacer" />
        <span className="ss-status">
          <span className="ss-status-dot" />
          {saveStatus}
        </span>
        {/* Refonte 2026-05-17 — bouton Preview (ouvre PreviewModal unifié,
         *  cf memory project_preview_modal_unified). Identique Studio Animation. */}
        {onPreview && (
          <button
            type="button"
            className="ss-topbar-btn"
            onClick={onPreview}
            title="Ouvrir la fenêtre de preview (jouer la séquence des pellicules)"
          >
            <Eye size={14} />
            <span>Preview</span>
          </button>
        )}
        {onToggleTheme && (
          <button
            type="button"
            className="ss-topbar-btn ss-topbar-btn-icon"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        )}
      </header>

      {/* ── BODY : rail à gauche + main au centre ────────────────────── */}
      <div className="ss-body">

        {/* RAIL vertical (icônes catégories) */}
        <nav className="ss-rail" role="toolbar" aria-label="Catégories de la section">
          {RAIL_ITEMS.map(item => {
            const isActive = activeTab === item.id
            const badge = badges[item.id]
            return (
              <button
                key={item.id}
                type="button"
                className={`ss-rail-btn${isActive ? ' active' : ''}`}
                onClick={() => {
                  // Refonte 2026-05-16 — click sur tab déjà actif :
                  // - si onActiveTabReclick fourni → délègue (toggle banque pour
                  //   Storyboard, no-op pour autres tabs en V1)
                  // - sinon → no-op (le tab est déjà affiché)
                  if (isActive) {
                    onActiveTabReclick?.(item.id)
                  } else {
                    onTabChange(item.id)
                  }
                }}
                title={item.tooltip}
                aria-pressed={isActive}
                aria-label={item.label}
              >
                {item.icon}
                {badge != null && badge > 0 && (
                  <span className="ss-rail-badge">{badge}</span>
                )}
              </button>
            )
          })}
        </nav>

        {/* MAIN content (varie selon le tab actif, géré par le parent) */}
        <main className="ss-main">
          {children}
        </main>

      </div>
    </div>
  )
}
