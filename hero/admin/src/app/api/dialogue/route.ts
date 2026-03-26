import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Seuils du test d'intelligence ─────────────────────────────────────────────
const THRESHOLD_SUCCESS  = 15  // succès franc  → choix suggéré + info claire
const THRESHOLD_PARTIAL  = 10  // succès partiel → info utile mais pas de choix
//                        < 10 → échec → confusion / silence

// Questions prédéfinies que le joueur peut poser
export const PLAYER_QUESTIONS = [
  'On fait quoi ?',
  "T'es avec moi ?",
  "C'est quoi le plan ?",
]

export interface PastEncounter {
  section_number: number
  outcome: 'success' | 'failure' | 'abandoned'
  memory_summary: string
  timestamp: string
}

export interface MangaNpc {
  id: string
  name: string
  description?: string
  speech_style?: string
  type: 'allié' | 'boss' | 'ennemi' | 'neutre' | 'marchand'
  intelligence: number
  available_emotions: string[]  // clés de portrait_emotions
}

export interface MangaNpcResponse {
  npc_id: string
  text: string
  agrees: boolean
  emotion: string
  test_result: 'success' | 'partial' | 'failure'
  suggested_choice_id?: string | null
}

export interface DialogueRequest {
  mode?: 'question' | 'post_choice' | 'generate_questions' | 'manga_group'
  npc?: {
    id: string
    name: string
    description?: string
    speech_style?: string
    type: 'allié' | 'boss' | 'ennemi' | 'neutre' | 'marchand'
    intelligence: number   // 1–20
  }
  // mode manga_group
  npcs?: MangaNpc[]
  player_question?: string
  // mode generate_questions
  address_form?: 'tu' | 'vous'
  section_context: string
  tension_level: number    // 0–10
  // mode question / post_choice / manga_group — choices available to the player
  is_intervention?: boolean
  chosen_choice?: { label: string; section_number: number }
  choices?: { id?: string; label: string; section_number?: number }[]
  book_theme: string
  age_range: string
  past_encounters?: PastEncounter[]
  generate_memory_summary?: boolean
  history?: { role: 'player' | 'npc'; text: string }[]
}

// ── Test d'intelligence ────────────────────────────────────────────────────────
function rollTest(intelligence: number, tension: number): 'success' | 'partial' | 'failure' {
  const roll = Math.floor(Math.random() * 20) + 1  // 1–20
  const score = roll + Math.round(intelligence / 2) - tension
  if (score >= THRESHOLD_SUCCESS) return 'success'
  if (score >= THRESHOLD_PARTIAL) return 'partial'
  return 'failure'
}

export async function POST(req: NextRequest) {
  try {
    const body: DialogueRequest = await req.json()
    const {
      mode = 'question', npc, npcs, section_context, tension_level, player_question,
      is_intervention, chosen_choice, choices = [], book_theme, age_range,
      past_encounters, generate_memory_summary, history = [], address_form = 'tu',
    } = body

    // ── Mode generate_questions : questions contextuelles du joueur ─────────
    if (mode === 'generate_questions') {
      const tutoiement = address_form === 'tu'
      const prompt = `Tu dois générer 3 questions courtes qu'un joueur pourrait poser à ses compagnons dans cette scène d'un roman "Dont Vous Êtes le Héros".

Contexte de la scène : ${section_context}
Thème : ${book_theme} | Public : ${age_range} ans | Tension : ${tension_level}/10

Règles :
- 5-8 mots max par question
- ${tutoiement ? 'Tutoiement' : 'Vouvoiement'}
- Contextuelles à la scène (pas génériques)
- Ton approprié à l'âge et à la tension

JSON uniquement : { "questions": ["...", "...", "..."] }`

      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
        const { questions } = JSON.parse(cleaned)
        return NextResponse.json({ questions })
      } catch {
        return NextResponse.json({ questions: PLAYER_QUESTIONS })
      }
    }

    // ── Mode manga_group : réponses de groupe pour la boite manga ───────────
    if (mode === 'manga_group' && npcs && npcs.length > 0) {
      const tensionDesc = tension_level >= 8 ? 'EXTRÊME' : tension_level >= 6 ? 'HAUTE' : tension_level >= 4 ? 'MODÉRÉE' : 'FAIBLE'
      const primaryNpc = npcs[0]

      const npcList = npcs.map((n, idx) => {
        const emotions = n.available_emotions.length > 0 ? n.available_emotions.join(', ') : 'neutre'
        return `- PNJ[${idx}] npc_id="${n.id}" | ${n.name} (${n.type}, int.${n.intelligence}) : ${n.description ?? ''} | Parole : ${n.speech_style ?? 'naturel'} | Émotions dispo : ${emotions}`
      }).join('\n')

      const questionLine = player_question
        ? `Le joueur pose la question : "${player_question}"`
        : `Génère aussi une courte question contextuelle que le joueur pose au groupe (5-8 mots, ${address_form === 'tu' ? 'tutoiement' : 'vouvoiement'}).`

      const choicesBlock = choices.length > 0
        ? `\nChoix narratifs disponibles pour le joueur :\n${choices.map((c, i) => `  ${i + 1}. id="${c.id ?? i}" → "${c.label}"`).join('\n')}\n`
        : ''

      const suggestedChoiceRule = choices.length > 0
        ? `- "suggested_choice_id" : si le PNJ conseille clairement un des choix ci-dessus (test_result "success" d'un allié, ou tromperie d'un ennemi), mets l'id exact du choix suggéré. Sinon null.`
        : ''

      const prompt = `Tu gères un dialogue de groupe dans un roman "Dont Vous Êtes le Héros" (thème : ${book_theme}, public : ${age_range} ans).

Contexte : ${section_context}
Tension : ${tension_level}/10 (${tensionDesc})

Personnages présents :
${npcList}
${choicesBlock}
${questionLine}

Le premier PNJ (${primaryNpc.name}) est le principal — les autres réagissent à sa réponse ET à la question du joueur.

Pour chaque PNJ génère une réponse de 2 phrases + 1 phrase de clôture (3 au total), dans son style de parole. La phrase de clôture doit sonner naturel selon sa personnalité : une proposition, un aveu d'ignorance, un renvoi au joueur ou aux autres, une hésitation, une résignation… Insère 1 tag vocal ElevenLabs v3 entre crochets : [nerveux], [soupir], [excité], [hésite], [chuchote], [pause], [frustré], [calme], [pressé], etc.
- "agrees" : true si le PNJ approuve globalement la position du PNJ principal, false s'il s'y oppose
- "emotion" : DOIT être une des émotions disponibles du PNJ (ou "neutre" si la liste est vide)
- "test_result" : résultat narratif pour ce PNJ ("success" | "partial" | "failure") selon son intelligence (${primaryNpc.intelligence}/20) et la tension (${tension_level}/10)
${suggestedChoiceRule}

JSON uniquement — utilise exactement la valeur npc_id="..." de chaque PNJ ci-dessus :
{
  ${!player_question ? '"player_question": "...",\n  ' : ''}"npc_responses": [
    { "npc_id": "${npcs[0]?.id ?? 'uuid-du-pnj'}", "text": "réplique avec [tag]", "agrees": true, "emotion": "...", "test_result": "success"${choices.length > 0 ? ', "suggested_choice_id": "id-du-choix-ou-null"' : ''} }
  ]
}`

      const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
        const parsed = JSON.parse(cleaned)
        return NextResponse.json({
          player_question: player_question ?? parsed.player_question ?? '',
          npc_responses: (parsed.npc_responses ?? []) as MangaNpcResponse[],
        })
      } catch {
        return NextResponse.json({ error: 'parse error', raw }, { status: 500 })
      }
    }

    // Guard : les modes suivants requièrent un npc
    if (!npc) return NextResponse.json({ error: 'npc required' }, { status: 400 })

    // ── Mode résumé mémoriel ────────────────────────────────────────────────
    if (generate_memory_summary) {
      const summaryPrompt = `Tu es ${npc.name}. Résume en 1-2 phrases ce que tu retiens de cette interaction, de ton point de vue. Style : 1ère personne, dans ton speech_style habituel.\n\nHistorique :\n${history.map(m => `${m.role === 'player' ? 'Joueur' : npc.name}: ${m.text}`).join('\n')}\n\nRéponds UNIQUEMENT avec le résumé, sans JSON.`
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: summaryPrompt }],
      })
      return NextResponse.json({ memory_summary: res.content[0].type === 'text' ? res.content[0].text.trim() : '' })
    }

    // ── Mode post_choice : réaction après sélection d'un choix ────────────
    if (mode === 'post_choice' && chosen_choice) {
      const testResult = rollTest(npc.intelligence, tension_level)
      const isEnemy = npc.type === 'ennemi' || npc.type === 'boss'

      // Pas de réaction si le test échoue totalement
      if (testResult === 'failure') {
        return NextResponse.json({ reaction_type: 'none', npc_reply: null, alternative_choice_index: null, test_result: 'failure' })
      }

      // Trouver le meilleur choix alternatif (index 0 pour allié, dernier pour ennemi)
      const altChoices = choices.filter(c => c.section_number !== chosen_choice.section_number)
      const alternativeIdx = altChoices.length > 0
        ? choices.indexOf(isEnemy ? altChoices[altChoices.length - 1] : altChoices[0])
        : null

      // Allié : contredit si le joueur prend le dernier choix (supposé mauvais), confirme sinon
      // Ennemi : contredit si le joueur prend le premier choix (supposé bon), confirme sinon
      const chosenIdx = choices.findIndex(c => c.section_number === chosen_choice.section_number)
      const isGoodChoice = chosenIdx === 0
      const shouldContradict = testResult === 'success'
        ? (isEnemy ? isGoodChoice : !isGoodChoice)
        : false  // succès partiel → toujours confirmer (trop incertain pour contredire)

      const reactionType = shouldContradict ? 'contradict' : 'confirm'
      const finalAltIdx  = shouldContradict ? alternativeIdx : null

      const prompt = `Tu es ${npc.name} (${npc.type}) dans un roman LDVELH (${book_theme}, ${age_range} ans).
${npc.description ? `Description : ${npc.description}` : ''}
Style de parole : ${npc.speech_style ?? 'naturel'}
Contexte : ${section_context}
Tension : ${tension_level}/10
Test d'intelligence : ${testResult.toUpperCase()}

Le joueur vient de choisir : "${chosen_choice.label}"
${shouldContradict && finalAltIdx !== null
  ? `Tu dois CONTREDIRE ce choix et proposer à la place : "${choices[finalAltIdx]?.label}". ${isEnemy ? 'Tu le fais pour tromper le joueur — sois convaincant et sincère en apparence.' : 'Tu penses sincèrement que c\'est la mauvaise direction.'}`
  : `Tu CONFIRMES ce choix. ${isEnemy ? 'Tu confirmes pour le piéger dans cette mauvaise direction.' : 'Tu penses que c\'est la bonne décision.'}`
}

Réponds en 2 phrases + 1 phrase de clôture (3 au total), dans ton style. La phrase de clôture doit sonner naturel : proposition, aveu d'ignorance, renvoi au joueur, hésitation, résignation… Reste dans le personnage. Ne mentionne pas de chiffres ou de système de jeu. Insère 1 tag vocal entre crochets : [nerveux], [soupir], [excité], [hésite], [chuchote], [pause], [frustré], [pressé], etc.
JSON uniquement : { "npc_reply": "ta réplique avec [tag] inclus" }`

      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
      let npc_reply = raw
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
        npc_reply = JSON.parse(cleaned).npc_reply ?? raw
      } catch { /* utiliser raw */ }

      return NextResponse.json({
        reaction_type:           reactionType,
        npc_reply,
        alternative_choice_index: finalAltIdx,
        test_result:              testResult,
      })
    }

    // ── Test d'intelligence avec malus de tension ───────────────────────────
    const testResult = rollTest(npc.intelligence, tension_level)

    // ── Contexte mémoriel ───────────────────────────────────────────────────
    let memoryContext = ''
    if (past_encounters && past_encounters.length > 0) {
      memoryContext = '\nMémoire des rencontres précédentes :\n'
      for (const enc of past_encounters) {
        const label = enc.outcome === 'success' ? '✓' : enc.outcome === 'failure' ? '✗' : '⊘'
        memoryContext += `- §${enc.section_number} (${label}) : "${enc.memory_summary}"\n`
      }
    }

    // ── Déterminer l'intention selon type PNJ + résultat test ──────────────
    const isEnemy = npc.type === 'ennemi' || npc.type === 'boss'

    // Quel choix suggérer ? Allié → bon choix (index 0), Ennemi → mauvais (dernier index)
    const goodChoiceIdx = 0
    const badChoiceIdx  = choices.length - 1
    const suggestedIdx  = isEnemy ? badChoiceIdx : goodChoiceIdx

    // Construire les instructions selon résultat
    let testInstruction = ''
    let suggestedChoiceIndex: number | null = null

    if (testResult === 'success') {
      suggestedChoiceIndex = suggestedIdx
      if (isEnemy) {
        testInstruction = `Tu es intelligent et MENTEUR. Tu orientes INTENTIONNELLEMENT le joueur vers le mauvais choix ("${choices[badChoiceIdx]?.label}"). Tu le fais avec assurance, en inventant une bonne raison. PAS de doute, tu es convaincant.`
      } else {
        testInstruction = `Tu es lucide malgré la tension. Tu orientes CLAIREMENT le joueur vers le bon choix ("${choices[goodChoiceIdx]?.label}"). Sois direct et convaincant, sans trop expliquer.`
      }
    } else if (testResult === 'partial') {
      testInstruction = `La tension te perturbe. Tu donnes une info utile mais VAGUE — tu pressens quelque chose sans pouvoir l'articuler clairement. Pas de direction précise. 2-3 phrases max.`
    } else {
      testInstruction = `La tension est trop forte. Tu paniques, tu bégaies, tu dis quelque chose d'inutile ou de contradictoire. 1-2 phrases courtes, émotionnelles, pas de conseil.`
    }

    const interventionInstruction = is_intervention
      ? `\nATTENTION : Tu interviens SPONTANÉMENT car le joueur tarde. Tu prends l'initiative, tu es pressé, tu n'attends pas qu'on te parle.`
      : `\nLe joueur t'a posé cette question : "${player_question}"`

    // ── Prompt ─────────────────────────────────────────────────────────────
    const systemPrompt = `Tu incarnes ${npc.name} dans un roman "Dont Vous Êtes le Héros" (thème : ${book_theme}, public : ${age_range} ans).

Profil :
${npc.description ? `- Description : ${npc.description}` : ''}
- Type : ${npc.type}
- Intelligence : ${npc.intelligence}/20
- Style de parole : ${npc.speech_style ?? 'naturel, cohérent avec ton rôle'}
${memoryContext}
Contexte de la scène :
${section_context}

Niveau de tension actuel : ${tension_level}/10${tension_level >= 6 ? ' — HAUTE TENSION, tu es sous pression' : ''}

Choix narratifs disponibles :
${choices.map((c, i) => `${i + 1}. "${c.label}"`).join('\n')}
${interventionInstruction}

Résultat de ton test d'intelligence (tension=${tension_level}, int=${npc.intelligence}) : ${testResult.toUpperCase()}
→ ${testInstruction}

Règles ABSOLUES :
1. Reste dans le personnage. Utilise ton style de parole.
2. Ne mentionne JAMAIS les numéros de section, le JSON ou le système de jeu.
3. Longueur : 2 phrases maximum + 1 phrase de clôture obligatoire (= 3 phrases au total). La phrase de clôture doit sonner naturel : une proposition concrète, un aveu d'ignorance, un renvoi au joueur ou aux autres, une hésitation, une résignation — selon la personnalité du PNJ et la tension. Jamais de tirade longue.
4. Tags vocaux ElevenLabs v3 : insère 1 à 2 tags entre crochets pour guider le jeu d'acteur. Exemples : [nerveux], [soupir], [excité], [hésite], [chuchote], [pause], [frustré], [triste], [calme], [bégaye], [pressé]. Place-les là où l'intonation change naturellement.
5. Réponds UNIQUEMENT en JSON :
{
  "npc_reply": "ta réplique avec [tags] inclus",
  "suggested_choice_index": ${suggestedChoiceIndex !== null ? suggestedChoiceIndex : 'null'},
  "test_result": "${testResult}",
  "is_resolved": true
}
- "suggested_choice_index" : ${testResult === 'success' ? `OBLIGATOIREMENT ${suggestedChoiceIndex}` : 'null (pas de direction claire)'}
- "is_resolved" : toujours true (une seule interaction par PNJ)`

    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({
        role: (m.role === 'player' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.role === 'player' ? `[Joueur] : ${m.text}` : m.text,
      })),
      { role: 'user', content: is_intervention ? '[Intervention spontanée]' : `[Joueur] : ${player_question}` },
    ]

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: systemPrompt,
      messages,
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    let parsed: {
      npc_reply: string
      suggested_choice_index: number | null
      test_result: 'success' | 'partial' | 'failure'
      is_resolved: boolean
    }

    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { npc_reply: raw, suggested_choice_index: null, test_result: testResult, is_resolved: true }
    }

    return NextResponse.json({ ...parsed, test_result: testResult, roll_debug: undefined })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
