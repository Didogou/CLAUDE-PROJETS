/**
 * Provider Ollama (self-hosted local, port 11434 par défaut).
 *
 * Modèles recommandés pour RTX 5060 8 Go VRAM :
 *   - qwen2.5:7b-instruct  (~5 Go, meilleur function calling des 7B)
 *   - llama3.1:8b-instruct (~5 Go, bien supporté)
 *   - mistral:7b-instruct  (~5 Go, français correct)
 *
 * Format API Ollama : /api/chat (streaming SSE-like NDJSON).
 * Function calling : support natif depuis Ollama 0.3+, format OpenAI-like.
 */

import type { Message, StreamEvent, ToolCall } from '../types'
import type { ChatRequest, ProviderClient } from './types'

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
const DEFAULT_MODEL = 'qwen2.5:7b-instruct'

export class OllamaProvider implements ProviderClient {
  readonly id: string
  readonly label: string

  constructor(
    private model: string = DEFAULT_MODEL,
    private baseUrl: string = DEFAULT_OLLAMA_URL,
  ) {
    this.id = `ollama-${model}`
    this.label = `Ollama : ${model} (local)`
  }

  async *chatStream(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const messages = [
      { role: 'system' as const, content: req.systemPrompt },
      ...req.messages.map(toOllamaMessage),
    ]

    const tools = req.tools.length > 0
      ? req.tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }))
      : undefined

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools,
          stream: true,
        }),
      })

      if (!res.ok) {
        yield { type: 'error', message: `Ollama HTTP ${res.status} — vérifie qu'Ollama tourne (ollama serve) et que le modèle ${this.model} est pullé.` }
        return
      }
      if (!res.body) {
        yield { type: 'error', message: 'Ollama : pas de body dans la réponse' }
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let json: OllamaChunk
          try { json = JSON.parse(line) as OllamaChunk }
          catch { continue }
          const msg = json.message
          if (msg?.content) {
            yield { type: 'text', delta: msg.content }
          }
          if (msg?.tool_calls) {
            for (const tc of msg.tool_calls) {
              const toolCall: ToolCall = {
                id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: tc.function.name,
                args: typeof tc.function.arguments === 'string'
                  ? safeParseJson(tc.function.arguments)
                  : tc.function.arguments,
              }
              yield { type: 'tool_call', toolCall }
            }
          }
          if (json.done) {
            yield { type: 'done' }
            return
          }
        }
      }
      yield { type: 'done' }
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ── Types internes Ollama ──────────────────────────────────────────────

interface OllamaChunk {
  message?: {
    role: 'assistant'
    content?: string
    tool_calls?: Array<{
      function: {
        name: string
        arguments: string | Record<string, unknown>
      }
    }>
  }
  done?: boolean
}

function toOllamaMessage(m: Message): { role: string; content: string; tool_calls?: unknown; tool_call_id?: string; name?: string } {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content, name: m.toolName }
  }
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls?.map(tc => ({
        function: { name: tc.name, arguments: tc.args },
      })),
    }
  }
  return { role: m.role, content: m.content }
}

function safeParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) }
  catch { return {} }
}
