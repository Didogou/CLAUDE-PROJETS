import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 30

/**
 * POST /api/books/[id]/bank-uploads
 *
 * Crée une entrée dans `bank_uploads` (Phase 3b — uploads externes pour la banque
 * du Studio Designer).
 *
 * Body :
 *   {
 *     kind: 'image' | 'animation',
 *     url: string,                    // URL Supabase de l'asset uploadé
 *     first_frame_url?: string,       // si kind='animation' (extrait via helper client)
 *     last_frame_url?: string,        // si kind='animation'
 *     name?: string,                  // nom affiché (ex: nom du fichier sans ext)
 *     tags?: PlanTags,                // tags initiaux (vides V1, suggestion Qwen VL en V2)
 *     source?: 'upload' | 'fetch_url'
 *   }
 *
 * Retour : { id, ...row }
 *
 * Cf migration 074 + project_plan_bank_order.md.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bookId } = await params
    const body = await req.json() as {
      kind?: 'image' | 'animation'
      url?: string
      first_frame_url?: string
      last_frame_url?: string
      name?: string
      tags?: Record<string, unknown>
      source?: 'upload' | 'fetch_url'
    }

    if (!bookId) {
      return NextResponse.json({ error: 'book id manquant' }, { status: 400 })
    }
    const kind = body.kind ?? 'image'
    if (!body.url) {
      return NextResponse.json({ error: 'url requise' }, { status: 400 })
    }
    if (!['image', 'animation'].includes(kind)) {
      return NextResponse.json({ error: 'kind invalide (image|animation)' }, { status: 400 })
    }
    if (kind === 'animation' && !body.first_frame_url) {
      // Soft warning : on accepte mais sans first_frame, la vignette banque
      // tombera sur l'URL du MP4 (pas optimal mais fonctionnel)
      console.warn('[bank-uploads POST] kind=animation sans first_frame_url')
    }

    const { data, error } = await supabaseAdmin
      .from('bank_uploads')
      .insert({
        book_id:         bookId,
        kind,
        url:             body.url,
        first_frame_url: body.first_frame_url ?? null,
        last_frame_url:  body.last_frame_url ?? null,
        name:            body.name ?? null,
        tags:            body.tags ?? {},
        source:          body.source ?? 'upload',
      })
      .select()
      .single()

    if (error) throw new Error(`bank_uploads insert: ${error.message}`)

    return NextResponse.json({ success: true, ...data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bank-uploads POST]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/books/[id]/bank-uploads?uploadId=X
 *
 * Supprime une entrée de bank_uploads. Ne supprime PAS le fichier dans
 * Supabase Storage (cleanup async séparé V2).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bookId } = await params
    const url = new URL(req.url)
    const uploadId = url.searchParams.get('uploadId')

    if (!bookId || !uploadId) {
      return NextResponse.json({ error: 'bookId + uploadId requis' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('bank_uploads')
      .delete()
      .eq('id', uploadId)
      .eq('book_id', bookId)  // double check : ne supprime que si l'upload appartient au book

    if (error) throw new Error(`bank_uploads delete: ${error.message}`)
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bank-uploads DELETE]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
