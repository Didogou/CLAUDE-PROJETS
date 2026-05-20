import { NextRequest, NextResponse } from 'next/server'
import { translateToEnglish } from '@/lib/ai-utils'

export const maxDuration = 30

/**
 * POST /api/translate-text
 *
 * Wrapper minimaliste sur `translateToEnglish` (lib/ai-utils.ts) pour exposer
 * la traduction côté client. Différence avec `/api/translate-prompt` : pas de
 * SDXL_PROMPT_RULES, pas d'enrichissement, pas de JSON output. Juste une
 * traduction texte→texte.
 *
 * Use case : traduire une "action" FR courte saisie par l'auteur dans le
 * Studio Designer (ex: "se tourne vers la femme") → "turns toward the woman"
 * pour l'inclure dans le prompt structuré Vantage en EN.
 *
 * Body : { text: string }
 * Retour : { text_en: string }  — ou text inchangé si déjà en anglais détecté
 */
export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text?: string }
    if (typeof text !== 'string') {
      return NextResponse.json({ error: 'text (string) requis' }, { status: 400 })
    }
    const text_en = await translateToEnglish(text)
    return NextResponse.json({ text_en })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/translate-text]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
