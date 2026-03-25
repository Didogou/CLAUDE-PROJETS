import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { section_id, label, target_section_id, sort_order, is_back } = body
    if (!section_id || !label) return NextResponse.json({ error: 'section_id et label requis' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('choices')
      .insert({
        section_id,
        label,
        target_section_id: target_section_id || null,
        sort_order: sort_order ?? 0,
        requires_trial: false,
        is_back: is_back ?? false,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
