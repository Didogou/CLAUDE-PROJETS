import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import https from 'node:https'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildBookStructurePrompt, buildSectionContentPrompt, type SectionMeta } from '@/lib/prompts'
import type { GenerateBookParams } from '@/types'

export const maxDuration = 300 // 5 minutes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * Corrige les caractères de contrôle littéraux écrits par les LLM à l'intérieur
 * des chaînes JSON (ex: vrai \n, \t, \r au lieu des séquences d'échappement \n \t \r).
 */
function fixJsonControlChars(raw: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { result += ch; escaped = false; continue }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if      (ch === '\n') { result += '\\n';  continue }
      else if (ch === '\r') { result += '\\r';  continue }
      else if (ch === '\t') { result += '\\t';  continue }
      else if (ch.charCodeAt(0) < 0x20) { continue } // autres ctrl chars → supprimés
    }
    result += ch
  }
  return result
}

async function streamMessageWithRetry(params: Parameters<typeof anthropic.messages.stream>[0], maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const stream = anthropic.messages.stream(params)
      return await stream.finalMessage()
    } catch (err: any) {
      const isOverloaded = err?.status === 529 || err?.error?.type === 'overloaded_error'
      if (isOverloaded && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 30000)))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries reached')
}

/** Appel direct Mistral via node:https — contourne le fetch patché par Next.js */
async function callMistral(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('Clé MISTRAL_API_KEY manquante dans .env.local')

  const body = JSON.stringify({
    model: 'mistral-large-latest',
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.mistral.ai',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 360_000, // 6 min max par appel
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
            if (res.statusCode !== 200) {
              reject(new Error(json.message ?? json.error?.message ?? `Mistral HTTP ${res.statusCode}`))
            } else {
              resolve((json.choices?.[0]?.message?.content as string ?? '').trim())
            }
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Délai Mistral dépassé (4 min)')) })
    req.write(body)
    req.end()
  })
}

// Mistral Large 2 max output = 16 384 tokens
const MISTRAL_MAX_TOKENS = 16000

async function generateText(
  model: 'claude' | 'mistral',
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  if (model === 'mistral') {
    return callMistral(systemPrompt, userPrompt, Math.min(maxTokens, MISTRAL_MAX_TOKENS))
  }
  // Claude
  const msg = await streamMessageWithRetry({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  return msg.content[0].type === 'text' ? msg.content[0].text : ''
}

export async function POST(req: NextRequest) {
  try {
    const params: GenerateBookParams = await req.json()
    const aiModel = params.ai_model ?? 'claude'
    // En mode mixte : Claude pour la structure, Mistral pour les textes narratifs
    const structureModel: 'claude' | 'mistral' = 'claude'
    const contentModel: 'claude' | 'mistral' = aiModel === 'mistral' ? 'mistral' : aiModel === 'mixed' ? 'mistral' : 'claude'

    // 1. Créer le livre en BDD (statut draft)
    const { data: book, error: bookError } = await supabaseAdmin
      .from('books')
      .insert({
        title: params.title, theme: params.theme, age_range: params.age_range,
        context_type: params.context_type, language: params.language,
        difficulty: params.difficulty, content_mix: params.content_mix,
        description: params.description,
        map_style: params.map_style ?? null,
        map_visibility: params.map_visibility ?? 'full',
        status: 'draft',
      })
      .select().single()
    if (bookError) throw bookError

    // 2. Générer la structure via le LLM choisi
    // Structure → toujours Claude (fiable pour le JSON et les embranchements)
    const structureSystemPrompt = 'Tu es un générateur de JSON. Ta réponse entière doit être du JSON brut valide. Commence par { et termine par }. N\'inclus aucun texte, commentaire ou bloc markdown. Dans les chaînes JSON, échappe correctement les guillemets (\\") et les retours à la ligne (\\n).'
    const rawContent = await generateText(
      structureModel,
      structureSystemPrompt,
      buildBookStructurePrompt(params),
      32000
    )
    let structure: { npcs?: any[]; sections: any[]; locations?: any[] }
    try {
      // 1. Nettoyer les balises markdown éventuelles
      let cleaned = rawContent.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim()
      // 2. Extraire le bloc { … } si du texte précède
      if (!cleaned.startsWith('{')) {
        const start = rawContent.indexOf('{')
        const end   = rawContent.lastIndexOf('}')
        if (start !== -1 && end !== -1) cleaned = rawContent.slice(start, end + 1)
      }
      // 3. Sanitiser les caractères de contrôle littéraux dans les strings JSON
      //    (Claude écrit parfois de vrais \n/\t dans les valeurs de chaîne)
      cleaned = fixJsonControlChars(cleaned)
      structure = JSON.parse(cleaned)
    } catch {
      const preview = rawContent.slice(0, 500).replace(/\n/g, '↵')
      throw new Error(`Le modèle a retourné un JSON invalide. Début de la réponse : ${preview}`)
    }

    // 3. Insérer les lieux et construire un index nom → location id
    const locationNameMap = new Map<string, string>() // name → id

    if (structure.locations?.length && params.map_style) {
      const locToInsert = structure.locations.map((l: any) => ({
        book_id: book.id,
        name:    l.name,
        x:       Math.min(100, Math.max(0, l.x ?? 50)),
        y:       Math.min(100, Math.max(0, l.y ?? 50)),
        icon:    l.icon ?? '📍',
      }))
      const { data: insertedLocs, error: locError } = await supabaseAdmin
        .from('locations').insert(locToInsert).select()
      if (locError) throw locError
      for (const loc of insertedLocs) {
        locationNameMap.set(loc.name.toLowerCase(), loc.id)
      }
    }

    // 4. Insérer les PNJ et construire un index nom → PNJ inséré
    // Un PNJ peut apparaître dans plusieurs sections
    const npcNameMap = new Map<string, { id: string; force: number; agilite: number; endurance: number }>()

    if (structure.npcs?.length) {
      const npcsToInsert = structure.npcs.map((n: any) => ({
        book_id: book.id,
        name:            n.name,
        type:            ['ennemi', 'boss', 'allié', 'neutre', 'marchand'].includes(n.type) ? n.type : 'ennemi',
        description:     n.description ?? null,
        force:           n.force       ?? 5,
        agilite:         n.agilite     ?? 5,
        intelligence:    n.intelligence ?? 5,
        magie:           n.magie        ?? 0,
        endurance:       n.endurance    ?? 10,
        chance:          n.chance       ?? 5,
        special_ability: n.special_ability ?? null,
        resistances:     n.resistances     ?? null,
        loot:            n.loot            ?? null,
        speech_style:    n.speech_style    ?? null,
        dialogue_intro:  n.dialogue_intro  ?? null,
      }))

      const { data: insertedNpcs, error: npcError } = await supabaseAdmin
        .from('npcs').insert(npcsToInsert).select()
      if (npcError) throw npcError

      for (const npc of insertedNpcs) {
        npcNameMap.set(npc.name.toLowerCase(), {
          id: npc.id, force: npc.force, agilite: npc.agilite, endurance: npc.endurance,
        })
      }
    }

    // 5. Phase 2 — Générer le texte narratif (format texte, pas JSON → pas de pb d'échappement)
    const sectionTypeFn = (s: any): string => {
      if (s.is_ending) return s.ending_type === 'victory' ? 'Victoire' : 'Mort'
      if (s.trial) {
        const map: Record<string, string> = {
          combat: 'Combat', magie: 'Magie', agilite: 'Agilité',
          intelligence: 'Énigme', chance: 'Chance', crochetage: 'Crochetage', dialogue: 'Dialogue',
        }
        return map[s.trial.type] ?? 'Épreuve'
      }
      return 'Narration'
    }

    const locationNames = new Map(
      [...locationNameMap.entries()].map(([name, id]) => [id, name])
    )
    // Reconstruit le map inversé name→id pour retrouver le nom depuis location_name
    const sectionMetas: SectionMeta[] = structure.sections.map((s: any) => ({
      number:       s.number,
      summary:      s.summary ?? '',
      type:         sectionTypeFn(s),
      location:     s.location_name ?? undefined,
      choiceLabels: (s.choices ?? []).map((c: any) => c.label),
    }))

    // Textes narratifs → modèle contenu (Mistral en mode mixte ou mistral-only)
    const rawContent2 = await generateText(
      contentModel,
      'Tu es un auteur de livres DYEH. Réponds uniquement avec les textes narratifs dans le format §§N§§ demandé. Aucun autre texte.',
      buildSectionContentPrompt(params, sectionMetas),
      32000
    )

    // Parser §§N§§\n{texte}
    const contentMap = new Map<number, string>()
    const blocks = rawContent2.split(/§§(\d+)§§/)
    for (let i = 1; i < blocks.length - 1; i += 2) {
      const num = parseInt(blocks[i])
      const text = blocks[i + 1].trim()
      if (!isNaN(num) && text) contentMap.set(num, text)
    }

    // Normalise ending_type : accepte 'victory'/'victoire'/'win' → 'victory', 'death'/'mort'/'lose' → 'death'
    function normalizeEndingType(raw: any): 'victory' | 'death' | null {
      if (!raw) return null
      const v = String(raw).toLowerCase().trim()
      if (['victory', 'victoire', 'win', 'succes', 'success'].includes(v)) return 'victory'
      if (['death', 'mort', 'lose', 'defeat', 'defaite', 'défaite'].includes(v)) return 'death'
      return null
    }

    // 6. Insérer les sections avec le contenu narratif
    const sectionsToInsert = structure.sections.map((s: any) => ({
      book_id:     book.id,
      number:      s.number,
      summary:     s.summary     ?? null,
      content:     contentMap.get(s.number) ?? `[Section ${s.number}]`,
      is_ending:   s.is_ending   ?? false,
      ending_type: normalizeEndingType(s.ending_type),
      trial:       null,
      location_id: s.location_name ? (locationNameMap.get(s.location_name.toLowerCase()) ?? null) : null,
    }))

    const { data: _insertedSections, error: sectionsError } = await supabaseAdmin
      .from('sections').insert(sectionsToInsert).select()
    if (sectionsError) throw sectionsError
    const insertedSections: any[] = _insertedSections ?? []

    const sectionMap = new Map<number, string>(insertedSections.map((s: any) => [s.number, s.id]))

    // 7. Insérer les choix
    const choicesToInsert: any[] = []
    for (const s of structure.sections) {
      const sectionId = sectionMap.get(s.number)
      if (!sectionId || !s.choices?.length) continue
      for (const c of s.choices) {
        choicesToInsert.push({
          section_id:        sectionId,
          label:             c.label,
          target_section_id: sectionMap.get(c.target_section) ?? null,
          requires_trial:    false,
          sort_order:        c.sort_order ?? 0,
          is_back:           c.is_back ?? false,
        })
      }
    }
    let insertedChoices: any[] = []
    if (choicesToInsert.length > 0) {
      const { data: ic, error: choicesError } = await supabaseAdmin.from('choices').insert(choicesToInsert).select()
      if (choicesError) throw choicesError
      insertedChoices = ic ?? []
    }

    // 8. Résoudre les trials (section IDs + lien PNJ)
    // Un même PNJ peut être référencé dans plusieurs sections
    for (const s of structure.sections) {
      if (!s.trial) continue
      const sectionId = sectionMap.get(s.number)
      if (!sectionId) continue

      const rawTrial = s.trial
      const npcKey = rawTrial.enemy_name?.toLowerCase()
      const npcData = npcKey ? npcNameMap.get(npcKey) : null

      const trial: Record<string, any> = {
        type:                      rawTrial.type,
        stat:                      rawTrial.stat,
        success_section_id:        sectionMap.get(rawTrial.success_section) ?? null,
        failure_section_id:        sectionMap.get(rawTrial.failure_section) ?? null,
        endurance_loss_on_failure: rawTrial.endurance_loss_on_failure ?? null,
        mana_cost:                 rawTrial.mana_cost ?? null,
        xp_reward:                 rawTrial.xp_reward ?? null,
        item_rewards:              rawTrial.item_rewards ?? null,
        dialogue_opening:          rawTrial.dialogue_opening ?? null,
        dialogue_goal:             rawTrial.dialogue_goal ?? null,
      }

      // Lier au PNJ si trouvé (peut apparaître dans plusieurs sections)
      if (npcData) {
        trial.npc_id = npcData.id
        trial.enemy  = {
          name:      rawTrial.enemy_name,
          force:     npcData.force,
          endurance: npcData.endurance,
        }
      } else if (rawTrial.enemy) {
        trial.enemy = rawTrial.enemy
      }

      await supabaseAdmin.from('sections').update({ trial }).eq('id', sectionId)
    }

    // 9. Générer le prologue
    const firstSections = [...insertedSections]
      .sort((a: any, b: any) => a.number - b.number)
      .slice(0, 3)
      .map((s: any) => `§${s.number} — ${(s.content ?? '').slice(0, 150)}`)
      .join('\n')

    const intro_text = await generateText(
      contentModel,
      'Tu es un auteur de livres "Dont Vous Êtes le Héros". Réponds UNIQUEMENT avec le texte du prologue, sans titre ni balise.',
      `Écris le PROLOGUE d'introduction du livre "${book.title}" (${book.theme}, public ${book.age_range} ans).\nContexte : ${book.description ?? '(non précisé)'}\nPremières sections :\n${firstSections}\nRÈGLES : 2e personne du singulier ("tu" ou "vous"), atmosphère sensorielle (sons, odeurs, lumières), 250-400 mots, pas de titre, terminer sur le moment où l'aventure commence.`,
      1200
    ).catch(() => '')

    if (intro_text) {
      await supabaseAdmin.from('books').update({ intro_text }).eq('id', book.id)
    }

    // 10. Générer les transitions entre sections (par lots de 5)
    const sectionContentById = new Map<string, string>(
      insertedSections.map((s: any) => [s.id, s.content ?? ''])
    )

    const transitionSystemPrompt = 'Tu es un auteur de livre LDVELH. Réponds UNIQUEMENT avec le texte de transition demandé, sans guillemets ni balises.'

    async function generateTransition(choice: any): Promise<void> {
      if (!choice.target_section_id) return
      const sourceContent = sectionContentById.get(choice.section_id) ?? ''
      const targetContent = sectionContentById.get(choice.target_section_id) ?? ''
      if (!sourceContent || !targetContent) return

      const transition = await generateText(
        contentModel,
        transitionSystemPrompt,
        `Écris un court paragraphe de transition (2-3 phrases, 30-50 mots maximum) pour le livre "${book.title}".\nLe lecteur choisit : "${choice.label}"\nSection de départ : ${sourceContent.slice(0, 400)}\nSection d'arrivée : ${targetContent.slice(0, 300)}\nLe texte de transition doit rendre le passage fluide, cohérent avec l'univers, à la 2e personne du singulier.`,
        200
      ).catch(() => '')

      if (transition) {
        await supabaseAdmin.from('choices').update({ transition_text: transition }).eq('id', choice.id)
      }
    }

    // Analyse narrative (story_analysis) — calculée en parallèle des transitions
    async function generateStoryAnalysis(): Promise<void> {
      try {
        const sectionIdToNumber = new Map<string, number>(
          insertedSections.map((s: any) => [s.id, s.number])
        )
        const structureBySectionNumber = new Map<number, any>(
          structure.sections.map((s: any) => [s.number, s])
        )

        const sectionLines = [...insertedSections]
          .sort((a: any, b: any) => a.number - b.number)
          .map((s: any) => {
            const sChoices = choicesToInsert.filter((c: any) => c.section_id === s.id)
            const choiceStr = sChoices.length
              ? sChoices.map((c: any) => {
                  const tNum = c.target_section_id ? sectionIdToNumber.get(c.target_section_id) : null
                  return `  → "${c.label}"${tNum ? ` → §${tNum}` : ' (fin)'}`
                }).join('\n')
              : ''
            const meta = structureBySectionNumber.get(s.number)
            const ending = meta?.is_ending
              ? ` [FIN : ${normalizeEndingType(meta.ending_type) === 'victory' ? 'VICTOIRE' : 'MORT'}]`
              : ''
            const text = s.summary || (s.content ?? '').slice(0, 200) || '(pas de contenu)'
            return `§${s.number}${ending}\n${text}${choiceStr ? '\n' + choiceStr : ''}`
          }).join('\n\n')

        const endings = structure.sections.filter((s: any) => s.is_ending)
        const victories = endings.filter((s: any) => normalizeEndingType(s.ending_type) === 'victory').length
        const deaths    = endings.filter((s: any) => normalizeEndingType(s.ending_type) === 'death').length

        const analysisPrompt = `Tu es un éditeur littéraire qui analyse un livre "Dont Vous Êtes le Héros".

Livre : "${book.title}" — ${book.theme}, ${book.context_type}
Sections : ${insertedSections.length} | Fins : ${endings.length} (${victories} victoires, ${deaths} morts)

--- CONTENU DU LIVRE ---
${sectionLines}
--- FIN DU CONTENU ---

Ta mission : produire un RAPPORT D'ANALYSE NARRATIVE structuré ainsi :

## Résumé de l'histoire principale
(Décris le fil directeur du récit en 3-5 paragraphes — du début à la ou les fins principales. Explique qui est le héros, quel est l'enjeu, les grandes étapes de l'aventure.)

## Chemins alternatifs notables
(Liste les bifurcations importantes et ce qu'elles impliquent narrativement)

## Incohérences et problèmes détectés
(Signale tout ce qui cloche : ruptures de continuité, sections orphelines, contradictions dans l'univers, personnages qui disparaissent sans explication, logique cassée d'un choix, fins trop abruptes, sections sans choix qui ne sont pas des fins, etc. Si rien à signaler sur un point, écris "Aucun problème détecté.")

## Points forts
(Ce qui fonctionne bien dans la narration)

## Recommandations
(Suggestions concrètes pour améliorer la cohérence — maximum 5 points, triés par priorité)

Sois précis, cite les numéros de section (§N) quand tu pointes un problème.`

        const analysis = await generateText(
          contentModel,
          'Tu es un éditeur littéraire expert. Réponds uniquement avec le rapport demandé, en markdown.',
          analysisPrompt,
          4000
        ).catch(() => '')

        if (analysis) {
          await supabaseAdmin.from('books').update({ story_analysis: analysis }).eq('id', book.id)
        }
      } catch {
        // Échec silencieux — ne bloque pas la création du livre
      }
    }

    // Transitions + analyse en parallèle
    await Promise.all([
      (async () => {
        for (let i = 0; i < insertedChoices.length; i += 5) {
          await Promise.all(insertedChoices.slice(i, i + 5).map(generateTransition))
        }
      })(),
      generateStoryAnalysis(),
    ])

    return NextResponse.json({
      book_id:          book.id,
      sections_count:   insertedSections.length,
      npcs_count:       structure.npcs?.length ?? 0,
      locations_count:  structure.locations?.length ?? 0,
    })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
