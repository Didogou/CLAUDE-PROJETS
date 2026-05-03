'use client'
/**
 * "Sur la scène — Personnages" : liste des NPCs déjà placés avec édition
 * inline collapsible et drag-and-drop d'ordre Z (top liste = devant canvas).
 *
 * Powered by framer-motion `Reorder.Group` + `Reorder.Item` :
 *   - Drag handle uniquement (icône GripVertical) via `useDragControls`
 *   - Au drag : preview qui suit la souris, item soulevé (z-index + scale + shadow)
 *   - Les autres items s'écartent automatiquement pour laisser de la place
 *   - Les autres items sont DIM (opacity 0.5) pour focus sur le draggé
 *   - Animation spring lisse au drop
 */
import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { ChevronDown, FlipHorizontal2, Sparkles, Trash2, GripVertical } from 'lucide-react'
import type { Npc } from '@/types'
import type { EditorNpcPlacement } from '../types'
import { useEditorState, type SelectedPlacement } from '../EditorStateContext'
import { resolveNpcImageUrl, availableVariants } from '@/components/wizard/helpers/npcImageVariant'

interface OnSceneNpcsProps {
  npcs: Npc[]
  imageUrl: string | null
}

export default function OnSceneNpcs({ npcs, imageUrl }: OnSceneNpcsProps) {
  const { composition, selected, setSelected, toggleSelected, clearSelected, isSelected, setNpcs } = useEditorState()
  const [draggingUid, setDraggingUid] = useState<string | null>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // expanded est DÉRIVÉ de selected (single-expand : sélection = expansion).
  // Sélectionner un autre NPC ferme l'ancien. Multi-sélection (Shift+clic) =
  // toutes les lignes sélectionnées sont ouvertes.
  const expanded = new Set(
    selected
      .filter(s => s.kind === 'npc')
      .map(s => composition.npcs[s.index]?._uid)
      .filter((uid): uid is string => !!uid),
  )

  // Scroll auto vers la première ligne sélectionnée (utile quand sélection
  // depuis le canvas et que la ligne est hors champ dans la sidebar)
  useEffect(() => {
    const firstSel = selected.find(s => s.kind === 'npc')
    if (!firstSel) return
    const placement = composition.npcs[firstSel.index]
    if (!placement) return
    const el = rowRefs.current.get(placement._uid)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selected, composition.npcs])

  if (composition.npcs.length === 0) {
    return (
      <div style={{ fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-faint)', fontStyle: 'italic', padding: 'var(--ie-space-2)' }}>
        Aucun personnage sur la scène. Ouvre « Ajouter un NPJ » pour en placer.
      </div>
    )
  }

  const selectedCount = selected.filter(s => s.kind === 'npc').length

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
      {composition.npcs.length > 1 && (
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
        values={composition.npcs}
        onReorder={setNpcs}
        style={{ listStyle: 'none', padding: 0, margin: 0 }}
      >
        {composition.npcs.map((p) => {
          // Index dynamique au render (recalculé à chaque réorganisation)
          const index = composition.npcs.findIndex(x => x._uid === p._uid)
          const npc = npcs.find(n => n.id === p.npc_id)
          const sel: SelectedPlacement = { kind: 'npc', index }
          const isSel = isSelected(sel)
          const isOpen = expanded.has(p._uid)
          const imgUrl = npc ? resolveNpcImageUrl(npc, p.image_variant) : undefined
          const isDragging = draggingUid === p._uid
          const isDimmed = draggingUid !== null && !isDragging
          return (
            <NpcRow
              key={p._uid}
              placement={p}
              npc={npc}
              imgUrl={imgUrl}
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
                  // Re-clic sur le seul sélectionné → désélectionne (referme)
                  clearSelected()
                } else {
                  setSelected([sel])
                }
              }}
              onDragStart={() => setDraggingUid(p._uid)}
              onDragEnd={() => setDraggingUid(null)}
              renderEditor={() => (
                <NpcEditor index={index} placement={p} npc={npc} imageUrl={imageUrl} />
              )}
            />
          )
        })}
      </Reorder.Group>
    </div>
  )
}

// ── Ligne NPC (Reorder.Item) ─────────────────────────────────────────────

interface NpcRowProps {
  placement: EditorNpcPlacement
  npc: Npc | undefined
  imgUrl: string | undefined
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

function NpcRow({ placement, npc, imgUrl, isSel, isOpen, isDragging, isDimmed, registerRef, onHeaderClick, onDragStart, onDragEnd, renderEditor }: NpcRowProps) {
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
      dragListener={false}        // pas de drag sur tout l'item
      dragControls={dragControls}  // → drag uniquement via la poignée
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{
        boxShadow: '0 12px 32px rgba(236, 72, 153, 0.45), 0 0 0 2px var(--ie-accent)',
        zIndex: 10,
      }}
      transition={{ type: 'spring', stiffness: 350, damping: 32, mass: 0.7 }}
      style={{
        background: isSel ? 'var(--ie-accent-faint)' : 'var(--ie-surface)',
        border: `1px solid ${isSel ? 'var(--ie-accent)' : 'var(--ie-border)'}`,
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
        {/* Drag handle — initie le drag via dragControls */}
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
            <img src={imgUrl} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} draggable={false} />
          ) : (
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ie-surface-3)', flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 'var(--ie-text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {npc?.name ?? '?'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--ie-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
              θ {Math.round(placement.theta)}° · scale {placement.scale.toFixed(2)}
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

      {/* Body éditeur (déplié) */}
      <AnimatePresence initial={false}>
        {isOpen && !isDragging && (
          <motion.div
            key="body"
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

// ── Éditeur NPC inline (slider, flip, prompts, ✨ IA, retirer) ────────────

function NpcEditor({
  index, placement, npc, imageUrl,
}: { index: number; placement: EditorNpcPlacement; npc: Npc | undefined; imageUrl: string | null }) {
  const { updateNpc, removeNpc } = useEditorState()
  const [aiDescription, setAiDescription] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [showAiInput, setShowAiInput] = useState(false)
  const variants = npc ? availableVariants(npc) : []

  async function handleAiPlace() {
    if (!imageUrl || !aiDescription.trim() || aiBusy) return
    setAiBusy(true); setAiError(null)
    try {
      const refUrl = npc ? (resolveNpcImageUrl(npc, placement.image_variant) ?? null) : null
      const res = await fetch('/api/editor/semantic-placement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, description: aiDescription.trim(), reference_url: refUrl, element_type: 'npc' }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `Erreur ${res.status}`)
      updateNpc(index, { theta: d.theta, phi: d.phi, scale: d.scale ?? placement.scale })
      setAiDescription('')
      setShowAiInput(false)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

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
          onChange={e => updateNpc(index, { scale: Number(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--ie-accent)' }}
        />
      </label>

      {variants.length > 1 && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={smallLabel}>Image utilisée</span>
          <select
            value={placement.image_variant ?? 'portrait'}
            onChange={e => updateNpc(index, { image_variant: e.target.value as EditorNpcPlacement['image_variant'] })}
            style={fieldStyle}
          >
            {variants.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </label>
      )}

      <button
        onClick={() => updateNpc(index, { flip: !placement.flip })}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 8px',
          borderRadius: 'var(--ie-radius)',
          border: `1px solid ${placement.flip ? 'var(--ie-accent)' : 'var(--ie-border-strong)'}`,
          background: placement.flip ? 'var(--ie-accent-faint)' : 'var(--ie-surface)',
          color: placement.flip ? 'var(--ie-accent-dark)' : 'var(--ie-text-muted)',
          fontSize: 'var(--ie-text-xs)',
          textAlign: 'left',
        }}
      >
        <FlipHorizontal2 size={12} />
        {placement.flip ? 'Retourné' : 'Retourner'}
      </button>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={smallLabel}>Prompt bake (optionnel)</span>
        <textarea
          value={placement.bake_prompt ?? ''}
          onChange={e => updateNpc(index, { bake_prompt: e.target.value })}
          placeholder={`Ex : ${npc?.name ?? 'NPC'} debout, bras levé`}
          rows={2}
          style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={smallLabel}>Negative bake</span>
        <input
          type="text"
          value={placement.bake_negative ?? ''}
          onChange={e => updateNpc(index, { bake_negative: e.target.value })}
          placeholder="Ex : two men, duplicate"
          style={fieldStyle}
        />
      </label>

      {showAiInput ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            type="text" value={aiDescription}
            onChange={e => setAiDescription(e.target.value)}
            placeholder="ex : sur l'estrade, à droite, au sol…"
            disabled={aiBusy}
            onKeyDown={e => { if (e.key === 'Enter') void handleAiPlace() }}
            style={fieldStyle}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => void handleAiPlace()}
              disabled={aiBusy || !aiDescription.trim() || !imageUrl}
              style={{
                flex: 1, padding: '5px 8px',
                background: aiBusy ? 'var(--ie-surface-3)' : 'var(--ie-accent)',
                color: aiBusy ? 'var(--ie-text-faint)' : 'var(--ie-accent-text-on)',
                border: 'none', borderRadius: 'var(--ie-radius)',
                fontSize: 10, fontWeight: 600,
                cursor: aiBusy ? 'wait' : 'pointer',
              }}
            >
              {aiBusy ? '⏳ Vision…' : 'Placer'}
            </button>
            <button
              onClick={() => { setShowAiInput(false); setAiError(null); setAiDescription('') }}
              style={{
                padding: '5px 8px',
                background: 'transparent', color: 'var(--ie-text-muted)',
                border: '1px solid var(--ie-border-strong)',
                borderRadius: 'var(--ie-radius)', fontSize: 10,
              }}
            >
              ✕
            </button>
          </div>
          {aiError && <div style={{ fontSize: 10, color: 'var(--ie-danger)' }}>⚠ {aiError}</div>}
        </div>
      ) : (
        <button
          onClick={() => setShowAiInput(true)}
          disabled={!imageUrl}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '5px 8px',
            background: 'var(--ie-accent-faint)',
            color: 'var(--ie-accent-dark)',
            border: '1px solid var(--ie-accent)',
            borderRadius: 'var(--ie-radius)',
            fontSize: 'var(--ie-text-xs)', fontWeight: 500,
            cursor: imageUrl ? 'pointer' : 'not-allowed',
            opacity: imageUrl ? 1 : 0.5,
          }}
          title="Décris la position, Claude Vision place le NPC"
        >
          <Sparkles size={12} /> Placer avec IA
        </button>
      )}

      <button
        onClick={() => removeNpc(index)}
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
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '5px 7px',
  background: 'var(--ie-bg)', border: '1px solid var(--ie-border-strong)',
  borderRadius: 'var(--ie-radius)', fontSize: 'var(--ie-text-xs)',
  color: 'var(--ie-text)', outline: 'none',
}
