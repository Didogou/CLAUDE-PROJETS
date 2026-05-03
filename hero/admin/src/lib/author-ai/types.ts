/**
 * Types pour la Couche 3 — conversation IA co-auteur.
 *
 * Format de conversation abstrait, indépendant du provider (Gemini/Ollama/…).
 * Chaque provider convertit vers/depuis son format natif.
 */

export type Role = 'user' | 'assistant' | 'system' | 'tool'

export interface Message {
  role: Role
  content: string
  /** Appels d'outils émis par l'assistant (rôle='assistant'). */
  toolCalls?: ToolCall[]
  /** Résultat d'un outil (rôle='tool'). */
  toolCallId?: string
  toolName?: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  result: unknown
  error?: string
}

/** Provider-agnostic stream event. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done' }
  | { type: 'error'; message: string }
