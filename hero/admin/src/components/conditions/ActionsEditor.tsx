'use client'
/**
 * Éditeur no-code de cascade d'actions déclenchées au clic.
 *
 * Structure plate (pas de récursion) : une liste ordonnée d'actions.
 * L'ordre compte — les actions s'appliquent séquentiellement, chaque
 * action voit le state produit par les précédentes.
 *
 * API :
 *   <ActionsEditor
 *     value={actions}
 *     onChange={next => ...}
 *     context={{ items, sections }}
 *   />
 */

import React from 'react'
import type { Action, StatOp } from '@/types/actions'
import type { Item, Section } from '@/types'

export interface ActionsEditorContext {
  items: Pick<Item, 'id' | 'name'>[]
  sections: Pick<Section, 'id' | 'number'>[]
  knownFlags?: string[]
  knownStats?: string[]
  knownVars?: string[]
  /** Pour le kind `start_dialog` — à remplir quand on aura un référentiel dialogues. */
  dialogs?: { id: string; label: string }[]
}

export interface ActionsEditorProps {
  value: Action[]
  onChange: (next: Action[]) => void
  context: ActionsEditorContext
}

const KIND_LABELS: Record<Action['kind'], string> = {
  give_item:    'Donner un objet',
  take_item:    'Retirer un objet',
  set_flag:     'Définir un drapeau',
  set_stat:     'Modifier une stat',
  set_var:      'Définir une variable',
  navigate:     'Aller à une section',
  start_dialog: 'Ouvrir un dialogue',
}

const STAT_OP_LABELS: Record<StatOp, string> = {
  set:      '= (définir à)',
  add:      '+ (ajouter)',
  subtract: '- (soustraire)',
}

export default function ActionsEditor({ value, onChange, context }: ActionsEditorProps) {
  const addAction = (kind: Action['kind']) => {
    onChange([...value, defaultActionForKind(kind, context)])
  }

  const updateAction = (idx: number, next: Action) => {
    onChange(value.map((a, i) => (i === idx ? next : a)))
  }

  const removeAction = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  const moveAction = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir
    if (nextIdx < 0 || nextIdx >= value.length) return
    const copy = [...value]
    const [item] = copy.splice(idx, 1)
    copy.splice(nextIdx, 0, item)
    onChange(copy)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {value.length === 0 && (
        <div style={{ color: '#9898b4', fontSize: 12, fontStyle: 'italic', padding: '4px 0' }}>
          Aucune action au clic. La navigation vers une section cible reste possible via le champ classique du choix.
        </div>
      )}

      {value.map((action, idx) => (
        <ActionRow
          key={idx}
          index={idx}
          total={value.length}
          value={action}
          onChange={next => updateAction(idx, next)}
          onRemove={() => removeAction(idx)}
          onMoveUp={() => moveAction(idx, -1)}
          onMoveDown={() => moveAction(idx, 1)}
          context={context}
        />
      ))}

      <AddActionPicker onAdd={addAction} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Ligne d'action — rend les champs spécifiques au kind
// ────────────────────────────────────────────────────────────────────────

interface ActionRowProps {
  index: number
  total: number
  value: Action
  onChange: (next: Action) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  context: ActionsEditorContext
}

function ActionRow({ index, total, value, onChange, onRemove, onMoveUp, onMoveDown, context }: ActionRowProps) {
  const change = (patch: Partial<Action>) => onChange({ ...value, ...patch } as Action)

  return (
    <div style={rowContainer}>
      <span style={orderBadge}>{index + 1}</span>
      <span style={kindLabel}>{KIND_LABELS[value.kind]}</span>

      {value.kind === 'give_item' && (
        <>
          <select value={value.item_id} onChange={e => change({ item_id: e.target.value })} style={selectStyle}>
            <option value="">— Choisir un objet —</option>
            {context.items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select>
          <input
            type="number" min={1}
            value={value.quantity ?? 1}
            onChange={e => change({ quantity: Math.max(1, Number(e.target.value) || 1) })}
            style={{ ...inputStyle, width: 60 }}
            title="Quantité"
          />
        </>
      )}

      {value.kind === 'take_item' && (
        <>
          <select value={value.item_id} onChange={e => change({ item_id: e.target.value })} style={selectStyle}>
            <option value="">— Choisir un objet —</option>
            {context.items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select>
          <input
            type="number" min={1}
            value={value.quantity ?? 1}
            onChange={e => change({ quantity: Math.max(1, Number(e.target.value) || 1) })}
            style={{ ...inputStyle, width: 60 }}
          />
        </>
      )}

      {value.kind === 'set_flag' && (
        <>
          <input
            type="text"
            value={value.flag}
            onChange={e => change({ flag: e.target.value })}
            placeholder="nom du drapeau"
            list="ie-known-flags"
            style={{ ...inputStyle, width: 220 }}
          />
          <select
            value={value.value ? 'true' : 'false'}
            onChange={e => change({ value: e.target.value === 'true' })}
            style={selectStyle}
          >
            <option value="true">= vrai</option>
            <option value="false">= faux</option>
          </select>
        </>
      )}

      {value.kind === 'set_stat' && (
        <>
          <input
            type="text"
            value={value.stat}
            onChange={e => change({ stat: e.target.value })}
            placeholder="nom de la stat"
            list="ie-known-stats"
            style={{ ...inputStyle, width: 180 }}
          />
          <select value={value.op} onChange={e => change({ op: e.target.value as StatOp })} style={selectStyle}>
            {(Object.keys(STAT_OP_LABELS) as StatOp[]).map(op => (
              <option key={op} value={op}>{STAT_OP_LABELS[op]}</option>
            ))}
          </select>
          <input
            type="number"
            value={value.value}
            onChange={e => change({ value: Number(e.target.value) || 0 })}
            style={{ ...inputStyle, width: 80 }}
          />
        </>
      )}

      {value.kind === 'set_var' && (
        <>
          <input
            type="text"
            value={value.var}
            onChange={e => change({ var: e.target.value })}
            placeholder="nom de variable"
            style={{ ...inputStyle, width: 180 }}
          />
          <input
            type="text"
            value={String(value.value)}
            onChange={e => {
              const raw = e.target.value
              const asNum = Number(raw)
              const parsed: string | number | boolean =
                raw === 'true' ? true :
                raw === 'false' ? false :
                !isNaN(asNum) && raw.trim() !== '' ? asNum :
                raw
              change({ value: parsed })
            }}
            placeholder="valeur (texte, nombre, true/false)"
            style={{ ...inputStyle, width: 200 }}
          />
        </>
      )}

      {value.kind === 'navigate' && (
        <select value={value.section_id} onChange={e => change({ section_id: e.target.value })} style={selectStyle}>
          <option value="">— Choisir une section —</option>
          {context.sections.map(s => <option key={s.id} value={s.id}>Section {s.number}</option>)}
        </select>
      )}

      {value.kind === 'start_dialog' && (
        <select value={value.dialog_id} onChange={e => change({ dialog_id: e.target.value })} style={selectStyle}>
          <option value="">— Choisir un dialogue —</option>
          {(context.dialogs ?? []).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      )}

      {/* Boutons de contrôle */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
        <button onClick={onMoveUp} disabled={index === 0} title="Monter" style={controlBtn(index === 0)}>↑</button>
        <button onClick={onMoveDown} disabled={index === total - 1} title="Descendre" style={controlBtn(index === total - 1)}>↓</button>
        <button onClick={onRemove} title="Supprimer" style={{ ...controlBtn(false), color: '#ef4444' }}>×</button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Picker d'ajout — dropdown de type d'action
// ────────────────────────────────────────────────────────────────────────

function AddActionPicker({ onAdd }: { onAdd: (kind: Action['kind']) => void }) {
  return (
    <select
      value=""
      onChange={e => {
        const k = e.target.value as Action['kind']
        if (k) {
          onAdd(k)
          e.currentTarget.value = ''
        }
      }}
      style={{ ...btnGhost, alignSelf: 'flex-start', cursor: 'pointer' }}
    >
      <option value="">+ Ajouter une action…</option>
      {(Object.keys(KIND_LABELS) as Action['kind'][]).map(k => (
        <option key={k} value={k}>{KIND_LABELS[k]}</option>
      ))}
    </select>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function defaultActionForKind(kind: Action['kind'], context: ActionsEditorContext): Action {
  switch (kind) {
    case 'give_item':    return { kind: 'give_item', item_id: context.items[0]?.id ?? '', quantity: 1 }
    case 'take_item':    return { kind: 'take_item', item_id: context.items[0]?.id ?? '', quantity: 1 }
    case 'set_flag':     return { kind: 'set_flag', flag: '', value: true }
    case 'set_stat':     return { kind: 'set_stat', stat: '', op: 'add', value: 1 }
    case 'set_var':      return { kind: 'set_var', var: '', value: '' }
    case 'navigate':     return { kind: 'navigate', section_id: context.sections[0]?.id ?? '' }
    case 'start_dialog': return { kind: 'start_dialog', dialog_id: context.dialogs?.[0]?.id ?? '' }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────

const rowContainer: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
  padding: '6px 8px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 6,
}

const orderBadge: React.CSSProperties = {
  width: 22, height: 22,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#EC4899',
  color: 'white',
  fontSize: 11, fontWeight: 600,
  borderRadius: 11,
  flexShrink: 0,
}

const kindLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 500,
  color: '#ede9df',
  whiteSpace: 'nowrap',
}

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: '#0d0d0d',
  border: '1px solid #3a3a42',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
}

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: '#0d0d0d',
  border: '1px solid #3a3a42',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

const btnGhost: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  border: '1px dashed #3a3a42',
  borderRadius: 4,
  color: '#9898b4',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const controlBtn = (disabled: boolean): React.CSSProperties => ({
  width: 22, height: 22,
  padding: 0,
  background: 'transparent',
  border: '1px solid #3a3a42',
  borderRadius: 4,
  color: disabled ? '#3a3a42' : '#9898b4',
  fontSize: 12,
  lineHeight: 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'inherit',
})
