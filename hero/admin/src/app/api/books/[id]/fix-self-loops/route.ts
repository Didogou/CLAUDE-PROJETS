import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic, extractJson } from '@/lib/ai-utils'

export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // 1. Trouver toutes les boucles (choice.section_id === choice.target_section_id)
  const { data: sections } = await supabaseAdmin
    .from('sections')
    .select('id, number, summary')
    .eq('book_id', id)
    .order('number')

  if (!sections?.length) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const sectionIds = sections.map((s: any) => s.id)
  const { data: choices } = await supabaseAdmin
    .from('choices')
    .select('id, section_id, target_section_id, label')
    .in('section_id', sectionIds)

  const loops = (choices ?? []).filter((c: any) => c.section_id === c.target_section_id)
  if (loops.length === 0) {
    return NextResponse.json({ ok: true, fixed: 0, message: 'Aucune boucle infinie détectée.' })
  }

  const sectionById = new Map(sections.map((s: any) => [s.id, s]))
  const sectionByNumber = new Map(sections.map((s: any) => [s.number, s]))
  const maxNumber = Math.max(...sections.map((s: any) => s.number))

  // 2. Construire le contexte pour Claude : pour chaque boucle, donner les sections voisines
  const loopContexts = loops.map((c: any) => {
    const sec = sectionById.get(c.section_id) as any
    const num = sec?.number ?? 0
    // Sections voisines : N-2 à N+5 pour donner du contexte narratif
    const neighbors = sections
      .filter((s: any) => s.number >= num - 2 && s.number <= num + 5 && s.number !== num)
      .map((s: any) => `§${s.number}: ${s.summary ?? '(pas de résumé)'}`)
      .join('\n')
    return `Boucle à corriger :
  Section §${num}: "${sec?.summary ?? '(pas de résumé)'}"
  Choix qui boucle : "${c.label}"
  Sections voisines disponibles :
${neighbors}
  → Quelle section ce choix devrait-il cibler ? (entre 1 et ${maxNumber}, pas ${num})`
  }).join('\n\n---\n\n')

  // 3. Demander à Claude
  const prompt = `Tu es un éditeur de livre-jeu. Des choix pointent sur leur propre section (boucle infinie). Corrige chacun en choisissant la section cible la plus cohérente narrativement.

${loopContexts}

Réponds UNIQUEMENT avec du JSON brut valide :
[
  { "choice_id": "${loops[0].id}", "target_section_number": 91 },
  ...
]
Une entrée par boucle, dans le même ordre. Utilise uniquement des numéros de sections existants (1 à ${maxNumber}).`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  let fixes: Array<{ choice_id: string; target_section_number: number }> = []
  try {
    fixes = JSON.parse(extractJson(raw))
  } catch {
    return NextResponse.json({ error: `JSON invalide de Claude : ${raw.slice(0, 200)}` }, { status: 500 })
  }

  // 4. Appliquer les corrections
  let fixed = 0
  const errors: string[] = []

  for (const fix of fixes) {
    const targetSec = sectionByNumber.get(fix.target_section_number) as any
    if (!targetSec) {
      errors.push(`Choix ${fix.choice_id}: section §${fix.target_section_number} introuvable`)
      continue
    }
    const { error } = await supabaseAdmin
      .from('choices')
      .update({ target_section_id: targetSec.id })
      .eq('id', fix.choice_id)
    if (error) { errors.push(`Choix ${fix.choice_id}: ${error.message}`); continue }
    fixed++
  }

  return NextResponse.json({ ok: true, fixed, total: loops.length, errors })
}
