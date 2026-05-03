'use client'
/**
 * CatalogShell — wrapper visuel commun à tous les catalogues.
 *
 * Gère le layout standard (header avec titre + bouton fermer, search en
 * option, body scrollable). Les catalogues spécifiques (CatalogEffects,
 * CatalogBanks, etc.) en héritent en passant leur contenu en `children`.
 */

import React from 'react'
import { X, Search } from 'lucide-react'

interface CatalogShellProps {
  title: React.ReactNode
  onClose: () => void
  /** Active la barre de recherche en haut. true par défaut. */
  showSearch?: boolean
  /** Placeholder du champ search */
  searchPlaceholder?: string
  /** Valeur du search (controlled) */
  searchValue?: string
  onSearchChange?: (v: string) => void
  children: React.ReactNode
}

export default function CatalogShell({
  title,
  onClose,
  showSearch = true,
  searchPlaceholder = 'Rechercher…',
  searchValue,
  onSearchChange,
  children,
}: CatalogShellProps) {
  return (
    <div className="dz-catalog" role="region">
      <header className="dz-catalog-header">
        <span className="dz-catalog-title">{title}</span>
        <button
          type="button"
          className="dz-catalog-close"
          onClick={onClose}
          title="Fermer le catalogue"
          aria-label="Fermer le catalogue"
        >
          <X size={14} />
        </button>
      </header>

      {showSearch && (
        <div className="dz-catalog-search">
          <Search size={12} className="dz-catalog-search-icon" />
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={searchValue ?? ''}
            onChange={e => onSearchChange?.(e.target.value)}
          />
        </div>
      )}

      <div className="dz-catalog-body">{children}</div>
    </div>
  )
}
