'use client'
/**
 * SectionInfoPanel — colonne droite du SectionPlansPanel.
 *
 * Affiche :
 *   - Vient de (incoming choices) : sections qui pointent vers cette section
 *   - Va vers (outgoing choices) : où mènent les choix de cette section
 *   - Personnages présents (parsé depuis content) — cliquables → fiche perso
 *   - Objets (filtre items.sections_used contains sectionId) — cliquables → fiche objet
 *   - Résumé éditable inline + auto-save (debounce 800ms)
 *   - Notes auteur éditables inline + auto-save
 *
 * Refonte UX 2026-05-12.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowLeft, Users, Package, FileText, Loader2, Check } from 'lucide-react'

interface IncomingChoice {
  choice_id: string
  choice_text: string
  source_section_id: string
  source_section_number: number | null
  source_section_title: string | null
}

interface OutgoingChoice {
  id: string
  // Note : la colonne DB s'appelle `label` (cf migration 001).
  label: string
  target_section_id: string | null
  sort_order: number
}

interface SectionFullData {
  section: {
    content: string | null
    summary: string | null
  }
  choices: OutgoingChoice[]
}

export interface SectionItemBrief {
  id: string
  name: string
  illustration_url: string | null
  sections_used: string[]
}

interface SectionInfoPanelProps {
  sectionId: string
  /** Items du livre (filtrés côté client par sections_used). */
  bookItems: SectionItemBrief[]
  /** Numéros des sections cibles (pour résoudre target_section_id → §X). */
  sectionNumberById?: Map<string, number>
  /** Click sur une chip personnage → ouvre la fiche perso (lookup par nom
   *  côté parent qui a accès à la liste NPCs du livre). */
  onClickNpc?: (npcName: string) => void
  /** Click sur un item → ouvre la fiche objet. */
  onClickItem?: (item: SectionItemBrief) => void
  /** Click sur un choix (FROM ou TO) → callback parent qui ferme l'expand
   *  + scroll + highlight la section cible. */
  onClickChoice?: (targetSectionId: string) => void
}

/** Parse le content original en parties éditables + non-éditables. */
function parseContent(content: string): {
  resume: string
  npcsBlock: string
  objetsBlock: string
  notes: string
  trailingMarker: string
} {
  const npcsRegex = /\n\n\*\*Persos pr[ée]sents :\*\*[^\n]+/
  const objetsRegex = /\n\n\*\*Objets :\*\*[^\n]+/
  const notesRegex = /\n\n---\n\n\*Notes auteur :\s*([^*]+)\*/

  const npcsMatch = content.match(npcsRegex)
  const objetsMatch = content.match(objetsRegex)
  const notesMatch = content.match(notesRegex)

  // Le résumé = tout ce qui est avant le premier marker (Persos / Objets / ---)
  const indexes = [
    npcsMatch ? content.indexOf(npcsMatch[0]) : -1,
    objetsMatch ? content.indexOf(objetsMatch[0]) : -1,
    content.indexOf('\n\n---'),
  ].filter(i => i >= 0)
  const resumeEnd = indexes.length > 0 ? Math.min(...indexes) : content.length

  return {
    resume: content.slice(0, resumeEnd).trim(),
    npcsBlock: npcsMatch?.[0] ?? '',
    objetsBlock: objetsMatch?.[0] ?? '',
    notes: notesMatch?.[1]?.trim() ?? '',
    trailingMarker: notesMatch ? '' : (content.includes('\n\n---') ? '\n\n---' : ''),
  }
}

/** Reconstruit le content depuis ses parties (préserve npcs/objets non éditables). */
function buildContent(parts: {
  resume: string
  npcsBlock: string
  objetsBlock: string
  notes: string
}): string {
  const { resume, npcsBlock, objetsBlock, notes } = parts
  const notesPart = notes.trim()
    ? `\n\n---\n\n*Notes auteur : ${notes.trim()}*`
    : ''
  return `${resume.trim()}${npcsBlock}${objetsBlock}${notesPart}`
}

export default function SectionInfoPanel({
  sectionId, bookItems, sectionNumberById,
  onClickNpc, onClickItem, onClickChoice,
}: SectionInfoPanelProps) {
  const [full, setFull] = useState<SectionFullData | null>(null)
  const [incoming, setIncoming] = useState<IncomingChoice[] | null>(null)
  const [loading, setLoading] = useState(true)

  // Local editable state — initialisé au load + sync sur changements externes.
  const [resumeText, setResumeText] = useState('')
  const [notesText, setNotesText] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Refs pour preserver les blocs npcs/objets entre saves (read-only ici).
  const npcsBlockRef = useRef('')
  const objetsBlockRef = useRef('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let aborted = false
    setLoading(true)
    Promise.all([
      fetch(`/api/sections/${sectionId}`).then(r => r.json() as Promise<SectionFullData | { error: string }>),
      fetch(`/api/sections/${sectionId}/incoming-choices`).then(r => r.json() as Promise<IncomingChoice[] | { error: string }>),
    ])
      .then(([f, inc]) => {
        if (aborted) return
        if ('section' in f) {
          setFull(f)
          // Hydrate les zones éditables + cache les blocs read-only
          const parts = parseContent(f.section?.content ?? '')
          setResumeText(parts.resume)
          setNotesText(parts.notes)
          npcsBlockRef.current = parts.npcsBlock
          objetsBlockRef.current = parts.objetsBlock
        }
        if (Array.isArray(inc)) setIncoming(inc)
      })
      .catch(err => console.error('[SectionInfoPanel] load failed:', err))
      .finally(() => { if (!aborted) setLoading(false) })
    return () => {
      aborted = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
    }
  }, [sectionId])

  /** PATCH /api/sections/:id avec content reconstruit depuis les parties.
   *  Debounced 800ms — appelé via scheduleSave(). */
  const persistContent = useCallback(async (newResume: string, newNotes: string) => {
    setSaveStatus('saving')
    try {
      const newContent = buildContent({
        resume: newResume,
        npcsBlock: npcsBlockRef.current,
        objetsBlock: objetsBlockRef.current,
        notes: newNotes,
      })
      const res = await fetch(`/api/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      })
      if (!res.ok) throw new Error(`PATCH HTTP ${res.status}`)
      setSaveStatus('saved')
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
      savedFlashTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1600)
    } catch (err) {
      console.error('[SectionInfoPanel] save failed:', err)
      setSaveStatus('idle')
    }
  }, [sectionId])

  function scheduleSave(newResume: string, newNotes: string) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void persistContent(newResume, newNotes)
    }, 800)
  }

  function handleResumeChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    setResumeText(v)
    scheduleSave(v, notesText)
  }
  function handleNotesChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    setNotesText(v)
    scheduleSave(resumeText, v)
  }

  if (loading) {
    return (
      <div className="sc-info-panel sc-info-panel-loading">
        <Loader2 size={14} className="sc-plans-spin" />
        <span>Chargement…</span>
      </div>
    )
  }

  // Items liés à cette section (filtre client-side)
  const sectionItems = bookItems.filter(i => i.sections_used?.includes(sectionId))

  // Parse NPCs depuis npcsBlock (format "**Persos présents :** Duke, Epsi")
  const npcsMatch = npcsBlockRef.current.match(/\*\*Persos pr[ée]sents :\*\*\s*([^\n]+)/i)
  const npcs = npcsMatch?.[1]?.split(',').map(s => s.trim()).filter(Boolean) ?? []

  const outgoing = full?.choices ?? []

  return (
    <div className="sc-info-panel">
      {/* Indicateur save subtil en haut à droite (absolu, ne prend pas de place) */}
      {saveStatus !== 'idle' && (
        <div className={`sc-info-save-indicator ${saveStatus}`}>
          {saveStatus === 'saving' ? (
            <>
              <Loader2 size={11} className="sc-plans-spin" />
              <span>Sauvegarde…</span>
            </>
          ) : (
            <>
              <Check size={11} />
              <span>Sauvegardé</span>
            </>
          )}
        </div>
      )}

      {/* Top row : 3 colonnes — VIENT DE | RÉSUMÉ | VA VERS */}
      <div className="sc-info-top-row">
        {/* VIENT DE (gauche) */}
        <section className="sc-info-col-from">
          <div className="sc-info-title">
            <ArrowLeft size={12} />
            <span>Vient de</span>
          </div>
          {incoming && incoming.length > 0 ? (
            <ul className="sc-info-choices-list">
              {incoming.map(c => (
                <li key={c.choice_id}>
                  <button
                    type="button"
                    className="sc-info-choice"
                    onClick={() => onClickChoice?.(c.source_section_id)}
                    title={c.choice_text}
                  >
                    <span className="sc-info-choice-target">
                      {c.source_section_number != null ? `§${c.source_section_number}` : '?'}
                    </span>
                    <span className="sc-info-choice-label">{truncate(c.choice_text, 40)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sc-info-empty">Section d&apos;entrée</div>
          )}
        </section>

        {/* RÉSUMÉ éditable (centre) */}
        <section className="sc-info-col-resume">
          <div className="sc-info-title">Résumé</div>
          <textarea
            className="sc-info-resume-textarea"
            value={resumeText}
            onChange={handleResumeChange}
            placeholder="Décris la scène — ce que le joueur lit en arrivant…"
            spellCheck
          />
        </section>

        {/* VA VERS (droite) */}
        <section className="sc-info-col-to">
          <div className="sc-info-title">
            <span>Va vers</span>
            <ArrowRight size={12} />
          </div>
          {outgoing.length > 0 ? (
            <ul className="sc-info-choices-list">
              {outgoing.map(c => {
                const targetNum = c.target_section_id
                  ? sectionNumberById?.get(c.target_section_id)
                  : null
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="sc-info-choice"
                      onClick={() => c.target_section_id && onClickChoice?.(c.target_section_id)}
                      disabled={!c.target_section_id}
                      title={c.label}
                    >
                      <span className="sc-info-choice-label">{truncate(c.label, 40)}</span>
                      <span className="sc-info-choice-target">
                        {targetNum != null ? `→ §${targetNum}` : '→ ?'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="sc-info-empty">Section finale</div>
          )}
        </section>
      </div>

      {/* Bottom row : Personnages + Objets */}
      <div className="sc-info-bottom-row">
        {npcs.length > 0 && (
          <section className="sc-info-col-half">
            <div className="sc-info-title">
              <Users size={12} />
              <span>Personnages ({npcs.length})</span>
            </div>
            <div className="sc-info-chips">
              {npcs.map((n, i) => (
                <button
                  key={`${n}-${i}`}
                  type="button"
                  className="sc-info-chip"
                  onClick={() => onClickNpc?.(n)}
                  title={`Ouvrir la fiche de ${n}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </section>
        )}

        {sectionItems.length > 0 && (
          <section className="sc-info-col-half">
            <div className="sc-info-title">
              <Package size={12} />
              <span>Objets ({sectionItems.length})</span>
            </div>
            <ul className="sc-info-items">
              {sectionItems.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="sc-info-item"
                    onClick={() => onClickItem?.(item)}
                    title={`Ouvrir la fiche de ${item.name}`}
                  >
                    {item.illustration_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.illustration_url} alt="" className="sc-info-item-thumb" />
                    ) : (
                      <div className="sc-info-item-thumb sc-info-item-thumb-empty">
                        <Package size={11} />
                      </div>
                    )}
                    <span className="sc-info-item-name">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Notes auteur éditables (si on a des notes ou si on veut en ajouter) */}
      <section className="sc-info-notes-row">
        <div className="sc-info-title">
          <FileText size={12} />
          <span>Notes auteur</span>
        </div>
        <textarea
          className="sc-info-notes-textarea"
          value={notesText}
          onChange={handleNotesChange}
          placeholder="Notes pour toi-même (ton, mood, références…)"
          spellCheck
        />
      </section>
    </div>
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
