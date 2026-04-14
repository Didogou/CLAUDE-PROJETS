import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 300

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function callClaude(prompt: string, maxTokens: number): Promise<string> {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  const message = await stream.finalMessage()
  return message.content[0].type === 'text' ? message.content[0].text.trim() : ''
}

function parseJSON(raw: string) {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON found')
  return JSON.parse(raw.slice(start, end + 1))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const analysis: string = body?.analysis ?? ''

    // ── Extraire le bloc incohérences ────────────────────────────────────────
    const incoBlock = analysis.match(/## Incohérences et problèmes détectés([\s\S]*?)(?=\n## [^#]|$)/)?.[1]?.trim() ?? ''
    if (!incoBlock || incoBlock.toLowerCase().includes('aucun problème')) {
      return NextResponse.json({ applied: [], structural: [], skipped: [], summary: 'Aucune incohérence à corriger.' })
    }

    // ── Charger tout le livre ────────────────────────────────────────────────
    const sectionIdsRes = await supabaseAdmin.from('sections').select('id').eq('book_id', id)
    const allIds = sectionIdsRes.data?.map(s => s.id) ?? []

    const [{ data: book }, { data: sections }, { data: allChoices }] = await Promise.all([
      supabaseAdmin.from('books').select('title, theme, context_type').eq('id', id).single(),
      supabaseAdmin.from('sections')
        .select('id, number, content, trial, is_ending, ending_type')
        .eq('book_id', id).order('number'),
      supabaseAdmin.from('choices')
        .select('id, section_id, label, target_section_id, requires_trial, sort_order')
        .in('section_id', allIds),
    ])

    if (!book || !sections?.length) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

    // ── Index ────────────────────────────────────────────────────────────────
    const sectionById = new Map(sections.map(s => [s.id, s]))
    const sectionByNumber = new Map(sections.map(s => [s.number, s]))

    const choicesBySecNum = new Map<number, { id: string; label: string; targetNumber?: number; sortOrder: number }[]>()
    for (const c of (allChoices ?? [])) {
      const sec = sectionById.get(c.section_id)
      if (!sec) continue
      const target = c.target_section_id ? sectionById.get(c.target_section_id) : null
      const list = choicesBySecNum.get(sec.number) ?? []
      list.push({ id: c.id, label: c.label, targetNumber: target?.number, sortOrder: c.sort_order ?? 0 })
      choicesBySecNum.set(sec.number, list)
    }

    const incomingCount = new Map<number, number>()
    for (const s of sections) incomingCount.set(s.number, 0)
    // Compter les liens via choices
    for (const c of (allChoices ?? [])) {
      const target = c.target_section_id ? sectionById.get(c.target_section_id) : null
      if (target) incomingCount.set(target.number, (incomingCount.get(target.number) ?? 0) + 1)
    }
    // Compter aussi les liens via trial success/failure
    for (const s of sections) {
      const t = s.trial as any
      if (!t) continue
      if (t.success_section_id) {
        const sec = sectionById.get(t.success_section_id)
        if (sec) incomingCount.set(sec.number, (incomingCount.get(sec.number) ?? 0) + 1)
      }
      if (t.failure_section_id) {
        const sec = sectionById.get(t.failure_section_id)
        if (sec) incomingCount.set(sec.number, (incomingCount.get(sec.number) ?? 0) + 1)
      }
    }

    // ── Index condensé partagé (toutes les passes) ───────────────────────────
    const condensedIndex = sections.map(s => {
      const t = s.trial as any
      const trialStr = t
        ? ` [ÉPR:${t.type} succ→${t.success_section_id ? sectionById.get(t.success_section_id)?.number : '?'} éch→${t.failure_section_id ? sectionById.get(t.failure_section_id)?.number : '?'}]`
        : ''
      const choicesStr = (choicesBySecNum.get(s.number) ?? []).map(c => `→§${c.targetNumber ?? '?'}`).join(' ')
      const inco = incomingCount.get(s.number) ?? 0
      return `§${s.number}[in:${inco}${s.is_ending ? ' FIN' : ''}${trialStr}]: ${(s.content ?? '').slice(0, 80).replace(/\n/g, ' ')} ${choicesStr}`
    }).join('\n')

    // ── Détection directe depuis la DB (source de vérité) ───────────────────
    const trialSections = sections.filter(s => {
      const t = s.trial as any
      return t && (!t.success_section_id || !t.failure_section_id)
    })
    const floatingSections = sections.filter(s =>
      (incomingCount.get(s.number) ?? 0) === 0 && s.number !== 1 && !s.is_ending
    )
    const deadEndSections = sections.filter(s =>
      !s.is_ending && !s.trial && (choicesBySecNum.get(s.number)?.length ?? 0) === 0
    )

    // ── Sections à incohérences narratives (mentionnées dans l'analyse) ──────
    const allMentioned = new Set<number>()
    for (const m of incoBlock.matchAll(/§(\d+)/g)) allMentioned.add(parseInt(m[1]))
    const trialNums  = new Set(trialSections.map(s => s.number))
    const floatNums  = new Set(floatingSections.map(s => s.number))
    const deadNums   = new Set(deadEndSections.map(s => s.number))

    const applied: number[] = []
    const structural: string[] = []
    const skipped: { number: number; reason: string }[] = []

    // ════════════════════════════════════════════════════════════════════════
    // PASSE 1 — Épreuves sans sorties (sortie structurelle, output ~4k tokens)
    // Détectées directement depuis la DB : champ trial sans success/failure_id
    // ════════════════════════════════════════════════════════════════════════
    if (trialSections.length > 0) {
      const trialList = trialSections.map(s => {
        const t = s.trial as any
        return `§${s.number} [ÉPREUVE:${t.type}]\n${(s.content ?? '').slice(0, 200)}`
      }).join('\n\n')

      const pass1Prompt = `Tu es un éditeur de LDVELH. Pour chaque épreuve ci-dessous, choisis les sections cibles pour succès ET échec.

LIVRE : "${book.title}" (${book.theme})

INDEX COMPLET :
${condensedIndex}

ÉPREUVES SANS BRANCHES (à corriger) :
${trialList}

RÈGLES :
- Succès → section qui continue l'aventure (contexte positif, logique narrativement)
- Échec → section alternative difficile, blessure, ou chemin négatif
- Les deux sections DOIVENT exister dans l'index ci-dessus
- Évite les sections FIN pour les succès si possible

JSON valide UNIQUEMENT :
{"trial_fixes":[{"number":<N>,"success_section_number":<M>,"failure_section_number":<P>}]}`

      try {
        const raw1 = await callClaude(pass1Prompt, 4000)
        const p1 = parseJSON(raw1)
        for (const tf of (p1.trial_fixes ?? [])) {
          const sec = sectionByNumber.get(tf.number)
          if (!sec?.trial) continue
          const successSec = sectionByNumber.get(tf.success_section_number)
          const failSec    = sectionByNumber.get(tf.failure_section_number)
          if (!successSec || !failSec) continue
          const updatedTrial = { ...(sec.trial as object), success_section_id: successSec.id, failure_section_id: failSec.id }
          const { error } = await supabaseAdmin.from('sections').update({ trial: updatedTrial }).eq('id', sec.id)
          if (!error) structural.push(`§${tf.number} épreuve → succès §${tf.success_section_number}, échec §${tf.failure_section_number}`)
        }
      } catch (e: any) {
        skipped.push({ number: 0, reason: `Passe 1 (épreuves) échouée : ${e.message?.slice(0, 200)}` })
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PASSE 2 — Sections flottantes + culs-de-sac (connexions structurelles)
    // ════════════════════════════════════════════════════════════════════════
    if (floatingSections.length > 0 || deadEndSections.length > 0) {
      const floatingList = floatingSections.map(s =>
        `§${s.number} [FLOTTANTE — 0 entrée]\n${s.content ?? '(vide)'}`
      ).join('\n\n')

      const deadEndList = deadEndSections.map(s =>
        `§${s.number} [CUL-DE-SAC — 0 sortie]\n${s.content ?? '(vide)'}`
      ).join('\n\n')

      const pass2Prompt = `Tu es un éditeur de LDVELH. Corrige les problèmes structurels ci-dessous.

LIVRE : "${book.title}" (${book.theme})

INDEX COMPLET :
${condensedIndex}

${floatingSections.length > 0 ? `══ SECTIONS FLOTTANTES (inaccessibles — aucune section ne pointe vers elles) ══
${floatingList}

Pour chaque section flottante :
1. Identifie dans l'index la section SOURCE la plus cohérente qui DEVRAIT mener ici
2. "fixes" : réécris le texte de la SOURCE pour introduire la transition naturellement
3. "choice_additions" : SOURCE → section flottante
` : ''}${deadEndSections.length > 0 ? `══ CULS-DE-SAC (joueur bloqué — section sans sortie ni épreuve) ══
${deadEndList}

Pour chaque cul-de-sac : "choice_additions" vers une section cohérente.
` : ''}
Style Pierre Bordage : 2ème personne, phrases courtes, immersif.
Préserve les choix existants.

JSON valide UNIQUEMENT :
{
  "fixes": [{"number":<N>,"content":"<texte complet de la section SOURCE réécrite>"}],
  "choice_additions": [{"number":<source>,"label":"<texte court du choix>","target_section_number":<cible>}]
}`

      try {
        const raw2 = await callClaude(pass2Prompt, 16000)
        const p2 = parseJSON(raw2)

        for (const fix of (p2.fixes ?? [])) {
          const sec = sectionByNumber.get(fix.number)
          if (!sec || !fix.content?.trim() || fix.content.trim() === (sec.content ?? '').trim()) continue
          const { error } = await supabaseAdmin.from('sections').update({ content: fix.content }).eq('id', sec.id)
          if (!error) applied.push(fix.number)
        }

        for (const ca of (p2.choice_additions ?? [])) {
          const sec       = sectionByNumber.get(ca.number)
          const targetSec = sectionByNumber.get(ca.target_section_number)
          if (!sec || !targetSec || !ca.label?.trim()) continue
          const existing = choicesBySecNum.get(ca.number) ?? []
          if (existing.some(c => c.targetNumber === ca.target_section_number)) continue
          const { error } = await supabaseAdmin.from('choices').insert({
            section_id: sec.id,
            label: ca.label,
            target_section_id: targetSec.id,
            requires_trial: false,
            sort_order: existing.length + 1,
          })
          if (!error) {
            structural.push(`§${ca.number} → choix "${ca.label}" → §${ca.target_section_number}`)
            existing.push({ id: '', label: ca.label, targetNumber: ca.target_section_number, sortOrder: existing.length + 1 })
            choicesBySecNum.set(ca.number, existing)
          }
        }
      } catch (e: any) {
        skipped.push({ number: 0, reason: `Passe 2 (structure) échouée : ${e.message?.slice(0, 200)}` })
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PASSE 3 — Incohérences narratives (géographie, personnages, logique)
    // Uniquement les sections mentionnées dans l'analyse qui ne sont PAS
    // des épreuves ou sections flottantes (déjà traitées)
    // ════════════════════════════════════════════════════════════════════════
    const narrativeNums = [...allMentioned].filter(n =>
      !trialNums.has(n) && !floatNums.has(n) && !deadNums.has(n)
    )
    const narrativeSections = narrativeNums.map(n => sectionByNumber.get(n)).filter(Boolean)

    if (narrativeSections.length > 0) {
      // Traiter par lots de 15 (contexte élargi pour cohérence narrative)
      const BATCH_SIZE = 15
      for (let i = 0; i < narrativeSections.length; i += BATCH_SIZE) {
        const batch = narrativeSections.slice(i, i + BATCH_SIZE)

        // Contexte élargi : sections voisines de chaque section du lot
        const batchNums = new Set(batch.map(s => s!.number))
        const contextNums = new Set<number>()
        for (const s of batch) {
          for (let d = -3; d <= 3; d++) contextNums.add(s!.number + d)
        }
        const contextSections = sections
          .filter(s => contextNums.has(s.number) && !batchNums.has(s.number))
          .map(s => {
            const choices = choicesBySecNum.get(s.number) ?? []
            return `§${s.number}[ctx]: ${(s.content ?? '').slice(0, 120).replace(/\n/g, ' ')} ${choices.map(c => `→§${c.targetNumber ?? '?'}`).join(' ')}`
          }).join('\n')

        const narrativeContent = batch.map(s => {
          const choices = choicesBySecNum.get(s!.number) ?? []
          const choiceStr = choices.map(c => `  → "${c.label}" → §${c.targetNumber ?? '?'}`).join('\n')
          return `§${s!.number}:\n${s!.content ?? '(vide)'}\n${choiceStr ? 'CHOIX:\n' + choiceStr : 'CHOIX: aucun'}`
        }).join('\n\n---\n\n')

        const pass3Prompt = `Tu es un éditeur de LDVELH. Corrige les incohérences narratives listées ci-dessous.

LIVRE : "${book.title}" (${book.theme})

RAPPORT D'INCOHÉRENCES (extrait pertinent) :
${incoBlock}

SECTIONS À CORRIGER (lot ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(narrativeSections.length / BATCH_SIZE)}) :
${narrativeContent}

SECTIONS DE CONTEXTE VOISINES (ne pas modifier) :
${contextSections}

RÈGLES :
- Incohérence géographique → réécris pour justifier ou corriger le trajet
- Personnage disparu → mentionne son sort dans la section la plus pertinente
- Gang/faction sans introduction → ajoute une ligne d'intro
- Contradiction logique → réécris pour supprimer la contradiction
- Si une section ne nécessite pas de correction → omets-la du JSON (ne pas forcer)
- Style Pierre Bordage : 2ème personne, phrases courtes, immersif
- Préserve les choix existants sauf contradiction directe

JSON valide UNIQUEMENT :
{"fixes":[{"number":<N>,"content":"<texte complet corrigé>"}]}`

        try {
          const raw3 = await callClaude(pass3Prompt, 8000)
          const p3 = parseJSON(raw3)
          for (const fix of (p3.fixes ?? [])) {
            if (applied.includes(fix.number)) continue
            const sec = sectionByNumber.get(fix.number)
            if (!sec || !fix.content?.trim() || fix.content.trim() === (sec.content ?? '').trim()) continue
            const { error } = await supabaseAdmin.from('sections').update({ content: fix.content }).eq('id', sec.id)
            if (!error) applied.push(fix.number)
          }
        } catch (e: any) {
          skipped.push({ number: 0, reason: `Passe 3 lot ${Math.floor(i / BATCH_SIZE) + 1} échouée : ${e.message?.slice(0, 150)}` })
        }
      }
    }

    const trialCount  = structural.filter(s => s.includes('épreuve')).length
    const choiceCount = structural.filter(s => s.includes('choix')).length

    return NextResponse.json({
      applied,
      structural,
      skipped,
      summary: `${applied.length} texte(s) · ${trialCount} épreuve(s) · ${choiceCount} choix · ${skipped.length ? skipped.length + ' ignoré(s)' : 'tout corrigé'}`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Erreur inconnue' }, { status: 500 })
  }
}
