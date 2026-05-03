import { NextRequest, NextResponse } from 'next/server'
import { callMistral } from '@/lib/ai-utils'

export const maxDuration = 30

const SYSTEM = `You are a prompt engineer specialized in Pony Diffusion XL V6, an SDXL anime model trained on Danbooru-tagged images.

Your job: convert a natural English prompt describing a scene into Danbooru-style tags optimized for Pony XL.

Rules:
1. Use comma-separated short tags (1-3 words each), NO sentences
2. Start with character count tags: 1boy, 1girl, 2boys, multiple boys, etc.
3. Add physical traits as tags: dark skin, short black hair, athletic build, leather jacket, etc.
4. Add pose/action tags: raised hand, standing, walking, fighting pose, etc.
5. Add scene tags: night, urban, park, lamp post, dramatic lighting, etc.
6. Add mood/composition: cinematic, dramatic, atmospheric, low angle, etc.
7. Common Danbooru tag conventions: use underscores for compound tags only when standard (e.g., "looking_at_viewer", "from_above")
8. Output ONLY the tags, no explanation, no quotes, no preamble. Max 50 tags.

Example input: "A young black-skinned man with charisma stands in the center of a New York park at night, surrounded by gang members from various crews, raising his right hand in a dramatic greeting"

Example output: 1boy, solo focus, dark skin, short black hair, athletic build, charismatic expression, leather jacket, raised hand, greeting pose, surrounded by crowd, multiple boys, multiple girls, gang members, urban park, night, lamp post, dramatic lighting, cinematic composition, low angle, atmospheric, masterpiece`

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json() as { prompt?: string }
    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 })
    }
    const tags = await callMistral(SYSTEM, prompt.trim(), 300)
    // Nettoyage : enlève sauts de ligne, normalise virgules
    const cleaned = tags
      .replace(/\n+/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/\s+,/g, ',')
      .trim()
      .replace(/^["']|["']$/g, '')
    return NextResponse.json({ tags: cleaned })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[translate-to-pony-tags] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
