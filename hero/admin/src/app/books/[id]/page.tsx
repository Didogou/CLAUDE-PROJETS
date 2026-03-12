'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { Book, Section, Choice, SectionStatus, Npc, NpcType } from '@/types'

// ── Config ────────────────────────────────────────────────────────────────────

const BOOK_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', published: 'Publié', archived: 'Archivé',
}

const SECTION_STATUS_CONFIG: Record<SectionStatus, { label: string; color: string; bg: string }> = {
  draft:       { label: 'Brouillon',  color: '#6b6b80', bg: '#6b6b8022' },
  in_progress: { label: 'En cours',   color: '#c9a84c', bg: '#c9a84c22' },
  validated:   { label: 'Validé',     color: '#4caf7d', bg: '#4caf7d22' },
}

// ── Type de section ────────────────────────────────────────────────────────────

type SectionTypeInfo = { icon: string; label: string; color: string }

const SECTION_TYPES: SectionTypeInfo[] = [
  { icon: '📖', label: 'Narration',   color: '#6b6b80' },
  { icon: '⚔️',  label: 'Combat',     color: '#e05c4b' },
  { icon: '🧩', label: 'Énigme',      color: '#6b8cde' },
  { icon: '🏃', label: 'Agilité',     color: '#4ec9b0' },
  { icon: '✨', label: 'Magie',       color: '#b48edd' },
  { icon: '🎲', label: 'Chance',      color: '#f0a742' },
  { icon: '🔓', label: 'Crochetage',  color: '#a8c97f' },
  { icon: '🏆', label: 'Victoire',    color: '#4caf7d' },
  { icon: '💀', label: 'Mort',        color: '#c94c4c' },
  { icon: '💬', label: 'Dialogue',    color: '#64b5f6' },
]

function getSectionType(section: Section): SectionTypeInfo {
  if (section.is_ending)
    return section.ending_type === 'victory' ? SECTION_TYPES[7] : SECTION_TYPES[8]
  if (section.trial) {
    const map: Record<string, SectionTypeInfo> = {
      combat: SECTION_TYPES[1], intelligence: SECTION_TYPES[2],
      agilite: SECTION_TYPES[3], magie: SECTION_TYPES[4],
      chance: SECTION_TYPES[5], crochetage: SECTION_TYPES[6],
      dialogue: SECTION_TYPES[9],
    }
    return map[section.trial.type] ?? { icon: '⚡', label: section.trial.type, color: '#c9a84c' }
  }
  return SECTION_TYPES[0]
}

// ── NPC config ────────────────────────────────────────────────────────────────

const NPC_TYPE_CONFIG: Record<NpcType, { label: string; color: string; icon: string }> = {
  ennemi:   { label: 'Ennemi',    color: '#e05c4b', icon: '👹' },
  boss:     { label: 'Boss',      color: '#c94c4c', icon: '💀' },
  allié:    { label: 'Allié',     color: '#4caf7d', icon: '🤝' },
  neutre:   { label: 'Neutre',    color: '#6b8cde', icon: '🧑' },
  marchand: { label: 'Marchand',  color: '#f0a742', icon: '🛒' },
}

const STATS = [
  { key: 'force',        label: 'Force',        color: '#e05c4b', icon: '💪' },
  { key: 'agilite',      label: 'Agilité',      color: '#4ec9b0', icon: '🏃' },
  { key: 'intelligence', label: 'Intelligence',  color: '#6b8cde', icon: '🧠' },
  { key: 'magie',        label: 'Magie',         color: '#b48edd', icon: '✨' },
  { key: 'endurance',    label: 'Endurance (PV)', color: '#4caf7d', icon: '❤️' },
  { key: 'chance',       label: 'Chance',        color: '#f0a742', icon: '🎲' },
] as const

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BookPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [book, setBook] = useState<Book | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [choices, setChoices] = useState<Choice[]>([])
  const [npcs, setNpcs] = useState<Npc[]>([])
  const [loading, setLoading] = useState(true)
  const [bookSaving, setBookSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [narrationPanel, setNarrationPanel] = useState<{ sectionId: string; content: string } | null>(null)
  const [sectionSaving, setSectionSaving] = useState<string | null>(null)
  const [tab, setTab] = useState<'sections' | 'plan' | 'npcs'>('sections')
  const [planHighlight, setPlanHighlight] = useState<number | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const [bookRes, npcRes] = await Promise.all([
        fetch(`/api/books/${id}`),
        fetch(`/api/books/${id}/npcs`),
      ])
      if (!bookRes.ok) { setLoading(false); return }
      const { book: b, sections: s, choices: c } = await bookRes.json()
      const npcData = await npcRes.json()
      setBook(b); setSections(s ?? []); setChoices(c ?? [])
      setNpcs(Array.isArray(npcData) ? npcData : [])
      setLoading(false)
    }
    load()
  }, [id])

  // ── Actions livre ──────────────────────────────────────────────────────────

  async function deleteBook() {
    setBookSaving(true)
    await fetch(`/api/books/${id}`, { method: 'DELETE' })
    router.push('/')
  }

  async function updateBookStatus(status: string) {
    setBookSaving(true)
    await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_id: id, status }) })
    setBook(b => b ? { ...b, status: status as any } : b)
    setBookSaving(false)
  }

  async function saveTitle() {
    const t = titleInput.trim()
    if (!t || t === book?.title) { setEditingTitle(false); return }
    setBookSaving(true)
    await fetch(`/api/books/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) })
    setBook(b => b ? { ...b, title: t } : b)
    setBookSaving(false)
    setEditingTitle(false)
  }

  // ── Actions section ────────────────────────────────────────────────────────

  async function saveSection(sectionId: string) {
    setSectionSaving(sectionId)
    await fetch(`/api/sections/${sectionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editContent, summary: editSummary }) })
    setSections(ss => ss.map(s => s.id === sectionId ? { ...s, content: editContent, summary: editSummary } : s))
    setEditingSection(null); setSectionSaving(null)
  }

  async function updateSectionStatus(sectionId: string, status: SectionStatus) {
    setSectionSaving(sectionId)
    await fetch(`/api/sections/${sectionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    setSections(ss => ss.map(s => s.id === sectionId ? { ...s, status } : s))
    setSectionSaving(null)
  }

  function scrollToSection(number: number) {
    document.getElementById(`sec-${number}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const sectionChoices = (sectionId: string) =>
    choices.filter(c => c.section_id === sectionId).sort((a, b) => a.sort_order - b.sort_order)

  if (loading) return <p style={{ color: 'var(--muted)' }}>Chargement...</p>
  if (!book) return <p style={{ color: 'var(--danger)' }}>Livre introuvable.</p>

  const validated = sections.filter(s => s.status === 'validated').length
  const inProgress = sections.filter(s => s.status === 'in_progress').length

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.875rem', marginBottom: '0.5rem', padding: 0 }}>
            ← Bibliothèque
          </button>
          {editingTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.1rem' }}>
              <input
                autoFocus
                value={titleInput}
                onChange={e => setTitleInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                style={{
                  fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)',
                  background: 'var(--surface-2)', border: '1px solid var(--accent)',
                  borderRadius: '6px', padding: '0.2rem 0.6rem', outline: 'none', width: '360px',
                }}
              />
              <button onClick={saveTitle} disabled={bookSaving} style={{ background: 'var(--accent)', color: '#0f0f14', border: 'none', borderRadius: '5px', padding: '0.3rem 0.7rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}>
                {bookSaving ? '...' : '✓'}
              </button>
              <button onClick={() => setEditingTitle(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.82rem' }}>
                Annuler
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ fontSize: '1.75rem', color: 'var(--accent)', margin: 0 }}>{book.title}</h2>
              <button onClick={() => { setTitleInput(book.title); setEditingTitle(true) }} title="Modifier le titre" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', opacity: 0.6, padding: '0.2rem' }}>
                ✏️
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            {[book.theme, book.context_type, book.age_range + ' ans', book.language.toUpperCase()].map(tag => (
              <span key={tag} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'var(--surface-2)', color: 'var(--muted)' }}>{tag}</span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            {BOOK_STATUS_LABELS[book.status]} · {sections.length} sections · {validated} validées
          </span>
          {book.status === 'draft' && (
            <button onClick={() => updateBookStatus('published')} disabled={bookSaving} style={btnStyle('#4caf7d', '#fff')}>
              {bookSaving ? '...' : '✓ Publier'}
            </button>
          )}
          {book.status === 'published' && (<>
            <button onClick={() => updateBookStatus('draft')} disabled={bookSaving} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>
              {bookSaving ? '...' : '↩ Brouillon'}
            </button>
            <button onClick={() => updateBookStatus('archived')} disabled={bookSaving} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>
              Archiver
            </button>
          </>)}
          {book.status === 'archived' && (
            <button onClick={() => updateBookStatus('draft')} disabled={bookSaving} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>
              ↩ Restaurer
            </button>
          )}
          {/* Supprimer */}
          {confirmDelete ? (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', background: 'var(--surface)', border: '1px solid #c94c4c', borderRadius: '6px', padding: '0.35rem 0.6rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#c94c4c' }}>Supprimer définitivement ?</span>
              <button onClick={deleteBook} disabled={bookSaving} style={btnStyle('#c94c4c', '#fff')}>
                {bookSaving ? '...' : 'Oui'}
              </button>
              <button onClick={() => setConfirmDelete(false)} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>Non</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={btnStyle('#c94c4c11', '#c94c4c', '1px solid #c94c4c44')}>
              🗑 Supprimer
            </button>
          )}
        </div>
      </div>

      {/* ── Barre de progression ───────────────────────────────────────────── */}
      {sections.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
            <span style={{ color: '#4caf7d' }}>● {validated} validées</span>
            <span style={{ color: '#c9a84c' }}>● {inProgress} en cours</span>
            <span>● {sections.length - validated - inProgress} brouillon</span>
          </div>
          <div style={{ height: '6px', background: 'var(--surface-2)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${(validated / sections.length) * 100}%`, background: '#4caf7d', transition: 'width 0.3s' }} />
            <div style={{ width: `${(inProgress / sections.length) * 100}%`, background: '#c9a84c', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* ── Onglets ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
        {([
          { key: 'sections', label: '📝 Sections' },
          { key: 'plan',     label: '🗺 Plan graphique' },
          { key: 'npcs',     label: `👥 PNJ (${npcs.length})` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '0.5rem 1rem', fontSize: '0.875rem',
            fontWeight: tab === t.key ? 'bold' : 'normal',
            color: tab === t.key ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: '-1px',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Légende + Filtres ────────────────────────────────────────────────── */}
      {(tab === 'sections' || tab === 'plan') && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
          marginBottom: '1.25rem', padding: '0.6rem 0.9rem',
          background: 'var(--surface)', borderRadius: '8px',
          border: '1px solid var(--border)', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginRight: '0.25rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Filtrer
          </span>
          {SECTION_TYPES.map(t => {
            const active = activeFilters.has(t.label)
            return (
              <button key={t.label} onClick={() => {
                setActiveFilters(prev => {
                  const next = new Set(prev)
                  active ? next.delete(t.label) : next.add(t.label)
                  return next
                })
              }} style={{
                fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '20px',
                background: active ? t.color + '44' : t.color + '18',
                color: t.color, display: 'flex', alignItems: 'center', gap: '0.3rem',
                border: active ? `1.5px solid ${t.color}` : '1.5px solid transparent',
                cursor: 'pointer', fontWeight: active ? 'bold' : 'normal',
                transition: 'all 0.15s',
              }}>
                {t.icon} {t.label}
              </button>
            )
          })}
          {activeFilters.size > 0 && (
            <button onClick={() => setActiveFilters(new Set())} style={{
              fontSize: '0.68rem', padding: '0.2rem 0.55rem', borderRadius: '20px',
              background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)',
              cursor: 'pointer', marginLeft: '0.25rem',
            }}>
              ✕ Réinitialiser
            </button>
          )}
        </div>
      )}

      {/* ── Onglet Sections ─────────────────────────────────────────────────── */}
      {tab === 'sections' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {sections.filter(s => {
            if (activeFilters.size === 0) return true
            return activeFilters.has(getSectionType(s).label)
          }).map(section => {
            const sc = SECTION_STATUS_CONFIG[section.status ?? 'draft']
            const t = getSectionType(section)
            const isEditing = editingSection === section.id
            const isSaving = sectionSaving === section.id
            const sChoices = sectionChoices(section.id)
            return (
              <div key={section.id} id={`sec-${section.number}`} style={{
                background: 'var(--surface)',
                border: `1px solid ${t.color}44`,
                borderRadius: '10px', padding: '1.25rem', scrollMarginTop: '1rem',
              }}>
                {/* En-tête */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{
                      background: t.color + '33', color: t.color,
                      borderRadius: '50%', width: '32px', height: '32px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.85rem', flexShrink: 0,
                    }}>
                      {t.icon}
                    </span>
                    <span style={{ fontWeight: 'bold', color: 'var(--accent)', fontSize: '1rem' }}>§{section.number}</span>
                    <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '4px', background: t.color + '22', color: t.color, fontWeight: 'bold' }}>
                      {t.label}
                    </span>
                    {/* Lien PNJ si combat */}
                    {section.trial?.npc_id && (() => {
                      const npc = npcs.find(n => n.id === section.trial!.npc_id)
                      return npc ? (
                        <button onClick={() => setTab('npcs')} style={{
                          fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '4px',
                          background: NPC_TYPE_CONFIG[npc.type].color + '22',
                          color: NPC_TYPE_CONFIG[npc.type].color,
                          border: `1px solid ${NPC_TYPE_CONFIG[npc.type].color}44`,
                          cursor: 'pointer', fontWeight: 'bold',
                        }}>
                          {NPC_TYPE_CONFIG[npc.type].icon} {npc.name}
                        </button>
                      ) : null
                    })()}
                    <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '4px', background: sc.bg, color: sc.color, fontWeight: 'bold' }}>
                      {sc.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    {(['draft', 'in_progress', 'validated'] as SectionStatus[]).map(s => (
                      <button key={s} onClick={() => updateSectionStatus(section.id, s)}
                        disabled={isSaving || section.status === s}
                        style={{
                          fontSize: '0.65rem', padding: '0.2rem 0.5rem', borderRadius: '4px',
                          border: `1px solid ${SECTION_STATUS_CONFIG[s].color}`,
                          background: section.status === s ? SECTION_STATUS_CONFIG[s].bg : 'transparent',
                          color: SECTION_STATUS_CONFIG[s].color,
                          cursor: section.status === s ? 'default' : 'pointer', opacity: isSaving ? 0.5 : 1,
                        }}>
                        {SECTION_STATUS_CONFIG[s].label}
                      </button>
                    ))}
                    <button onClick={() => { setPlanHighlight(section.number); setTab('plan') }}
                      title="Voir dans le plan"
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>
                      📐 Plan
                    </button>
                    {!isEditing && (
                      <button onClick={() => setNarrationPanel({ sectionId: section.id, content: section.content })}
                        style={{ background: 'none', border: '1px solid #b48edd66', borderRadius: '4px', color: '#b48edd', cursor: 'pointer', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>
                        ✨ Narration
                      </button>
                    )}
                    <button onClick={() => {
                      if (isEditing) { setEditingSection(null) }
                      else { setEditingSection(section.id); setEditContent(section.content); setEditSummary(section.summary ?? '') }
                    }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', cursor: 'pointer', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>
                      {isEditing ? 'Annuler' : '✏ Modifier'}
                    </button>
                  </div>
                </div>

                {/* Résumé */}
                {!isEditing && section.summary && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--accent)', fontStyle: 'italic', margin: '0 0 0.65rem', opacity: 0.85 }}>
                    ✦ {section.summary}
                  </p>
                )}

                {isEditing ? (
                  <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.3rem' }}>
                      Résumé (max 12 mots)
                    </label>
                    <input
                      value={editSummary}
                      onChange={e => setEditSummary(e.target.value)}
                      placeholder="Ex: Vous affrontez le garde devant la porte"
                      style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--accent)', borderRadius: '6px', padding: '0.45rem 0.7rem', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', marginBottom: '0.75rem', fontStyle: 'italic' }}
                    />
                    <label style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.3rem' }}>
                      Contenu
                    </label>
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)} style={{
                      width: '100%', minHeight: '200px', background: 'var(--surface-2)',
                      border: '1px solid var(--accent)', borderRadius: '6px',
                      padding: '0.75rem', color: 'var(--foreground)', fontSize: '0.875rem',
                      resize: 'vertical', outline: 'none', fontFamily: 'Georgia, serif', boxSizing: 'border-box',
                    }} />
                    <button onClick={() => saveSection(section.id)} disabled={isSaving} style={{
                      marginTop: '0.5rem', background: 'var(--accent)', color: '#0f0f14',
                      border: 'none', borderRadius: '4px', padding: '0.4rem 0.9rem',
                      cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem',
                    }}>
                      {isSaving ? 'Sauvegarde...' : 'Sauvegarder'}
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.875rem', lineHeight: '1.7', color: 'var(--foreground)', margin: 0, whiteSpace: 'pre-wrap' }}>
                    {section.content}
                  </p>
                )}

                {/* Carte de combat ou de dialogue */}
                {section.trial && section.trial.type !== 'dialogue' && (
                  <CombatCard
                    trial={section.trial}
                    npcs={npcs}
                    sections={sections}
                    onNavigate={scrollToSection}
                  />
                )}
                {section.trial?.type === 'dialogue' && (
                  <DialogueCard
                    trial={section.trial}
                    npcs={npcs}
                    sections={sections}
                    book={book}
                    sectionNumber={section.number}
                    onNavigate={scrollToSection}
                  />
                )}

                {sChoices.length > 0 && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {sChoices.map(choice => {
                      const targetNum = sections.find(s => s.id === choice.target_section_id)?.number
                      return (
                        <button key={choice.id} onClick={() => targetNum && scrollToSection(targetNum)}
                          disabled={!targetNum}
                          style={{
                            textAlign: 'left', background: 'var(--surface-2)',
                            border: '1px solid var(--border)', borderRadius: '6px',
                            padding: '0.4rem 0.75rem', cursor: targetNum ? 'pointer' : 'default',
                            fontSize: '0.82rem', color: 'var(--foreground)', transition: 'border-color 0.15s',
                          }}
                          onMouseEnter={e => { if (targetNum) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
                        >
                          <span style={{ color: 'var(--accent)', marginRight: '0.5rem' }}>→</span>
                          {choice.label}
                          {targetNum && <span style={{ color: 'var(--muted)', fontSize: '0.7rem', marginLeft: '0.5rem' }}>[§{targetNum}]</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Panneau Narration ────────────────────────────────────────────────── */}
      {narrationPanel && (
        <NarrationPanel
          sectionId={narrationPanel.sectionId}
          content={narrationPanel.content}
          onApply={(sectionId, newContent) => {
            setSections(ss => ss.map(s => s.id === sectionId ? { ...s, content: newContent } : s))
            fetch(`/api/sections/${sectionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: newContent }) })
            setNarrationPanel(null)
          }}
          onClose={() => setNarrationPanel(null)}
        />
      )}

      {/* ── Onglet Plan ─────────────────────────────────────────────────────── */}
      {tab === 'plan' && <GraphView sections={sections} choices={choices} activeFilters={activeFilters} highlightNumber={planHighlight} onHighlightDone={() => setPlanHighlight(null)} onNavigate={(n) => { setTab('sections'); scrollToSection(n) }} />}

      {/* ── Onglet PNJ ──────────────────────────────────────────────────────── */}
      {tab === 'npcs' && (
        <NpcTab bookId={id} npcs={npcs} setNpcs={setNpcs} sections={sections} onNavigate={(n) => { setTab('sections'); scrollToSection(n) }} />
      )}
    </div>
  )
}

// ── Carte de combat ───────────────────────────────────────────────────────────

function CombatCard({ trial, npcs, sections, onNavigate }: {
  trial: NonNullable<Section['trial']>
  npcs: Npc[]
  sections: Section[]
  onNavigate: (n: number) => void
}) {
  const npc = trial.npc_id ? npcs.find(n => n.id === trial.npc_id) : null
  const enemy = npc ?? trial.enemy
  const successNum = trial.success_section_id ? sections.find(s => s.id === trial.success_section_id)?.number : null
  const failureNum = trial.failure_section_id ? sections.find(s => s.id === trial.failure_section_id)?.number : null

  if (!enemy && !trial.type) return null

  const isMagic  = trial.type === 'magie'
  const borderCol = isMagic ? '#b48edd' : '#e05c4b'

  const statRows = npc ? [
    { key: 'force',        label: 'Force',   color: '#e05c4b', icon: '💪', val: npc.force },
    { key: 'endurance',    label: 'PV max',  color: '#4caf7d', icon: '❤️',  val: npc.endurance },
    { key: 'agilite',      label: 'Agilité', color: '#4ec9b0', icon: '🏃',  val: npc.agilite },
    { key: 'magie',        label: 'Magie',   color: '#b48edd', icon: '✨',  val: npc.magie },
    { key: 'intelligence', label: 'Intel.',  color: '#6b8cde', icon: '🧠',  val: npc.intelligence },
    { key: 'chance',       label: 'Chance',  color: '#f0a742', icon: '🎲',  val: npc.chance },
  ] : [
    { key: 'force',     label: 'Force',  color: '#e05c4b', icon: '💪', val: (enemy as any)?.force ?? 0 },
    { key: 'endurance', label: 'PV max', color: '#4caf7d', icon: '❤️',  val: (enemy as any)?.endurance ?? 0 },
  ]

  const tc = npc ? NPC_TYPE_CONFIG[npc.type] : NPC_TYPE_CONFIG['ennemi']

  return (
    <div style={{
      marginTop: '0.85rem',
      border: `1px solid ${borderCol}55`,
      borderRadius: '10px',
      padding: '0.9rem 1rem',
      background: `${borderCol}06`,
    }}>
      {/* En-tête adversaire */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.2rem' }}>{tc.icon}</span>
          <div>
            <span style={{ fontWeight: 'bold', color: '#e05c4b', fontSize: '0.95rem' }}>
              {(enemy as any)?.name ?? trial.type}
            </span>
            {npc && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: tc.color + '22', color: tc.color, fontWeight: 'bold' }}>
                {tc.label}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {trial.xp_reward && (
            <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '4px', background: '#f0a74222', color: '#f0a742', fontWeight: 'bold' }}>
              ⭐ +{trial.xp_reward} XP
            </span>
          )}
          {trial.mana_cost && (
            <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '4px', background: '#b48edd22', color: '#b48edd' }}>
              🔮 -{trial.mana_cost} mana
            </span>
          )}
        </div>
      </div>

      {/* Description du PNJ */}
      {npc?.description && (
        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic', margin: '0 0 0.65rem' }}>
          {npc.description}
        </p>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${statRows.length}, 1fr)`, gap: '0.35rem 0.6rem', marginBottom: '0.65rem' }}>
        {statRows.map(s => (
          <div key={s.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', marginBottom: '0.15rem' }}>
              <span style={{ color: s.color }}>{s.icon} {s.label}</span>
              <strong style={{ color: 'var(--foreground)' }}>{s.val}</strong>
            </div>
            <div style={{ height: '4px', background: 'var(--surface-2)', borderRadius: '2px' }}>
              <div style={{ width: `${Math.min((s.val / (s.key === 'endurance' ? 40 : 20)) * 100, 100)}%`, height: '100%', background: s.color, borderRadius: '2px' }} />
            </div>
          </div>
        ))}
      </div>

      {/* Capacité spéciale + résistances */}
      {(npc?.special_ability || npc?.resistances) && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.65rem', fontSize: '0.72rem' }}>
          {npc.special_ability && <span style={{ color: '#b48edd' }}>⚡ {npc.special_ability}</span>}
          {npc.resistances     && <span style={{ color: '#4ec9b0' }}>🛡 {npc.resistances}</span>}
        </div>
      )}

      {/* Récompenses victoire */}
      {(trial.item_rewards?.length || npc?.loot) && (
        <div style={{ marginBottom: '0.65rem', fontSize: '0.72rem', color: '#f0a742' }}>
          🎁 <strong>Butin :</strong> {[...(trial.item_rewards ?? []), ...(npc?.loot ? [npc.loot] : [])].join(' · ')}
        </div>
      )}

      {/* Redirections */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {successNum != null ? (
          <button onClick={() => onNavigate(successNum)} style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: '5px',
            background: '#4caf7d22', color: '#4caf7d', border: '1px solid #4caf7d55',
            cursor: 'pointer', fontWeight: 'bold',
          }}>
            ✓ Victoire → §{successNum}
          </button>
        ) : (
          <span style={{ fontSize: '0.72rem', color: '#c9a84c', padding: '0.3rem 0.6rem', background: '#c9a84c11', borderRadius: '4px' }}>⚠ Section victoire manquante</span>
        )}
        {failureNum != null ? (
          <button onClick={() => onNavigate(failureNum)} style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: '5px',
            background: '#c94c4c22', color: '#c94c4c', border: '1px solid #c94c4c55',
            cursor: 'pointer', fontWeight: 'bold',
          }}>
            ✗ Défaite → §{failureNum}
          </button>
        ) : (
          <span style={{ fontSize: '0.72rem', color: '#c9a84c', padding: '0.3rem 0.6rem', background: '#c9a84c11', borderRadius: '4px' }}>⚠ Section défaite manquante</span>
        )}
        {trial.endurance_loss_on_failure != null && (
          <span style={{ fontSize: '0.72rem', color: '#c94c4c' }}>
            💔 -{trial.endurance_loss_on_failure} PV en cas d'échec
          </span>
        )}
      </div>
    </div>
  )
}

// ── Carte de dialogue ─────────────────────────────────────────────────────────

interface NpcEncounter {
  section_number: number
  outcome: 'success' | 'failure' | 'abandoned'
  memory_summary: string
  timestamp: string
}

function memoryKey(bookId: string, npcId: string) {
  return `hero_npc_memory_${bookId}_${npcId}`
}

function loadMemory(bookId: string, npcId: string): NpcEncounter[] {
  try {
    return JSON.parse(localStorage.getItem(memoryKey(bookId, npcId)) ?? '[]')
  } catch { return [] }
}

function saveMemory(bookId: string, npcId: string, encounters: NpcEncounter[]) {
  localStorage.setItem(memoryKey(bookId, npcId), JSON.stringify(encounters))
}

function DialogueCard({ trial, npcs, sections, book, sectionNumber, onNavigate }: {
  trial: NonNullable<Section['trial']>
  npcs: Npc[]
  sections: Section[]
  book: Book
  sectionNumber: number
  onNavigate: (n: number) => void
}) {
  const npc = trial.npc_id ? npcs.find(n => n.id === trial.npc_id) : null
  const [history, setHistory] = useState<{ role: 'player' | 'npc'; text: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [resolved, setResolved] = useState<'success' | 'failure' | null>(null)
  const [suggestedChoice, setSuggestedChoice] = useState<number | null>(null)
  const [pastEncounters, setPastEncounters] = useState<NpcEncounter[]>([])
  const [showMemory, setShowMemory] = useState(false)

  // Charger la mémoire au montage
  useEffect(() => {
    if (npc) setPastEncounters(loadMemory(book.id, npc.id))
  }, [book.id, npc?.id])

  const successNum = trial.success_section_id ? sections.find(s => s.id === trial.success_section_id)?.number : null
  const failureNum = trial.failure_section_id ? sections.find(s => s.id === trial.failure_section_id)?.number : null
  const sectionChoices = [
    ...(successNum != null ? [{ label: 'Accord obtenu', section_number: successNum }] : []),
    ...(failureNum != null ? [{ label: 'Refus ou échec', section_number: failureNum }] : []),
  ]

  const opening = trial.dialogue_opening ?? npc?.dialogue_intro
  const opened = history.length > 0

  function startDialogue() {
    const initial = opening ? [{ role: 'npc' as const, text: opening }] : []
    setHistory(initial)
  }

  // Génère et sauvegarde le résumé mémoriel à la fin du dialogue
  async function finalizeMemory(finalHistory: { role: 'player' | 'npc'; text: string }[], outcome: 'success' | 'failure') {
    if (!npc || finalHistory.length < 2) return
    try {
      const res = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npc: { name: npc.name, description: npc.description, speech_style: npc.speech_style, type: npc.type },
          section_context: '',
          dialogue_goal: trial.dialogue_goal ?? '',
          history: finalHistory,
          player_message: '',
          choices: [],
          book_theme: book.theme,
          age_range: book.age_range,
          generate_memory_summary: true,
        }),
      })
      const data = await res.json()
      const newEncounter: NpcEncounter = {
        section_number: sectionNumber,
        outcome,
        memory_summary: data.memory_summary ?? `Rencontre en §${sectionNumber}.`,
        timestamp: new Date().toISOString(),
      }
      const updated = [...pastEncounters, newEncounter]
      setPastEncounters(updated)
      saveMemory(book.id, npc.id, updated)
    } catch { /* silencieux */ }
  }

  async function sendMessage() {
    if (!input.trim() || loading || resolved) return
    const playerMsg = input.trim()
    setInput('')
    const newHistory = [...history, { role: 'player' as const, text: playerMsg }]
    setHistory(newHistory)
    setLoading(true)

    try {
      const sectionContent = sections.find(s => s.number === sectionNumber)?.content ?? ''
      const res = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npc: { name: npc?.name ?? 'Personnage', description: npc?.description, speech_style: npc?.speech_style, type: npc?.type ?? 'neutre' },
          section_context: sectionContent,
          dialogue_goal: trial.dialogue_goal ?? 'Obtenir des informations utiles du personnage.',
          history: newHistory.slice(0, -1),
          player_message: playerMsg,
          choices: sectionChoices,
          book_theme: book.theme,
          age_range: book.age_range,
          past_encounters: pastEncounters,
        }),
      })
      const data = await res.json()
      const npcReply = data.npc_reply ?? '…'
      const finalHistory = [...newHistory, { role: 'npc' as const, text: npcReply }]
      setHistory(finalHistory)
      if (data.suggested_choice_index != null) setSuggestedChoice(data.suggested_choice_index)
      if (data.is_resolved) {
        const outcome = data.resolution_hint ?? 'success'
        setResolved(outcome)
        finalizeMemory(finalHistory, outcome)
      }
    } catch {
      setHistory(h => [...h, { role: 'npc', text: '…' }])
    }
    setLoading(false)
  }

  function resetMemory() {
    if (!npc) return
    saveMemory(book.id, npc.id, [])
    setPastEncounters([])
  }

  const tc = npc ? NPC_TYPE_CONFIG[npc.type] : NPC_TYPE_CONFIG['neutre']

  return (
    <div style={{ marginTop: '0.85rem', border: '1px solid #64b5f655', borderRadius: '10px', padding: '0.9rem 1rem', background: '#64b5f606' }}>
      {/* En-tête PNJ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.3rem' }}>💬</span>
          <div>
            <span style={{ fontWeight: 'bold', color: '#64b5f6', fontSize: '0.95rem' }}>{npc?.name ?? 'Personnage inconnu'}</span>
            {npc && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: tc.color + '22', color: tc.color, fontWeight: 'bold' }}>
                {tc.label}
              </span>
            )}
          </div>
        </div>
        {/* Indicateur mémoire */}
        {pastEncounters.length > 0 && (
          <button onClick={() => setShowMemory(m => !m)} style={{
            fontSize: '0.68rem', padding: '0.2rem 0.55rem', borderRadius: '20px',
            background: '#c9a84c22', color: '#c9a84c', border: '1px solid #c9a84c55', cursor: 'pointer',
          }}>
            🧠 {pastEncounters.length} souvenir{pastEncounters.length > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Panneau mémoire */}
      {showMemory && pastEncounters.length > 0 && (
        <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', background: '#c9a84c0a', border: '1px solid #c9a84c33', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', color: '#c9a84c', fontWeight: 'bold' }}>🧠 Mémoire du PNJ</span>
            <button onClick={resetMemory} style={{ fontSize: '0.62rem', color: '#c94c4c', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
              Effacer
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {pastEncounters.map((enc, i) => (
              <div key={i} style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <span style={{ color: enc.outcome === 'success' ? '#4caf7d' : '#c94c4c', flexShrink: 0 }}>
                  {enc.outcome === 'success' ? '✓' : '✗'} §{enc.section_number}
                </span>
                <span style={{ fontStyle: 'italic' }}>{enc.memory_summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Style de parole */}
      {npc?.speech_style && (
        <p style={{ margin: '0 0 0.6rem', fontSize: '0.72rem', color: '#64b5f6', fontStyle: 'italic', borderLeft: '2px solid #64b5f644', paddingLeft: '0.5rem' }}>
          🎭 {npc.speech_style}
        </p>
      )}

      {/* Objectif */}
      {trial.dialogue_goal && (
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
          🎯 <strong>Objectif :</strong> {trial.dialogue_goal}
        </p>
      )}

      {/* Zone de chat */}
      {!opened ? (
        <button onClick={startDialogue} style={{
          width: '100%', padding: '0.55rem', borderRadius: '6px',
          background: '#64b5f622', color: '#64b5f6', border: '1px solid #64b5f655',
          cursor: 'pointer', fontSize: '0.82rem', fontWeight: 'bold',
        }}>
          {pastEncounters.length > 0 ? '💬 Reprendre la conversation' : '💬 Engager la conversation'}
        </button>
      ) : (
        <>
          <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.6rem', padding: '0.5rem', background: 'var(--surface)', borderRadius: '6px' }}>
            {history.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'player' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%', padding: '0.4rem 0.7rem',
                  borderRadius: msg.role === 'player' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  background: msg.role === 'player' ? '#64b5f633' : 'var(--surface-2)',
                  color: msg.role === 'player' ? '#64b5f6' : 'var(--foreground)',
                  fontSize: '0.8rem', lineHeight: 1.45,
                  border: msg.role === 'npc' ? '1px solid var(--border)' : 'none',
                }}>
                  {msg.role === 'npc' && <span style={{ fontWeight: 'bold', fontSize: '0.68rem', color: '#64b5f6', display: 'block', marginBottom: '0.15rem' }}>{npc?.name ?? '???'}</span>}
                  {msg.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '0.4rem 0.7rem', borderRadius: '12px 12px 12px 4px', background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--muted)' }}>…</div>
              </div>
            )}
          </div>

          {resolved ? (
            <div style={{ padding: '0.5rem', background: resolved === 'success' ? '#4caf7d11' : '#c94c4c11', borderRadius: '6px', fontSize: '0.8rem', color: resolved === 'success' ? '#4caf7d' : '#c94c4c', textAlign: 'center', marginBottom: '0.6rem' }}>
              {resolved === 'success' ? '✓ Conversation réussie — souvenir enregistré' : '✗ Conversation échouée — souvenir enregistré'}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                placeholder="Votre réponse..."
                disabled={loading}
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 0.7rem', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none' }}
              />
              <button onClick={sendMessage} disabled={loading || !input.trim()} style={{
                padding: '0.45rem 0.9rem', borderRadius: '6px', border: 'none',
                background: input.trim() && !loading ? '#64b5f6' : 'var(--surface-2)',
                color: input.trim() && !loading ? '#0f0f14' : 'var(--muted)',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '0.82rem',
              }}>
                Envoyer
              </button>
            </div>
          )}
        </>
      )}

      {/* Redirections */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
        {successNum != null && (
          <button onClick={() => onNavigate(successNum)} style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: '5px',
            background: suggestedChoice === 0 || resolved === 'success' ? '#4caf7d33' : '#4caf7d22',
            color: '#4caf7d', border: `1px solid ${suggestedChoice === 0 || resolved === 'success' ? '#4caf7d' : '#4caf7d55'}`,
            cursor: 'pointer', fontWeight: suggestedChoice === 0 || resolved === 'success' ? 'bold' : 'normal',
          }}>✓ Accord → §{successNum}{suggestedChoice === 0 ? ' ✦' : ''}</button>
        )}
        {failureNum != null && (
          <button onClick={() => onNavigate(failureNum)} style={{
            fontSize: '0.75rem', padding: '0.3rem 0.7rem', borderRadius: '5px',
            background: suggestedChoice === 1 || resolved === 'failure' ? '#c94c4c33' : '#c94c4c22',
            color: '#c94c4c', border: `1px solid ${suggestedChoice === 1 || resolved === 'failure' ? '#c94c4c' : '#c94c4c55'}`,
            cursor: 'pointer', fontWeight: suggestedChoice === 1 || resolved === 'failure' ? 'bold' : 'normal',
          }}>✗ Refus → §{failureNum}{suggestedChoice === 1 ? ' ✦' : ''}</button>
        )}
      </div>
    </div>
  )
}

// ── Plan graphique ────────────────────────────────────────────────────────────

const NODE_W = 148
const NODE_H = 72
const COL_GAP = 190
const ROW_GAP = 110

function computeReachable(sections: Section[], choices: Choice[], endingType: 'victory' | 'death'): Set<string> {
  // BFS arrière : depuis les fins, remonter vers les sections qui y mènent
  const endings = new Set(sections.filter(s => s.is_ending && s.ending_type === endingType).map(s => s.id))
  const reachable = new Set(endings)
  // index inverse : target_section_id → section_ids qui pointent vers elle
  const inEdges = new Map<string, string[]>()
  for (const c of choices) {
    if (!c.target_section_id) continue
    if (!inEdges.has(c.target_section_id)) inEdges.set(c.target_section_id, [])
    inEdges.get(c.target_section_id)!.push(c.section_id)
  }
  // Aussi via les trials (success/failure)
  for (const s of sections) {
    if (s.trial?.success_section_id) {
      if (!inEdges.has(s.trial.success_section_id)) inEdges.set(s.trial.success_section_id, [])
      inEdges.get(s.trial.success_section_id)!.push(s.id)
    }
    if (s.trial?.failure_section_id) {
      if (!inEdges.has(s.trial.failure_section_id)) inEdges.set(s.trial.failure_section_id, [])
      inEdges.get(s.trial.failure_section_id)!.push(s.id)
    }
  }
  const queue = [...endings]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const src of (inEdges.get(current) ?? [])) {
      if (!reachable.has(src)) { reachable.add(src); queue.push(src) }
    }
  }
  return reachable
}

function GraphView({ sections, choices, activeFilters, highlightNumber, onHighlightDone, onNavigate }: {
  sections: Section[]
  choices: Choice[]
  activeFilters: Set<string>
  highlightNumber?: number | null
  onHighlightDone?: () => void
  onNavigate: (n: number) => void
}) {
  const [pathFilter, setPathFilter] = useState<'victory' | 'death' | null>(null)
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Scroller vers le nœud surligné quand highlightNumber change
  useEffect(() => {
    if (!highlightNumber) return
    const section = sections.find(s => s.number === highlightNumber)
    if (!section) return
    // Petit délai pour laisser les refs se peupler après le montage du composant
    const scrollTimer = setTimeout(() => {
      const el = nodeRefs.current.get(section.id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }, 80)
    const resetTimer = setTimeout(() => onHighlightDone?.(), 3500)
    return () => { clearTimeout(scrollTimer); clearTimeout(resetTimer) }
  }, [highlightNumber])

  const COLS = Math.max(4, Math.ceil(Math.sqrt(sections.length)))

  const positions = new Map<string, { x: number; y: number; cx: number; cy: number }>()
  sections.forEach((s, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x = col * COL_GAP + 16
    const y = row * ROW_GAP + 16
    positions.set(s.id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 })
  })

  const rows = Math.ceil(sections.length / COLS)
  const canvasW = COLS * COL_GAP + NODE_W + 16
  const canvasH = rows * ROW_GAP + NODE_H + 16
  const sectionById = new Map(sections.map(s => [s.id, s]))

  const reachableVictory = computeReachable(sections, choices, 'victory')
  const reachableDeath   = computeReachable(sections, choices, 'death')

  return (
    <div>
      {/* Filtres chemins */}
      <style>{`
        @keyframes plan-pulse {
          0%   { box-shadow: 0 0 0 0px var(--pulse-color, #fff4), 0 0 16px 4px var(--pulse-color, #fff2); }
          50%  { box-shadow: 0 0 0 8px var(--pulse-color, #fff0), 0 0 28px 8px var(--pulse-color, #fff3); }
          100% { box-shadow: 0 0 0 0px var(--pulse-color, #fff4), 0 0 16px 4px var(--pulse-color, #fff2); }
        }
        .plan-node-highlighted {
          animation: plan-pulse 0.9s ease-in-out infinite;
          z-index: 10;
        }
      `}</style>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chemins</span>
        {([
          { key: 'victory', label: `🏆 Mènent à la victoire (${reachableVictory.size})`, color: '#4caf7d' },
          { key: 'death',   label: `💀 Mènent à la mort (${reachableDeath.size})`,        color: '#c94c4c' },
        ] as const).map(f => (
          <button key={f.key} onClick={() => setPathFilter(p => p === f.key ? null : f.key)} style={{
            fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '20px',
            border: `1.5px solid ${pathFilter === f.key ? f.color : f.color + '55'}`,
            background: pathFilter === f.key ? f.color + '33' : f.color + '11',
            color: f.color, cursor: 'pointer', fontWeight: pathFilter === f.key ? 'bold' : 'normal',
            transition: 'all 0.15s',
          }}>{f.label}</button>
        ))}
        {pathFilter && (
          <button onClick={() => setPathFilter(null)} style={{ fontSize: '0.68rem', padding: '0.2rem 0.55rem', borderRadius: '20px', background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            ✕ Tout afficher
          </button>
        )}
      </div>

    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '68vh', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--surface)' }}>
      <div style={{ position: 'relative', width: canvasW, height: canvasH }}>
        <svg style={{ position: 'absolute', inset: 0, width: canvasW, height: canvasH, pointerEvents: 'none' }}>
          <defs>
            {[
              { id: 'arr',   color: '#c9a84c99' },
              { id: 'arr-v', color: '#4caf7d99' },
              { id: 'arr-d', color: '#c94c4c99' },
            ].map(({ id, color }) => (
              <marker key={id} id={id} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L0,7 L7,3.5 z" fill={color} />
              </marker>
            ))}
          </defs>
          {choices.map(choice => {
            if (!choice.target_section_id) return null
            const from = positions.get(choice.section_id)
            const to = positions.get(choice.target_section_id)
            if (!from || !to) return null
            const target = sectionById.get(choice.target_section_id)
            const source = sectionById.get(choice.section_id)
            const isVictory = target?.ending_type === 'victory'
            const isDeath = target?.ending_type === 'death'
            const reachable = pathFilter === 'victory' ? reachableVictory : reachableDeath
            const arrowDimmed = pathFilter !== null && (!reachable.has(choice.section_id) || !reachable.has(choice.target_section_id))
            const srcTypeDimmed = activeFilters.size > 0 && source && !activeFilters.has(getSectionType(source).label)
            const tgtTypeDimmed = activeFilters.size > 0 && target && !activeFilters.has(getSectionType(target).label)
            const arrowFaded = arrowDimmed || srcTypeDimmed || tgtTypeDimmed
            const color = arrowFaded ? '#ffffff11' : isVictory ? '#4caf7d88' : isDeath ? '#c94c4c88' : '#c9a84c66'
            const markerId = isVictory ? 'arr-v' : isDeath ? 'arr-d' : 'arr'
            const goRight = to.cx > from.cx + COL_GAP * 0.3
            const goLeft  = to.cx < from.cx - COL_GAP * 0.3
            let d: string
            if (goRight) {
              const x1 = from.x + NODE_W, y1 = from.cy, x2 = to.x, y2 = to.cy
              const mx = (x1 + x2) / 2
              d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
            } else if (goLeft) {
              const x1 = from.cx, y1 = from.y + NODE_H, x2 = to.cx, y2 = to.y + NODE_H
              const sag = Math.min(60 + Math.abs(to.cx - from.cx) * 0.25, 120)
              d = `M ${x1} ${y1} C ${x1} ${y1 + sag}, ${x2} ${y2 + sag}, ${x2} ${y2}`
            } else {
              const x1 = from.x + NODE_W, y1 = from.cy, x2 = to.x + NODE_W + 18, y2 = to.cy
              const mx = Math.max(x1, x2) + 30
              d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
            }
            return <path key={choice.id} d={d} fill="none" stroke={color} strokeWidth="1.5" markerEnd={`url(#${markerId})`} />
          })}
        </svg>
        {sections.map(section => {
          const pos = positions.get(section.id)
          if (!pos) return null
          const sc = SECTION_STATUS_CONFIG[section.status ?? 'draft']
          const t = getSectionType(section)
          const typeDimmed = activeFilters.size > 0 && !activeFilters.has(t.label)
          const pathDimmed = pathFilter !== null && !(pathFilter === 'victory' ? reachableVictory : reachableDeath).has(section.id)
          const dimmed = typeDimmed || pathDimmed
          const isHighlighted = highlightNumber === section.number
          return (
            <div
              key={section.id}
              ref={el => { if (el) nodeRefs.current.set(section.id, el); else nodeRefs.current.delete(section.id) }}
              onClick={() => !dimmed && onNavigate(section.number)}
              title={`§${section.number} — cliquer pour lire la section`}
              className={isHighlighted ? 'plan-node-highlighted' : undefined}
              style={{
                position: 'absolute', left: pos.x, top: pos.y, width: NODE_W, height: NODE_H,
                background: isHighlighted ? t.color + '33' : 'var(--surface-2)',
                border: `${isHighlighted ? '3px' : '1.5px'} solid ${dimmed ? 'var(--border)' : t.color + (isHighlighted ? '' : '99')}`,
                outline: isHighlighted ? `3px solid ${t.color}` : 'none',
                outlineOffset: '4px',
                borderRadius: '7px', padding: '0.4rem 0.55rem', overflow: 'hidden', boxSizing: 'border-box',
                opacity: dimmed ? 0.15 : 1, transition: 'opacity 0.2s',
                cursor: dimmed ? 'default' : 'pointer',
                ['--pulse-color' as any]: t.color + '99',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ fontSize: '0.8rem' }}>{t.icon}</span>
                  <span style={{ fontWeight: 'bold', color: 'var(--accent)', fontSize: '0.72rem' }}>§{section.number}</span>
                </div>
                <span style={{ color: sc.color, fontSize: '0.6rem' }}>{sc.label}</span>
              </div>
              <p style={{ margin: 0, color: section.summary ? 'var(--foreground)' : 'var(--muted)', fontSize: '0.6rem', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, fontStyle: section.summary ? 'italic' : 'normal' }}>
                {section.summary ?? section.content.slice(0, 80)}
              </p>
            </div>
          )
        })}
      </div>
    </div>
    </div>
  )
}

// ── Onglet PNJ ────────────────────────────────────────────────────────────────

const NPC_DEFAULTS = {
  name: '', type: 'ennemi' as NpcType, description: '',
  force: 5, agilite: 5, intelligence: 5, magie: 0, endurance: 10, chance: 5,
  special_ability: '', resistances: '', loot: '',
  speech_style: '', dialogue_intro: '',
}

function NpcTab({ bookId, npcs, setNpcs, sections, onNavigate }: { bookId: string; npcs: Npc[]; setNpcs: (fn: (prev: Npc[]) => Npc[]) => void; sections: Section[]; onNavigate: (n: number) => void }) {
  // sections où chaque PNJ apparaît (via trial.npc_id)
  const npcSections = (npcId: string) =>
    sections.filter(s => s.trial?.npc_id === npcId).map(s => s.number).sort((a, b) => a - b)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...NPC_DEFAULTS })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function openCreate() { setForm({ ...NPC_DEFAULTS }); setEditingId(null); setShowForm(true) }
  function openEdit(npc: Npc) {
    setForm({
      name: npc.name, type: npc.type, description: npc.description ?? '',
      force: npc.force, agilite: npc.agilite, intelligence: npc.intelligence,
      magie: npc.magie, endurance: npc.endurance, chance: npc.chance,
      special_ability: npc.special_ability ?? '', resistances: npc.resistances ?? '', loot: npc.loot ?? '',
      speech_style: npc.speech_style ?? '', dialogue_intro: npc.dialogue_intro ?? '',
    })
    setEditingId(npc.id); setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    if (editingId) {
      await fetch(`/api/npcs/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      setNpcs(prev => prev.map(n => n.id === editingId ? { ...n, ...form } : n))
    } else {
      const res = await fetch(`/api/books/${bookId}/npcs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const created = await res.json()
      setNpcs(prev => [...prev, created])
    }
    setSaving(false); setShowForm(false); setEditingId(null)
  }

  async function deleteNpc(id: string) {
    setDeletingId(id)
    await fetch(`/api/npcs/${id}`, { method: 'DELETE' })
    setNpcs(prev => prev.filter(n => n.id !== id))
    setDeletingId(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>
          Fiches des personnages non joueurs — utilisées lors des combats et épreuves.
        </p>
        <button onClick={openCreate} style={btnStyle('var(--accent)', '#0f0f14')}>+ Ajouter un PNJ</button>
      </div>

      {/* Formulaire */}
      {showForm && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: '10px',
          padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h3 style={{ color: 'var(--accent)', marginTop: 0, marginBottom: '1.25rem', fontSize: '1rem' }}>
            {editingId ? '✏ Modifier le PNJ' : '+ Nouveau PNJ'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={labelStyle}>Nom *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} placeholder="Ex: Seigneur Malven" />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as NpcType }))} style={inputStyle}>
                {Object.entries(NPC_TYPE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Apparence, rôle dans l'histoire..." />
          </div>

          {/* Statistiques */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ ...labelStyle, marginBottom: '0.75rem' }}>Statistiques de combat</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              {STATS.map(stat => (
                <div key={stat.key}>
                  <label style={{ fontSize: '0.72rem', color: stat.color, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    {stat.icon} {stat.label}
                  </label>
                  <input type="number" min={0} max={99}
                    value={(form as any)[stat.key]}
                    onChange={e => setForm(f => ({ ...f, [stat.key]: parseInt(e.target.value) || 0 }))}
                    style={{ ...inputStyle, textAlign: 'center' }} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={labelStyle}>Capacité spéciale</label>
              <input value={form.special_ability} onChange={e => setForm(f => ({ ...f, special_ability: e.target.value }))} style={inputStyle} placeholder="Ex: Attaque de feu (×2 dégâts)" />
            </div>
            <div>
              <label style={labelStyle}>Résistances / Faiblesses</label>
              <input value={form.resistances} onChange={e => setForm(f => ({ ...f, resistances: e.target.value }))} style={inputStyle} placeholder="Ex: Immunisé au feu, sensible à l'eau" />
            </div>
            <div>
              <label style={labelStyle}>Butin (si vaincu)</label>
              <input value={form.loot} onChange={e => setForm(f => ({ ...f, loot: e.target.value }))} style={inputStyle} placeholder="Ex: Épée +2, 50 pièces d'or" />
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>🎭 Style de parole / Accent</label>
            <input value={form.speech_style} onChange={e => setForm(f => ({ ...f, speech_style: e.target.value }))} style={inputStyle} placeholder="Ex: Accent du sud, tutoie toujours, dit 'hé l'ami' en accroche, phrases courtes" />
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>💬 Introduction du dialogue (facultatif)</label>
            <textarea value={form.dialogue_intro} onChange={e => setForm(f => ({ ...f, dialogue_intro: e.target.value }))} style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} placeholder="Ex: Une vieille femme aux yeux laiteux vous fait signe depuis l'ombre. 'Psst, mon moineau…'" />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={save} disabled={saving || !form.name.trim()} style={btnStyle('var(--accent)', '#0f0f14')}>
              {saving ? 'Sauvegarde...' : '✓ Sauvegarder'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null) }} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste des PNJ */}
      {npcs.length === 0 && !showForm ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--surface)', borderRadius: '10px', border: '1px dashed var(--border)' }}>
          <p style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>👥</p>
          <p style={{ color: 'var(--muted)' }}>Aucun PNJ pour ce livre.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {npcs.map(npc => {
            const tc = NPC_TYPE_CONFIG[npc.type]
            return (
              <div key={npc.id} style={{
                background: 'var(--surface)', border: `1px solid ${tc.color}44`,
                borderRadius: '10px', padding: '1.25rem',
              }}>
                {/* En-tête PNJ */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{
                      fontSize: '1.5rem', width: '44px', height: '44px', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: tc.color + '22', borderRadius: '8px',
                    }}>{tc.icon}</span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--foreground)' }}>{npc.name}</h3>
                      <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.55rem', borderRadius: '20px', background: tc.color + '22', color: tc.color, fontWeight: 'bold' }}>
                        {tc.label}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => openEdit(npc)} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>✏</button>
                    <button onClick={() => deleteNpc(npc.id)} disabled={deletingId === npc.id} style={btnStyle('#c94c4c22', '#c94c4c', '1px solid #c94c4c44')}>
                      {deletingId === npc.id ? '...' : '🗑'}
                    </button>
                  </div>
                </div>

                {npc.description && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem', fontStyle: 'italic' }}>{npc.description}</p>
                )}

                {/* Barres de stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem 1rem', marginBottom: '0.75rem' }}>
                  {STATS.map(stat => {
                    const val = (npc as any)[stat.key] as number
                    const max = stat.key === 'endurance' ? Math.max(val, 20) : 20
                    return (
                      <div key={stat.key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', marginBottom: '0.2rem' }}>
                          <span style={{ color: stat.color }}>{stat.icon} {stat.label}</span>
                          <span style={{ fontWeight: 'bold', color: 'var(--foreground)' }}>{val}</span>
                        </div>
                        <div style={{ height: '5px', background: 'var(--surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min((val / max) * 100, 100)}%`, height: '100%', background: stat.color, borderRadius: '3px' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Infos complémentaires */}
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.78rem', marginBottom: '0.6rem' }}>
                  {npc.special_ability && (
                    <span style={{ color: '#b48edd' }}>⚡ <strong>Capacité :</strong> {npc.special_ability}</span>
                  )}
                  {npc.resistances && (
                    <span style={{ color: '#4ec9b0' }}>🛡 <strong>Résistances :</strong> {npc.resistances}</span>
                  )}
                  {npc.loot && (
                    <span style={{ color: '#f0a742' }}>💰 <strong>Butin :</strong> {npc.loot}</span>
                  )}
                </div>

                {npc.speech_style && (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.73rem', color: '#64b5f6', fontStyle: 'italic', borderLeft: '2px solid #64b5f644', paddingLeft: '0.5rem' }}>
                    🎭 {npc.speech_style}
                  </p>
                )}

                {/* Sections où ce PNJ apparaît */}
                {(() => {
                  const secs = sections.filter(s => s.trial?.npc_id === npc.id).sort((a, b) => a.number - b.number)
                  return secs.length > 0 ? (
                    <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.72rem' }}>
                      <span style={{ color: 'var(--muted)' }}>Apparaît dans :</span>
                      {secs.map(s => {
                        const t = getSectionType(s)
                        return (
                          <button key={s.id} onClick={() => onNavigate(s.number)} title={`Aller à la section ${s.number}`} style={{
                            padding: '0.2rem 0.55rem', borderRadius: '5px',
                            background: t.color + '22', color: t.color,
                            border: `1px solid ${t.color}55`,
                            fontWeight: 'bold', cursor: 'pointer', fontSize: '0.72rem',
                            display: 'flex', alignItems: 'center', gap: '0.25rem',
                          }}>
                            <span>{t.icon}</span> §{s.number}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                      Pas encore associé à une section
                    </p>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Panneau Narration ─────────────────────────────────────────────────────────

const NARRATION_MODES = [
  { key: 'bordage',     label: 'Style Bordage', icon: '📖', desc: 'Réécriture complète dans le style Pierre Bordage' },
  { key: 'intensifier', label: 'Intensifier',   icon: '🔥', desc: 'Phrases courtes, tension maximale' },
  { key: 'alléger',     label: 'Alléger',       icon: '🌱', desc: 'Vocabulaire simple, public 8-12 ans' },
  { key: 'corriger',    label: 'Corriger',      icon: '✓',  desc: 'Orthographe et grammaire uniquement' },
  { key: 'résumé',      label: 'Résumé',        icon: '✦',  desc: 'Génère la phrase résumé (12 mots max)' },
]

function NarrationPanel({ sectionId, content, onApply, onClose }: {
  sectionId: string
  content: string
  onApply: (sectionId: string, newContent: string) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState('bordage')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    setLoading(true); setError(''); setResult('')
    try {
      const res = await fetch('/api/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data.result)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0009', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid #b48edd66',
        borderRadius: '12px', width: '100%', maxWidth: '860px',
        maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 'bold', color: '#b48edd', fontSize: '1rem' }}>✨ Atelier Narration</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>

        <div style={{ overflow: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Sélection du mode */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
            {NARRATION_MODES.map(m => (
              <button key={m.key} onClick={() => setMode(m.key)} style={{
                padding: '0.5rem 0.4rem', borderRadius: '7px', cursor: 'pointer', textAlign: 'center',
                border: `2px solid ${mode === m.key ? '#b48edd' : 'var(--border)'}`,
                background: mode === m.key ? '#b48edd22' : 'var(--surface-2)',
                color: mode === m.key ? '#b48edd' : 'var(--muted)',
                transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: '1.1rem', marginBottom: '0.15rem' }}>{m.icon}</div>
                <div style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>{m.label}</div>
                <div style={{ fontSize: '0.6rem', opacity: 0.75, marginTop: '0.1rem', lineHeight: 1.3 }}>{m.desc}</div>
              </button>
            ))}
          </div>

          {/* Texte original + résultat */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Texte original</div>
              <div style={{
                background: 'var(--surface-2)', borderRadius: '8px', padding: '0.85rem',
                fontSize: '0.82rem', lineHeight: 1.65, color: 'var(--muted)',
                whiteSpace: 'pre-wrap', maxHeight: '320px', overflow: 'auto',
              }}>
                {content}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#b48edd', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Version {NARRATION_MODES.find(m2 => m2.key === mode)?.label}
              </div>
              <div style={{
                background: 'var(--surface-2)', border: `1px solid ${result ? '#b48edd44' : 'var(--border)'}`,
                borderRadius: '8px', padding: '0.85rem',
                fontSize: '0.82rem', lineHeight: 1.65, color: result ? 'var(--foreground)' : 'var(--muted)',
                whiteSpace: 'pre-wrap', maxHeight: '320px', overflow: 'auto',
                minHeight: '80px', display: 'flex', alignItems: loading ? 'center' : 'flex-start', justifyContent: loading ? 'center' : 'flex-start',
              }}>
                {loading ? (
                  <span style={{ color: '#b48edd', fontSize: '0.85rem' }}>✨ Réécriture en cours...</span>
                ) : result || (
                  <span style={{ fontStyle: 'italic' }}>Le texte réécrit apparaîtra ici.</span>
                )}
              </div>
            </div>
          </div>

          {error && <p style={{ color: '#c94c4c', fontSize: '0.82rem', background: '#c94c4c11', padding: '0.6rem', borderRadius: '6px' }}>⚠ {error}</p>}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnStyle('var(--surface-2)', 'var(--muted)', '1px solid var(--border)')}>Annuler</button>
            <button onClick={generate} disabled={loading} style={btnStyle(loading ? 'var(--muted)' : '#b48edd33', '#b48edd', '1px solid #b48edd66')}>
              {loading ? '...' : '✨ Générer'}
            </button>
            {result && (
              <button onClick={() => onApply(sectionId, result)} style={btnStyle('var(--accent)', '#0f0f14')}>
                ✓ Appliquer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Styles partagés ───────────────────────────────────────────────────────────

function btnStyle(bg: string, color: string, border?: string): React.CSSProperties {
  return { background: bg, color, border: border ?? 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.875rem' }
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: '6px', padding: '0.5rem 0.7rem', color: 'var(--foreground)',
  fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.72rem', color: 'var(--muted)',
  marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em',
}
