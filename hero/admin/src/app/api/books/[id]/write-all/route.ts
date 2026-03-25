import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callMistral, generateText } from '@/lib/ai-utils'
import { buildSectionContentPrompt, type SectionMeta } from '@/lib/prompts'
import type { GenerateBookParams } from '@/types'

export const maxDuration = 300

const BATCH_SIZE = 10

function sectionType(s: any): string {
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

function parseContentMap(raw: string): Map<number, string> {
  const map = new Map<number, string>()
  const blocks = raw.split(/§§(\d+)§§/)
  for (let i = 1; i < blocks.length - 1; i += 2) {
    const num = parseInt(blocks[i])
    const text = blocks[i + 1].trim()
    if (!isNaN(num) && text) map.set(num, text)
  }
  return map
}

/** Détecte un contenu tronqué/vide renvoyé par Mistral */
function isStubContent(text: string): boolean {
  const t = text.trim()
  return (
    t.length < 30 ||
    /^\.{2,}$/.test(t) ||       // "..." ou "……"
    t === '…' ||
    t.endsWith('...') && t.length < 60 ||
    t.startsWith('...') && t.length < 60
  )
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const force = body?.force === true      // relancer sans contrainte de phase
  const overwrite = body?.overwrite === true  // réécrire même les sections déjà rédigées

  const encoder = new TextEncoder()
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Load book
        const { data: book } = await supabaseAdmin.from('books').select('*').eq('id', id).single()
        if (!book) {
          controller.enqueue(send({ type: 'error', message: 'Livre introuvable' }))
          controller.close(); return
        }
        if (!force && book.phase !== 'structure_validated') {
          controller.enqueue(send({ type: 'error', message: 'La structure doit être validée avant la rédaction' }))
          controller.close(); return
        }

        // Mark as writing
        await supabaseAdmin.from('books').update({ phase: 'writing' }).eq('id', id)

        // Load sections + choices + locations
        const { data: sections } = await supabaseAdmin
          .from('sections')
          .select('id, number, summary, content, narrative_arc, is_ending, ending_type, trial, location_id')
          .eq('book_id', id)
          .order('number')

        const sectionIds = (sections ?? []).map(s => s.id)
        const sectionNumberById = new Map((sections ?? []).map(s => [s.id, s.number]))

        const { data: choices } = await supabaseAdmin
          .from('choices')
          .select('section_id, label, sort_order, target_section_id')
          .in('section_id', sectionIds)
          .order('sort_order')

        const { data: locations } = await supabaseAdmin
          .from('locations')
          .select('id, name')
          .eq('book_id', id)

        const { data: npcs } = await supabaseAdmin
          .from('npcs')
          .select('name, speech_style, type')
          .eq('book_id', id)

        const locationById = new Map((locations ?? []).map(l => [l.id, l.name]))
        const choicesBySectionId = new Map<string, { label: string; target: number | null }[]>()
        for (const c of choices ?? []) {
          if (!choicesBySectionId.has(c.section_id)) choicesBySectionId.set(c.section_id, [])
          const targetNum = c.target_section_id ? (sectionNumberById.get(c.target_section_id) ?? null) : null
          choicesBySectionId.get(c.section_id)!.push({ label: c.label, target: targetNum })
        }

        // overwrite = tout réécrire ; force seul = seulement les sections vides
        const allSections = overwrite
          ? (sections ?? [])
          : force
            ? (sections ?? []).filter((s: any) => !s.content?.trim())
            : (sections ?? [])
        const total = allSections.length
        if (total === 0) {
          controller.enqueue(send({ type: 'done', written: 0, total: 0, message: 'Toutes les sections ont déjà un contenu.' }))
          await supabaseAdmin.from('books').update({ phase: 'done' }).eq('id', id)
          controller.close(); return
        }
        controller.enqueue(send({ type: 'start', total }))

        const bookParams: GenerateBookParams = {
          title:          book.title,
          theme:          book.theme,
          age_range:      book.age_range,
          context_type:   book.context_type,
          language:       book.language,
          difficulty:     book.difficulty,
          num_sections:   total,
          content_mix:    book.content_mix ?? { combat: 20, chance: 10, enigme: 10, magie: 5 },
          map_style:      book.map_style ?? null,
          map_visibility: book.map_visibility ?? 'full',
          description:    book.description ?? undefined,
          synopsis:       book.synopsis?.trim() || book.book_summary?.trim() || undefined,
          address_form:   book.address_form ?? 'tu',
        }

        let written = 0

        // Process in batches
        for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
          const batch = allSections.slice(batchStart, batchStart + BATCH_SIZE)

          const metas: SectionMeta[] = batch.map(s => ({
            number:       s.number,
            summary:      s.summary ?? `Section ${s.number}`,
            type:         sectionType(s),
            location:     s.location_id ? (locationById.get(s.location_id) ?? undefined) : undefined,
            choices:      choicesBySectionId.get(s.id) ?? [],
            choiceLabels: (choicesBySectionId.get(s.id) ?? []).map(c => c.label),
            trialTargets: s.trial
              ? { success: s.trial.success_section ?? null, failure: s.trial.failure_section ?? null }
              : undefined,
            narrativeArc: s.narrative_arc ?? null,
          }))

          controller.enqueue(send({
            type: 'batch',
            batch: batchStart / BATCH_SIZE + 1,
            sections: batch.map(s => s.number),
          }))

          let rawContent: string
          try {
            rawContent = await callMistral(
              'Tu es un auteur de livres "Dont Vous Êtes le Héros". Pour CHAQUE section demandée, tu dois écrire un texte narratif complet — même pour les épreuves (combat, chance, magie, dialogue). Réponds UNIQUEMENT avec les textes dans le format §§N§§ demandé, sans sauter aucune section, sans mettre "..." comme contenu. DIALOGUES : utilise UNIQUEMENT le tiret cadratin (—) pour introduire les répliques, JAMAIS d\'astérisques (*) ni de guillemets droits (""). Exemple correct : « — Suis-moi, dit-il. »',
              buildSectionContentPrompt(bookParams, metas, npcs ?? []),
              16000
            )
          } catch (err: any) {
            controller.enqueue(send({ type: 'batch_error', batch: batchStart / BATCH_SIZE + 1, message: err.message }))
            continue
          }

          const contentMap = parseContentMap(rawContent)

          // Save each section in this batch — collect stubs for retry
          const toRetry: typeof batch = []
          for (const s of batch) {
            const content = contentMap.get(s.number)
            if (content && !isStubContent(content)) {
              await supabaseAdmin.from('sections').update({ content, status: 'draft' }).eq('id', s.id)
              written++
              controller.enqueue(send({ type: 'section_done', number: s.number, written, total }))
            } else {
              controller.enqueue(send({ type: 'section_skipped', number: s.number, reason: content ? 'stub_content' : 'not_in_response' }))
              toRetry.push(s)
            }
          }

          // Retry stubs/skipped individually with a stricter prompt
          for (const s of toRetry) {
            controller.enqueue(send({ type: 'retry', number: s.number }))
            try {
              const singleMeta: SectionMeta[] = [metas.find(m => m.number === s.number)!]
              const retryRaw = await callMistral(
                'Tu es un auteur de livres "Dont Vous Êtes le Héros". Rédige un texte narratif complet pour la section demandée. INTERDIT : "...", texte vide, abréviation, astérisques (*) dans les dialogues. Les dialogues utilisent UNIQUEMENT le tiret cadratin (—). Réponds UNIQUEMENT avec §§N§§ suivi du texte, AUCUN autre commentaire.',
                buildSectionContentPrompt(bookParams, singleMeta, npcs ?? []),
                4000
              )
              const retryMap = parseContentMap(retryRaw)
              const retryContent = retryMap.get(s.number)
              if (retryContent && !isStubContent(retryContent)) {
                await supabaseAdmin.from('sections').update({ content: retryContent, status: 'draft' }).eq('id', s.id)
                written++
                controller.enqueue(send({ type: 'section_done', number: s.number, written, total }))
              } else {
                controller.enqueue(send({ type: 'section_failed', number: s.number, reason: 'stub_after_retry' }))
              }
            } catch (retryErr: any) {
              controller.enqueue(send({ type: 'section_failed', number: s.number, reason: retryErr.message }))
            }
          }
        }

        // Générer le prologue avec Claude (utilise les 3 premières sections rédigées)
        controller.enqueue(send({ type: 'prologue_start' }))
        try {
          const { data: firstSections } = await supabaseAdmin
            .from('sections').select('number, content, summary').eq('book_id', id).order('number').limit(3)
          const firstSectionsText = (firstSections ?? [])
            .map(s => `§${s.number} — ${s.summary ?? s.content?.slice(0, 120) ?? ''}`)
            .join('\n')

          const introPrompt = `Tu es un auteur de livres "Dont Vous Êtes le Héros" dans le style de Pierre Bordage.

Écris le PROLOGUE d'introduction de ce livre. Ce texte apparaît AVANT la section 1.

Livre : "${book.title}"
Thème : ${book.theme} — ${book.context_type}
Public : ${book.age_range} ans
Adresse au lecteur : ${book.address_form === 'tu' ? 'tutoiement ("Tu te réveilles…")' : 'vouvoiement ("Vous vous réveillez…")'}
${book.synopsis?.trim() ? `\nSynopsis :\n${book.synopsis.slice(0, 1500)}\n` : book.description?.trim() ? `\nContexte :\n${book.description.slice(0, 800)}\n` : ''}
Début de l'aventure (premières sections) :
${firstSectionsText || '(non disponible)'}

OBJECTIF DU PROLOGUE :
- Planter le décor : monde, époque, ambiance sensorielle (sons, odeurs, lumières)
- Présenter qui est le lecteur (son identité, son passé proche, sa situation)
- Créer une tension narrative progressive, sans action immédiate
- Laisser le temps de l'immersion — pas de combat, pas de choix, pas de péril immédiat
- Se terminer sur le moment précis où l'aventure commence (transition vers §1)

STYLE :
- ${book.address_form === 'tu' ? '2ème personne du singulier ("Tu te réveilles...", "Le vent fouette ton visage...")' : '2ème personne ("Vous vous réveillez...", "Le vent fouette votre visage...")'}
- Phrases rythmées, atmosphère dense et sensorielle
- Entre 250 et 400 mots
- Aucune mention de numéro de section
- Pas de titre, pas de chapeau — commence directement par le texte narratif`

          const intro_text = await generateText('claude', '', introPrompt, 1024)
          if (intro_text.trim()) {
            await supabaseAdmin.from('books').update({ intro_text: intro_text.trim() }).eq('id', id)
            controller.enqueue(send({ type: 'prologue_done' }))
          }
        } catch (prologueErr: any) {
          controller.enqueue(send({ type: 'prologue_error', message: prologueErr.message }))
        }

        // Mark as done
        await supabaseAdmin.from('books').update({ phase: 'done' }).eq('id', id)
        controller.enqueue(send({ type: 'done', written, total }))
      } catch (err: any) {
        console.error('[write-all]', err)
        controller.enqueue(send({ type: 'error', message: err.message }))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
