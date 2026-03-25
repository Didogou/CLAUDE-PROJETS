'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const THEMES = ['Fantasy', 'Science-Fiction', 'Médiéval', 'Post-Apocalyptique', 'Cyberpunk', 'Horreur', 'Polar', 'Historique', 'Contemporain']

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: '6px', padding: '0.6rem 0.75rem', color: 'var(--foreground)',
  fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.8rem', color: 'var(--muted)',
  marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em',
}
const sectionStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: '10px', padding: '1.75rem', marginBottom: '1.5rem',
}

export default function NewProjectPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [theme, setTheme] = useState('Fantasy')
  const [numBooks, setNumBooks] = useState(1)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Le titre est requis'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), theme, num_books: numBooks, description: description.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur lors de la création')
      router.push(`/projects/${data.id}`)
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/projects" style={{ color: 'var(--muted)', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Retour aux projets
        </a>
        <h2 style={{ fontSize: '1.75rem', color: 'var(--accent)', marginTop: '0.5rem', marginBottom: '0.25rem' }}>
          Nouveau projet
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
          Créez un projet — Claude générera ensuite les résumés de chaque tome.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={sectionStyle}>
          <h3 style={{ fontSize: '1rem', color: 'var(--foreground)', marginBottom: '1.25rem', marginTop: 0 }}>
            Informations générales
          </h3>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>Titre de la série / du projet *</label>
            <input
              style={inputStyle} value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Les Chroniques du Nexus"
              required
            />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>Thème</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {THEMES.map(t => (
                <button
                  key={t} type="button"
                  onClick={() => setTheme(t)}
                  style={{
                    padding: '0.4rem 0.9rem', borderRadius: '6px', cursor: 'pointer',
                    border: '1px solid', fontSize: '0.85rem',
                    background: theme === t ? 'var(--accent)' : 'var(--surface-2)',
                    color: theme === t ? '#0f0f14' : 'var(--foreground)',
                    borderColor: theme === t ? 'var(--accent)' : 'var(--border)',
                    fontWeight: theme === t ? 'bold' : 'normal',
                  }}
                >{t}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>Nombre de tomes</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n} type="button"
                  onClick={() => setNumBooks(n)}
                  style={{
                    width: '2.5rem', height: '2.5rem', borderRadius: '6px', cursor: 'pointer',
                    border: '1px solid', fontSize: '1rem', fontWeight: 'bold',
                    background: numBooks === n ? 'var(--accent)' : 'var(--surface-2)',
                    color: numBooks === n ? '#0f0f14' : 'var(--foreground)',
                    borderColor: numBooks === n ? 'var(--accent)' : 'var(--border)',
                  }}
                >{n}</button>
              ))}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
              {numBooks === 1 ? 'Livre unique — Claude génèrera un résumé complet.' : `Série de ${numBooks} tomes — Claude créera un résumé par tome avec une progression narrative cohérente.`}
            </p>
          </div>

          <div>
            <label style={labelStyle}>Description / Contexte <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optionnel)</span></label>
            <textarea
              style={{ ...inputStyle, height: '120px', resize: 'vertical' }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Univers, inspiration, contraintes narratives, personnages phares..."
            />
          </div>
        </div>

        {error && (
          <div style={{ background: '#c94c4c22', border: '1px solid #c94c4c', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#c94c4c', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !title.trim()}
          style={{
            width: '100%', padding: '0.85rem',
            background: loading || !title.trim() ? 'var(--surface-2)' : 'var(--accent)',
            color: loading || !title.trim() ? 'var(--muted)' : '#0f0f14',
            border: 'none', borderRadius: '8px', cursor: loading || !title.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 'bold', fontSize: '1rem',
          }}
        >
          {loading ? 'Création...' : 'Créer le projet →'}
        </button>
      </form>
    </div>
  )
}
