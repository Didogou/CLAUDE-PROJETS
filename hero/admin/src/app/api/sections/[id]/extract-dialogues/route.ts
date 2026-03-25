import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic, extractJson } from '@/lib/ai-utils'
import type { SectionDialogue } from '@/types'

export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sectionId } = await params

  // ── Chargement ────────────────────────────────────────────────────────────

  const { data: section } = await supabaseAdmin
    .from('sections')
    .select('id, book_id, number, content, summary')
    .eq('id', sectionId)
    .single()
  if (!section) return NextResponse.json({ error: 'Section introuvable' }, { status: 404 })

  const { data: choices } = await supabaseAdmin
    .from('choices')
    .select('id, label, transition_text')
    .eq('section_id', sectionId)
    .not('transition_text', 'is', null)

  const { data: npcs } = await supabaseAdmin
    .from('npcs')
    .select('id, name')
    .eq('book_id', section.book_id)

  const npcList = (npcs ?? []).map(n => n.name).join(', ')

  // ── Assemblage du texte à analyser ────────────────────────────────────────

  const parts: { text: string; source: 'content' | 'transition' }[] = []
  if (section.content?.trim()) parts.push({ text: section.content, source: 'content' })
  for (const c of choices ?? []) {
    if (c.transition_text?.trim()) parts.push({ text: c.transition_text, source: 'transition' })
  }

  if (parts.length === 0) {
    await supabaseAdmin.from('sections').update({ dialogues: [] }).eq('id', sectionId)
    return NextResponse.json({ dialogues: [] })
  }

  // ── Extraction via Claude Haiku ───────────────────────────────────────────

  const blocksForPrompt = parts
    .map((p, i) => `=== BLOC ${i + 1} (${p.source}) ===\n${p.text}`)
    .join('\n\n')

  const prompt = `Analyse ces textes narratifs et extrait UNIQUEMENT les répliques de dialogue (lignes commençant par un tiret cadratin —).

PNJ connus dans cette histoire : ${npcList || '(aucun listé)'}

Pour chaque réplique trouvée, identifie :
- "text" : le texte exact de la réplique (sans le tiret cadratin initial)
- "speaker" : le nom du locuteur. Utilise "joueur" si c'est le personnage joueur, le nom exact du PNJ si identifiable, ou null si inconnu
- "npc_id" : null (ne pas remplir, sera résolu côté serveur)
- "source" : "content" ou "transition" selon le bloc d'origine

${blocksForPrompt}

Réponds UNIQUEMENT en JSON :
{
  "dialogues": [
    { "text": "...", "speaker": "...", "npc_id": null, "source": "content" }
  ]
}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  let dialogues: SectionDialogue[] = []
  try {
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const parsed = JSON.parse(extractJson(raw))
    dialogues = parsed.dialogues ?? []
  } catch {
    return NextResponse.json({ error: 'Réponse Claude invalide' }, { status: 500 })
  }

  // Nettoyer le texte des répliques
  const INCISE = /[,\s]+((?:dit|murmura|répondit|souffla|chuchota|cria|hurla|lança|ajouta|reprit|continua|répliqua|gronda|soupira|bredouilla|ricana|grogna|sanglota|marmonna|susurra|s'exclama|s'écria|demanda|interrogea|conclut|déclara|affirma|avoua|admit|reconnut)(?:[-‑](?:il|elle|ils|elles|on|je|tu|nous|vous))?[^.!?]*)/gi
  function cleanDialogueText(text: string): string {
    return text
      .replace(/^[—–-]\s*/, '')           // tiret initial
      .replace(/^[«"'"\u2018\u201C]/, '') // guillemet ouvrant
      .replace(/[»"'"\u2019\u201D]$/, '') // guillemet fermant
      .replace(INCISE, '')                // incises narratives
      .trim()
  }

  // Résoudre les npc_id depuis les noms
  const npcMap = new Map((npcs ?? []).map(n => [n.name.toLowerCase(), n.id]))
  dialogues = dialogues.map(d => ({
    ...d,
    text: cleanDialogueText(d.text),
    npc_id: d.speaker && d.speaker !== 'joueur'
      ? (npcMap.get(d.speaker.toLowerCase()) ?? undefined)
      : undefined,
  }))

  await supabaseAdmin.from('sections').update({ dialogues }).eq('id', sectionId)

  return NextResponse.json({ dialogues })
}
