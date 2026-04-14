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

  // Résoudre le nom de la localisation
  let locationName: string | null = null
  if (section.location_id) {
    const { data: loc } = await supabaseAdmin.from('locations').select('name').eq('id', section.location_id).single()
    locationName = loc?.name ?? null
  }

  // Résoudre les noms des PNJ présents dans la section
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
    npcNames = (npcs ?? []).map((n: any) => n.name)
  }

  const charactersBlock = npcNames.length > 0
    ? `Characters present in this scene: ${npcNames.join(', ')}\n`
    : ''
  const locationBlock = locationName
    ? `Location: ${locationName}\n`
    : ''

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `You are a storyboard director for a gamebook set in the Bronx, New York, summer 2000.
Break this scene into 3 sequential storyboard shots.

${locationBlock}${charactersBlock}
For each shot provide:
- "prompt": Shot Description in natural English for an AI image generator. Use character names directly (e.g. "Travis grabs Shawn's arm"). ALWAYS describe the environment/background — even on a close-up, mention what surrounds the character (neon light, concrete wall, tree shadow, etc.). Describe who is doing what, the atmosphere, and lighting. 2-3 sentences. No AI diffusion keywords (no "8k", "hyperrealistic", "masterpiece"). Never describe a character against a plain or black background.
- "shot_size": framing — one of: "Extreme Wide Shot", "Wide Shot", "Medium Wide Shot", "Medium Shot", "Medium Close-Up", "Close-Up", "Extreme Close-Up"
- "perspective": camera angle — one of: "Eye Level", "Low Angle", "High Angle", "Bird's Eye View", "Dutch Angle", "Over-the-Shoulder"
- "fr": short description in French for the designer (1 sentence, what we see)

Visual style context: gritty urban thriller, Bronx streets summer 2000, neon orange streetlights, elevated subway pillars, young gang members in streetwear. Cinematic, tense. Lighting must be strong enough to see all characters clearly — use streetlights, neon signs, car headlights, or ambient urban glow. No pitch-black scenes. Every shot must feel grounded in a real environment — no studio backdrops, no plain backgrounds.

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
    const raw = (message.content[0] as any).text?.trim() ?? ''
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
