import { NextRequest, NextResponse } from 'next/server'
import { translateToEnglish } from '@/lib/ai-utils'

// POST { text: string } → { translated: string }
export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text: string }
    if (!text?.trim()) return NextResponse.json({ translated: '' })
    const translated = await translateToEnglish(text)
    return NextResponse.json({ translated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
