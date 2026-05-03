/**
 * Moteur unifié conditions + actions.
 *
 * Point d'entrée unique pour évaluer une condition et appliquer une cascade
 * d'actions contre un `PlayerState`. Consommé par les choix textuels, les
 * hotspots visuels, et toute autre surface interactive à venir.
 *
 * Contrat :
 *  - `evaluateCondition(cond, state)` — pure, pas d'effet de bord, `true/false`
 *  - `applyActions(actions, state)` — retourne un NOUVEAU state + les side effects
 *    à exécuter par le runtime (navigation, ouverture dialog…)
 *
 * Garanties d'immutabilité : les fonctions ne mutent jamais `state`. Clonage
 * shallow par niveau touché (évite deep-clone coûteux tout en gardant les
 * refs inchangées sur les sous-arbres non modifiés).
 */

import type { Condition, PlayerState } from '@/types/conditions'
import type { Action, ApplyResult, SideEffect } from '@/types/actions'

export function evaluateCondition(cond: Condition, state: PlayerState): boolean {
  switch (cond.kind) {
    case 'item': {
      const has = (state.inventory[cond.item_id] ?? 0) > 0
      return (cond.present ?? true) ? has : !has
    }
    case 'stat': {
      const v = state.stats[cond.stat] ?? 0
      switch (cond.op) {
        case '>':  return v > cond.value
        case '>=': return v >= cond.value
        case '<':  return v < cond.value
        case '<=': return v <= cond.value
        case '==': return v === cond.value
        case '!=': return v !== cond.value
      }
    }
    case 'flag': {
      const actual = state.flags[cond.flag] ?? false
      return actual === (cond.value ?? true)
    }
    case 'visited': {
      const was = state.visited[cond.section_id] === true
      return was === (cond.visited ?? true)
    }
    case 'and': return cond.conditions.every(c => evaluateCondition(c, state))
    case 'or':  return cond.conditions.some(c => evaluateCondition(c, state))
    case 'not': return !evaluateCondition(cond.condition, state)
  }
}

export function applyActions(actions: Action[], state: PlayerState): ApplyResult {
  let next = state
  const sideEffects: SideEffect[] = []
  for (const action of actions) {
    const { state: s, sideEffect } = applyAction(action, next)
    next = s
    if (sideEffect) sideEffects.push(sideEffect)
  }
  return { state: next, sideEffects }
}

function applyAction(a: Action, state: PlayerState): { state: PlayerState; sideEffect?: SideEffect } {
  switch (a.kind) {
    case 'give_item': {
      const cur = state.inventory[a.item_id] ?? 0
      return { state: { ...state, inventory: { ...state.inventory, [a.item_id]: cur + (a.quantity ?? 1) } } }
    }
    case 'take_item': {
      const cur = state.inventory[a.item_id] ?? 0
      const next = Math.max(0, cur - (a.quantity ?? 1))
      if (next === 0) {
        const { [a.item_id]: _drop, ...rest } = state.inventory
        return { state: { ...state, inventory: rest } }
      }
      return { state: { ...state, inventory: { ...state.inventory, [a.item_id]: next } } }
    }
    case 'set_flag': {
      return { state: { ...state, flags: { ...state.flags, [a.flag]: a.value } } }
    }
    case 'set_stat': {
      const cur = state.stats[a.stat] ?? 0
      const v = a.op === 'add' ? cur + a.value
             : a.op === 'subtract' ? cur - a.value
             : a.value
      return { state: { ...state, stats: { ...state.stats, [a.stat]: v } } }
    }
    case 'set_var': {
      return { state: { ...state, vars: { ...(state.vars ?? {}), [a.var]: a.value } } }
    }
    case 'navigate':
      return { state, sideEffect: { kind: 'navigate', section_id: a.section_id } }
    case 'start_dialog':
      return { state, sideEffect: { kind: 'start_dialog', dialog_id: a.dialog_id } }
  }
}

/** Marque une section comme visitée. À appeler par le runtime chaque fois que
 *  le joueur entre dans une section (y compris retour). Garantit l'idempotence. */
export function markVisited(state: PlayerState, section_id: string): PlayerState {
  if (state.visited[section_id]) return state
  return { ...state, visited: { ...state.visited, [section_id]: true } }
}
