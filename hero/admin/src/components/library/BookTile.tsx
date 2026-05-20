'use client'
/**
 * BookTile — tuile livre dans la grille Library.
 *
 * Affiche : cover (image ou placeholder) + status badge + universe tag +
 * titre + synopsis excerpt + nb sections + phase. Click → callback navigation
 * vers Studio Creator du livre.
 */

import React from 'react'
import { BookOpen } from 'lucide-react'
import type { BookSummary } from './types'

interface BookTileProps {
  book: BookSummary
  onOpen: (bookId: string) => void
}

const STATUS_LABEL: Record<BookSummary['status'], string> = {
  draft: 'Brouillon',
  published: 'Publié',
  archived: 'Archivé',
}

const PHASE_LABEL: Record<NonNullable<BookSummary['phase']>, string> = {
  draft: 'Draft',
  structure_generated: 'Structure',
  structure_validated: 'Validé',
  writing: 'Écriture',
  done: 'Terminé',
}

const PHASE_KEY: Record<NonNullable<BookSummary['phase']>, string> = {
  draft: 'structure',
  structure_generated: 'structure',
  structure_validated: 'validated',
  writing: 'writing',
  done: 'done',
}

export default function BookTile({ book, onOpen }: BookTileProps) {
  return (
    <button
      type="button"
      className="lib-tile"
      onClick={() => onOpen(book.id)}
      title={book.title}
    >
      <div className="lib-tile-cover">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt={book.title} />
        ) : (
          <div className="lib-tile-cover-placeholder">
            <BookOpen size={48} />
            <span className="lib-tile-cover-placeholder-label">{book.universe ?? 'Sans cover'}</span>
          </div>
        )}
        <span className={`lib-tile-status ${book.status}`}>
          {STATUS_LABEL[book.status]}
        </span>
        {book.universe && (
          <span className="lib-tile-universe">{book.universe}</span>
        )}
      </div>
      <div className="lib-tile-body">
        <div className="lib-tile-title">{book.title}</div>
        {book.synopsis && (
          <div className="lib-tile-synopsis">{book.synopsis}</div>
        )}
        <div className="lib-tile-meta">
          <span className="lib-tile-meta-section-count">
            📖 {book.numSections} section{book.numSections > 1 ? 's' : ''}
          </span>
          {book.phase && (
            <span className={`lib-tile-meta-phase ${PHASE_KEY[book.phase]}`}>
              {PHASE_LABEL[book.phase]}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
