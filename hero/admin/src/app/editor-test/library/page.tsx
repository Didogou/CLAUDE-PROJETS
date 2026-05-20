'use client'
/**
 * Library — page d'accueil des Studios (route /editor-test/library).
 *
 * Affiche la grille de tuiles livres + 1 tuile "+ Nouveau livre".
 *
 * Phase A (V0 mock) : mock data hardcodée pour valider le visuel. La vraie
 * connexion à `GET /api/books` viendra Phase C (une fois que Library + Studio
 * Creator sont fonctionnels en mock).
 */

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sun, Moon, Sparkles } from 'lucide-react'
import BookTile from '@/components/library/BookTile'
import { mapApiBookToSummary, type BookSummary } from '@/components/library/types'
import { useThemePreference } from '@/lib/use-theme-preference'
import '@/components/library/library.css'

export default function LibraryPage() {
  const router = useRouter()
  const [books, setBooks] = useState<BookSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { theme, toggleTheme } = useThemePreference()

  // Phase C — fetch real books from /api/books on mount.
  useEffect(() => {
    let aborted = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await fetch('/api/books')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as unknown[]
        if (aborted) return
        const summaries = (data as Parameters<typeof mapApiBookToSummary>[0][])
          .map(mapApiBookToSummary)
        setBooks(summaries)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Library] load books failed:', msg)
        setError(msg)
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    void load()
    return () => { aborted = true }
  }, [])

  function handleOpenBook(bookId: string) {
    router.push(`/editor-test/studio-creator/${bookId}`)
  }

  function handleNewBook() {
    // Phase ultérieure : naviguer vers Studio Book (création IA d'un livre)
    alert('TODO : Studio Book (création IA d\'un nouveau livre) — bientôt')
  }

  return (
    <div className={`lib-root ${theme === 'light' ? 'theme-light' : ''}`}>

      {/* ── TOP BAR ──────────────────────────────────────────────────── */}
      <header className="lib-topbar">
        <div className="lib-topbar-title">
          <span className="lib-logo">H</span>
          Hero · Library
        </div>
        <div className="lib-topbar-spacer" />
        <button
          type="button"
          className="lib-topbar-btn lib-topbar-btn-icon"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </header>

      {/* ── MAIN ─────────────────────────────────────────────────────── */}
      <main className="lib-main">
        <div className="lib-section-header">
          <div>
            <h1>Mes livres</h1>
            <p>
              {loading
                ? 'Chargement…'
                : `${books.length} livre${books.length > 1 ? 's' : ''} dans la bibliothèque`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="lib-loading">Chargement des livres…</div>
        ) : error ? (
          <div className="lib-empty" style={{ color: '#EF4444' }}>
            ⚠ Erreur de chargement : {error}
          </div>
        ) : (
          <div className="lib-grid">
            {books.map(book => (
              <BookTile key={book.id} book={book} onOpen={handleOpenBook} />
            ))}
            {/* Tuile + Nouveau livre — toujours en dernier */}
            <button
              type="button"
              className="lib-tile lib-tile-new"
              onClick={handleNewBook}
              title="Créer un nouveau livre avec l'aide de l'IA (Studio Book)"
            >
              <Sparkles size={32} />
              <span className="lib-tile-new-plus">+</span>
              <span className="lib-tile-new-label">Nouveau livre</span>
              <span className="lib-tile-new-hint">
                Création assistée par IA via Studio Book
              </span>
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
