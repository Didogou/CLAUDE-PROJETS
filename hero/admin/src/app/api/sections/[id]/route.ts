import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const allowed: Record<string, any> = {}
    if ('content' in body) allowed.content = body.content
    if ('summary' in body) allowed.summary = body.summary
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
