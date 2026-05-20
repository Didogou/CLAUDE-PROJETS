'use client'
/**
 * BookNpcsBank — onglet "Banque de personnages" du Studio Creator.
 *
 * V2 (2026-05-06) : pipeline IA complet branché via BookNpcCreatorModal
 * (réutilise CharacterCreatorModal du Designer — Z-Image / Flux / FaceDetailer
 * + 2 modes portrait + plein pied + upload manuel + lightbox). Persistance
 * directe en table Supabase `npcs` (PATCH/POST /api/npcs).
 *
 * Endpoints utilisés :
 *   - GET    /api/npcs?bookId=X
 *   - POST   /api/npcs               (via BookNpcCreatorModal)
 *   - PATCH  /api/npcs/[id]          (via BookNpcCreatorModal en mode édition)
 *   - DELETE /api/npcs/[id]
 */

import React, { useEffect, useState } from 'react'
import { Plus, User, Pencil, Trash2 } from 'lucide-react'
import BookNpcCreatorModal, { type NpcRow } from './BookNpcCreatorModal'

interface BookNpcsBankProps {
  bookId: string
}

export default function BookNpcsBank({ bookId }: BookNpcsBankProps) {
  const [npcs, setNpcs] = useState<NpcRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [editingNpc, setEditingNpc] = useState<NpcRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<NpcRow | null>(null)

  useEffect(() => {
    let aborted = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/npcs?bookId=${bookId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as NpcRow[]
        if (!aborted) setNpcs(data)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[BookNpcsBank] load failed:', msg)
        setError(msg)
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    void load()
    return () => { aborted = true }
  }, [bookId])

  function handleSaved(saved: NpcRow) {
    // Insert ou replace par id (gère création ET édition uniformément)
    setNpcs(prev => {
      const idx = prev.findIndex(n => n.id === saved.id)
      if (idx === -1) return [...prev, saved]
      const next = [...prev]
      next[idx] = saved
      return next
    })
  }

  async function handleDelete(npc: NpcRow) {
    setDeletingId(npc.id)
    try {
      const res = await fetch(`/api/npcs/${npc.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setNpcs(prev => prev.filter(n => n.id !== npc.id))
      setConfirmDelete(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[BookNpcsBank] delete failed:', msg)
      alert(`Suppression échouée : ${msg}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="sc-npcs-bank">
      <div className="sc-section-header">
        <div>
          <h1>Banque de personnages</h1>
          <p>{npcs.length} NPC{npcs.length > 1 ? 's' : ''} dans le livre</p>
        </div>
      </div>

      {loading ? (
        <div className="sc-loading">Chargement…</div>
      ) : error ? (
        <div className="sc-empty" style={{ color: '#EF4444' }}>⚠ {error}</div>
      ) : (
        <div className="sc-npcs-grid">
          {npcs.map(n => (
            <div key={n.id} className="sc-npc-card">
              <div
                className="sc-npc-portrait"
                onClick={() => setEditingNpc(n)}
                title="Modifier le personnage"
              >
                {n.portrait_url ? (
                  <img src={n.portrait_url} alt={n.name} />
                ) : n.fullbody_gray_url ? (
                  <img src={n.fullbody_gray_url} alt={n.name} />
                ) : (
                  <User size={32} />
                )}
                <div className="sc-npc-card-actions">
                  <button
                    type="button"
                    className="sc-npc-card-btn"
                    onClick={(e) => { e.stopPropagation(); setEditingNpc(n) }}
                    aria-label="Modifier"
                    title="Modifier"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="sc-npc-card-btn sc-npc-card-btn-danger"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(n) }}
                    aria-label="Supprimer"
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="sc-npc-body">
                <div className="sc-npc-name">{n.name}</div>
                {n.appearance ? (
                  <div className="sc-npc-desc">{n.appearance}</div>
                ) : n.description ? (
                  <div className="sc-npc-desc">{n.description}</div>
                ) : null}
              </div>
            </div>
          ))}

          {/* Tuile "+ Créer" — ouvre le modal complet */}
          <button
            type="button"
            className="sc-npc-add"
            onClick={() => setCreatorOpen(true)}
          >
            <Plus size={28} />
            <span>Créer un personnage</span>
            <span className="sc-npc-add-hint">Génération IA portrait + plein pied (Z-Image / Flux + FaceDetailer)</span>
          </button>
        </div>
      )}

      {/* Modal création */}
      <BookNpcCreatorModal
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        bookId={bookId}
        onSaved={handleSaved}
      />

      {/* Modal édition (ouvert quand editingNpc défini) */}
      <BookNpcCreatorModal
        open={editingNpc !== null}
        onClose={() => setEditingNpc(null)}
        bookId={bookId}
        editingNpc={editingNpc}
        onSaved={handleSaved}
      />

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div className="sc-npc-confirm-backdrop" onClick={() => deletingId === null && setConfirmDelete(null)}>
          <div className="sc-npc-confirm" onClick={e => e.stopPropagation()}>
            <h3>Supprimer ce personnage ?</h3>
            <p>
              <strong>{confirmDelete.name}</strong> sera retiré du livre. Les plans qui le
              référencent ne seront pas modifiés mais perdront leur lien.
            </p>
            <div className="sc-npc-confirm-actions">
              <button
                type="button"
                className="sc-npc-form-cancel"
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId !== null}
              >
                Annuler
              </button>
              <button
                type="button"
                className="sc-npc-confirm-delete"
                onClick={() => void handleDelete(confirmDelete)}
                disabled={deletingId !== null}
              >
                {deletingId !== null ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
