/**
 * Provider Gemini Flash (Google AI Studio, gratuit 1500 req/j).
 *
 * Utilise le SDK @google/genai. Les messages sont convertis du format interne
 * vers le format Gemini (role 'user' / 'model' avec parts).
 */

import { GoogleGenAI, type Content, type FunctionDeclaration, Type } from '@google/genai'
import type { Message, StreamEvent, ToolCall } from '../types'
import type { ChatRequest, ProviderClient } from './types'

const GEMINI_MODEL = 'gemini-2.5-flash'

export class GeminiProvider implements ProviderClient {
  readonly id = 'gemini-flash'
  readonly label = 'Gemini 2.0 Flash (cloud, gratuit)'

  private client: GoogleGenAI

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey })
  }

  async *chatStream(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const contents = messagesToGeminiContents(req.messages)
    const tools = req.tools.length > 0
      ? [{ functionDeclarations: req.tools.map(t => toGeminiFunction(t)) }]
      : undefined

    try {
      const stream = await this.client.models.generateContentStream({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction: req.systemPrompt,
          tools,
        },
      })

      for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? []
        for (const part of parts) {
          if (part.text) {
            yield { type: 'text', delta: part.text }
          } else if (part.functionCall) {
            const toolCall: ToolCall = {
              id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: part.functionCall.name ?? '',
              args: (part.functionCall.args as Record<string, unknown>) ?? {},
            }
            yield { type: 'tool_call', toolCall }
          }
        }
      }
      yield { type: 'done' }
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ── Conversions format interne ↔ Gemini ─────────────────────────────────

function messagesToGeminiContents(messages: Message[]): Content[] {
  const out: Content[] = []
  for (const m of messages) {
    if (m.role === 'system') continue  // systemInstruction est passé séparément
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.content }] })
    } else if (m.role === 'assistant') {
      const parts: Content['parts'] = []
      if (m.content) parts.push({ text: m.content })
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.args } })
        }
      }
      if (parts.length > 0) out.push({ role: 'model', parts })
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: m.toolName ?? '',
            response: safeParseJson(m.content),
          },
        }],
      })
    }
  }
  return out
}

function toGeminiFunction(tool: { name: string; description: string; inputSchema: Record<string, unknown> }): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: convertSchemaToGemini(tool.inputSchema),
  }
}

function convertSchemaToGemini(schema: Record<string, unknown>): FunctionDeclaration['parameters'] {
  const type = mapType((schema.type as string) ?? 'object')
  const out: Record<string, unknown> = { type }
  if (schema.description) out.description = schema.description
  if (schema.enum) out.enum = schema.enum
  if (schema.properties) {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      props[k] = convertSchemaToGemini(v)
    }
    out.properties = props
  }
  if (schema.required) out.required = schema.required
  if (schema.items) out.items = convertSchemaToGemini(schema.items as Record<string, unknown>)
  return out as FunctionDeclaration['parameters']
}

function mapType(t: string): Type {
  switch (t) {
    case 'string':  return Type.STRING
    case 'number':  return Type.NUMBER
    case 'integer': return Type.INTEGER
    case 'boolean': return Type.BOOLEAN
    case 'array':   return Type.ARRAY
    case 'object':  return Type.OBJECT
    default:        return Type.STRING
  }
}

function safeParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) }
  catch { return { content: s } }
}
