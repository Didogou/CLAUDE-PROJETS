import { NextRequest, NextResponse } from 'next/server'
import { ollamaJSON } from '@/lib/ollama'
import type { OllamaError } from '@/lib/ollama'

export const maxDuration = 30

/**
 * POST /api/ai/parse-replace-command
 *
 * Parse une commande naturelle de remplacement (FR ou EN) en JSON structuré.
 * Utilisé par le mode auto pipeline d'Insert Anything pour transformer une
 * intention auteur en paramètres machine.
 *
 * Body  : { text: string }
 * Sortie : {
 *   action: 'replace',
 *   source_keyword: string,    // mot-clé EN pour Grounded-SAM, ex "man", "barrel"
 *   source_spatial?: string,   // qualificatif spatial optionnel ex "middle", "left"
 *   target_description: string // description EN du sujet cible pour T2I
 * }
 *
 * Exemples :
 * - "Remplace l'homme assis au fond par une elfe blonde"
 *   → { source_keyword: "man", source_spatial: "back", target_description: "a young elf woman with long blonde hair" }
 * - "Replace the chair with a wooden treasure chest"
 *   → { source_keyword: "chair", target_description: "a wooden treasure chest with metal bands" }
 *
 * Modèle : Ollama Qwen 2.5 1.5B (texte, ultra-léger). Pour passer la prod
 * SaaS, peut être upgrade à 3B/7B si nécessaire (qualité parsing).
 */

interface ParsedReplaceCommand {
  action: 'replace'
  source_keyword: string
  source_spatial?: string
  target_description: string
}

const SYSTEM = `You are a JSON command parser for an image editing tool.
The user describes what they want to replace in an image. Output ONLY valid JSON.

Schema:
{
  "action": "replace",
  "source_keyword": string,   // English noun for the object to detect (lowercase, singular). E.g. "man", "barrel", "chair", "dog", "person"
  "source_spatial": string | null,  // optional spatial hint if user mentioned position. E.g. "left", "right", "middle", "front", "back", "top", "bottom"
  "target_description": string  // English descriptive prompt for the replacement subject (full body, color, clothing, role)
}

Rules:
- source_keyword must be a SINGLE common English noun, no adjectives. Choose the most generic word that COCO/Grounded-SAM understands ("person" not "soldier", "chair" not "throne").
- target_description must be in English, comma-separated descriptors, ready to inject in an SDXL prompt. Add full body / pose hints when relevant.
- If user input is in French, translate to English internally.
- If no spatial hint, set source_spatial to null.

Examples:

Input: "Remplace l'homme assis au fond par une elfe blonde"
Output: {"action":"replace","source_keyword":"person","source_spatial":"back","target_description":"a young elf woman with long blonde hair, wearing green velvet dress, full body"}

Input: "Change the barrel into a wooden treasure chest"
Output: {"action":"replace","source_keyword":"barrel","source_spatial":null,"target_description":"a wooden treasure chest with metal bands and ornate carvings, medieval style"}

Input: "Remplace le chat du milieu par un chien"
Output: {"action":"replace","source_keyword":"cat","source_spatial":"middle","target_description":"a brown labrador dog, calm pose"}`

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text?: string }
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'bad_request', message: 'text requis' }, { status: 400 })
    }

    const result = await ollamaJSON<ParsedReplaceCommand>({
      system: SYSTEM,
      prompt: text.trim(),
      temperature: 0.1,
      timeoutMs: 15_000,
    })

    if (!result.action || !result.source_keyword || !result.target_description) {
      return NextResponse.json({
        error: 'invalid_parse',
        message: 'Réponse Ollama incomplète',
        raw: result,
      }, { status: 502 })
    }

    return NextResponse.json(result)
  } catch (err) {
    const e = err as OllamaError
    if (e.reason === 'unreachable') {
      return NextResponse.json({
        error: 'ollama_unreachable',
        message: e.message,
        hint: 'Installe Ollama et lance `ollama pull qwen2.5:1.5b`',
      }, { status: 503 })
    }
    if (e.reason === 'model_not_found') {
      return NextResponse.json({ error: 'model_not_found', message: e.message }, { status: 503 })
    }
    if (e.reason === 'timeout') {
      return NextResponse.json({ error: 'timeout', message: e.message }, { status: 504 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[parse-replace-command] error:', msg)
    return NextResponse.json({ error: 'internal', message: msg }, { status: 500 })
  }
}
