import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const allowed: Record<string, any> = {}
    if ('content' in body) allowed.content = body.content
    if ('summary' in body) allowed.summary = body.summary
    if ('music_url' in body) allowed.music_url = body.music_url || null
    if ('image_url' in body) allowed.image_url = body.image_url || null
    if ('images' in body) allowed.images = body.images ?? []
    if ('reading_time' in body) allowed.reading_time = body.reading_time ?? null
    if ('decision_time' in body) allowed.decision_time = body.decision_time ?? null
    if ('companion_npc_ids' in body) allowed.companion_npc_ids = body.companion_npc_ids ?? []
    if ('continues_timer' in body) allowed.continues_timer = !!body.continues_timer
    if ('dialogues' in body) allowed.dialogues = body.dialogues ?? []
    if ('hint_text' in body) allowed.hint_text = body.hint_text ?? null
    if ('player_questions' in body) allowed.player_questions = body.player_questions ?? []
    if ('player_responses' in body) allowed.player_responses = body.player_responses ?? {}
    if ('conv_first_npc_id' in body) allowed.conv_first_npc_id = body.conv_first_npc_id ?? null
    if ('status' in body) {
      if (!['draft', 'in_progress', 'validated'].includes(body.status)) {
        return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
      }
      allowed.status = body.status
    }

    const { error } = await supabaseAdmin
      .from('sections')
      .update(allowed)
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
