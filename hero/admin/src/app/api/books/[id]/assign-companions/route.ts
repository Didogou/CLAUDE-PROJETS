import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import Anthropic from '@anthropic-ai/sdk'
import { extractJson } from '@/lib/ai-utils'

const anthropic = new Anthropic()

export const maxDuration = 300

function enc(obj: any) {
  return `data: ${JSON.stringify(obj)}\n\n`
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: book } = await supabaseAdmin.from('books').select('title, synopsis, book_summary, theme').eq('id', id).single()
  if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

  const { data: sections } = await supabaseAdmin
    .from('sections').select('id, number, summary, trial, is_ending')
    .eq('book_id', id).order('number')
  if (!sections?.length) return NextResponse.json({ error: 'Aucune section' }, { status: 400 })

  const { data: npcs } = await supabaseAdmin
    .from('npcs').select('id, name, type')
    .eq('book_id', id).in('type', ['allié', 'neutre'])
  if (!npcs?.length) return NextResponse.json({ error: 'Aucun PNJ allié/neutre' }, { status: 400 })

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => {
        try { controller.enqueue(new TextEncoder().encode(enc(obj))) } catch {}
      }

      const synopsis = book.synopsis?.trim() || book.book_summary?.trim() || book.theme
      const companionLines = npcs.map((n: any) => `- ${n.name} (${n.type})`).join('\n')
      const companionIdByName = new Map(npcs.map((n: any) => [n.name.toLowerCase(), n.id]))
      const sectionById = new Map(sections.map((s: any) => [s.number, s.id]))

      const BATCH = 60
      let assigned = 0
      let failed = 0
      const total = sections.length

      send({ type: 'start', total })

      for (let i = 0; i < sections.length; i += BATCH) {
        const batch = sections.slice(i, i + BATCH)
        const batchNum = Math.floor(i / BATCH) + 1

        const previousContext = sections.slice(0, i)
          .map((s: any) => `§${s.number}: ${s.summary ?? ''}`)
          .slice(-20).join('\n')

        const sectionLines = batch.map((s: any) => {
          const isCombat = s.trial?.type === 'combat'
          const tag = isCombat ? ' (COMBAT)' : s.is_ending ? ' (FIN)' : ''
          return `§${s.number}${tag}: ${s.summary ?? '(sans résumé)'}`
        }).join('\n')

        try {
          const msg = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 8192,
            messages: [{
              role: 'user',
              content: `Livre "Dont Vous Êtes le Héros" : "${book.title}"\n\nSynopsis :\n${synopsis}\n\nAlliés du protagoniste :\n${companionLines}\n\nRÈGLE : Les alliés accompagnent le protagoniste par défaut dans les sections de narration. Ils sont ABSENTS uniquement si :\n- La section est marquée (COMBAT) ou (FIN)\n- Le résumé indique explicitement mort, départ, capture ou scène solo\n- Le contexte précédent montre qu'ils ont quitté l'histoire\n\n${previousContext ? `Contexte précédent :\n${previousContext}\n\n` : ''}Sections (lot ${batchNum}) :\n${sectionLines}\n\nRéponds UNIQUEMENT avec le JSON brut, sans texte avant ni après : [{"number":1,"companions":["Nom1"]},{"number":2,"companions":[]},...]`,
            }],
          })

          const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
          const assignments: { number: number; companions: string[] }[] = JSON.parse(extractJson(raw))

          for (const a of assignments) {
            const sectionId = sectionById.get(a.number)
            if (!sectionId || !a.companions?.length) continue
            const ids = a.companions
              .map((name: string) => companionIdByName.get(name.toLowerCase()))
              .filter(Boolean) as string[]
            if (!ids.length) continue
            const { error } = await supabaseAdmin.from('sections').update({ companion_npc_ids: ids }).eq('id', sectionId)
            if (!error) assigned += ids.length
          }

          send({ type: 'progress', batch: batchNum, done: Math.min(i + BATCH, total), total })
        } catch (err: any) {
          failed++
          send({ type: 'warn', message: `⚠ Lot ${batchNum} échoué : ${err?.message}` })
        }
      }

      send({ type: 'done', assigned, failed })
      controller.close()
    }
  })

  return new NextResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
