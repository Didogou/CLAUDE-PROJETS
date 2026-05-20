import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/** PATCH /api/npcs/[id]
 *  Aucune allowlist côté serveur — le legacy NpcTab PATCH des dizaines de
 *  champs (form complet, combat_v3, voice_settings, character_illustrations,
 *  portrait_emotions, name_image_settings, etc.). Mettre une allowlist ici
 *  casserait silencieusement ces flows. À sécuriser plus tard via une vraie
 *  RLS Supabase au lieu d'un filtre côté serveur. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as Record<string, unknown>
    const { data, error } = await supabaseAdmin
      .from('npcs')
      .update(body)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/npcs/:id PATCH]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('npcs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
