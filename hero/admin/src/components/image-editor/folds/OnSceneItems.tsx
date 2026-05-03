'use client'
/**
 * "Sur la scène — Objets" : liste des items déjà placés avec édition inline
 * et drag-and-drop d'ordre Z (top liste = devant canvas).
 *
 * Structure identique à OnSceneNpcs (Reorder.Group + dragControls + dim au drag).
 */
import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { ChevronDown, Hand, Trash2, GripVertical } from 'lucide-react'
import type { Item } from '@/types'
import type { EditorItemPlacement } from '../types'
import { useEditorState, type SelectedPlacement } from '../EditorStateContext'

interface OnSceneItemsProps {
  items: Item[]
}

export default function OnSceneItems({ items }: OnSceneItemsProps) {
  const { composition, selected, setSelected, toggleSelected, clearSelected, isSelected, setItems } = useEditorState()
  const [draggingUid, setDraggingUid] = useState<string | null>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Single-expand : expanded est dérivé de selected
  const expanded = new Set(
    selected
      .filter(s => s.kind === 'item')
      .map(s => composition.items[s.index]?._uid)
      .filter((uid): uid is string => !!uid),
  )

  // Scroll auto vers la première ligne sélectionnée
  useEffect(() => {
    const firstSel = selected.find(s => s.kind === 'item')
    if (!firstSel) return
    const placement = composition.items[firstSel.index]
    if (!placement) return
    const el = rowRefs.current.get(placement._uid)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selected, composition.items])

  if (composition.items.length === 0) {
    return (
      <div style={{ fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-faint)', fontStyle: 'italic', padding: 'var(--ie-space-2)' }}>
        Aucun objet sur la scène. Ouvre « Ajouter un objet » ou « Générer un objet ».
      </div>
    )
  }

  const selectedCount = selected.filter(s => s.kind === 'item').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {selectedCount > 1 && (
        <div style={{
          padding: 'var(--ie-space-2) var(--ie-space-3)',
          background: 'var(--ie-accent-faint)',
          color: 'var(--ie-accent-dark)',
          borderRadius: 'var(--ie-radius)',
          fontSize: 'var(--ie-text-xs)',
          fontWeight: 500,
        }}>
          {selectedCount} sélectionnés — drag sur Canvas pour les déplacer ensemble
        </div>
      )}
      {composition.items.length > 1 && (
        <div style={{
          fontSize: 10, color: 'var(--ie-text-faint)',
          fontStyle: 'italic', padding: '0 4px',
        }}>
          ⠿ glisse pour changer l&apos;ordre Z (haut = devant)
        </div>
      )}

      <Reorder.Group
        as="div"
        axis="y"
        values={composition.items}
        onReorder={setItems}
        style={{ listStyle: 'none', padding: 0, margin: 0 }}
      >
        {composition.items.map((p) => {
          const index = composition.items.findIndex(x => x._uid === p._uid)
          const item = items.find(i => i.id === p.item_id)
          const url = p.custom_url ?? item?.illustration_url
          const name = p.custom_name ?? item?.name ?? 'Objet'
          const sel: SelectedPlacement = { kind: 'item', index }
          const isSel = isSelected(sel)
          const isOpen = expanded.has(p._uid)
          const isDragging = draggingUid === p._uid
          const isDimmed = draggingUid !== null && !isDragging
          return (
            <ItemRow
              key={p._uid}
              placement={p}
              imgUrl={url}
              name={name}
              isSel={isSel}
              isOpen={isOpen}
              isDragging={isDragging}
              isDimmed={isDimmed}
              registerRef={(el) => {
                if (el) rowRefs.current.set(p._uid, el)
                else rowRefs.current.delete(p._uid)
              }}
              onHeaderClick={(e) => {
                if (e.shiftKey) {
                  toggleSelected(sel)
                } else if (isSelected(sel) && selected.length === 1) {
                  clearSelected()
                } else {
                  setSelected([sel])
                }
              }}
              onDragStart={() => setDraggingUid(p._uid)}
              onDragEnd={() => setDraggingUid(null)}
              renderEditor={() => <ItemEditor index={index} placement={p} />}
            />
          )
        })}
      </Reorder.Group>
    </div>
  )
}

interface ItemRowProps {
  placement: EditorItemPlacement
  imgUrl: string | undefined
  name: string
  isSel: boolean
  isOpen: boolean
  isDragging: boolean
  isDimmed: boolean
  registerRef: (el: HTMLDivElement | null) => void
  onHeaderClick: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragEnd: () => void
  renderEditor: () => React.ReactNode
}

function ItemRow({ placement, imgUrl, name, isSel, isOpen, isDragging, isDimmed, registerRef, onHeaderClick, onDragStart, onDragEnd, renderEditor }: ItemRowProps) {
  const dragControls = useDragControls()
  const localRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    registerRef(localRef.current)
    return () => registerRef(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Reorder.Item
      as="div"
      ref={localRef}
      value={placement}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{
        boxShadow: '0 12px 32px rgba(236, 72, 153, 0.45), 0 0 0 2px var(--ie-accent)',
        zIndex: 10,
      }}
      transition={{ type: 'spring', stiffness: 350, damping: 32, mass: 0.7 }}
      style={{
        background: isSel ? 'var(--ie-accent-faint)' : 'var(--ie-surface)',
        border: `1px solid ${isSel ? 'var(--ie-accent)' : placement.interactive ? 'rgba(16, 185, 129, 0.4)' : 'var(--ie-border)'}`,
        borderRadius: 'var(--ie-radius)',
        overflow: 'hidden',
        listStyle: 'none',
        cursor: isDragging ? 'grabbing' : 'default',
        marginBottom: 4,
        opacity: isDimmed ? 0.45 : 1,
        filter: isDimmed ? 'saturate(0.6)' : 'none',
        transition: 'opacity 200ms ease-out, filter 200ms ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div
          onPointerDown={(e) => dragControls.start(e)}
          title="Glisse pour changer l'ordre Z (top = devant)"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
            cursor: 'grab',
            color: isDragging ? 'var(--ie-accent)' : 'var(--ie-text-faint)',
            flexShrink: 0,
            touchAction: 'none',
          }}
        >
          <GripVertical size={14} />
        </div>
        <button
          onClick={onHeaderClick}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 6px 6px 0',
            background: 'transparent',
            color: isSel ? 'var(--ie-accent-dark)' : 'var(--ie-text)',
            textAlign: 'left',
          }}
        >
          {imgUrl ? (
            <img src={imgUrl} alt="" style={{ width: 24, height: 24, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }} draggable={false} />
          ) : (
            <div style={{ width: 24, height: 24, borderRadius: 3, background: 'var(--ie-surface-3)', flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 'var(--ie-text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </span>
            <span style={{ fontSize: 10, color: 'var(--ie-text-faint)', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 4 }}>
              scale {placement.scale.toFixed(2)}
              {placement.interactive && <span style={{ color: 'var(--ie-success)', fontWeight: 600 }}>· ramassable</span>}
            </span>
          </div>
          <motion.span
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            style={{ display: 'flex', alignItems: 'center', color: 'var(--ie-text-faint)' }}
          >
            <ChevronDown size={14} />
          </motion.span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && !isDragging && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            {renderEditor()}
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}

function ItemEditor({ index, placement }: { index: number; placement: EditorItemPlacement }) {
  const { updateItem, removeItem } = useEditorState()

  return (
    <div style={{
      padding: '8px 10px',
      borderTop: '1px solid var(--ie-border)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={smallLabel}>Taille — {placement.scale.toFixed(2)}</span>
        <input
          type="range" min={0.1} max={3} step={0.05} value={placement.scale}
          onChange={e => updateItem(index, { scale: Number(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--ie-accent)' }}
        />
      </label>

      <button
        onClick={() => updateItem(index, { interactive: !placement.interactive })}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px',
          borderRadius: 'var(--ie-radius)',
          border: `1px solid ${placement.interactive ? 'var(--ie-success)' : 'var(--ie-border-strong)'}`,
          background: placement.interactive ? 'rgba(16, 185, 129, 0.08)' : 'var(--ie-surface)',
          color: placement.interactive ? 'var(--ie-success)' : 'var(--ie-text-muted)',
          fontSize: 'var(--ie-text-xs)',
          textAlign: 'left',
        }}
        title="Get Object : si actif, le joueur peut cliquer pour ramasser"
      >
        <Hand size={12} />
        <span style={{ flex: 1 }}>{placement.interactive ? 'Ramassable' : 'Décoratif'}</span>
      </button>

      <button
        onClick={() => removeItem(index)}
        style={{
          padding: '5px 8px',
          background: 'transparent',
          color: 'var(--ie-danger)',
          border: '1px solid var(--ie-danger)',
          borderRadius: 'var(--ie-radius)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          fontSize: 'var(--ie-text-xs)',
        }}
      >
        <Trash2 size={12} /> Retirer
      </button>
    </div>
  )
}

const smallLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--ie-text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.03em',
}
