import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 60

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const allowed: Record<string, any> = {}
  if ('name' in body) allowed.name = body.name
  if ('narrative_text' in body) allowed.narrative_text = body.narrative_text
  if ('narrative_text_npc' in body) allowed.narrative_text_npc = body.narrative_text_npc ?? null
  if ('hint_text' in body) allowed.hint_text = body.hint_text ?? null
  if ('bonus_malus' in body) allowed.bonus_malus = body.bonus_malus
  if ('damage' in body) allowed.damage = body.damage
  if ('is_parry' in body) allowed.is_parry = body.is_parry
  if ('paired_move_id' in body) allowed.paired_move_id = body.paired_move_id ?? null
  if ('is_contextual' in body) allowed.is_contextual = body.is_contextual
  if ('prop_required' in body) allowed.prop_required = body.prop_required ?? null
  if ('weapon_type' in body) allowed.weapon_type = body.weapon_type ?? null
  if ('combat_image_type' in body) allowed.combat_image_type = body.combat_image_type ?? null
  if ('sort_order' in body) allowed.sort_order = body.sort_order
  if ('icon_url' in body) allowed.icon_url = body.icon_url ?? null
  const { error } = await supabaseAdmin.from('combat_moves').update(allowed).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('combat_moves').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
