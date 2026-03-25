import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic, extractJson } from '@/lib/ai-utils'

export const maxDuration = 120

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // 1. Récupérer les sections de combat sans ennemi
  const { data: sections } = await supabaseAdmin
    .from('sections')
    .select('id, number, summary, trial')
    .eq('book_id', id)
    .not('trial', 'is', null)

  const combatWithoutEnemy = (sections ?? []).filter((s: any) => {
    const t = s.trial
    return t?.type === 'combat' && !t?.npc_id && !t?.enemy
  })

  if (combatWithoutEnemy.length === 0) {
    return NextResponse.json({ ok: true, assigned: 0, message: 'Aucune section de combat sans ennemi.' })
  }

  // 2. Récupérer les PNJ du livre
  const { data: npcs } = await supabaseAdmin
    .from('npcs')
    .select('id, name, type, description, force, agilite, intelligence, magie, endurance, chance')
    .eq('book_id', id)
    .in('type', ['ennemi', 'boss'])

  if (!npcs || npcs.length === 0) {
    return NextResponse.json({ error: 'Aucun PNJ ennemi/boss disponible pour ce livre.' }, { status: 400 })
  }

  // 3. Demander à Claude d'assigner le PNJ le plus approprié à chaque section
  const npcList = npcs.map((n: any) => `- "${n.name}" (${n.type}) : ${n.description ?? 'pas de description'}`).join('\n')
  const sectionList = combatWithoutEnemy.map((s: any) => `§${s.number}: ${s.summary ?? '(pas de résumé)'}`).join('\n')

  const prompt = `Tu es un game designer. Pour chaque section de combat ci-dessous, assigne le PNJ ennemi le plus cohérent avec le contexte narratif.

PNJ disponibles :
${npcList}

Sections de combat sans ennemi :
${sectionList}

Réponds UNIQUEMENT avec du JSON brut valide :
[
  { "number": 7, "npc_name": "Nom exact du PNJ" },
  ...
]
Utilise UNIQUEMENT les noms exacts des PNJ listés ci-dessus.`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  let assignments: Array<{ number: number; npc_name: string }> = []
  try {
    assignments = JSON.parse(extractJson(raw))
  } catch {
    return NextResponse.json({ error: `JSON invalide de Claude : ${raw.slice(0, 200)}` }, { status: 500 })
  }

  // 4. Appliquer les assignations
  const npcByName = new Map(npcs.map((n: any) => [n.name.toLowerCase(), n]))
  const sectionById = new Map(combatWithoutEnemy.map((s: any) => [s.number, s]))

  let assigned = 0
  const errors: string[] = []

  for (const assignment of assignments) {
    const sec = sectionById.get(assignment.number)
    const npc = npcByName.get(assignment.npc_name?.toLowerCase())
    if (!sec || !npc) {
      errors.push(`§${assignment.number}: PNJ "${assignment.npc_name}" introuvable`)
      continue
    }
    const updatedTrial = {
      ...(sec.trial as object),
      npc_id: npc.id,
      enemy: { name: npc.name, force: npc.force, endurance: npc.endurance },
    }
    const { error } = await supabaseAdmin.from('sections').update({ trial: updatedTrial }).eq('id', sec.id)
    if (error) { errors.push(`§${assignment.number}: ${error.message}`); continue }
    assigned++
  }

  return NextResponse.json({ ok: true, assigned, total: combatWithoutEnemy.length, errors })
}
