'use client'
/**
 * Fold "Ajouter un NPJ" : recherche + liste de PNJ pour AJOUTER à la scène.
 *
 * Plus de panneau d'édition ici — l'édition (scale, variant, prompts, IA, etc.)
 * et la liste des NPCs déjà placés migrent vers le fold "Sur la scène > Personnages"
 * (OnSceneNpcs.tsx) qui apparaît en tête de sidebar dès qu'un NPC est placé.
 *
 * Comportement Q9 (validé) : clic dans la sidebar → ajout au centre de l'image
 * avec scale=1, variant fullbody par défaut. Repositionnement via drag canvas
 * ou via le bouton ✨ IA dans Sur la scène.
 */
import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Plus } from 'lucide-react'
import type { Npc } from '@/types'
import { useEditorState } from '../EditorStateContext'
import { availableVariants } from '@/components/wizard/helpers/npcImageVariant'

interface FoldNPCProps {
  npcs: Npc[]
  /** Conservés pour compat, mais la logique est dans OnSceneNpcs maintenant. */
  imageUrl: string | null
  storagePathPrefix: string
}

export default function FoldNPC({ npcs }: FoldNPCProps) {
  const { composition, addNpc } = useEditorState()
  const [search, setSearch] = useState('')

  const filteredNpcs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return npcs
    return npcs.filter(n =>
      n.name.toLowerCase().includes(q) ||
      (n.type && n.type.toLowerCase().includes(q)),
    )
  }, [npcs, search])

  function handleAdd(npc: Npc) {
    const variants = availableVariants(npc)
    const defaultVariant = variants.find(v => v.key === 'fullbody_gray')?.key
      ?? variants.find(v => v.key === 'fullbody_scenic')?.key
      ?? 'portrait'
    addNpc({
      npc_id: npc.id,
      theta: 180,
      phi: 0,
      scale: 1,
      image_variant: defaultVariant,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-3)' }}>
      {/* Recherche */}
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{
          position: 'absolute',
          left: 10, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--ie-text-faint)',
          pointerEvents: 'none',
        }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Chercher un PNJ…"
          style={{
            width: '100%',
            padding: '8px 10px 8px 32px',
            background: 'var(--ie-surface)',
            border: '1px solid var(--ie-border-strong)',
            borderRadius: 'var(--ie-radius)',
            fontSize: 'var(--ie-text-base)',
            color: 'var(--ie-text)',
            outline: 'none',
            transition: 'border-color var(--ie-transition), box-shadow var(--ie-transition)',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = 'var(--ie-accent)'
            e.currentTarget.style.boxShadow = `0 0 0 3px var(--ie-accent-faint)`
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'var(--ie-border-strong)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        />
      </div>

      {/* Liste NPCs disponibles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filteredNpcs.length === 0 ? (
          <div style={{
            padding: 'var(--ie-space-4)',
            fontSize: 'var(--ie-text-sm)',
            color: 'var(--ie-text-faint)',
            textAlign: 'center',
            fontStyle: 'italic',
          }}>
            {npcs.length === 0 ? 'Aucun PNJ dans ce livre.' : 'Aucun résultat.'}
          </div>
        ) : (
          filteredNpcs.map(npc => {
            const placedTimes = composition.npcs.filter(p => p.npc_id === npc.id).length
            return (
              <motion.button
                key={npc.id}
                onClick={() => handleAdd(npc)}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 'var(--ie-radius)',
                  background: 'transparent',
                  color: 'var(--ie-text)',
                  textAlign: 'left',
                  fontSize: 'var(--ie-text-base)',
                  transition: 'background var(--ie-transition)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--ie-surface-3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {npc.portrait_url ? (
                  <img
                    src={npc.portrait_url}
                    alt=""
                    style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--ie-surface-3)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {npc.name}
                  </span>
                  {npc.type && (
                    <span style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)' }}>
                      {npc.type}
                    </span>
                  )}
                </div>
                {placedTimes > 0 && (
                  <span style={{
                    fontSize: 'var(--ie-text-xs)',
                    fontWeight: 600,
                    color: 'var(--ie-accent)',
                    background: 'var(--ie-accent-faint)',
                    padding: '2px 8px',
                    borderRadius: 999,
                  }}>
                    ×{placedTimes}
                  </span>
                )}
                <Plus size={14} style={{ color: 'var(--ie-text-faint)', flexShrink: 0 }} />
              </motion.button>
            )
          })
        )}
      </div>

      <div style={{ fontSize: 10, color: 'var(--ie-text-faint)', fontStyle: 'italic', lineHeight: 1.4 }}>
        L&apos;édition des NPCs déjà placés se fait dans « Sur la scène &rsaquo; Personnages » en haut.
      </div>
    </div>
  )
}
