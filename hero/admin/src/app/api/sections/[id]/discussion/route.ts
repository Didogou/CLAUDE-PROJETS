import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type Params = { params: Promise<{ id: string }> }

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTree(flatChoices: any[], parentId: string | null = null): any[] {
  return flatChoices
    .filter(c => c.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(c => ({
      id: c.id,
      player_text: c.player_text ?? '',
      emotion_label: c.emotion_label ?? '',
      npc_response: c.npc_response ?? '',
      npc_capitulation: c.npc_capitulation ?? undefined,
      target_section_id: c.target_section_id ?? undefined,
      condition_item: c.condition_item ?? undefined,
      sub_choices: buildTree(flatChoices, c.id),
    }))
}

async function insertChoicesRecursive(
  choices: any[],
  sceneId: string,
  parentId: string | null,
): Promise<void> {
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i]
    const { data: inserted, error } = await supabaseAdmin.from('discussion_choices').insert({
      scene_id: sceneId,
      parent_id: parentId,
      sort_order: i,
      player_text: c.player_text ?? null,
      emotion_label: c.emotion_label ?? null,
      npc_response: c.npc_response ?? null,
      npc_capitulation: c.npc_capitulation ?? null,
      target_section_id: c.target_section_id ?? null,
      condition_item: c.condition_item ?? null,
    }).select('id').single()

    if (error || !inserted) continue

    if (c.sub_choices?.length) {
      await insertChoicesRecursive(c.sub_choices, sceneId, inserted.id)
    }
  }
}

// ── GET /api/sections/[id]/discussion ─────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const { data: scene } = await supabaseAdmin
    .from('discussion_scenes')
    .select('*')
    .eq('section_id', id)
    .single()

  if (!scene) return NextResponse.json(null)

  const { data: flatChoices } = await supabaseAdmin
    .from('discussion_choices')
    .select('*')
    .eq('scene_id', scene.id)
    .order('sort_order')

  return NextResponse.json({
    scene_id: scene.id,
    npc_id: scene.npc_id,
    npc_opening: scene.npc_opening,
    outcome_thought: scene.outcome_thought,
    choices: buildTree(flatChoices ?? []),
  })
}

// ── PUT /api/sections/[id]/discussion ─────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const { npc_id, npc_opening, outcome_thought, choices = [] } = body

  // 1. Upsert discussion_scene
  const { data: scene, error: sceneErr } = await supabaseAdmin
    .from('discussion_scenes')
    .upsert({ section_id: id, npc_id, npc_opening, outcome_thought }, { onConflict: 'section_id' })
    .select('id')
    .single()

  if (sceneErr || !scene) return NextResponse.json({ error: sceneErr?.message }, { status: 500 })

  // 2. Supprimer les choix existants
  await supabaseAdmin.from('discussion_choices').delete().eq('scene_id', scene.id)

  // 3. Insérer les choix récursivement
  await insertChoicesRecursive(choices, scene.id, null)

  // 4. Mettre à jour le cache JSONB (pour le simulateur)
  await supabaseAdmin.from('sections')
    .update({ discussion_scene: { scene_id: scene.id, npc_id, npc_opening, outcome_thought, choices } })
    .eq('id', id)

  return NextResponse.json({ ok: true, scene_id: scene.id })
}

// ── DELETE /api/sections/[id]/discussion ──────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params

  await supabaseAdmin.from('discussion_scenes').delete().eq('section_id', id)
  await supabaseAdmin.from('sections').update({ discussion_scene: null }).eq('id', id)

  return NextResponse.json({ ok: true })
}
