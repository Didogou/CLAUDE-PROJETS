/**
 * Conditions structurées no-code, évaluées contre un `PlayerState`.
 *
 * Partagées entre :
 *  - Choix textuels (`Choice.visibleIf`) — remplace à terme `Choice.condition` legacy
 *  - Hotspots visuels (`Hotspot.visibleIf`, `Hotspot.enabledIf`)
 *  - (futur) Mots cliquables inline dans le texte narratif
 *  - (futur) Calques interactifs qui apparaissent sous condition
 *
 * Unité d'évaluation : voir `lib/conditions-engine.ts` → `evaluateCondition`.
 */

export type ComparisonOp = '>' | '>=' | '<' | '<=' | '==' | '!='

export type Condition =
  | { kind: 'item'; item_id: string; present?: boolean }
  | { kind: 'stat'; stat: string; op: ComparisonOp; value: number }
  | { kind: 'flag'; flag: string; value?: boolean }
  | { kind: 'visited'; section_id: string; visited?: boolean }
  | { kind: 'and'; conditions: Condition[] }
  | { kind: 'or'; conditions: Condition[] }
  | { kind: 'not'; condition: Condition }

export interface PlayerState {
  inventory: Record<string, number>
  stats: Record<string, number>
  flags: Record<string, boolean>
  visited: Record<string, true>
  vars?: Record<string, string | number | boolean>
}

export const EMPTY_PLAYER_STATE: PlayerState = {
  inventory: {},
  stats: {},
  flags: {},
  visited: {},
  vars: {},
}
