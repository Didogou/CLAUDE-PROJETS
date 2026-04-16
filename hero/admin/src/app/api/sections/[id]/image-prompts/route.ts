import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 30

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: section } = await supabaseAdmin
    .from('sections')
    .select('number, content, summary, location_id, companion_npc_ids, trial, book_id')
    .eq('id', id)
    .single()

  if (!section) return NextResponse.json({ error: 'Section introuvable' }, { status: 404 })

  const source = section.content?.trim() || section.summary?.trim() || ''
  if (!source) return NextResponse.json({ error: 'Section sans contenu' }, { status: 400 })

  // Fetch book context for theme and illustration bible
  let bookTheme = ''
  let illustrationBible = ''
  if (section.book_id) {
    const { data: book } = await supabaseAdmin
      .from('books')
      .select('theme, illustration_bible, illustration_style')
      .eq('id', section.book_id)
      .single()
    if (book) {
      bookTheme = book.theme ?? ''
      illustrationBible = book.illustration_bible ?? ''
    }
  }

  // Resolve location name
  let locationName: string | null = null
  if (section.location_id) {
    const { data: loc } = await supabaseAdmin.from('locations').select('name').eq('id', section.location_id).single()
    locationName = loc?.name ?? null
  }

  // Resolve NPC names
  const npcIds: string[] = [
    ...((section.companion_npc_ids as string[]) ?? []),
    ...(section.trial?.npc_id ? [section.trial.npc_id] : []),
  ].filter(Boolean)

  let npcNames: string[] = []
  if (npcIds.length > 0) {
    const { data: npcs } = await supabaseAdmin
      .from('npcs')
      .select('id, name')
      .in('id', npcIds)
    npcNames = (npcs ?? []).map((n: { id: string; name: string }) => n.name)
  }

  const charactersBlock = npcNames.length > 0
    ? `Characters present in this scene: ${npcNames.join(', ')}\n`
    : ''
  const locationBlock = locationName
    ? `Location: ${locationName}\n`
    : ''
  const themeBlock = bookTheme
    ? `Story theme: ${bookTheme}\n`
    : ''
  const bibleBlock = illustrationBible
    ? `Visual style guide: ${illustrationBible}\n`
    : ''

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `You are a storyboard director for a gamebook illustration.
Break this scene into 3 sequential storyboard shots.

${themeBlock}${bibleBlock}${locationBlock}${charactersBlock}
For each shot provide:
- "prompt": An optimized Stable Diffusion XL prompt in English following these STRICT rules:
  * Write in NATURAL LANGUAGE (descriptive sentences), NOT comma-separated tag lists
  * Keep it 30-75 tokens. The first 5-10 words are the most important
  * Structure: Subject doing action → Setting/Environment → Lighting → Style
  * Use character names directly (e.g. "Duke grabs the envelope")
  * ALWAYS describe the environment/background, even on close-ups
  * Use BREAK to separate character description from setting/atmosphere
  * Quality boosters that work: cinematic lighting, volumetric lighting, rim light, 85mm lens, film grain
  * DO NOT use: masterpiece, best quality, 8k, uhd, trending on artstation, hyperrealistic
  * DO NOT describe facial features (handled by IPAdapter reference images)
  * No plain/black/studio backgrounds — every shot must feel grounded in a real environment
- "shot_size": one of: "Extreme Wide Shot", "Wide Shot", "Medium Wide Shot", "Medium Shot", "Medium Close-Up", "Close-Up", "Extreme Close-Up"
- "perspective": one of: "Eye Level", "Low Angle", "High Angle", "Bird's Eye View", "Dutch Angle", "Over-the-Shoulder"
- "fr": short description in French for the designer (1 sentence)

Respond only in JSON:
{
  "prompt1": "...", "shot_size1": "...", "perspective1": "...", "fr1": "...",
  "prompt2": "...", "shot_size2": "...", "perspective2": "...", "fr2": "...",
  "prompt3": "...", "shot_size3": "...", "perspective3": "...", "fr3": "..."
}

Section §${section.number} text:
${source.slice(0, 1500)}`,
    }],
  })

  try {
    const raw = (message.content[0] as { type: string; text: string }).text?.trim() ?? ''
    const json = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(json)
    const prompts = [parsed.prompt1 ?? '', parsed.prompt2 ?? '', parsed.prompt3 ?? '']
    const prompts_fr = [parsed.fr1 ?? '', parsed.fr2 ?? '', parsed.fr3 ?? '']
    const prompts_shot_size = [parsed.shot_size1 ?? '', parsed.shot_size2 ?? '', parsed.shot_size3 ?? '']
    const prompts_perspective = [parsed.perspective1 ?? '', parsed.perspective2 ?? '', parsed.perspective3 ?? '']
    return NextResponse.json({ prompts, prompts_fr, prompts_shot_size, prompts_perspective })
  } catch {
    return NextResponse.json({ error: 'Réponse Claude invalide' }, { status: 500 })
  }
}
