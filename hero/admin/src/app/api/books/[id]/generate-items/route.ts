import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateText, extractJson } from '@/lib/ai-utils'
import { buildItemsPrompt } from '@/lib/prompts'

export const maxDuration = 60

const VALID_ITEM_TYPES = new Set(['soin', 'mana', 'arme', 'armure', 'outil', 'quete', 'grimoire'])

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const { data: book } = await supabaseAdmin
      .from('books')
      .select('title, theme, synopsis, book_summary, total_sections')
      .eq('id', id)
      .single()
    if (!book) return NextResponse.json({ error: 'Livre introuvable' }, { status: 404 })

    const synopsis = book.synopsis?.trim() || book.book_summary?.trim()
    if (!synopsis) return NextResponse.json({ error: 'Aucun synopsis disponible' }, { status: 400 })

    const totalSections: number = (book as any).total_sections ?? 20

    const system = 'Tu es un générateur de JSON. Ta réponse entière doit être du JSON brut valide. Aucun texte avant ou après.'
    const raw = await generateText('claude', system, buildItemsPrompt(book.title, book.theme, synopsis, totalSections), 2048)

    let itemsArr: any[]
    try {
      itemsArr = JSON.parse(extractJson(raw))
    } catch {
      return NextResponse.json({ error: `JSON invalide : ${raw.slice(0, 200)}` }, { status: 500 })
    }

    if (!Array.isArray(itemsArr) || itemsArr.length === 0) {
      return NextResponse.json({ error: 'Aucun item généré', raw: raw.slice(0, 300) }, { status: 500 })
    }

    const itemsToInsert = itemsArr
      .filter((it: any) => it.name && VALID_ITEM_TYPES.has(it.item_type))
      .map((it: any) => ({
        book_id: id,
        name: it.name,
        item_type: it.item_type,
        description: it.description ?? null,
        effect: it.effect ?? {},
        sections_used: [],
      }))

    if (itemsToInsert.length === 0) {
      return NextResponse.json({ error: 'Aucun item valide après filtrage', raw: raw.slice(0, 300) }, { status: 500 })
    }

    const { error: insertError } = await supabaseAdmin.from('items').insert(itemsToInsert)
    if (insertError) throw new Error(`Erreur insertion : ${insertError.message}`)

    return NextResponse.json({ items_count: itemsToInsert.length })
  } catch (err: any) {
    console.error('[generate-items]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
