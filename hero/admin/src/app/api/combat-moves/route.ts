import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.combat_type_id) return NextResponse.json({ error: 'combat_type_id requis' }, { status: 400 })
  if (!body.name) return NextResponse.json({ error: 'name requis' }, { status: 400 })
  if (!body.narrative_text) return NextResponse.json({ error: 'narrative_text requis' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('combat_moves')
    .insert({
      combat_type_id: body.combat_type_id,
      name: body.name,
      narrative_text: body.narrative_text,
      narrative_text_npc: body.narrative_text_npc ?? null,
      hint_text: body.hint_text ?? null,
      bonus_malus: body.bonus_malus ?? 0,
      damage: body.damage ?? 1,
      is_parry: body.is_parry ?? false,
      paired_move_id: body.paired_move_id ?? null,
      is_contextual: body.is_contextual ?? false,
      prop_required: body.prop_required ?? null,
      sort_order: body.sort_order ?? 0,
      move_type: body.move_type ?? 'attack',
      creates_state: body.creates_state ?? null,
      required_state: body.required_state ?? null,
      required_self_state: body.required_self_state ?? null,
      narrative_on_hit: body.narrative_on_hit ?? null,
      narrative_on_miss: body.narrative_on_miss ?? null,
      icon_url: body.icon_url ?? null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ combat_move: data })
}
