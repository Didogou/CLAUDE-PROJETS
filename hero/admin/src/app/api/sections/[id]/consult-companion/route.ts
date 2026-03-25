import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic, extractJson } from '@/lib/ai-utils'

export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sectionId } = await params
  const { npc_id } = await req.json() as { npc_id: string }
  if (!npc_id) return NextResponse.json({ error: 'npc_id requis' }, { status: 400 })

  // ── Chargement des données ──────────────────────────────────────────────────

  const { data: section } = await supabaseAdmin
    .from('sections')
    .select('id, book_id, number, content, summary')
    .eq('id', sectionId)
    .single()
  if (!section) return NextResponse.json({ error: 'Section introuvable' }, { status: 404 })

  const { data: book } = await supabaseAdmin
    .from('books')
    .select('theme, age_range, address_form, context_type')
    .eq('id', section.book_id)
    .single()

  const { data: npc } = await supabaseAdmin
    .from('npcs')
    .select('id, name, description, speech_style, type')
    .eq('id', npc_id)
    .single()
  if (!npc) return NextResponse.json({ error: 'PNJ introuvable' }, { status: 404 })

  // Choix existants de la section source (avant création)
  const { data: sourceChoices } = await supabaseAdmin
    .from('choices')
    .select('id, label, target_section_id, requires_trial, sort_order, condition, transition_text, is_back')
    .eq('section_id', sectionId)
    .order('sort_order')

  // Prochain numéro de section
  const { data: maxRow } = await supabaseAdmin
    .from('sections')
    .select('number')
    .eq('book_id', section.book_id)
    .order('number', { ascending: false })
    .limit(1)
    .single()
  const nextNumber = (maxRow?.number ?? 0) + 1

  // ── Génération du texte de conseil via Claude ───────────────────────────────

  const tutoie = book?.address_form === 'tu'
  const sceneContext = section.summary?.trim() || section.content?.slice(0, 600) || ''

  const prompt = `Tu es un auteur de livre "Dont Vous Êtes le Héros".

Contexte de la scène actuelle (§${section.number}) :
${sceneContext}

Le joueur se tourne vers son compagnon : ${npc.name}
${npc.description ? `Description : ${npc.description}` : ''}
${npc.speech_style ? `Style de parole : ${npc.speech_style}` : ''}

Thème du livre : ${book?.theme ?? ''}
Contexte : ${book?.context_type ?? ''}
Public : ${book?.age_range ?? ''}
Adresse : ${tutoie ? 'tutoiement' : 'vouvoiement'}

Rédige la section de consultation. Structure attendue :
1. Court texte narratif (2-3 phrases) décrivant le moment où le joueur s'approche du compagnon
2. Le discours du compagnon (3-5 phrases) : son point de vue sur la situation, les risques, ce qu'il recommande — dans son style de parole exact. Utilise le tiret cadratin — pour les dialogues.
3. Une phrase de clôture qui laisse la décision au joueur

Style : immersif, rythmé, 120-180 mots total. ${tutoie ? 'Tutoie le joueur.' : 'Vouvoie le joueur.'}

Réponds UNIQUEMENT en JSON :
{
  "content": "texte complet de la section",
  "summary": "résumé en 1-2 phrases (20-30 mots)",
  "dialogue_opening": "première réplique du PNJ mot pour mot"
}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  let content = '', summary = '', dialogue_opening = ''
  try {
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const parsed = JSON.parse(extractJson(raw))
    content = parsed.content ?? ''
    summary = parsed.summary ?? ''
    dialogue_opening = parsed.dialogue_opening ?? ''
  } catch {
    return NextResponse.json({ error: 'Réponse Claude invalide' }, { status: 500 })
  }

  // ── Création de la nouvelle section ────────────────────────────────────────

  const { data: newSection, error: secErr } = await supabaseAdmin
    .from('sections')
    .insert({
      book_id: section.book_id,
      number: nextNumber,
      content,
      summary,
      is_ending: false,
      status: 'draft',
      continues_timer: true,
      trial: {
        type: 'dialogue',
        npc_id: npc.id,
        dialogue_opening,
        dialogue_goal: `Obtenir le conseil de ${npc.name}`,
      },
    })
    .select()
    .single()

  if (secErr || !newSection) return NextResponse.json({ error: secErr?.message ?? 'Erreur création section' }, { status: 500 })

  // ── Choix dans la section source → nouvelle section ─────────────────────────

  const maxSourceOrder = sourceChoices?.length ? Math.max(...sourceChoices.map(c => c.sort_order)) : -1

  const { data: choiceInSource } = await supabaseAdmin
    .from('choices')
    .insert({
      section_id: sectionId,
      label: `Demander l'avis de ${npc.name}`,
      target_section_id: newSection.id,
      requires_trial: false,
      sort_order: maxSourceOrder + 1,
    })
    .select()
    .single()

  // ── Choix dans la nouvelle section ─────────────────────────────────────────

  const newChoices = [
    // 0 : suivre le conseil (target à définir par l'admin)
    {
      section_id: newSection.id,
      label: `Suivre le conseil de ${npc.name}`,
      target_section_id: null,
      requires_trial: false,
      sort_order: 0,
    },
    // 1+ : copie des choix de la section source
    ...(sourceChoices ?? []).map((c, i) => ({
      section_id: newSection.id,
      label: c.label,
      target_section_id: c.target_section_id ?? null,
      requires_trial: c.requires_trial,
      sort_order: i + 1,
      condition: c.condition ?? null,
      transition_text: c.transition_text ?? null,
      is_back: c.is_back ?? false,
    })),
  ]

  const { data: createdChoices } = await supabaseAdmin
    .from('choices')
    .insert(newChoices)
    .select()

  return NextResponse.json({
    new_section: newSection,
    choice_in_source: choiceInSource,
    choices_in_new_section: createdChoices ?? [],
  })
}
