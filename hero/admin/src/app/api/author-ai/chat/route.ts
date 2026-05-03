/**
 * Endpoint de chat IA co-auteur — streaming SSE.
 *
 * Body (POST JSON) :
 *   { messages: Message[], providerId: 'gemini-flash' | 'ollama-xxx', existingNpcs: CreatedNpc[] }
 *
 * Réponse : stream SSE d'events :
 *   - { type: 'text', delta: string }
 *   - { type: 'tool_call', toolCall: ... }
 *   - { type: 'tool_result', toolCallId, name, result }
 *   - { type: 'error', message }
 *   - { type: 'done' }
 *
 * Flow : orchestre les tool calls jusqu'à ce que l'IA termine (plafond MAX_TURNS).
 */

import { NextRequest } from 'next/server'
import { GeminiProvider } from '@/lib/author-ai/providers/gemini'
import { OllamaProvider } from '@/lib/author-ai/providers/ollama'
import type { ProviderClient } from '@/lib/author-ai/providers/types'
import { ALL_TOOLS, executeTool, type CreatedNpc } from '@/lib/author-ai/tools'
import { AUTHOR_AI_SYSTEM_PROMPT } from '@/lib/author-ai/system-prompt'
import type { Message, ToolCall } from '@/lib/author-ai/types'

const MAX_TURNS = 6

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    messages: Message[]
    providerId: string
    existingNpcs?: CreatedNpc[]
  }

  const provider = resolveProvider(body.providerId)
  if (!provider) {
    return new Response(JSON.stringify({ error: `Provider inconnu : ${body.providerId}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const session = { npcs: [...(body.existingNpcs ?? [])] }
  const systemPrompt = buildSystemPrompt(session.npcs)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        let currentMessages = [...body.messages]

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const assistantText: string[] = []
          const assistantToolCalls: ToolCall[] = []
          let sawError = false

          for await (const event of provider.chatStream({
            messages: currentMessages,
            tools: ALL_TOOLS,
            systemPrompt,
          })) {
            if (event.type === 'text') {
              assistantText.push(event.delta)
              send({ type: 'text', delta: event.delta })
            } else if (event.type === 'tool_call') {
              assistantToolCalls.push(event.toolCall)
              send({ type: 'tool_call', toolCall: event.toolCall })
            } else if (event.type === 'error') {
              send({ type: 'error', message: event.message })
              sawError = true
            }
            // 'done' fin du stream provider → on sort naturellement
          }

          if (sawError) break

          currentMessages.push({
            role: 'assistant',
            content: assistantText.join(''),
            toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined,
          })

          if (assistantToolCalls.length === 0) break

          for (const tc of assistantToolCalls) {
            const exec = executeTool(tc.name, tc.args, session)
            send({
              type: 'tool_result',
              toolCallId: tc.id,
              name: tc.name,
              result: exec.result,
              error: exec.error,
            })
            currentMessages.push({
              role: 'tool',
              content: JSON.stringify(exec.result ?? { error: exec.error }),
              toolCallId: tc.id,
              toolName: tc.name,
            })
          }
        }

        send({ type: 'session_npcs', npcs: session.npcs })
        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────

function resolveProvider(id: string): ProviderClient | null {
  if (id === 'gemini-flash') {
    const apiKey = process.env.GOOGLE_AI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY manquante dans .env.local')
    return new GeminiProvider(apiKey)
  }
  if (id.startsWith('ollama:')) {
    const model = id.slice('ollama:'.length) || 'qwen2.5:7b-instruct'
    return new OllamaProvider(model)
  }
  return null
}

function buildSystemPrompt(npcs: CreatedNpc[]): string {
  if (npcs.length === 0) return AUTHOR_AI_SYSTEM_PROMPT
  const list = npcs.map(n => `- ${n.name} (${n.type}) : ${n.description}`).join('\n')
  return `${AUTHOR_AI_SYSTEM_PROMPT}\n\n# PNJ déjà créés dans le livre\n${list}\n\nNe re-crée PAS ces PNJ. Propose des nouveaux si l'auteur le demande.`
}
