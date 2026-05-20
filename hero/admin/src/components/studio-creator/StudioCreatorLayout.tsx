'use client'
/**
 * StudioCreatorLayout — shell du Studio Creator (édition d'un livre).
 *
 * Layout aligné Studio Section :
 *   ┌─────────────────────────────────────────────────────┐
 *   │ TOP BAR (breadcrumb Library › Livre)                │
 *   ├──┬──────────────────────────────────────────────────┤
 *   │R │  MAIN (tab actif : Sections / Banque...)         │
 *   │A │                                                   │
 *   │I │                                                   │
 *   │L │                                                   │
 *   └──┴──────────────────────────────────────────────────┘
 *
 * Rail vertical (3rem) avec 2 groupes :
 *   - Sections (1 entrée)
 *   - Séparateur
 *   - Banques : Images / Personnages / Objets (3 entrées)
 */

import React, { type ReactNode } from 'react'
import {
  FileText, Image as ImageIcon, Users, Package,
  Sun, Moon, ArrowLeft,
} from 'lucide-react'
import './studio-creator.css'

export type CreatorTab =
  | 'sections'
  | 'bank-images'
  | 'bank-characters'
  | 'bank-items'

interface RailItem {
  id: CreatorTab
  icon: ReactNode
  label: string
  tooltip: string
}

const RAIL_GROUP_1: RailItem[] = [
  { id: 'sections', icon: <FileText size={18} />, label: 'Sections', tooltip: 'Sections du livre — storyboard global' },
]
const RAIL_GROUP_2_BANQUES: RailItem[] = [
  { id: 'bank-images',     icon: <ImageIcon size={18} />, label: 'Banque Images',      tooltip: 'Banque d\'images réutilisables (plans, transitions, illustrations)' },
  { id: 'bank-characters', icon: <Users size={18} />,     label: 'Banque Personnages', tooltip: 'Personnages du livre (NPC, protagoniste)' },
  { id: 'bank-items',      icon: <Package size={18} />,   label: 'Banque Objets',      tooltip: 'Objets du livre (items inventaire, scène)' },
]

interface StudioCreatorLayoutProps {
  bookTitle: string
  children: ReactNode
  activeTab: CreatorTab
  onTabChange: (tab: CreatorTab) => void
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
  onBackToLibrary?: () => void
}

export default function StudioCreatorLayout({
  bookTitle,
  children,
  activeTab,
  onTabChange,
  theme = 'dark',
  onToggleTheme,
  onBackToLibrary,
}: StudioCreatorLayoutProps) {
  return (
    <div className={`sc-root ${theme === 'light' ? 'theme-light' : ''}`}>

      {/* ── TOP BAR ──────────────────────────────────────────────────── */}
      <header className="sc-topbar">
        <button
          type="button"
          className="sc-topbar-btn sc-topbar-btn-icon"
          onClick={onBackToLibrary}
          title="Retour à la Library"
          aria-label="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <nav className="sc-breadcrumb">
          <a onClick={onBackToLibrary}>Library</a>
          <span>›</span>
          <strong>{bookTitle}</strong>
        </nav>
        <div className="sc-topbar-spacer" />
        {onToggleTheme && (
          <button
            type="button"
            className="sc-topbar-btn sc-topbar-btn-icon"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        )}
      </header>

      {/* ── BODY ─────────────────────────────────────────────────────── */}
      <div className="sc-body">

        {/* RAIL vertical */}
        <nav className="sc-rail" role="toolbar" aria-label="Catégories du Studio Creator">
          {RAIL_GROUP_1.map(item => (
            <RailButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => onTabChange(item.id)}
            />
          ))}
          <div className="sc-rail-sep" />
          {RAIL_GROUP_2_BANQUES.map(item => (
            <RailButton
              key={item.id}
              item={item}
              active={activeTab === item.id}
              onClick={() => onTabChange(item.id)}
            />
          ))}
        </nav>

        {/* MAIN content */}
        <main className="sc-main">
          {children}
        </main>

      </div>
    </div>
  )
}

function RailButton({
  item, active, onClick,
}: { item: RailItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`sc-rail-btn${active ? ' active' : ''}`}
      onClick={onClick}
      title={item.tooltip}
      aria-pressed={active}
      aria-label={item.label}
    >
      {item.icon}
    </button>
  )
}
