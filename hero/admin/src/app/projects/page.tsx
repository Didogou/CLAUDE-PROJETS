'use client'
import { useEffect, useState } from 'react'
import type { Project } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  bible_generated: 'Bible générée',
  bible_validated: 'Bible validée',
  in_progress: 'En cours',
  completed: 'Terminé',
}
const STATUS_COLORS: Record<string, string> = {
  draft: '#c9a84c',
  bible_generated: '#6b8cde',
  bible_validated: '#4caf7d',
  in_progress: '#b48edd',
  completed: '#4caf7d',
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      setProjects(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }, [])

  async function deleteProject(id: string) {
    setDeletingId(id)
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    setProjects(prev => prev.filter(p => p.id !== id))
    setDeletingId(null)
    setConfirmId(null)
  }

  return (
    <div style={{ padding: '2rem 2.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>Projets</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>{projects.length} projet{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <a href="/projects/new" style={{
          background: 'var(--accent)', color: '#0f0f14',
          padding: '0.6rem 1.25rem', borderRadius: '6px',
          textDecoration: 'none', fontWeight: 'bold', fontSize: '0.875rem',
        }}>
          + Nouveau projet
        </a>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Chargement...</p>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem', background: 'var(--surface)', borderRadius: '12px', border: '1px dashed var(--border)' }}>
          <p style={{ fontSize: '3rem', marginBottom: '1rem' }}>🗂</p>
          <p style={{ color: 'var(--muted)' }}>Aucun projet pour l&apos;instant.</p>
          <a href="/projects/new" style={{ display: 'inline-block', marginTop: '1rem', color: 'var(--accent)', textDecoration: 'underline' }}>
            Créer votre premier projet →
          </a>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {projects.map(project => (
            <div key={project.id} style={{ position: 'relative' }}>
              <a href={`/projects/${project.id}`} style={{ textDecoration: 'none', display: 'block' }}>
                <div style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: '10px', padding: '1.5rem', cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: '1.15rem', color: 'var(--foreground)', margin: 0, paddingRight: '0.5rem' }}>
                      {project.title}
                    </h3>
                    <span style={{
                      fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '20px', whiteSpace: 'nowrap',
                      background: `${STATUS_COLORS[project.status]}22`, color: STATUS_COLORS[project.status],
                      fontWeight: 'bold',
                    }}>
                      {STATUS_LABELS[project.status] ?? project.status}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'var(--surface-2)', color: 'var(--muted)' }}>
                      {project.theme}
                    </span>
                    <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'var(--surface-2)', color: 'var(--muted)' }}>
                      {project.num_books} tome{project.num_books !== 1 ? 's' : ''}
                    </span>
                    {project.books_count !== undefined && (
                      <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'var(--surface-2)', color: 'var(--accent)' }}>
                        {project.books_count} livre{project.books_count !== 1 ? 's' : ''} créé{project.books_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {project.description && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: 0, lineHeight: 1.5,
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
                    }}>
                      {project.description}
                    </p>
                  )}

                  <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.75rem', marginBottom: 0 }}>
                    {new Date(project.created_at).toLocaleDateString('fr-FR')}
                  </p>
                </div>
              </a>

              {confirmId === project.id ? (
                <div style={{
                  position: 'absolute', top: '0.5rem', right: '0.5rem',
                  background: 'var(--surface)', border: '1px solid #c94c4c',
                  borderRadius: '8px', padding: '0.5rem 0.75rem',
                  display: 'flex', gap: '0.5rem', alignItems: 'center',
                  fontSize: '0.75rem', zIndex: 10, boxShadow: '0 4px 12px #0004',
                }}>
                  <span style={{ color: '#c94c4c' }}>Supprimer ?</span>
                  <button onClick={() => deleteProject(project.id)} disabled={deletingId === project.id} style={{
                    background: '#c94c4c', color: '#fff', border: 'none',
                    borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontWeight: 'bold',
                  }}>
                    {deletingId === project.id ? '...' : 'Oui'}
                  </button>
                  <button onClick={() => setConfirmId(null)} style={{
                    background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)',
                    borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer',
                  }}>Non</button>
                </div>
              ) : (
                <button
                  onClick={e => { e.preventDefault(); setConfirmId(project.id) }}
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
