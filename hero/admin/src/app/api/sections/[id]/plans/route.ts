import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { SectionImage, PlanTags } from '@/types'

export const maxDuration = 30

/**
 * POST /api/sections/[id]/plans
 *
 * Pousse un plan dans la section. 2 modes :
 *   - APPEND (défaut) : si pas de `planIndex` dans le body → ajoute en fin
 *   - UPDATE : si `planIndex` fourni → remplace `images[planIndex]` (utile
 *     pour le Dev-Studio où les plans sont pré-créés à init)
 *
 * Body :
 *   {
 *     planIndex?: number,              // mode UPDATE si fourni
 *     kind?: 'image' | 'animation',    // défaut 'image'
 *     url?: string,                    // optionnel en update partiel
 *     base_video_url?: string,
 *     first_frame_url?: string,
 *     last_frame_url?: string,
 *     prompt_fr?: string,
 *     tags?: PlanTags,
 *     // Champs additionnels pour merge en mode UPDATE :
 *     description?: string,
 *     comfyui_settings?: SectionImage['comfyui_settings'],
 *   }
 *
 * En mode UPDATE : merge body sur l'existant (pas d'écrasement complet).
 * En mode APPEND : créé un nouveau plan (url requise).
 *
 * Auto-tag à la création (cf project_plan_tags_strategy.md).
 * Note : pas de transaction / lock. Read-modify-write naïf, OK V1 single-user.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sectionId } = await params
    const body = await req.json() as {
      planIndex?: number
      kind?: 'image' | 'animation'
      url?: string
      base_video_url?: string
      first_frame_url?: string
      last_frame_url?: string
      prompt_fr?: string
      tags?: Partial<PlanTags>
      description?: string
      comfyui_settings?: SectionImage['comfyui_settings']
    }

    if (!sectionId) {
      return NextResponse.json({ error: 'section id manquant' }, { status: 400 })
    }

    const isUpdateMode = typeof body.planIndex === 'number'

    // En APPEND : url requise (on crée un nouveau plan from scratch)
    // En UPDATE : url optionnelle (on merge sur l'existant)
    if (!isUpdateMode && !body.url) {
      return NextResponse.json({ error: 'url requise en mode APPEND' }, { status: 400 })
    }

    // En APPEND, défaut 'image'. En UPDATE, on prendra existing.kind après
    // avoir lu la section (ne pas forcer 'image' qui basculerait une animation
    // existante en image au moindre patch sans kind).
    if (!isUpdateMode && body.kind === 'animation' && !body.base_video_url) {
      return NextResponse.json(
        { error: 'base_video_url requis pour kind=animation (mode APPEND)' },
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

    let newImages: SectionImage[]
    let resultIndex: number
    let resultPlan: SectionImage

    if (isUpdateMode) {
      // ── MODE UPDATE : merge sur images[planIndex] ──────────────────────
      const idx = body.planIndex!
      if (idx < 0 || idx >= currentImages.length) {
        return NextResponse.json(
          { error: `planIndex ${idx} hors range (section a ${currentImages.length} plan(s))` },
          { status: 400 },
        )
      }
      const existing = currentImages[idx]
      // Kind résolu : body > existing > 'image' par défaut
      const resolvedKind: 'image' | 'animation' = body.kind ?? existing.kind ?? 'image'
      const mergedTags: PlanTags = {
        kind: resolvedKind,
        sections: existing.tags?.sections ?? [sectionId],
        location: existing.tags?.location ?? section.location_id ?? null,
        characters: body.tags?.characters ?? existing.tags?.characters ?? [],
        effects: body.tags?.effects ?? existing.tags?.effects ?? [],
        objects: body.tags?.objects ?? existing.tags?.objects ?? [],
        manual_overrides: body.tags?.manual_overrides ?? existing.tags?.manual_overrides ?? [],
      }
      // Merge field-by-field, body écrase l'existant uniquement si défini
      const merged: SectionImage = {
        ...existing,
        ...(body.url !== undefined && { url: body.url }),
        ...(body.kind !== undefined && { kind: body.kind }),
        ...(body.base_video_url !== undefined && { base_video_url: body.base_video_url }),
        ...(body.first_frame_url !== undefined && { first_frame_url: body.first_frame_url }),
        ...(body.last_frame_url !== undefined && { last_frame_url: body.last_frame_url }),
        ...(body.prompt_fr !== undefined && { prompt_fr: body.prompt_fr }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.comfyui_settings !== undefined && { comfyui_settings: body.comfyui_settings }),
        tags: mergedTags,
      }
      newImages = [...currentImages.slice(0, idx), merged, ...currentImages.slice(idx + 1)]
      resultIndex = idx
      resultPlan = merged
    } else {
      // ── MODE APPEND : ajoute en fin ────────────────────────────────────
      const kind = body.kind ?? 'image'
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
        description: body.description,
        comfyui_settings: body.comfyui_settings,
        tags: autoTags,
      }
      newImages = [...currentImages, newPlan]
      resultIndex = newImages.length - 1
      resultPlan = newPlan
    }

    // ── 2. Update section ─────────────────────────────────────────────────
    const { error: updErr } = await supabaseAdmin
      .from('sections')
      .update({ images: newImages })
      .eq('id', sectionId)

    if (updErr) throw new Error(`Section update: ${updErr.message}`)

    return NextResponse.json({
      success: true,
      mode: isUpdateMode ? 'update' : 'append',
      planIndex: resultIndex,
      plan: resultPlan,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sections/[id]/plans POST]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
