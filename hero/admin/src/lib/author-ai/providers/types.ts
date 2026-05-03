/**
 * Interface provider-agnostic pour la Couche 3.
 *
 * Chaque impl (Gemini, Ollama, Claude, etc.) respecte ce contrat. Le
 * consommateur (route API) ne sait pas quel provider il utilise — il
 * lui envoie une conversation + des tools, il reçoit un stream d'events.
 */

import type { Message, StreamEvent } from '../types'
import type { ToolDefinition } from '../tools'

export interface ChatRequest {
  messages: Message[]
  tools: ToolDefinition[]
  systemPrompt: string
}

export interface ProviderClient {
  readonly id: string
  readonly label: string
  chatStream(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown>
}
