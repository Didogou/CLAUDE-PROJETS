/**
 * Library — types V0 mock pour les tuiles livres.
 *
 * Représente le minimum nécessaire pour une carte livre dans la grille.
 * Sera enrichi/typé via le retour de `GET /api/books` quand on branchera
 * la BDD (Phase C). Cf `Book` dans `src/types/index.ts` pour le full type
 * en BDD — on en utilisera un sous-ensemble.
 */

export type BookStatus = 'draft' | 'published' | 'archived'

/** Phase = workflow step (correspond à `book.phase` côté BDD).
 *  Aligné avec `BookPhase` de src/types/index.ts. */
export type BookPhase =
  | 'draft'
  | 'structure_generated'
  | 'structure_validated'
  | 'writing'
  | 'done'

export interface BookSummary {
  id: string
  title: string
  /** Synopsis 1 ligne pour la carte (excerpt). */
  synopsis?: string | null
  /** URL de la cover (placeholder si null). */
  coverUrl?: string | null
  status: BookStatus
  phase?: BookPhase
  /** Nombre de sections (count agrégé côté API ou calculé localement). */
  numSections: number
  /** Date de mise à jour (ISO) pour le tri "récent en premier". */
  updatedAt?: string | null
  /** Univers narratif (sci-fi, fantasy, polar, etc.) — affiché en tag.
   *  Mappé depuis `book.context_type` (Aventure / Intrigue / Sci-Fi / etc.). */
  universe?: string | null
}

/** Mapping de la réponse `GET /api/books` vers BookSummary (pour la grille). */
export function mapApiBookToSummary(apiBook: {
  id: string
  title: string
  synopsis?: string | null
  cover_image_url?: string | null
  status?: string
  phase?: string | null
  context_type?: string
  num_sections?: number
  updated_at?: string | null
}): BookSummary {
  return {
    id: apiBook.id,
    title: apiBook.title,
    synopsis: apiBook.synopsis ?? null,
    coverUrl: apiBook.cover_image_url ?? null,
    status: (apiBook.status as BookStatus) ?? 'draft',
    phase: (apiBook.phase as BookPhase) ?? undefined,
    numSections: apiBook.num_sections ?? 0,
    updatedAt: apiBook.updated_at ?? null,
    universe: apiBook.context_type ?? null,
  }
}
