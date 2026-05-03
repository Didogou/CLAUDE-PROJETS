'use client'
/**
 * Fold Ajouter/Liste d'objets.
 *
 * Deux modes depuis le même composant :
 *   - mode='add'  : liste tous les items de la section, clic = place au centre
 *   - mode='list' : liste seulement ceux déjà placés avec panneau d'édition
 *                   (taille, flag Get Object cliquable côté joueur)
 *
 * Q5 (validé) : Le fold "Liste d'objets" affiche TOUS les items de la section
 * avec un ✓ pour ceux déjà placés. Clic = place au centre OU édite si placé.
 */
import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Plus, Trash2, Hand, Check } from 'lucide-react'
import type { Item } from '@/types'
import { useEditorState } from '../EditorStateContext'

interface FoldItemProps {
  items: Item[]
  /** 'add' = afficher les items de la section pour placement.
   *  'list' = afficher ceux placés + édition (taille + Get Object). */
  mode: 'add' | 'list'
}

export default function FoldItem({ items, mode }: FoldItemProps) {
  const { composition, addItem } = useEditorState()
  const [search, setSearch] = useState('')

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Q5 (validé) : mode 'list' affiche TOUS les items de la section avec ✓
    // pour ceux placés. Mode 'add' identique pour l'instant (les deux folds
    // permettent d'ajouter ; l'édition se fait dans "Sur la scène > Objets").
    if (!q) return items
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [items, search])

  function handleAdd(item: Item) {
    addItem({
      item_id: item.id,
      theta: 180, phi: -10,   // légèrement sous l'horizon (objet au sol par défaut)
      scale: 0.5,
    })
  }

  if (items.length === 0 && mode === 'add') {
    return (
      <div style={{ fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-muted)', fontStyle: 'italic', padding: 'var(--ie-space-2)' }}>
        Aucun objet dans cette section. Crée un objet dans la fiche Section d&apos;abord, ou utilise « Générer un objet » pour un prop one-shot IA.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-3)' }}>
      {/* Recherche */}
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ie-text-faint)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Chercher un objet…"
          style={searchInput}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--ie-accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--ie-accent-faint)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--ie-border-strong)'; e.currentTarget.style.boxShadow = 'none' }}
        />
      </div>

      {/* Liste items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filteredItems.length === 0 ? (
          <div style={{ padding: 'var(--ie-space-4)', fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-faint)', fontStyle: 'italic', textAlign: 'center' }}>
            {mode === 'list' ? 'Aucun objet placé.' : 'Aucun résultat.'}
          </div>
        ) : (
          filteredItems.map(item => {
            const placedTimes = composition.items.filter(p => p.item_id === item.id).length
            return (
              <motion.button
                key={item.id}
                onClick={() => handleAdd(item)}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                style={itemButton}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--ie-surface-3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {item.illustration_url ? (
                  <img src={item.illustration_url} alt="" style={{ width: 28, height: 28, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: 3, background: 'var(--ie-surface-3)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                  {placedTimes > 0 && (
                    <div style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-accent)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Check size={10} /> Placé ({placedTimes})
                    </div>
                  )}
                </div>
                <Plus size={14} style={{ color: 'var(--ie-text-faint)', flexShrink: 0 }} />
              </motion.button>
            )
          })
        )}
      </div>

      <div style={{ fontSize: 10, color: 'var(--ie-text-faint)', fontStyle: 'italic', lineHeight: 1.4 }}>
        L&apos;édition des objets déjà placés se fait dans « Sur la scène &rsaquo; Objets » en haut.
      </div>
    </div>
  )
}

// ── Panneau édition de l'item sélectionné (kept for ref but not rendered anymore) ──

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _UnusedItemEditPanel({ items }: { items: Item[] }) {
  const { composition, selected, updateItem, removeItem } = useEditorState()
  const first = selected[0]
  if (!first || first.kind !== 'item') return null
  const p = composition.items[first.index]
  if (!p) return null
  const item = items.find(i => i.id === p.item_id)

  return (
    <AnimatePresence>
      <motion.div
        key={`item-edit-${first.index}`}
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ overflow: 'hidden', marginTop: 'var(--ie-space-2)' }}
      >
        <div style={{
          padding: 'var(--ie-space-3)',
          background: 'var(--ie-surface)',
          border: '1px solid var(--ie-accent)',
          borderRadius: 'var(--ie-radius-md)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 'var(--ie-text-sm)', fontWeight: 600, color: 'var(--ie-accent-dark)' }}>
            {p.custom_name ?? item?.name ?? 'Objet'}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={smallLabel}>Taille — {p.scale.toFixed(2)}</span>
            <input
              type="range" min={0.1} max={3} step={0.05} value={p.scale}
              onChange={e => updateItem(first.index, { scale: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--ie-accent)' }}
            />
          </label>

          {/* Get Object toggle (flag gameplay : objet cliquable/ramassable côté joueur) */}
          <motion.button
            onClick={() => updateItem(first.index, { interactive: !p.interactive })}
            whileTap={{ scale: 0.97 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--ie-radius)',
              border: `1px solid ${p.interactive ? 'var(--ie-success)' : 'var(--ie-border-strong)'}`,
              background: p.interactive ? 'rgba(16, 185, 129, 0.08)' : 'var(--ie-surface)',
              color: p.interactive ? 'var(--ie-success)' : 'var(--ie-text-muted)',
              fontSize: 'var(--ie-text-sm)',
              textAlign: 'left',
            }}
            title="Get Object : si activé, le joueur peut cliquer la zone pour ramasser l'objet"
          >
            <Hand size={14} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontWeight: 500 }}>{p.interactive ? 'Ramassable' : 'Décoratif'}</span>
              <span style={{ fontSize: 10, opacity: 0.75 }}>
                {p.interactive ? 'Zone cliquable côté joueur' : 'Juste un visuel'}
              </span>
            </div>
          </motion.button>

          <motion.button
            onClick={() => removeItem(first.index)}
            whileTap={{ scale: 0.95 }}
            style={{
              padding: '8px 10px',
              background: 'transparent',
              color: 'var(--ie-danger)',
              border: '1px solid var(--ie-danger)',
              borderRadius: 'var(--ie-radius)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontSize: 'var(--ie-text-sm)',
            }}
          >
            <Trash2 size={13} /> Retirer le placement
          </motion.button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

const smallLabel: React.CSSProperties = {
  fontSize: 'var(--ie-text-xs)', fontWeight: 600, color: 'var(--ie-text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.03em',
}
const searchInput: React.CSSProperties = {
  width: '100%', padding: '8px 10px 8px 32px',
  background: 'var(--ie-surface)', border: '1px solid var(--ie-border-strong)',
  borderRadius: 'var(--ie-radius)', fontSize: 'var(--ie-text-base)',
  color: 'var(--ie-text)', outline: 'none',
  transition: 'border-color var(--ie-transition), box-shadow var(--ie-transition)',
}
const itemButton: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 10px',
  borderRadius: 'var(--ie-radius)',
  background: 'transparent', color: 'var(--ie-text)',
  textAlign: 'left', fontSize: 'var(--ie-text-base)',
  transition: 'background var(--ie-transition)',
}
