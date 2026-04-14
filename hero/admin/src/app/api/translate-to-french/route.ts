import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 30

// POST { text: string, target?: 'fr' | 'en' } → { translated: string }
export async function POST(req: NextRequest) {
  try {
    const { text, target = 'fr' } = await req.json() as { text: string; target?: 'fr' | 'en' }
    if (!text?.trim()) return NextResponse.json({ translated: '' })

    const prompt = target === 'en'
      ? `Translate this shot description to English for an AI image generator. Return ONLY the translated text, no quotes, no explanation:\n\n${text}`
      : `Traduis cette description de plan en français, en une phrase concise pour un designer. Retourne UNIQUEMENT le texte traduit, sans guillemets ni explication :\n\n${text}`

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })

    const translated = msg.content[0].type === 'text' ? msg.content[0].text.trim() : text
    return NextResponse.json({ translated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
