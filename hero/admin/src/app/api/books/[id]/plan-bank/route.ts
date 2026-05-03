import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Section, Choice, SectionImage } from '@/types'

export const maxDuration = 30

/**
 * GET /api/books/[id]/plan-bank?currentSectionId=X
 *
 * Charge tous les items de la banque d'images pour le book + section courante.
 * Format de retour cohérent avec PlanBankItem (composant PlanBankPanel).
 *
 * Ordre de tri (cf project_plan_bank_order.md) :
 *   1. Plans de la section EN COURS (X)
 *   2. Transitions vers X (Choice.transition_image_url)
 *   3. Plans des autres sections (les + récents)
 *   4. Bank uploads (table bank_uploads)
 *
 * Cf décisions session 2026-05-03.
 */

// Type aligné sur PlanBankItem du composant client (pas d'import direct pour
// éviter les deps circulaires client→server).
interface PlanBankItem {
  id: string
  kind: 'image' | 'animation'
  thumbnailUrl: string
  videoUrl?: string
  lastFrameUrl?: string
  label?: string
  tags?: string[]
  source: 'current_section' | 'transition_to_current' | 'other_section' | 'bank_upload'
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** Convertit une SectionImage en PlanBankItem. */
function sectionImageToItem(
  img: SectionImage,
  sectionNumber: number,
  planIdx: number,
  source: PlanBankItem['source'],
): PlanBankItem | null {
  // Filtre : un plan sans média n'est pas affichable
  const isAnim = img.kind === 'animation'
  const thumbnailUrl = isAnim ? (img.first_frame_url ?? img.url) : img.url
  if (!thumbnailUrl) return null

  return {
    id: `s${sectionNumber}-p${planIdx}`,
    kind: isAnim ? 'animation' : 'image',
    thumbnailUrl,
    videoUrl: isAnim ? img.base_video_url : undefined,
    lastFrameUrl: isAnim ? img.last_frame_url : undefined,
    label: `Sec ${sectionNumber} / plan ${planIdx + 1}`,
    tags: img.tags
      ? [
          ...(img.tags.characters ?? []),
          ...(img.tags.effects ?? []),
          ...(img.tags.objects ?? []),
        ]
      : undefined,
    source,
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bookId } = await params
    const url = new URL(req.url)
    const currentSectionId = url.searchParams.get('currentSectionId')

    if (!bookId) {
      return NextResponse.json({ error: 'book id manquant' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // ── 1. Toutes les sections du book ────────────────────────────────────
    const { data: sections, error: secErr } = await supabase
      .from('sections')
      .select('id, number, images, location_id')
      .eq('book_id', bookId)
      .order('number', { ascending: true })

    if (secErr) throw new Error(`Sections fetch: ${secErr.message}`)

    const sectionList = (sections ?? []) as Pick<Section, 'id' | 'number' | 'images' | 'location_id'>[]
    const currentSection = currentSectionId
      ? sectionList.find(s => s.id === currentSectionId)
      : null

    // ── 2. Tous les choices avec target = currentSectionId (transitions amont) ──
    let transitions: Array<Pick<Choice, 'id' | 'section_id' | 'transition_image_url'>> = []
    if (currentSectionId) {
      const { data: choices, error: choErr } = await supabase
        .from('choices')
        .select('id, section_id, transition_image_url')
        .eq('target_section_id', currentSectionId)
        .not('transition_image_url', 'is', null)

      if (choErr) throw new Error(`Choices fetch: ${choErr.message}`)
      transitions = (choices ?? []) as typeof transitions
    }

    // ── 3. Bank uploads du book ───────────────────────────────────────────
    const { data: uploads, error: upErr } = await supabase
      .from('bank_uploads')
      .select('id, kind, url, first_frame_url, last_frame_url, name, tags, created_at')
      .eq('book_id', bookId)
      .order('created_at', { ascending: false })

    // bank_uploads peut ne pas exister encore en DB (migration 074 pas appliquée)
    // → on dégrade silencieusement, on log
    if (upErr) {
      console.warn('[plan-bank] bank_uploads fetch failed (migration 074 manquante ?):', upErr.message)
    }

    // ── Format des items ──────────────────────────────────────────────────
    const items: PlanBankItem[] = []

    // 1. Plans de la section EN COURS
    if (currentSection?.images) {
      for (let i = 0; i < currentSection.images.length; i++) {
        const it = sectionImageToItem(currentSection.images[i], currentSection.number, i, 'current_section')
        if (it) items.push(it)
      }
    }

    // 2. Transitions amont
    for (const c of transitions) {
      if (!c.transition_image_url) continue
      const sourceSec = sectionList.find(s => s.id === c.section_id)
      const sourceLabel = sourceSec ? `Sec ${sourceSec.number} → ici` : 'Transition'
      items.push({
        id: `trans-${c.id}`,
        kind: 'image',  // V1 : transition = image. Si plus tard on supporte transition vidéo, ajouter base_video_url à choices.
        thumbnailUrl: c.transition_image_url,
        label: sourceLabel,
        source: 'transition_to_current',
      })
    }

    // 3. Plans des autres sections (skip section en cours)
    for (const s of sectionList) {
      if (s.id === currentSectionId) continue
      if (!s.images || s.images.length === 0) continue
      for (let i = 0; i < s.images.length; i++) {
        const it = sectionImageToItem(s.images[i], s.number, i, 'other_section')
        if (it) items.push(it)
      }
    }

    // 4. Bank uploads
    if (uploads) {
      for (const u of uploads) {
        const isAnim = u.kind === 'animation'
        // Display tags = uniquement catégories sémantiques pertinentes pour
        // l'auteur (kind/location/manual_overrides sont des méta, à exclure).
        const displayTags = u.tags
          ? [
              ...(u.tags.characters ?? []),
              ...(u.tags.effects ?? []),
              ...(u.tags.objects ?? []),
            ].filter(Boolean) as string[]
          : undefined
        items.push({
          id: `bank-${u.id}`,
          kind: isAnim ? 'animation' : 'image',
          thumbnailUrl: isAnim ? (u.first_frame_url ?? u.url) : u.url,
          videoUrl: isAnim ? u.url : undefined,
          lastFrameUrl: isAnim ? u.last_frame_url : undefined,
          label: u.name ?? 'Upload',
          tags: displayTags && displayTags.length > 0 ? displayTags : undefined,
          source: 'bank_upload',
        })
      }
    }

    return NextResponse.json({ items })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[plan-bank GET]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
