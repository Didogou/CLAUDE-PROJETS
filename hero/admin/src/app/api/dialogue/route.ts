import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface PastEncounter {
  section_number: number
  outcome: 'success' | 'failure' | 'abandoned'
  memory_summary: string   // résumé mémoriel en 1-2 phrases, du point de vue du PNJ
  timestamp: string
}

export interface DialogueRequest {
  npc: {
    name: string
    description?: string
    speech_style?: string
    type: string
  }
  section_context: string
  dialogue_goal: string
  dialogue_opening?: string
  history: { role: 'player' | 'npc'; text: string }[]
  player_message: string
  choices: { label: string; section_number: number }[]
  book_theme: string
  age_range: string
  past_encounters?: PastEncounter[]   // mémoire des rencontres précédentes
  generate_memory_summary?: boolean   // si true, générer un résumé mémoriel (fin de dialogue)
}

export async function POST(req: NextRequest) {
  try {
    const body: DialogueRequest = await req.json()
    const {
      npc, section_context, dialogue_goal, history, player_message,
      choices, book_theme, age_range, past_encounters, generate_memory_summary,
    } = body

    // ── Mode résumé mémoriel (appelé à la fin du dialogue) ─────────────────
    if (generate_memory_summary) {
      const summaryPrompt = `Tu es ${npc.name}. Résume en 1-2 phrases courtes ce que tu retiens de la conversation qui vient de se passer, de ton point de vue de personnage. Inclus : l'attitude du joueur, ce qui a été dit d'important, et ton ressenti envers lui maintenant. Style : 1ère personne, dans ton speech_style habituel.\n\nHistorique de la conversation :\n${history.map(m => `${m.role === 'player' ? 'Joueur' : npc.name}: ${m.text}`).join('\n')}\n\nRéponds UNIQUEMENT avec le résumé mémoriel, sans JSON, sans commentaire.`

      const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{ role: 'user', content: summaryPrompt }],
      })
      const summary = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
      return NextResponse.json({ memory_summary: summary })
    }

    // ── Construire le contexte mémoriel ────────────────────────────────────
    let memoryContext = ''
    if (past_encounters && past_encounters.length > 0) {
      memoryContext = `\nMémoire des rencontres précédentes avec ce joueur :\n`
      for (const enc of past_encounters) {
        const outcomeLabel = enc.outcome === 'success' ? '✓ accord obtenu' : enc.outcome === 'failure' ? '✗ refus/échec' : '⊘ interrompu'
        memoryContext += `- Section §${enc.section_number} (${outcomeLabel}) : "${enc.memory_summary}"\n`
      }
      memoryContext += `\nTu te souviens de ces interactions. Réagis en conséquence : si le joueur a été hostile avant, tu peux être méfiant. S'il t'a aidé, tu peux être plus chaleureux. Réfère-toi naturellement à ces rencontres si pertinent ("La dernière fois que tu es venu…", "Je me souviens de toi…").\n`
    }

    // ── Prompt système ─────────────────────────────────────────────────────
    const systemPrompt = `Tu incarnes ${npc.name}, un personnage de roman "Dont Vous Êtes le Héros" (thème : ${book_theme}, public : ${age_range} ans).

Profil du personnage :
${npc.description ? `- Description : ${npc.description}` : ''}
- Type : ${npc.type}
- Style de parole : ${npc.speech_style ?? 'Parle normalement, de façon cohérente avec son rôle.'}
${memoryContext}
Contexte de la scène actuelle :
${section_context}

Objectif de cette conversation :
${dialogue_goal}

Choix narratifs disponibles à la fin du dialogue :
${choices.map((c, i) => `${i + 1}. "${c.label}"`).join('\n')}

Règles ABSOLUES :
1. Reste TOUJOURS dans le personnage. Utilise exactement le style de parole décrit.
2. Ne mentionne JAMAIS les numéros de section, le JSON, le code ou le système de jeu.
3. Si tu te souviens du joueur, réagis naturellement à cette histoire commune — sans forcer.
4. Réponds UNIQUEMENT en JSON avec ce format exact :
{
  "npc_reply": "La réplique du personnage",
  "suggested_choice_index": null,
  "is_resolved": false,
  "resolution_hint": null
}
- "suggested_choice_index" : indice 0-based du choix le plus probable. null si pas encore clair.
- "is_resolved" : true si la conversation atteint une conclusion naturelle.
- "resolution_hint" : "success" ou "failure" si is_resolved=true.
5. Adapte ton ton selon l'évolution de la conversation et l'historique mémoriel.
6. Répliques concises : 2-5 phrases max.`

    // ── Historique de la conversation courante ─────────────────────────────
    const messages: Anthropic.MessageParam[] = []
    for (const msg of history) {
      if (msg.role === 'player') {
        messages.push({ role: 'user', content: `[Joueur] : ${msg.text}` })
      } else {
        messages.push({ role: 'assistant', content: msg.text })
      }
    }
    messages.push({ role: 'user', content: `[Joueur] : ${player_message}` })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
      messages,
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    let parsed: {
      npc_reply: string
      suggested_choice_index: number | null
      is_resolved: boolean
      resolution_hint: 'success' | 'failure' | null
    }

    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { npc_reply: raw, suggested_choice_index: null, is_resolved: false, resolution_hint: null }
    }

    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
