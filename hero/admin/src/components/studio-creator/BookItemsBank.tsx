'use client'
/**
 * BookItemsBank — onglet "Banque d'objets" du Studio Section/Creator.
 *
 * V1 2026-05-19 — pattern aligné sur [[BookNpcsBank]] : grid de cards (vignette
 * illustration + nom + catégorie), boutons edit/delete au hover, tile "+ Créer"
 * qui ouvre [[ItemCreatorModal]] (réutilisé du Designer).
 *
 * Endpoints utilisés :
 *   - GET    /api/books/{bookId}/items
 *   - POST   /api/books/{bookId}/items                  (via ItemCreatorModal)
 *   - PATCH  /api/books/{bookId}/items {item_id, ...}   (via ItemCreatorModal édition)
 *   - DELETE /api/books/{bookId}/items?item_id=X
 */

import React, { useEffect, useState } from 'react'
import { Plus, Backpack, Pencil, Trash2 } from 'lucide-react'
import ItemCreatorModal, { type ItemFormData } from '@/components/image-editor/designer/ItemCreatorModal'

/** Row item retournée par /api/books/{id}/items (shape DB minimale ici). */
interface ItemRow {
  id: string
  name: string
  item_type?: string | null
  category?: string | null
  description?: string | null
  illustration_url?: string | null
  detail_url?: string | null
  weapon_type?: string | null
  effect?: Record<string, unknown> | null
  quantity?: number | null
  auto_pickup?: boolean | null
  sections_used?: string[] | null
}

interface BookItemsBankProps {
  bookId: string
}

export default function BookItemsBank({ bookId }: BookItemsBankProps) {
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ItemRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ItemRow | null>(null)

  useEffect(() => {
    let aborted = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/books/${bookId}/items`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as { items?: ItemRow[]; error?: string }
        if (json.error) throw new Error(json.error)
        if (!aborted) setItems(json.items ?? [])
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[BookItemsBank] load failed:', msg)
        setError(msg)
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    void load()
    return () => { aborted = true }
  }, [bookId])

  function handleSaved(saved: ItemFormData & { id: string }) {
    // Re-shape vers ItemRow (les champs sont compatibles).
    const row: ItemRow = {
      id: saved.id,
      name: saved.name,
      item_type: saved.item_type ?? null,
      category: saved.category ?? null,
      description: saved.description ?? null,
      illustration_url: saved.illustration_url ?? null,
      detail_url: saved.detail_url ?? null,
      weapon_type: saved.weapon_type ?? null,
      effect: (saved.effect as Record<string, unknown>) ?? null,
      quantity: saved.quantity ?? null,
      auto_pickup: saved.auto_pickup ?? null,
      sections_used: saved.sections_used ?? null,
    }
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === saved.id)
      if (idx === -1) return [...prev, row]
      const next = [...prev]
      next[idx] = row
      return next
    })
  }

  async function handleDelete(item: ItemRow) {
    setDeletingId(item.id)
    try {
      const res = await fetch(`/api/books/${bookId}/items?item_id=${item.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const eb = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(eb.error ?? `HTTP ${res.status}`)
      }
      setItems(prev => prev.filter(i => i.id !== item.id))
      setConfirmDelete(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[BookItemsBank] delete failed:', msg)
      alert(`Suppression échouée : ${msg}`)
    } finally {
      setDeletingId(null)
    }
  }

  /** Convertit ItemRow → ItemFormData pour passer en mode édition au modal. */
  function rowToForm(row: ItemRow): ItemFormData {
    return {
      id: row.id,
      name: row.name,
      item_type: (row.item_type ?? 'outil') as ItemFormData['item_type'],
      category: (row.category ?? 'consommable') as ItemFormData['category'],
      weapon_type: row.weapon_type ?? null,
      description: row.description ?? null,
      illustration_url: row.illustration_url ?? null,
      detail_url: row.detail_url ?? null,
      effect: (row.effect as ItemFormData['effect']) ?? {},
      quantity: row.quantity ?? 1,
      auto_pickup: row.auto_pickup ?? false,
      sections_used: row.sections_used ?? [],
    }
  }

  return (
    <div className="sc-npcs-bank">
      <div className="sc-section-header">
        <div>
          <h1>Banque d&apos;objets</h1>
          <p>{items.length} objet{items.length > 1 ? 's' : ''} dans le livre</p>
        </div>
      </div>

      {loading ? (
        <div className="sc-loading">Chargement…</div>
      ) : error ? (
        <div className="sc-empty" style={{ color: '#EF4444' }}>⚠ {error}</div>
      ) : (
        <div className="sc-npcs-grid">
          {items.map(i => (
            <div key={i.id} className="sc-npc-card">
              <div
                className="sc-npc-portrait"
                onClick={() => setEditingItem(i)}
                title="Modifier l'objet"
              >
                {i.illustration_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.illustration_url} alt={i.name} />
                ) : (
                  <Backpack size={32} />
                )}
                <div className="sc-npc-card-actions">
                  <button
                    type="button"
                    className="sc-npc-card-btn"
                    onClick={(e) => { e.stopPropagation(); setEditingItem(i) }}
                    aria-label="Modifier"
                    title="Modifier"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="sc-npc-card-btn sc-npc-card-btn-danger"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(i) }}
                    aria-label="Supprimer"
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="sc-npc-body">
                <div className="sc-npc-name">{i.name}</div>
                {i.category ? (
                  <div className="sc-npc-desc">{i.category}{i.item_type ? ` · ${i.item_type}` : ''}</div>
                ) : null}
              </div>
            </div>
          ))}

          {/* Tuile "+ Créer" */}
          <button
            type="button"
            className="sc-npc-add"
            onClick={() => setCreatorOpen(true)}
          >
            <Plus size={28} />
            <span>Créer un objet</span>
            <span className="sc-npc-add-hint">Génération IA illustration ou import manuel</span>
          </button>
        </div>
      )}

      {/* Modal création */}
      <ItemCreatorModal
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        editingItem={null}
        bookId={bookId}
        onSaved={(saved) => { handleSaved(saved); setCreatorOpen(false) }}
        storagePathPrefix={`books/${bookId}/items`}
      />

      {/* Modal édition */}
      <ItemCreatorModal
        open={editingItem !== null}
        onClose={() => setEditingItem(null)}
        editingItem={editingItem ? rowToForm(editingItem) : null}
        bookId={bookId}
        onSaved={(saved) => { handleSaved(saved); setEditingItem(null) }}
        storagePathPrefix={`books/${bookId}/items`}
      />

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div className="sc-npc-confirm-backdrop" onClick={() => deletingId === null && setConfirmDelete(null)}>
          <div className="sc-npc-confirm" onClick={e => e.stopPropagation()}>
            <h3>Supprimer cet objet ?</h3>
            <p>
              <strong>{confirmDelete.name}</strong> sera retiré du livre. Les sections qui
              le référencent ne seront pas modifiées mais perdront leur lien.
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
