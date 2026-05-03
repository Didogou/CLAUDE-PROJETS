import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { SectionImage, PlanTags } from '@/types'

export const maxDuration = 30

/**
 * POST /api/sections/[id]/plans
 *
 * Ajoute un nouveau plan à la section. Le plan est append à la fin du tableau
 * `sections.images[]`. Retourne l'index du nouveau plan.
 *
 * Body :
 *   {
 *     kind: 'image' | 'animation',
 *     url: string,                    // image (kind='image') OU 1ère frame (kind='animation')
 *     base_video_url?: string,        // si kind='animation'
 *     first_frame_url?: string,       // si kind='animation'
 *     last_frame_url?: string,        // si kind='animation'
 *     prompt_fr?: string,
 *     tags?: PlanTags
 *   }
 *
 * Auto-tag à la création (cf project_plan_tags_strategy.md) :
 *   - tags.kind = body.kind
 *   - tags.sections = [sectionId] (ajout du parent)
 *   - tags.location = section.location_id
 *   - le reste vient du body (effects, characters, objects vides V1)
 *
 * Note : pas de transaction / lock. Read-modify-write naïf, OK pour single-user V1.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sectionId } = await params
    const body = await req.json() as {
      kind?: 'image' | 'animation'
      url?: string
      base_video_url?: string
      first_frame_url?: string
      last_frame_url?: string
      prompt_fr?: string
      tags?: Partial<PlanTags>
    }

    if (!sectionId) {
      return NextResponse.json({ error: 'section id manquant' }, { status: 400 })
    }
    const kind = body.kind ?? 'image'
    if (!body.url) {
      return NextResponse.json({ error: 'url requise' }, { status: 400 })
    }
    if (kind === 'animation' && !body.base_video_url) {
      return NextResponse.json(
        { error: 'base_video_url requis pour kind=animation' },
        { status: 400 },
      )
    }

    // ── 1. Lit la section actuelle ────────────────────────────────────────
    const { data: section, error: getErr } = await supabaseAdmin
      .from('sections')
      .select('id, images, location_id')
      .eq('id', sectionId)
      .single()

    if (getErr) throw new Error(`Section fetch: ${getErr.message}`)
    if (!section) {
      return NextResponse.json({ error: 'section introuvable' }, { status: 404 })
    }

    const currentImages: SectionImage[] = (section.images as SectionImage[] | null) ?? []

    // ── 2. Build le nouveau plan + auto-tags ──────────────────────────────
    const autoTags: PlanTags = {
      kind,
      sections: [sectionId],
      location: section.location_id ?? null,
      characters: body.tags?.characters ?? [],
      effects: body.tags?.effects ?? [],
      objects: body.tags?.objects ?? [],
      manual_overrides: body.tags?.manual_overrides ?? [],
    }

    const newPlan: SectionImage = {
      url: body.url,
      kind,
      base_video_url: body.base_video_url,
      first_frame_url: body.first_frame_url,
      last_frame_url: body.last_frame_url,
      prompt_fr: body.prompt_fr,
      tags: autoTags,
    }

    // ── 3. Append + update ────────────────────────────────────────────────
    const newImages = [...currentImages, newPlan]
    const { error: updErr } = await supabaseAdmin
      .from('sections')
      .update({ images: newImages })
      .eq('id', sectionId)

    if (updErr) throw new Error(`Section update: ${updErr.message}`)

    return NextResponse.json({
      success: true,
      planIndex: newImages.length - 1,
      plan: newPlan,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sections/[id]/plans POST]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
