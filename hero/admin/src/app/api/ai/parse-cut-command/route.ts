import { NextRequest, NextResponse } from 'next/server'
import { parseCutCommand, tryParseRegex } from '@/lib/ai-cut-parser'
import type { OllamaError } from '@/lib/ollama'

export const maxDuration = 30

/**
 * POST /api/ai/parse-cut-command
 *
 * Body  : { text: string, fast?: boolean }
 *   - text  : commande utilisateur en langage naturel ("Repère le canapé au centre")
 *   - fast  : si true, ne tente que le parser regex local (no LLM call). Utile
 *             pour les routes qui veulent un fallback déterministe immédiat.
 *
 * Sortie : ParsedCutCommand (cf src/lib/ai-cut-parser.ts) ou { error }.
 *
 * Erreurs explicites :
 *   - 503 "ollama_unreachable" : service Ollama injoignable (à installer)
 *   - 503 "model_not_found"    : modèle non pull (cf message pour la commande)
 *   - 504 "timeout"            : Ollama timeout
 *   - 400 "bad_request"        : text vide ou invalide
 */
export async function POST(req: NextRequest) {
  try {
    const { text, fast = false } = await req.json() as { text?: string; fast?: boolean }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { error: 'bad_request', message: 'Champ "text" requis (string non vide).' },
        { status: 400 },
      )
    }

    // Fast path : regex uniquement, jamais d'appel LLM
    if (fast) {
      const result = tryParseRegex(text.trim())
      if (!result) {
        return NextResponse.json(
          { error: 'regex_no_match', message: 'Le parser regex n\'a pas pu interpréter la commande.' },
          { status: 422 },
        )
      }
      return NextResponse.json(result)
    }

    // Path normal : regex puis LLM si besoin
    const result = await parseCutCommand(text.trim())
    return NextResponse.json(result)

  } catch (err) {
    const e = err as OllamaError
    if (e.reason === 'unreachable') {
      return NextResponse.json({
        error: 'ollama_unreachable',
        message: e.message,
        hint: 'Installe Ollama (https://ollama.com), puis lance `ollama pull qwen2.5:1.5b`.',
      }, { status: 503 })
    }
    if (e.reason === 'model_not_found') {
      return NextResponse.json({
        error: 'model_not_found',
        message: e.message,
      }, { status: 503 })
    }
    if (e.reason === 'timeout') {
      return NextResponse.json({
        error: 'timeout',
        message: e.message,
      }, { status: 504 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ai/parse-cut-command] error:', msg)
    return NextResponse.json({ error: 'internal', message: msg }, { status: 500 })
  }
}
