'use client'
/**
 * Constructeur no-code de condition structurée.
 *
 * API :
 *   <ConditionBuilder
 *     value={condition | undefined}
 *     onChange={next => ...}
 *     context={{ items, sections }}
 *   />
 *
 * Récursif : les kinds `and` / `or` / `not` se rendent avec un sous-arbre
 * de conditions, chaque nœud enfant utilise le même composant.
 *
 * Stockage : le composant est 100% controlé. Il écrit dans `value` via
 * `onChange`. Aucune persistance propre. Le parent sérialise en JSONB.
 */

import React, { useMemo } from 'react'
import type { Condition, ComparisonOp } from '@/types/conditions'
import type { Item, Section } from '@/types'

export interface ConditionBuilderContext {
  items: Pick<Item, 'id' | 'name'>[]
  sections: Pick<Section, 'id' | 'number'>[]
  /** Noms de flags déjà utilisés dans le livre (pour autocomplete). Optionnel. */
  knownFlags?: string[]
  /** Noms de stats déjà utilisés dans le livre (pour autocomplete). Optionnel. */
  knownStats?: string[]
}

export interface ConditionBuilderProps {
  value?: Condition
  onChange: (next: Condition | undefined) => void
  context: ConditionBuilderContext
  /** Profondeur récursive (auto-géré). Usage interne. */
  depth?: number
}

const KIND_LABELS: Record<Condition['kind'], string> = {
  item:    'Possède un objet',
  stat:    'Stat / compteur',
  flag:    'Drapeau (vrai/faux)',
  visited: 'Section visitée',
  and:     'Toutes ces conditions (ET)',
  or:      'Au moins une (OU)',
  not:     'Pas cette condition (NON)',
}

const COMPARISON_LABELS: Record<ComparisonOp, string> = {
  '>':  '>',
  '>=': '≥',
  '<':  '<',
  '<=': '≤',
  '==': '=',
  '!=': '≠',
}

export default function ConditionBuilder({ value, onChange, context, depth = 0 }: ConditionBuilderProps) {
  if (!value) {
    return (
      <button
        onClick={() => onChange(defaultConditionForKind('item', context))}
        style={btnGhost}
      >
        + Ajouter une condition
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ConditionNode value={value} onChange={onChange} context={context} depth={depth} removable />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Nœud récursif : une condition affichée + éditable + suppressible
// ────────────────────────────────────────────────────────────────────────

interface ConditionNodeProps {
  value: Condition
  onChange: (next: Condition | undefined) => void
  context: ConditionBuilderContext
  depth: number
  /** Si true, affiche un bouton × qui appelle `onChange(undefined)`. */
  removable?: boolean
}

function ConditionNode({ value, onChange, context, depth, removable }: ConditionNodeProps) {
  const change = (patch: Partial<Condition>) => {
    onChange({ ...value, ...patch } as Condition)
  }

  const changeKind = (newKind: Condition['kind']) => {
    if (newKind === value.kind) return
    onChange(defaultConditionForKind(newKind, context))
  }

  return (
    <div style={{ ...rowContainer, paddingLeft: depth > 0 ? 12 : 0, borderLeft: depth > 0 ? '2px solid #3a3a42' : 'none' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={value.kind} onChange={e => changeKind(e.target.value as Condition['kind'])} style={selectStyle}>
          {(Object.keys(KIND_LABELS) as Condition['kind'][]).map(k => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>

        {/* Champs spécifiques au kind */}
        {value.kind === 'item' && (
          <>
            <select
              value={value.item_id}
              onChange={e => change({ item_id: e.target.value })}
              style={selectStyle}
            >
              <option value="">— Choisir un objet —</option>
              {context.items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            <select
              value={value.present === false ? 'absent' : 'present'}
              onChange={e => change({ present: e.target.value === 'present' })}
              style={selectStyle}
            >
              <option value="present">dans l&apos;inventaire</option>
              <option value="absent">pas dans l&apos;inventaire</option>
            </select>
          </>
        )}

        {value.kind === 'stat' && (
          <>
            <input
              type="text"
              value={value.stat}
              onChange={e => change({ stat: e.target.value })}
              placeholder="nom de la stat (ex: reputation_johnny)"
              list="ie-known-stats"
              style={{ ...inputStyle, width: 200 }}
            />
            <select value={value.op} onChange={e => change({ op: e.target.value as ComparisonOp })} style={selectStyle}>
              {(Object.keys(COMPARISON_LABELS) as ComparisonOp[]).map(op => (
                <option key={op} value={op}>{COMPARISON_LABELS[op]}</option>
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

        {value.kind === 'flag' && (
          <>
            <input
              type="text"
              value={value.flag}
              onChange={e => change({ flag: e.target.value })}
              placeholder="nom du drapeau (ex: trash_searched_s12)"
              list="ie-known-flags"
              style={{ ...inputStyle, width: 260 }}
            />
            <select
              value={(value.value ?? true) ? 'true' : 'false'}
              onChange={e => change({ value: e.target.value === 'true' })}
              style={selectStyle}
            >
              <option value="true">est vrai</option>
              <option value="false">est faux</option>
            </select>
          </>
        )}

        {value.kind === 'visited' && (
          <>
            <select
              value={value.section_id}
              onChange={e => change({ section_id: e.target.value })}
              style={selectStyle}
            >
              <option value="">— Choisir une section —</option>
              {context.sections.map(s => <option key={s.id} value={s.id}>Section {s.number}</option>)}
            </select>
            <select
              value={(value.visited ?? true) ? 'yes' : 'no'}
              onChange={e => change({ visited: e.target.value === 'yes' })}
              style={selectStyle}
            >
              <option value="yes">a été visitée</option>
              <option value="no">n&apos;a pas été visitée</option>
            </select>
          </>
        )}

        {value.kind === 'not' && (
          <span style={{ color: '#9898b4', fontSize: 12 }}>inverse de :</span>
        )}

        {removable && (
          <button
            onClick={() => onChange(undefined)}
            title="Supprimer cette condition"
            style={removeBtn}
          >
            ×
          </button>
        )}
      </div>

      {/* Sous-conditions pour and / or */}
      {(value.kind === 'and' || value.kind === 'or') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {value.conditions.map((child, idx) => (
            <ConditionNode
              key={idx}
              value={child}
              onChange={next => {
                const nextList = next
                  ? value.conditions.map((c, i) => (i === idx ? next : c))
                  : value.conditions.filter((_, i) => i !== idx)
                change({ conditions: nextList })
              }}
              context={context}
              depth={depth + 1}
              removable
            />
          ))}
          <button
            onClick={() => change({ conditions: [...value.conditions, defaultConditionForKind('item', context)] })}
            style={{ ...btnGhost, alignSelf: 'flex-start', marginTop: 4 }}
          >
            + Ajouter une sous-condition
          </button>
        </div>
      )}

      {/* Sous-condition unique pour not */}
      {value.kind === 'not' && (
        <div style={{ marginTop: 6 }}>
          <ConditionNode
            value={value.condition}
            onChange={next => {
              if (next) change({ condition: next })
              else onChange(undefined)  // supprime le not complet si enfant retiré
            }}
            context={context}
            depth={depth + 1}
          />
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function defaultConditionForKind(kind: Condition['kind'], context: ConditionBuilderContext): Condition {
  switch (kind) {
    case 'item':    return { kind: 'item', item_id: context.items[0]?.id ?? '', present: true }
    case 'stat':    return { kind: 'stat', stat: '', op: '>', value: 0 }
    case 'flag':    return { kind: 'flag', flag: '', value: true }
    case 'visited': return { kind: 'visited', section_id: context.sections[0]?.id ?? '', visited: true }
    case 'and':     return { kind: 'and', conditions: [] }
    case 'or':      return { kind: 'or', conditions: [] }
    case 'not':     return { kind: 'not', condition: { kind: 'item', item_id: context.items[0]?.id ?? '', present: true } }
  }
}

/** À monter UNE FOIS en haut du consumer pour brancher les autocompletes. */
export function ConditionBuilderDatalists({ context }: { context: ConditionBuilderContext }) {
  return (
    <>
      {context.knownStats && context.knownStats.length > 0 && (
        <datalist id="ie-known-stats">
          {context.knownStats.map(s => <option key={s} value={s} />)}
        </datalist>
      )}
      {context.knownFlags && context.knownFlags.length > 0 && (
        <datalist id="ie-known-flags">
          {context.knownFlags.map(f => <option key={f} value={f} />)}
        </datalist>
      )}
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Styles (inline pour ne pas dépendre du CSS global de l'ImageEditor)
// ────────────────────────────────────────────────────────────────────────

const rowContainer: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
}

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

const btnGhost: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  border: '1px dashed #3a3a42',
  borderRadius: 4,
  color: '#9898b4',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const removeBtn: React.CSSProperties = {
  width: 22, height: 22,
  padding: 0,
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  borderRadius: 11,
  color: '#ef4444',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginLeft: 'auto',
}
