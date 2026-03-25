'use client'
import { useEffect, useState, use } from 'react'
import type { Project, Book, BookPhase } from '@/types'

interface SynopsisProposal {
  id: string
  book_id: string
  tome: number
  title: string
  issue_type: 'personnage' | 'chronologie' | 'univers' | 'intrigue' | 'ton' | 'fin_serie'
  problem: string
}

// ── Styles ─────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: '10px', padding: '1.5rem', marginBottom: '1.5rem',
}
const btnStyle = (active = true, danger = false): React.CSSProperties => ({
  padding: '0.6rem 1.2rem', borderRadius: '6px', border: 'none',
  cursor: active ? 'pointer' : 'not-allowed',
  fontWeight: 'bold', fontSize: '0.875rem',
  background: !active ? 'var(--surface-2)' : danger ? '#c94c4c' : 'var(--accent)',
  color: !active ? 'var(--muted)' : danger ? '#fff' : '#0f0f14',
})

const PHASE_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  structure_generated: 'Structure générée',
  structure_validated: 'Structure validée',
  writing: 'Rédaction',
  done: 'Terminé',
}
const PHASE_COLORS: Record<string, string> = {
  draft: '#c9a84c',
  structure_generated: '#6b8cde',
  structure_validated: '#4caf7d',
  writing: '#b48edd',
  done: '#4caf7d',
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [project, setProject] = useState<Project | null>(null)
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [synopsisProposals, setSynopsisProposals] = useState<SynopsisProposal[]>([])
  const [analyzingSynopses, setAnalyzingSynopses] = useState(false)
  const [analysisRound, setAnalysisRound] = useState(0)
  const [synopsisAnalysisError, setSynopsisAnalysisError] = useState<string | null>(null)
  // Édition du texte du projet
  const [editingField, setEditingField] = useState(false)
  const [fieldDraft, setFieldDraft] = useState('')
  const [fieldSaving, setFieldSaving] = useState(false)

  useEffect(() => { loadProject() }, [id])

  async function loadProject() {
    setLoading(true)
    const res = await fetch(`/api/projects/${id}`)
    const data = await res.json()
    setProject(data.project ?? null)
    setBooks(data.books ?? [])
    setLoading(false)
  }

  async function action(key: string, url: string, method = 'POST') {
    setBusy(key)
    setMessage(null)
    try {
      const res = await fetch(url, { method })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      setMessage({ type: 'ok', text: 'Opération réussie.' })
      await loadProject()
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message })
    } finally {
      setBusy(null)
    }
  }

  async function analyzeSynopses() {
    setAnalyzingSynopses(true)
    setSynopsisAnalysisError(null)
    setSynopsisProposals([])
    try {
      const res = await fetch(`/api/projects/${id}/analyze-synopses`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      setSynopsisProposals(data.proposals)
      setAnalysisRound(r => r + 1)
      if (data.proposals.length === 0) setSynopsisAnalysisError('✅ Tous les synopsis sont cohérents.')
    } catch (err: any) {
      setSynopsisAnalysisError(`❌ ${err.message}`)
    } finally {
      setAnalyzingSynopses(false)
    }
  }

  async function acceptProposal(proposal: SynopsisProposal, corrections: { book_id: string; corrected_synopsis: string }[]) {
    await Promise.all(corrections.map(c =>
      fetch(`/api/books/${c.book_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synopsis: c.corrected_synopsis }),
      })
    ))
    setSynopsisProposals([])
    await loadProject()
    await analyzeSynopses()
  }

  function rejectProposal(id: string) {
    setSynopsisProposals(p => p.filter(x => x.id !== id))
  }

  async function saveField() {
    setFieldSaving(true)
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: fieldDraft }),
      })
      if (!res.ok) throw new Error('Erreur sauvegarde')
      setEditingField(false)
      await loadProject()
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message })
    } finally {
      setFieldSaving(false)
    }
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Chargement...</p>
  if (!project) return <p style={{ color: '#c94c4c' }}>Projet introuvable.</p>

  const status = project.status
  const canGenerateBooks = status === 'draft'
  const canAnalyze       = status === 'bible_generated' || status === 'bible_validated'
  const canValidate      = status === 'bible_generated'
  const isValidated      = status === 'bible_validated' || status === 'in_progress' || status === 'completed'

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <a href="/projects" style={{ color: 'var(--muted)', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Projets
        </a>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '0.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.75rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>{project.title}</h2>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{project.theme}</span>
              <span style={{ color: 'var(--border)' }}>·</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{project.num_books} tome{project.num_books !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <span style={{
            fontSize: '0.75rem', padding: '0.3rem 0.8rem', borderRadius: '20px',
            background: `${PHASE_COLORS[status] ?? '#888'}22`, color: PHASE_COLORS[status] ?? '#888',
            fontWeight: 'bold', alignSelf: 'flex-start',
          }}>
            {status === 'draft' ? '⬜ Brouillon' :
             status === 'bible_generated' ? '🔵 Bible générée' :
             status === 'bible_validated' ? '✅ Bible validée' :
             status === 'in_progress' ? '🟣 En cours' : '🟢 Terminé'}
          </span>
        </div>
        {/* ── Description ── */}
        {editingField ? (
          <div style={{ marginTop: '0.5rem' }}>
            <textarea
              value={fieldDraft}
              onChange={e => setFieldDraft(e.target.value)}
              rows={6}
              style={{
                width: '100%', fontSize: '0.875rem', lineHeight: 1.6,
                background: 'var(--surface)', color: 'var(--foreground)',
                border: '1px solid var(--accent)', borderRadius: '6px',
                padding: '0.5rem 0.75rem', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
              <button onClick={saveField} disabled={fieldSaving}
                style={{ padding: '0.3rem 0.75rem', borderRadius: '5px', border: 'none', cursor: 'pointer', background: '#4caf7d', color: '#fff', fontSize: '0.78rem', fontWeight: 'bold' }}>
                {fieldSaving ? '...' : '💾 Sauvegarder'}
              </button>
              <button onClick={() => setEditingField(false)}
                style={{ padding: '0.3rem 0.75rem', borderRadius: '5px', border: 'none', cursor: 'pointer', background: 'var(--surface)', color: 'var(--muted)', fontSize: '0.78rem' }}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', marginTop: '0.5rem' }}>
            {project.description && (
              <p style={{ color: 'var(--muted)', fontSize: '0.875rem', margin: 0, flex: 1 }}>{project.description}</p>
            )}
            <button
              onClick={() => { setFieldDraft(project.description ?? ''); setEditingField(true) }}
              title="Modifier la description"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.75rem', padding: '0 0.2rem', flexShrink: 0 }}>
              ✏️
            </button>
          </div>
        )}

      </div>

      {message && (
        <div style={{
          background: message.type === 'ok' ? '#4caf7d22' : '#c94c4c22',
          border: `1px solid ${message.type === 'ok' ? '#4caf7d' : '#c94c4c'}`,
          borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.5rem',
          color: message.type === 'ok' ? '#4caf7d' : '#c94c4c', fontSize: '0.875rem',
        }}>
          {message.text}
        </div>
      )}

      {/* ── Phase 1 : Génération de la bible ────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--foreground)' }}>
            {isValidated ? '✅' : canAnalyze ? '🔵' : '⬜'} Phase 1 — Bible de série
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canGenerateBooks && (
              <button
                style={btnStyle(!busy)}
                disabled={!!busy}
                onClick={() => action('gen-books', `/api/projects/${id}/generate-books`)}
              >
                {busy === 'gen-books' ? 'Génération...' : '🪄 Générer les tomes'}
              </button>
            )}
            {canAnalyze && (
              <button
                style={btnStyle(!busy)}
                disabled={!!busy}
                onClick={() => action('analyze', `/api/projects/${id}/analyze-series`)}
              >
                {busy === 'analyze' ? 'Analyse...' : '🔍 Analyser la cohérence'}
              </button>
            )}
            {canValidate && (
              <button
                style={btnStyle(!busy)}
                disabled={!!busy}
                onClick={() => action('validate', `/api/projects/${id}/validate-series`)}
              >
                {busy === 'validate' ? '...' : '✅ Valider la bible'}
              </button>
            )}
          </div>
        </div>

        {books.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', margin: 0 }}>
            Cliquez sur &quot;Générer les tomes&quot; pour que Claude crée les résumés de chaque livre.
          </p>
        )}

        {books.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[...books].sort((a, b) => (a.order_in_series ?? 0) - (b.order_in_series ?? 0)).map(book => (
              <BookRow key={book.id} book={book} projectValidated={isValidated} onRefresh={loadProject} />
            ))}
          </div>
        )}

        {project.series_analysis && (
          <details style={{ marginTop: '1.25rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: '0.875rem', userSelect: 'none' }}>
              📋 Rapport d&apos;analyse de cohérence
            </summary>
            <div style={{
              marginTop: '0.75rem', padding: '1rem', background: 'var(--surface-2)',
              borderRadius: '8px', fontSize: '0.85rem', lineHeight: 1.7,
              whiteSpace: 'pre-wrap', color: 'var(--foreground)',
            }}>
              {project.series_analysis}
            </div>
          </details>
        )}
      </div>

      {/* ── Cohérence des synopsis ─────────────────────────────────────────── */}
      {books.some(b => b.synopsis) && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--foreground)' }}>
              📝 Cohérence des synopsis
            </h3>
            <button
              style={btnStyle(!analyzingSynopses)}
              disabled={analyzingSynopses}
              onClick={analyzeSynopses}
            >
              {analyzingSynopses
                ? analysisRound === 0 ? '⏳ Analyse en cours...' : '⏳ Vérification en cours...'
                : analysisRound === 0 ? '🔍 Analyser la cohérence' : '🔍 Relancer l\'analyse'}
            </button>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: '0 0 1rem' }}>
            {books.filter(b => b.synopsis).length}/{books.length} tome{books.length > 1 ? 's' : ''} avec synopsis.
            {books.filter(b => !b.synopsis).length > 0 && (
              <span style={{ color: '#c9a84c' }}> Les tomes sans synopsis seront ignorés.</span>
            )}
          </p>

          {synopsisAnalysisError && (
            <p style={{ fontSize: '0.85rem', color: synopsisAnalysisError.startsWith('✅') ? '#4caf7d' : '#c94c4c', margin: 0 }}>
              {synopsisAnalysisError}
            </p>
          )}

          {synopsisProposals.length > 0 && (() => {
            const finSerie = synopsisProposals.filter(p => p.issue_type === 'fin_serie')
            const others   = synopsisProposals.filter(p => p.issue_type !== 'fin_serie')
            const byId     = new Map(books.map(b => [b.id, { tome: b.order_in_series ?? 0, title: b.title, synopsis: b.synopsis ?? '' }]))
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: 0 }}>
                  {synopsisProposals.length} proposition{synopsisProposals.length > 1 ? 's' : ''} — acceptez ou rejetez chacune :
                </p>

                {finSerie.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#f0a742', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      🏁 Fin canonique de série — chemin de victoire unifié
                    </p>
                    {finSerie.map(proposal => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        booksByIdSynopsis={byId}
                        onAccept={(corrections) => acceptProposal(proposal, corrections)}
                        onReject={() => rejectProposal(proposal.id)}
                      />
                    ))}
                  </div>
                )}

                {others.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {finSerie.length > 0 && (
                      <p style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Autres incohérences
                      </p>
                    )}
                    {others.map(proposal => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        booksByIdSynopsis={byId}
                        onAccept={(corrections) => acceptProposal(proposal, corrections)}
                        onReject={() => rejectProposal(proposal.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ── BookRow ────────────────────────────────────────────────────────────────

function BookRow({ book, projectValidated, onRefresh }: {
  book: Book
  projectValidated: boolean
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [writeProgress, setWriteProgress] = useState<{ written: number; total: number } | null>(null)
  const [npcProgress, setNpcProgress] = useState<{ current: number; total: number } | null>(null)
  const [mapImageGenerating, setMapImageGenerating] = useState(false)
  // Résumé
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState(book.book_summary ?? '')
  const [summarySaving, setSummarySaving] = useState(false)
  // Synopsis
  const [synopsisOpen, setSynopsisOpen] = useState(false)
  const [editingSynopsis, setEditingSynopsis] = useState(false)
  const [synopsisDraft, setSynopsisDraft] = useState(book.synopsis ?? '')
  const [synopsisSaving, setSynopsisSaving] = useState(false)
  const [generatingSynopsis, setGeneratingSynopsis] = useState(false)

  const phase = book.phase as BookPhase | null
  const canGenStruct    = projectValidated && (phase === 'draft' || !phase)
  const canAnalyzeSect  = phase === 'structure_generated' || phase === 'structure_validated'
  const canValidateSect = phase === 'structure_generated'
  const canWrite        = phase === 'structure_validated'
  const canReset        = phase === 'structure_generated' || phase === 'structure_validated'
  const isDone          = phase === 'done'

  async function doAction(key: string, url: string) {
    setBusy(key)
    setMessage(null)
    try {
      const res = await fetch(url, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      setMessage('✅ OK')
      onRefresh()
    } catch (err: any) {
      setMessage(`❌ ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  async function validateAndIllustrate() {
    setBusy('validate-sect')
    setMessage(null)
    setNpcProgress(null)
    try {
      // 1. Valider + générer la carte
      const res = await fetch(`/api/books/${book.id}/validate-sections`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur validation')

      setMessage(data.map_generated ? '🗺 Carte générée' : '✅ Structure validée')

      // 2. Générer la carte image + portraits PNJ en parallèle
      setBusy('illustrate-npcs')

      const mapPromise = book.map_style
        ? (setMapImageGenerating(true),
           fetch(`/api/books/${book.id}/generate-map-image`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ provider: process.env.NEXT_PUBLIC_IMAGE_PROVIDER ?? 'replicate' }),
           }).finally(() => setMapImageGenerating(false)))
        : Promise.resolve()

      const npcPromise = new Promise<void>((resolve) => {
        const es = new EventSource(`/api/books/${book.id}/illustrate-npcs?provider=replicate`)
        es.onmessage = (e) => {
          const ev = JSON.parse(e.data)
          if (ev.type === 'start') setNpcProgress({ current: 0, total: ev.total })
          if (ev.type === 'progress' && ev.status === 'done') setNpcProgress(p => p ? { ...p, current: ev.current } : p)
          if (ev.type === 'done' || ev.type === 'error') { es.close(); resolve() }
        }
        es.onerror = () => { es.close(); resolve() }
      })

      await Promise.all([mapPromise, npcPromise])

      setMessage('✅ Structure validée · Carte + PNJ générés')
      onRefresh()
    } catch (err: any) {
      setMessage(`❌ ${err.message}`)
    } finally {
      setBusy(null)
      setNpcProgress(null)
    }
  }

  async function writeAll() {
    setBusy('write')
    setMessage(null)
    setWriteProgress(null)
    try {
      const res = await fetch(`/api/books/${book.id}/write-all`, { method: 'POST' })
      if (!res.body) throw new Error('Pas de stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'section_done') setWriteProgress({ written: ev.written, total: ev.total })
            if (ev.type === 'prologue_start') setWriteProgress(p => p ? { ...p, prologue: true } as any : p)
            if (ev.type === 'done') setMessage(`✅ ${ev.written}/${ev.total} sections rédigées`)
            if (ev.type === 'error') setMessage(`❌ ${ev.message}`)
          } catch {}
        }
      }
      onRefresh()
    } catch (err: any) {
      setMessage(`❌ ${err.message}`)
    } finally {
      setBusy(null)
      setWriteProgress(null)
    }
  }

  async function saveSummary() {
    setSummarySaving(true)
    try {
      const res = await fetch(`/api/books/${book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_summary: summaryDraft }),
      })
      if (!res.ok) throw new Error('Erreur sauvegarde')
      setEditingSummary(false)
      onRefresh()
    } catch (err: any) {
      setMessage(`❌ ${err.message}`)
    } finally {
      setSummarySaving(false)
    }
  }

  async function saveSynopsis() {
    setSynopsisSaving(true)
    try {
      const res = await fetch(`/api/books/${book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synopsis: synopsisDraft }),
      })
      if (!res.ok) throw new Error('Erreur sauvegarde')
      setEditingSynopsis(false)
      onRefresh()
    } catch (err: any) {
      setMessage(`❌ ${err.message}`)
    } finally {
      setSynopsisSaving(false)
    }
  }

  async function generateSynopsis() {
    setGeneratingSynopsis(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/books/${book.id}/rewrite-synopsis`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      setSynopsisDraft(data.synopsis)
      setSynopsisOpen(true)
      setEditingSynopsis(true)
      onRefresh()
    } catch (err: any) {
      setMessage(`❌ ${err.message}`)
    } finally {
      setGeneratingSynopsis(false)
    }
  }

  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '1rem 1.25rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>Tome {book.order_in_series}</span>
            <a href={`/books/${book.id}`} style={{
              color: 'var(--foreground)', textDecoration: 'none', fontWeight: 'bold',
              fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {book.title}
            </a>
            {phase && (
              <span style={{
                fontSize: '0.65rem', padding: '0.1rem 0.45rem', borderRadius: '10px', flexShrink: 0,
                background: `${PHASE_COLORS[phase] ?? '#888'}22`, color: PHASE_COLORS[phase] ?? '#888',
                fontWeight: 'bold',
              }}>
                {PHASE_LABELS[phase] ?? phase}
              </span>
            )}
          </div>

          {/* ── Résumé ── */}
          {editingSummary ? (
            <div style={{ marginTop: '0.4rem' }}>
              <textarea
                value={summaryDraft}
                onChange={e => setSummaryDraft(e.target.value)}
                rows={4}
                style={{
                  width: '100%', fontSize: '0.8rem', lineHeight: 1.6,
                  background: 'var(--surface)', color: 'var(--foreground)',
                  border: '1px solid var(--accent)', borderRadius: '6px',
                  padding: '0.5rem 0.75rem', resize: 'vertical', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                <button onClick={saveSummary} disabled={summarySaving}
                  style={{ padding: '0.3rem 0.75rem', borderRadius: '5px', border: 'none', cursor: 'pointer', background: '#4caf7d', color: '#fff', fontSize: '0.78rem', fontWeight: 'bold' }}>
                  {summarySaving ? '...' : '💾 Sauvegarder'}
                </button>
                <button onClick={() => { setEditingSummary(false); setSummaryDraft(book.book_summary ?? '') }}
                  style={{ padding: '0.3rem 0.75rem', borderRadius: '5px', border: 'none', cursor: 'pointer', background: 'var(--surface)', color: 'var(--muted)', fontSize: '0.78rem' }}>
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', marginTop: '0.2rem' }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: 0, lineHeight: 1.5, flex: 1 }}>
                {book.book_summary
                  ? (book.book_summary.length > 200 ? book.book_summary.slice(0, 200) + '…' : book.book_summary)
                  : <em style={{ color: 'var(--border)' }}>Aucun résumé</em>}
              </p>
              <button onClick={() => { setSummaryDraft(book.book_summary ?? ''); setEditingSummary(true) }}
                title="Modifier le résumé"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.75rem', padding: '0 0.2rem', flexShrink: 0 }}>
                ✏️
              </button>
            </div>
          )}

          {/* ── Synopsis ── */}
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                onClick={() => setSynopsisOpen(o => !o)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.72rem', color: book.synopsis ? 'var(--accent)' : 'var(--muted)', padding: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                {synopsisOpen ? '▾' : '▸'} {book.synopsis ? '📝 Synopsis' : '📝 Pas de synopsis'}
              </button>
              <button
                onClick={generateSynopsis}
                disabled={generatingSynopsis || !book.book_summary}
                title={book.book_summary ? 'Générer un synopsis à partir du résumé' : 'Ajoutez un résumé d\'abord'}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', cursor: book.book_summary ? 'pointer' : 'not-allowed', fontSize: '0.7rem', color: 'var(--muted)', padding: '0.1rem 0.4rem' }}
              >
                {generatingSynopsis ? '⏳ Génération...' : '✨ Générer'}
              </button>
            </div>

            {synopsisOpen && (
              <div style={{ marginTop: '0.4rem', paddingLeft: '0.75rem', borderLeft: '2px solid var(--border)' }}>
                {editingSynopsis ? (
                  <>
                    <textarea
                      value={synopsisDraft}
                      onChange={e => setSynopsisDraft(e.target.value)}
                      rows={16}
                      style={{
                        width: '100%', fontSize: '0.8rem', lineHeight: 1.7,
                        background: 'var(--surface)', color: 'var(--foreground)',
                        border: '1px solid var(--accent)', borderRadius: '6px',
                        padding: '0.5rem 0.75rem', resize: 'vertical', boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                      <button onClick={saveSynopsis} disabled={synopsisSaving}
                        style={{ padding: '0.3rem 0.75rem', borderRadius: '5px', border: 'none', cursor: 'pointer', background: '#4caf7d', color: '#fff', fontSize: '0.78rem', fontWeight: 'bold' }}>
                        {synopsisSaving ? '...' : '💾 Sauvegarder'}
                      </button>
                      <button onClick={() => { setEditingSynopsis(false); setSynopsisDraft(book.synopsis ?? '') }}
                        style={{ padding: '0.3rem 0.75rem', borderRadius: '5px', border: 'none', cursor: 'pointer', background: 'var(--surface)', color: 'var(--muted)', fontSize: '0.78rem' }}>
                        Annuler
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                    <p style={{ fontSize: '0.78rem', color: 'var(--foreground)', margin: 0, lineHeight: 1.7, flex: 1, whiteSpace: 'pre-line' }}>
                      {book.synopsis ?? <em style={{ color: 'var(--muted)' }}>Cliquez sur &quot;✨ Générer&quot; pour créer le synopsis.</em>}
                    </p>
                    {book.synopsis && (
                      <button onClick={() => { setSynopsisDraft(book.synopsis ?? ''); setEditingSynopsis(true) }}
                        title="Modifier le synopsis"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '0.75rem', padding: '0 0.2rem', flexShrink: 0 }}>
                        ✏️
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, flexWrap: 'wrap' }}>
          {canGenStruct && (
            <a href={`/books/${book.id}`} style={{ ...btnStyle(true), textDecoration: 'none', display: 'inline-block' }}>
              🏗 Structure
            </a>
          )}
          {canAnalyzeSect && (
            <button style={btnStyle(!busy)} disabled={!!busy}
              onClick={() => doAction('analyze-sect', `/api/books/${book.id}/analyze-sections`)}>
              {busy === 'analyze-sect' ? '⏳' : '🔍 Analyser'}
            </button>
          )}
          {canValidateSect && (
            <button style={btnStyle(!busy)} disabled={!!busy} onClick={validateAndIllustrate}>
              {busy === 'validate-sect' ? '⏳ Validation…'
                : busy === 'illustrate-npcs'
                  ? mapImageGenerating ? '🗺 Carte…'
                  : npcProgress ? `🎨 PNJ ${npcProgress.current}/${npcProgress.total}` : '🎨 PNJ…'
                  : '✅ Valider'}
            </button>
          )}
          {canReset && (
            <button style={btnStyle(!busy, true)} disabled={!!busy}
              onClick={async () => {
                setBusy('reset-struct')
                setMessage(null)
                try {
                  const res = await fetch(`/api/books/${book.id}/reset-structure`, { method: 'POST' })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.error ?? 'Erreur')
                  window.location.href = `/books/${book.id}`
                } catch (err: any) {
                  setMessage(`❌ ${err.message}`)
                  setBusy(null)
                }
              }}>
              {busy === 'reset-struct' ? '⏳' : '🔄 Régénérer'}
            </button>
          )}
          {canWrite && (
            <button style={btnStyle(!busy)} disabled={!!busy} onClick={writeAll}>
              {busy === 'write'
                ? writeProgress
                  ? (writeProgress as any).prologue ? '📖 Prologue…' : `✍️ ${writeProgress.written}/${writeProgress.total}`
                  : '⏳ Démarrage...'
                : '✍️ Rédiger tout'}
            </button>
          )}
          {isDone && (
            <a href={`/books/${book.id}`} style={{
              ...btnStyle(true), textDecoration: 'none', display: 'inline-block',
            }}>
              📖 Voir le livre
            </a>
          )}
        </div>
      </div>

      {message && (
        <p style={{ fontSize: '0.78rem', marginTop: '0.5rem', marginBottom: 0, color: message.startsWith('✅') ? '#4caf7d' : '#c94c4c' }}>
          {message}
        </p>
      )}
    </div>
  )
}

// ── ProposalCard ───────────────────────────────────────────────────────────

const ISSUE_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  personnage:  { label: 'Personnage',   color: '#e05c4b' },
  chronologie: { label: 'Chronologie',  color: '#c9a84c' },
  univers:     { label: 'Univers',      color: '#6b8cde' },
  intrigue:    { label: 'Intrigue',     color: '#b48edd' },
  ton:         { label: 'Ton',          color: '#4ec9b0' },
  fin_serie:   { label: '🏁 Fin canonique', color: '#f0a742' },
}

interface SynopsisCorrection {
  book_id: string
  tome: number
  title: string
  corrected_synopsis: string
}

function ProposalCard({ proposal, booksByIdSynopsis, onAccept, onReject }: {
  proposal: SynopsisProposal
  booksByIdSynopsis: Map<string, { tome: number; title: string; synopsis: string }>
  onAccept: (corrections: { book_id: string; corrected_synopsis: string }[]) => void
  onReject: () => void
}) {
  const [corrections, setCorrections] = useState<SynopsisCorrection[] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const cfg = ISSUE_TYPE_CONFIG[proposal.issue_type] ?? { label: proposal.issue_type, color: '#888' }

  async function loadCorrection() {
    if (corrections) { setShowDiff(s => !s); return }
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch(`/api/books/${proposal.book_id}/fix-synopsis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_type: proposal.issue_type, problem: proposal.problem }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      setCorrections(data.corrections)
      setShowDiff(true)
    } catch (err: any) {
      setGenError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function handleAccept() {
    if (!corrections) return
    setAccepting(true)
    await onAccept(corrections.map(c => ({ book_id: c.book_id, corrected_synopsis: c.corrected_synopsis })))
    setAccepting(false)
  }

  const multiBook = corrections && corrections.length > 1

  return (
    <div style={{
      border: `1px solid ${cfg.color}44`, borderRadius: '8px',
      padding: '1rem 1.25rem', background: `${cfg.color}08`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.68rem', padding: '0.15rem 0.5rem', borderRadius: '10px', fontWeight: 'bold',
              background: `${cfg.color}22`, color: cfg.color,
            }}>
              {cfg.label}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
              Tome {proposal.tome} — <em>{proposal.title}</em>
            </span>
            {multiBook && (
              <span style={{ fontSize: '0.7rem', color: cfg.color, fontStyle: 'italic' }}>
                → correction sur {corrections!.length} tomes
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--foreground)', margin: 0, lineHeight: 1.6 }}>
            {proposal.problem}
          </p>
          {genError && <p style={{ fontSize: '0.78rem', color: '#c94c4c', margin: '0.4rem 0 0' }}>{genError}</p>}
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, flexWrap: 'wrap' }}>
          <button
            onClick={loadCorrection} disabled={generating}
            style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.78rem' }}
          >
            {generating ? '⏳ Génération...' : showDiff ? 'Masquer' : corrections ? '👁 Voir' : '👁 Générer la correction'}
          </button>
          <button
            onClick={handleAccept} disabled={accepting || !corrections}
            title={!corrections ? 'Générez la correction d\'abord' : multiBook ? `Accepter les corrections sur ${corrections!.length} tomes` : 'Accepter'}
            style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: 'none', cursor: corrections ? 'pointer' : 'not-allowed', background: corrections ? '#4caf7d' : 'var(--surface-2)', color: corrections ? '#fff' : 'var(--muted)', fontSize: '0.78rem', fontWeight: 'bold' }}
          >
            {accepting ? '...' : multiBook ? `✅ Accepter (${corrections!.length} tomes)` : '✅ Accepter'}
          </button>
          <button
            onClick={onReject}
            style={{ padding: '0.35rem 0.7rem', borderRadius: '5px', border: 'none', cursor: 'pointer', background: '#c94c4c22', color: '#c94c4c', fontSize: '0.78rem' }}
          >
            ✕ Rejeter
          </button>
        </div>
      </div>

      {/* Diff par tome */}
      {showDiff && corrections && (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {corrections.map(c => {
            const current = booksByIdSynopsis.get(c.book_id)
            return (
              <div key={c.book_id}>
                {multiBook && (
                  <p style={{ fontSize: '0.72rem', color: cfg.color, fontWeight: 'bold', margin: '0 0 0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Tome {c.tome} — {c.title}
                  </p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--muted)', margin: '0 0 0.25rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actuel</p>
                    <div style={{
                      fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.6, whiteSpace: 'pre-line',
                      background: 'var(--surface-2)', borderRadius: '6px', padding: '0.6rem 0.75rem',
                      maxHeight: '280px', overflowY: 'auto',
                    }}>
                      {current?.synopsis || <em>Aucun synopsis</em>}
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.7rem', color: '#4caf7d', margin: '0 0 0.25rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Correction proposée</p>
                    <div style={{
                      fontSize: '0.78rem', color: 'var(--foreground)', lineHeight: 1.6, whiteSpace: 'pre-line',
                      background: '#4caf7d0d', border: '1px solid #4caf7d33', borderRadius: '6px', padding: '0.6rem 0.75rem',
                      maxHeight: '280px', overflowY: 'auto',
                    }}>
                      {c.corrected_synopsis}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
