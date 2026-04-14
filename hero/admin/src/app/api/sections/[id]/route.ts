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
    if ('music_start_time' in body) allowed.music_start_time = body.music_start_time ?? null
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
    if ('items_on_scene' in body) allowed.items_on_scene = body.items_on_scene ?? []
    if ('conv_first_npc_id' in body) allowed.conv_first_npc_id = body.conv_first_npc_id ?? null
    if ('combat_type_id' in body) allowed.combat_type_id = body.combat_type_id ?? null
    if ('combat_props' in body) allowed.combat_props = body.combat_props ?? []
    if ('combat_image_url' in body) allowed.combat_image_url = body.combat_image_url || null
    if ('discussion_scene' in body) allowed.discussion_scene = body.discussion_scene ?? null
    if ('phrase_distribution' in body) allowed.phrase_distribution = body.phrase_distribution ?? null
    if ('location_id' in body) allowed.location_id = body.location_id ?? null
    if ('trial' in body) allowed.trial = body.trial
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
