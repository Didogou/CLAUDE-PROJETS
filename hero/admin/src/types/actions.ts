/**
 * Actions à exécuter sur un clic (choix textuel, hotspot visuel, futur mot cliquable).
 *
 * Deux catégories :
 *  - Mutations d'état (give_item, take_item, set_flag, set_stat, set_var) :
 *    le moteur les applique de manière immutable.
 *  - Effets de bord (navigate, start_dialog) : le moteur les récolte dans
 *    `sideEffects`, au consommateur runtime de les exécuter (navigation,
 *    ouverture d'un dialog modal…).
 *
 * Unité d'exécution : voir `lib/conditions-engine.ts` → `applyActions`.
 */

import type { PlayerState } from './conditions'

export type StatOp = 'set' | 'add' | 'subtract'

export type Action =
  | { kind: 'give_item'; item_id: string; quantity?: number }
  | { kind: 'take_item'; item_id: string; quantity?: number }
  | { kind: 'set_flag'; flag: string; value: boolean }
  | { kind: 'set_stat'; stat: string; op: StatOp; value: number }
  | { kind: 'set_var'; var: string; value: string | number | boolean }
  | { kind: 'navigate'; section_id: string }
  | { kind: 'start_dialog'; dialog_id: string }

export type SideEffect =
  | { kind: 'navigate'; section_id: string }
  | { kind: 'start_dialog'; dialog_id: string }

export interface ApplyResult {
  state: PlayerState
  sideEffects: SideEffect[]
}
