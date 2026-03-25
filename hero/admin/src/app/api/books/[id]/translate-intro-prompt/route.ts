import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text: string }
    if (!text?.trim()) return NextResponse.json({ error: 'text requis' }, { status: 400 })

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: `Translate this image generation prompt to English for an AI image generator. Return ONLY the translated text, no quotes, no explanation:\n\n${text}` }],
    })

    const translated = msg.content[0].type === 'text' ? msg.content[0].text.trim() : text
    return NextResponse.json({ translated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
