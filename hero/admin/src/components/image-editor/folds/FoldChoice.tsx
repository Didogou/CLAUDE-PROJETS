'use client'
/**
 * Fold "Placer un choix" : ancre un choix existant de la section à une position
 * (theta, phi) de l'image. Côté joueur (Q7 option C validée), le texte du choix
 * flottera à l'endroit précis, cliquable pour déclencher le choix.
 *
 * Modèle de données : EditorChoicePlacement { choice_id, theta, phi, display_text? }
 * stocké dans composition.choices.
 *
 * UX :
 *   - Liste des choix de la section non encore placés
 *   - Clic = ajout au centre de l'image, repositionnable par drag sur le canvas
 *   - Panneau édition : display_text (override du texte du choix), suppression
 */
import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Plus, Trash2, MousePointerClick } from 'lucide-react'
import type { Choice } from '@/types'
import { useEditorState } from '../EditorStateContext'

interface FoldChoiceProps {
  choices: Choice[]
}

export default function FoldChoice({ choices }: FoldChoiceProps) {
  const { composition, addChoice } = useEditorState()
  const [search, setSearch] = useState('')

  const filteredChoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return choices
    return choices.filter(c => c.label.toLowerCase().includes(q))
  }, [choices, search])

  function handlePlace(choice: Choice) {
    addChoice({
      choice_id: choice.id,
      theta: 180, phi: 0,
    })
  }

  if (choices.length === 0) {
    return (
      <div style={{ fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-muted)', fontStyle: 'italic', padding: 'var(--ie-space-2)' }}>
        Aucun choix associé à cette section. Crée des choix d&apos;abord dans la fiche Section.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-3)' }}>
      <div style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)', lineHeight: 1.4 }}>
        Pose un choix à une position précise de l&apos;image. Le joueur verra un texte flottant cliquable.
      </div>

      {/* Recherche */}
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ie-text-faint)', pointerEvents: 'none' }} />
        <input
          type="text" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Chercher un choix…"
          style={searchInput}
        />
      </div>

      {/* Liste choix */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filteredChoices.map(ch => {
          const placed = (composition.choices ?? []).some(p => p.choice_id === ch.id)
          return (
            <motion.button
              key={ch.id}
              onClick={() => handlePlace(ch)}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px',
                borderRadius: 'var(--ie-radius)',
                background: placed ? 'var(--ie-accent-faint)' : 'transparent',
                color: placed ? 'var(--ie-accent-dark)' : 'var(--ie-text)',
                textAlign: 'left', fontSize: 'var(--ie-text-base)',
              }}
            >
              <MousePointerClick size={14} style={{ flexShrink: 0, color: placed ? 'var(--ie-accent)' : 'var(--ie-text-muted)' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ch.label}
              </span>
              {placed
                ? <span style={{ fontSize: 'var(--ie-text-xs)', fontWeight: 600, color: 'var(--ie-accent)' }}>placé</span>
                : <Plus size={14} style={{ color: 'var(--ie-text-faint)', flexShrink: 0 }} />}
            </motion.button>
          )
        })}
      </div>

      {/* Panneau édition du choix placé sélectionné */}
      <ChoiceEditPanel choices={choices} />
    </div>
  )
}

function ChoiceEditPanel({ choices }: { choices: Choice[] }) {
  const { composition, selected, updateChoice, removeChoice } = useEditorState()
  const first = selected[0]
  if (!first || first.kind !== 'choice') return null
  const p = (composition.choices ?? [])[first.index]
  if (!p) return null
  const choice = choices.find(c => c.id === p.choice_id)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2 }}
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
            {p.display_text || choice?.label || 'Choix'}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={smallLabel}>Texte affiché (override du choix)</span>
            <input
              type="text"
              value={p.display_text ?? ''}
              onChange={e => updateChoice(first.index, { display_text: e.target.value })}
              placeholder={choice?.label ?? 'Texte du choix'}
              style={fieldStyle}
            />
          </label>
          <motion.button
            onClick={() => removeChoice(first.index)}
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
}
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px',
  background: 'var(--ie-bg)', border: '1px solid var(--ie-border-strong)',
  borderRadius: 'var(--ie-radius)', fontSize: 'var(--ie-text-sm)',
  color: 'var(--ie-text)', outline: 'none',
}
