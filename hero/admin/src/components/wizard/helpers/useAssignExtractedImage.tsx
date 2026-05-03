'use client'
/**
 * Hook + modale pour attacher une image extraite à un NPC ou à un Objet.
 *
 * Usage dans page.tsx :
 *   const assign = useAssignExtractedImage({ bookId, npcs, items, setNpcs, setItems })
 *   // Dans le JSX : {assign.modal}
 *   // Déclencher depuis un callback wizard :
 *   wiz.open({
 *     ...
 *     onCharacterExtracted: (url) => assign.open(url),
 *   })
 *
 * La modale affiche l'image + 2 listes côte-à-côte (🧍 NPCs | 📦 Objets).
 * Chaque liste a ses existants (avec ✓ si déjà une image) + un input pour créer.
 * L'utilisateur clique sur un NPC/Item existant OU tape un nom et "Créer".
 *
 * Utilise les helpers autonomes :
 *   - attachExtractedPortrait (NPC)
 *   - attachExtractedObjectImage (Item)
 */
import React, { useState } from 'react'
import type { Npc, Item } from '@/types'
import { attachExtractedPortrait } from './attachExtractedPortrait'
import { attachExtractedObjectImage } from './attachExtractedObjectImage'

export interface UseAssignExtractedImageParams {
  bookId: string
  npcs: Npc[]
  items: Item[]
  setNpcs: React.Dispatch<React.SetStateAction<Npc[]>>
  setItems: React.Dispatch<React.SetStateAction<Item[]>>
}

export function useAssignExtractedImage(params: UseAssignExtractedImageParams) {
  const { bookId, npcs, items, setNpcs, setItems } = params
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [newNpcName, setNewNpcName] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [processing, setProcessing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  function close() {
    setImageUrl(null); setNewNpcName(''); setNewItemName(''); setFeedback(null); setProcessing(false)
  }

  async function assignNpc(target: 'existing' | 'new', existingId?: string) {
    if (!imageUrl) return
    const name = target === 'existing'
      ? (npcs.find(n => n.id === existingId)?.name ?? '')
      : newNpcName.trim()
    if (!name) { setFeedback('Choisis un NPC existant ou tape un nom.'); return }
    setProcessing(true); setFeedback(null)
    // Le helper prend un promptFn : on court-circuite avec le nom déjà choisi
    const result = await attachExtractedPortrait({
      bookId, npcs, portraitUrl: imageUrl,
      prompt: () => name,
    })
    setProcessing(false)
    if (result.action === 'update') {
      setNpcs(prev => prev.map(n => n.id === result.npc.id ? result.npc : n))
      setFeedback(`✓ Portrait de « ${result.npc.name} » mis à jour.`)
      setTimeout(close, 1200)
    } else if (result.action === 'create') {
      setNpcs(prev => [...prev, result.npc])
      setFeedback(`✓ NPC « ${result.npc.name} » créé.`)
      setTimeout(close, 1200)
    } else if (result.action === 'error') {
      setFeedback(`⚠ ${result.message}`)
    } else {
      close()
    }
  }

  async function assignItem(target: 'existing' | 'new', existingId?: string) {
    if (!imageUrl) return
    setProcessing(true); setFeedback(null)
    const result = await attachExtractedObjectImage({
      bookId, items, imageUrl,
      targetItemId: target === 'existing' ? existingId : undefined,
      newItemName: target === 'new' ? newItemName.trim() : undefined,
    })
    setProcessing(false)
    if (result.action === 'update') {
      setItems(prev => prev.map(i => i.id === result.item.id ? result.item : i))
      setFeedback(`✓ Illustration de « ${result.item.name} » mise à jour.`)
      setTimeout(close, 1200)
    } else if (result.action === 'create') {
      setItems(prev => [...prev, result.item])
      setFeedback(`✓ Objet « ${result.item.name} » créé.`)
      setTimeout(close, 1200)
    } else if (result.action === 'error') {
      setFeedback(`⚠ ${result.message}`)
    } else {
      close()
    }
  }

  const modal = imageUrl ? (
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#000000dd', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: '8px', padding: '1.2rem', maxWidth: 900, width: '100%', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <strong style={{ fontSize: '0.95rem', color: 'var(--accent)' }}>Assigner l&apos;image à…</strong>
          <button onClick={close} disabled={processing} style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: processing ? 'wait' : 'pointer' }}>Annuler</button>
        </div>

        {/* Preview */}
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start' }}>
          <img src={imageUrl} alt="fiche" style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: '6px', border: '2px solid var(--accent)', background: '#808080' }} />
          <div style={{ flex: 1, fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            Choisis la cible : un <strong style={{ color: '#52c484' }}>NPC</strong> (l&apos;image devient son <code>portrait_url</code>) ou un <strong style={{ color: '#e0a742' }}>Objet</strong> (l&apos;image devient son <code>illustration_url</code>). Clique un existant pour mettre à jour, ou tape un nouveau nom.
          </div>
        </div>

        {/* Feedback */}
        {feedback && (
          <div style={{ fontSize: '0.75rem', padding: '0.5rem 0.7rem', borderRadius: '4px', color: feedback.startsWith('⚠') ? '#c94c4c' : '#52c484', background: feedback.startsWith('⚠') ? 'rgba(201,76,76,0.1)' : 'rgba(82,196,132,0.1)', border: `1px solid ${feedback.startsWith('⚠') ? '#c94c4c33' : '#52c48433'}` }}>
            {feedback}
          </div>
        )}

        {/* 2 listes côte-à-côte */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {/* NPCs */}
          <div style={{ border: '1px solid #52c48466', borderRadius: '6px', padding: '0.7rem', background: 'rgba(82,196,132,0.05)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#52c484', fontWeight: 'bold' }}>🧍 NPCs ({npcs.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', maxHeight: 280, overflowY: 'auto' }}>
              {npcs.length === 0 && <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun NPC existant.</div>}
              {npcs.map(n => (
                <button key={n.id} onClick={() => void assignNpc('existing', n.id)} disabled={processing}
                  style={{ textAlign: 'left', padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', fontSize: '0.7rem', cursor: processing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {n.portrait_url && <img src={n.portrait_url} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />}
                  <span style={{ flex: 1 }}>{n.name}</span>
                  {n.portrait_url && <span style={{ fontSize: '0.6rem', color: '#52c484' }}>✓</span>}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.3rem', paddingTop: '0.4rem', borderTop: '1px dashed var(--border)' }}>
              <input type="text" value={newNpcName} onChange={e => setNewNpcName(e.target.value)} placeholder="+ nouveau NPC" disabled={processing}
                style={{ flex: 1, fontSize: '0.7rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem 0.5rem', color: 'var(--foreground)' }} />
              <button onClick={() => void assignNpc('new')} disabled={processing || !newNpcName.trim()}
                style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: 'none', background: '#52c484', color: '#0f0f14', fontWeight: 'bold', cursor: (processing || !newNpcName.trim()) ? 'not-allowed' : 'pointer', opacity: (processing || !newNpcName.trim()) ? 0.5 : 1 }}>
                Créer
              </button>
            </div>
          </div>

          {/* Objets */}
          <div style={{ border: '1px solid #e0a74266', borderRadius: '6px', padding: '0.7rem', background: 'rgba(224,167,66,0.05)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#e0a742', fontWeight: 'bold' }}>📦 Objets ({items.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', maxHeight: 280, overflowY: 'auto' }}>
              {items.length === 0 && <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>Aucun objet existant.</div>}
              {items.map(it => (
                <button key={it.id} onClick={() => void assignItem('existing', it.id)} disabled={processing}
                  style={{ textAlign: 'left', padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--foreground)', fontSize: '0.7rem', cursor: processing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {it.illustration_url && <img src={it.illustration_url} alt="" style={{ width: 22, height: 22, borderRadius: '3px', objectFit: 'cover' }} />}
                  <span style={{ flex: 1 }}>{it.name}</span>
                  <span style={{ fontSize: '0.55rem', color: 'var(--muted)' }}>{it.item_type}</span>
                  {it.illustration_url && <span style={{ fontSize: '0.6rem', color: '#e0a742' }}>✓</span>}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.3rem', paddingTop: '0.4rem', borderTop: '1px dashed var(--border)' }}>
              <input type="text" value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="+ nouvel objet" disabled={processing}
                style={{ flex: 1, fontSize: '0.7rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem 0.5rem', color: 'var(--foreground)' }} />
              <button onClick={() => void assignItem('new')} disabled={processing || !newItemName.trim()}
                style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '4px', border: 'none', background: '#e0a742', color: '#0f0f14', fontWeight: 'bold', cursor: (processing || !newItemName.trim()) ? 'not-allowed' : 'pointer', opacity: (processing || !newItemName.trim()) ? 0.5 : 1 }}>
                Créer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return { open: (url: string) => setImageUrl(url), close, modal, isOpen: !!imageUrl }
}
