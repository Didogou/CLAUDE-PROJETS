'use client'
import { useEffect, useState } from 'react'
import type { Book, Difficulty } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', published: 'Publié', archived: 'Archivé',
}
const STATUS_COLORS: Record<string, string> = {
  draft: '#c9a84c', published: '#4caf7d', archived: '#6b6b80',
}
const DIFFICULTY_ICONS: Record<string, string> = {
  facile: '🌱', normal: '⚔️', difficile: '🔥', expert: '💀',
}

const VISIT_RATE: Record<Difficulty, number> = {
  facile: 0.42, normal: 0.36, difficile: 0.28, expert: 0.22,
}

function estimateTime(book: Book): string {
  const n = book.num_sections
  if (!n) return ''
  const mix = book.content_mix ?? { combat: 20, chance: 10, enigme: 10, magie: 5 }
  const total = mix.combat + mix.chance + mix.enigme + mix.magie
  const narration = Math.max(0, 100 - total)
  const avgMin =
    (mix.combat / 100) * 5 + (mix.magie / 100) * 5 +
    (mix.enigme / 100) * 4 + (mix.chance / 100) * 2 +
    (narration  / 100) * 2
  const visited = Math.round(n * (VISIT_RATE[book.difficulty ?? 'normal']))
  const minutes = Math.round(visited * avgMin)
  if (minutes < 60) return `~${minutes} min`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m === 0 ? `~${h}h` : `~${h}h${m.toString().padStart(2, '0')}`
}

export default function HomePage() {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/books').then(r => r.json()).then(d => {
      setBooks(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }, [])

  async function deleteBook(id: string) {
    setDeletingId(id)
    await fetch(`/api/books/${id}`, { method: 'DELETE' })
    setBooks(prev => prev.filter(b => b.id !== id))
    setDeletingId(null)
    setConfirmId(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>Bibliothèque</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>{books.length} livre{books.length !== 1 ? 's' : ''}</p>
        </div>
        <a href="/books/new" style={{
          background: 'var(--accent)', color: '#0f0f14',
          padding: '0.6rem 1.25rem', borderRadius: '6px',
          textDecoration: 'none', fontWeight: 'bold', fontSize: '0.875rem',
        }}>
          + Nouveau livre
        </a>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Chargement...</p>
      ) : books.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem', background: 'var(--surface)', borderRadius: '12px', border: '1px dashed var(--border)' }}>
          <p style={{ fontSize: '3rem', marginBottom: '1rem' }}>📖</p>
          <p style={{ color: 'var(--muted)' }}>Aucun livre pour l&apos;instant.</p>
          <a href="/books/new" style={{ display: 'inline-block', marginTop: '1rem', color: 'var(--accent)', textDecoration: 'underline' }}>
            Créer votre premier livre →
          </a>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
          {books.map(book => (
            <div key={book.id} style={{ position: 'relative' }}>
              <a href={`/books/${book.id}`} style={{ textDecoration: 'none', display: 'block' }}>
                <div style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: '10px', padding: '1.5rem', cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--foreground)', margin: 0, paddingRight: '0.5rem' }}>
                      {book.title}
                    </h3>
                    <span style={{
                      fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '20px',
                      background: `${STATUS_COLORS[book.status]}22`, color: STATUS_COLORS[book.status],
                      fontWeight: 'bold', whiteSpace: 'nowrap',
                    }}>
                      {STATUS_LABELS[book.status]}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    {[book.theme, book.context_type, book.age_range + ' ans', book.language.toUpperCase()].map(tag => (
                      <span key={tag} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'var(--surface-2)', color: 'var(--muted)' }}>{tag}</span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.3rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                      {DIFFICULTY_ICONS[book.difficulty ?? 'normal']} {book.difficulty ?? 'normal'}
                    </span>
                    {book.num_sections ? (
                      <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 'bold' }}>
                        ⏱ {estimateTime(book)} · {book.num_sections} §
                      </span>
                    ) : null}
                    <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: 0 }}>
                      {new Date(book.created_at).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                </div>
              </a>

              {/* Bouton supprimer */}
              {confirmId === book.id ? (
                <div style={{
                  position: 'absolute', top: '0.5rem', right: '0.5rem',
                  background: 'var(--surface)', border: '1px solid #c94c4c',
                  borderRadius: '8px', padding: '0.5rem 0.75rem',
                  display: 'flex', gap: '0.5rem', alignItems: 'center',
                  fontSize: '0.75rem', zIndex: 10, boxShadow: '0 4px 12px #0004',
                }}>
                  <span style={{ color: '#c94c4c' }}>Supprimer ?</span>
                  <button onClick={() => deleteBook(book.id)} disabled={deletingId === book.id} style={{
                    background: '#c94c4c', color: '#fff', border: 'none',
                    borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontWeight: 'bold',
                  }}>
                    {deletingId === book.id ? '...' : 'Oui'}
                  </button>
                  <button onClick={() => setConfirmId(null)} style={{
                    background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)',
                    borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer',
                  }}>Non</button>
                </div>
              ) : (
                <button
                  onClick={e => { e.preventDefault(); setConfirmId(book.id) }}
                  style={{
                    position: 'absolute', top: '0.6rem', right: '0.6rem',
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: '5px', padding: '0.2rem 0.45rem',
                    cursor: 'pointer', fontSize: '0.75rem', color: 'var(--muted)',
                    opacity: 0, transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                >
                  🗑
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
