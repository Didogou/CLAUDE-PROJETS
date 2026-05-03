'use client'
/**
 * Fold "Placer une conversation" : lie une conversation à un NPC déjà placé.
 *
 * Modèle Q8 (validé) : la conversation est TOUJOURS attachée à un NPC placé.
 * L'utilisateur choisit dans la liste des NPCs placés + l'id de la conversation
 * (input texte pour l'instant — sera remplacé par un dropdown quand on aura
 * l'accès à la liste des discussions de la section).
 *
 * Côté joueur : le NPC pulsera légèrement (via le rendu player) pour signaler
 * qu'il est interactif.
 */
import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Trash2, Plus } from 'lucide-react'
import type { Npc } from '@/types'
import { useEditorState } from '../EditorStateContext'
import { resolveNpcImageUrl } from '@/components/wizard/helpers/npcImageVariant'

interface FoldConversationProps {
  npcs: Npc[]
}

export default function FoldConversation({ npcs }: FoldConversationProps) {
  const { composition, addConversation, removeConversation } = useEditorState()
  const [npcIndex, setNpcIndex] = useState<number>(-1)
  const [conversationId, setConversationId] = useState('')

  const placedNpcs = composition.npcs.map((p, idx) => ({
    placement: p,
    npc: npcs.find(n => n.id === p.npc_id),
    index: idx,
  })).filter(x => x.npc !== undefined)

  function handleAdd() {
    if (npcIndex < 0 || !conversationId.trim()) return
    addConversation({
      npc_placement_index: npcIndex,
      conversation_id: conversationId.trim(),
    })
    setNpcIndex(-1)
    setConversationId('')
  }

  if (placedNpcs.length === 0) {
    return (
      <div style={{ fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-muted)', fontStyle: 'italic', padding: 'var(--ie-space-2)' }}>
        Place un NPC d&apos;abord via le fold « Ajouter un NPJ » pour pouvoir lui associer une conversation.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-3)' }}>
      <div style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)', lineHeight: 1.4 }}>
        Associe une conversation à un NPC placé. Côté joueur, le NPC pulsera légèrement pour indiquer qu&apos;il est interactif.
      </div>

      {/* Sélection NPC */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={smallLabel}>NPC placé</span>
        <select
          value={npcIndex}
          onChange={e => setNpcIndex(Number(e.target.value))}
          style={fieldStyle}
        >
          <option value={-1}>— Choisir un NPC —</option>
          {placedNpcs.map(x => (
            <option key={x.index} value={x.index}>
              {x.npc!.name} (θ {Math.round(x.placement.theta)}°)
            </option>
          ))}
        </select>
      </label>

      {/* ID de la conversation (input texte pour v1) */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={smallLabel}>ID de la conversation</span>
        <input
          type="text"
          value={conversationId}
          onChange={e => setConversationId(e.target.value)}
          placeholder="ex : conv_bar_entry_travis"
          style={fieldStyle}
        />
      </label>

      <motion.button
        onClick={handleAdd}
        disabled={npcIndex < 0 || !conversationId.trim()}
        whileHover={(npcIndex >= 0 && conversationId.trim()) ? { scale: 1.01 } : undefined}
        whileTap={(npcIndex >= 0 && conversationId.trim()) ? { scale: 0.98 } : undefined}
        style={{
          padding: '8px 12px',
          background: (npcIndex >= 0 && conversationId.trim()) ? 'var(--ie-accent)' : 'var(--ie-surface-3)',
          color: (npcIndex >= 0 && conversationId.trim()) ? 'var(--ie-accent-text-on)' : 'var(--ie-text-faint)',
          border: 'none', borderRadius: 'var(--ie-radius)',
          fontSize: 'var(--ie-text-sm)', fontWeight: 600,
          cursor: (npcIndex >= 0 && conversationId.trim()) ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        <Plus size={14} /> Attacher la conversation
      </motion.button>

      {/* Liste des conversations déjà placées */}
      {(composition.conversations ?? []).length > 0 && (
        <div style={{
          borderTop: '1px solid var(--ie-border)',
          paddingTop: 'var(--ie-space-3)',
          marginTop: 'var(--ie-space-2)',
        }}>
          <div style={{ ...smallLabel, marginBottom: 'var(--ie-space-2)' }}>
            Conversations placées ({(composition.conversations ?? []).length})
          </div>
          <AnimatePresence>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(composition.conversations ?? []).map((conv, idx) => {
                const npcPlacement = composition.npcs[conv.npc_placement_index]
                const npc = npcPlacement ? npcs.find(n => n.id === npcPlacement.npc_id) : null
                const imgUrl = npc ? resolveNpcImageUrl(npc) : undefined
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 8px',
                      background: 'var(--ie-surface)',
                      border: '1px solid var(--ie-border)',
                      borderRadius: 'var(--ie-radius)',
                      fontSize: 'var(--ie-text-sm)',
                    }}
                  >
                    {imgUrl && <img src={imgUrl} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <MessageCircle size={12} style={{ display: 'inline', marginRight: 4, color: 'var(--ie-accent)' }} />
                        {npc?.name ?? '?'}
                      </div>
                      <div style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-faint)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {conv.conversation_id}
                      </div>
                    </div>
                    <button
                      onClick={() => removeConversation(idx)}
                      style={{
                        padding: 4, background: 'transparent',
                        color: 'var(--ie-danger)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      title="Retirer la conversation"
                    >
                      <Trash2 size={13} />
                    </button>
                  </motion.div>
                )
              })}
            </div>
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

const smallLabel: React.CSSProperties = {
  fontSize: 'var(--ie-text-xs)', fontWeight: 600, color: 'var(--ie-text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.03em',
}
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px',
  background: 'var(--ie-bg)', border: '1px solid var(--ie-border-strong)',
  borderRadius: 'var(--ie-radius)', fontSize: 'var(--ie-text-sm)',
  color: 'var(--ie-text)', outline: 'none',
}
