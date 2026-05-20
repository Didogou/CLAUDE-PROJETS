/**
 * playable-items — modèle de données du preview "tout le livre" du Studio Section.
 *
 * Transforme les plans bruts (du endpoint /api/books/[id]/all-plans) en une
 * liste plate d'items lisibles par le player :
 *   - Plan animation → 1 item 'video' par séquence (avec videoUrl si générée)
 *   - Plan static → 1 item 'image' (avec imageUrl)
 *   - Plan conversation → ignoré V1 (pas de visuel chainable simple)
 *
 * L'ordre est : section.number ASC, plan.sort_order ASC, séquence.idx ASC.
 *
 * Le state machine du StickyPreviewPanel (commit B) utilise cette liste pour :
 *   - Auto-advance sur fin de vidéo
 *   - Stop forcé quand l'item suivant est de type 'image' (le user clique
 *     play pour avancer, conformément à la décision UX 2026-05-09)
 */

export type PlayableItem =
  | {
      kind: 'video'
      /** ID stable composé : `${planId}::seq-${idx}`. Garantit unicité globale. */
      id: string
      videoUrl: string
      firstFrameUrl: string | null
      lastFrameUrl: string | null
      /** Durée nominale (somme shots) ou réelle si chargée par le player. */
      duration: number
      trimStart?: number
      trimEnd?: number
      // Métadonnées pour affichage / sync timeline
      sectionId: string
      sectionNumber: number
      sectionTitle: string
      planId: string
      planOrder: number
      planTitle: string
      sequenceIdx: number
    }
  | {
      kind: 'image'
      /** ID stable : `${planId}::image`. */
      id: string
      imageUrl: string
      // Métadonnées
      sectionId: string
      sectionNumber: number
      sectionTitle: string
      planId: string
      planOrder: number
      planTitle: string
    }

interface ApiAllPlansRow {
  id: string
  book_id: string
  section_id: string
  sort_order: number
  type: 'static' | 'animation' | 'conversation'
  title: string | null
  data: Record<string, unknown> | null
  section_number: number
  section_title: string
}

interface AnimationDataShape {
  sequences?: Array<{
    id?: string
    duration?: number
    videoUrl?: string | null
    firstFrameUrl?: string | null
    lastFrameUrl?: string | null
    trimStart?: number
    trimEnd?: number
  }>
  imageUrl?: string | null  // base image du plan (fallback si aucune séquence générée)
  firstFrameUrl?: string | null
}

interface StaticDataShape {
  imageUrl?: string | null
}

/** Variante pour la section courante : prend les `Plan` déjà mappés (via
 *  mapApiPlanToPlan) + le n° et titre de la section, et produit les items.
 *  Évite de re-fetch un endpoint dédié quand on n'a besoin que de la section
 *  actuelle (mode preview restreint, décision UX 2026-05-09). */
export function mapSectionPlansToPlayableItems(
  plans: import('./types').Plan[],
  sectionId: string,
  sectionNumber: number,
  sectionTitle: string,
): PlayableItem[] {
  const items: PlayableItem[] = []
  for (const plan of plans) {
    const baseMeta = {
      sectionId,
      sectionNumber,
      sectionTitle,
      planId: plan.id,
      planOrder: plan.order,
      planTitle: plan.title,
    }
    if (plan.type === 'animation') {
      const sequences = plan.sequences ?? []
      let pushedAny = false
      sequences.forEach((s, idx) => {
        if (!s.videoUrl) return
        items.push({
          kind: 'video',
          id: `${plan.id}::seq-${idx}`,
          videoUrl: s.videoUrl,
          firstFrameUrl: s.firstFrameUrl ?? null,
          lastFrameUrl: s.lastFrameUrl ?? null,
          duration: s.duration ?? 0,
          trimStart: s.trimStart,
          trimEnd: s.trimEnd,
          sequenceIdx: idx,
          ...baseMeta,
        })
        pushedAny = true
      })
      if (!pushedAny && plan.thumb.url) {
        items.push({
          kind: 'image',
          id: `${plan.id}::image`,
          imageUrl: plan.thumb.url,
          ...baseMeta,
        })
      }
    } else if (plan.type === 'static' && plan.thumb.url) {
      items.push({
        kind: 'image',
        id: `${plan.id}::image`,
        imageUrl: plan.thumb.url,
        ...baseMeta,
      })
    }
    // 'conversation' ignoré V1
  }
  return items
}

/** Convertit la liste brute des rows /api/books/[id]/all-plans en items
 *  séquentiels lisibles par le player. Ignore les rows qui n'ont rien de
 *  visuel (= plan animation 0 séquence générée + 0 imageUrl, plan static
 *  sans imageUrl, plan conversation). */
export function mapPlansToPlayableItems(
  rows: ApiAllPlansRow[],
): PlayableItem[] {
  const items: PlayableItem[] = []

  for (const row of rows) {
    const planOrder = row.sort_order + 1  // 0-indexé BDD → 1-indexé UI
    const planTitle =
      row.title
      || (row.type === 'animation' ? 'Animation' : row.type === 'static' ? 'Image' : 'Dialogue')

    const baseMeta = {
      sectionId: row.section_id,
      sectionNumber: row.section_number,
      sectionTitle: row.section_title,
      planId: row.id,
      planOrder,
      planTitle,
    }

    if (row.type === 'animation') {
      const data = (row.data ?? {}) as AnimationDataShape
      const sequences = data.sequences ?? []
      // Séquences générées (= avec videoUrl) → items video
      let pushedAny = false
      sequences.forEach((s, idx) => {
        if (!s.videoUrl) return
        items.push({
          kind: 'video',
          id: `${row.id}::seq-${idx}`,
          videoUrl: s.videoUrl,
          firstFrameUrl: s.firstFrameUrl ?? null,
          lastFrameUrl: s.lastFrameUrl ?? null,
          duration: s.duration ?? 0,
          trimStart: s.trimStart,
          trimEnd: s.trimEnd,
          sequenceIdx: idx,
          ...baseMeta,
        })
        pushedAny = true
      })
      // Aucune séquence générée mais une imageUrl base → fallback image item
      if (!pushedAny && (data.firstFrameUrl ?? data.imageUrl)) {
        items.push({
          kind: 'image',
          id: `${row.id}::image`,
          imageUrl: (data.firstFrameUrl ?? data.imageUrl) as string,
          ...baseMeta,
        })
      }
    } else if (row.type === 'static') {
      const data = (row.data ?? {}) as StaticDataShape
      if (data.imageUrl) {
        items.push({
          kind: 'image',
          id: `${row.id}::image`,
          imageUrl: data.imageUrl,
          ...baseMeta,
        })
      }
    }
    // type 'conversation' : ignoré pour V1 (pas de visuel séquentiel)
  }

  return items
}
