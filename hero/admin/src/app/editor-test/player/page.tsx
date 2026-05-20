'use client'
/**
 * /editor-test/player?bookId=X&sectionId=Y
 *
 * Page de test du Renderer livre-joué (Phase B 2026-05-13).
 *
 * Usage manuel pour V1 — passe les IDs en query params. Si pas fourni, affiche
 * un sélecteur simple pour pick une section du livre Duke Duo (le seul livre
 * survivant au cleanup massif 2026-05-12).
 */

import React, { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import BookPlayer from '@/components/book-player/BookPlayer'

export default function PlayerTestPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const bookId = searchParams.get('bookId')
  const sectionId = searchParams.get('sectionId')

  const [books, setBooks] = useState<Array<{ id: string; title: string }>>([])
  const [sections, setSections] = useState<Array<{ id: string; title: string; number: number }>>([])
  const [selectedBookId, setSelectedBookId] = useState<string>('')

  // Si pas de bookId/sectionId → fetch books pour sélection
  useEffect(() => {
    if (bookId && sectionId) return
    void (async () => {
      try {
        const res = await fetch('/api/books')
        if (!res.ok) return
        const data = await res.json() as Array<{ id: string; title: string }>
        setBooks(data)
        if (data.length > 0) setSelectedBookId(data[0].id)
      } catch (err) {
        console.warn('[PlayerTestPage] fetch books failed:', err)
      }
    })()
  }, [bookId, sectionId])

  // Si bookId sélectionné → fetch sections
  useEffect(() => {
    if (bookId && sectionId) return
    if (!selectedBookId) return
    void (async () => {
      try {
        const res = await fetch(`/api/books/${selectedBookId}`)
        if (!res.ok) return
        const data = await res.json() as { sections?: Array<{ id: string; title: string; number: number }> }
        setSections((data.sections ?? []).sort((a, b) => (a.number ?? 0) - (b.number ?? 0)))
      } catch (err) {
        console.warn('[PlayerTestPage] fetch sections failed:', err)
      }
    })()
  }, [selectedBookId, bookId, sectionId])

  function handleNavigate(targetSectionId: string) {
    if (!bookId) return
    router.push(`/editor-test/player?bookId=${bookId}&sectionId=${targetSectionId}`)
  }

  // Mode lecteur
  if (bookId && sectionId) {
    return <BookPlayer bookId={bookId} sectionId={sectionId} onNavigateSection={handleNavigate} />
  }

  // Mode sélecteur
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f0f0f',
      color: '#e8e8e8',
      padding: '2rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>
        Renderer livre-joué — sélection
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '36rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', opacity: 0.7 }}>
            Livre
          </label>
          <select
            value={selectedBookId}
            onChange={e => setSelectedBookId(e.target.value)}
            style={{
              width: '100%',
              padding: '0.6rem 0.75rem',
              background: '#1a1a1a',
              color: '#e8e8e8',
              border: '1px solid #333',
              borderRadius: '0.4rem',
            }}
          >
            {books.map(b => (
              <option key={b.id} value={b.id}>{b.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', opacity: 0.7 }}>
            Section
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {sections.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => router.push(`/editor-test/player?bookId=${selectedBookId}&sectionId=${s.id}`)}
                style={{
                  padding: '0.65rem 0.85rem',
                  background: '#1a1a1a',
                  color: '#e8e8e8',
                  border: '1px solid #333',
                  borderRadius: '0.4rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#252525'
                  e.currentTarget.style.borderColor = '#d4a84c'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#1a1a1a'
                  e.currentTarget.style.borderColor = '#333'
                }}
              >
                <span style={{ opacity: 0.6, marginRight: '0.5rem' }}>#{s.number}</span>
                {s.title}
              </button>
            ))}
            {sections.length === 0 && selectedBookId && (
              <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>Aucune section dans ce livre.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
