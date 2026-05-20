/**
 * Studio Creator — types V0 mock pour les tuiles sections.
 *
 * Un sous-ensemble léger de `Section` (cf src/types/index.ts) — juste ce
 * dont la grille a besoin. Sera enrichi via le retour de `GET /api/books/{id}`
 * quand on branchera la BDD (Phase C).
 */

export type SectionStatusKey = 'draft' | 'in_progress' | 'validated'
export type SectionTypeKey = 'narration' | 'combat' | 'dialogue' | 'puzzle' | 'choice' | 'ending'

export interface SectionSummary {
  id: string
  /** Numéro dans le livre (1, 2, 3…) — affiché en §NN. */
  number: number
  /** Titre court éditable (1 ligne). Optionnel : si null, on affiche §NN seul. */
  title?: string | null
  /** Type narratif (drive icône + couleur tag). Default : narration. */
  type?: SectionTypeKey
  /** Status workflow (drive le badge). */
  status: SectionStatusKey
  /** 1 ligne d'aperçu, max 12 mots (cf field `summary` du legacy). */
  summary?: string | null
  /** URL miniature (typiquement `images[0].url` du legacy). */
  thumbUrl?: string | null
  /** Nombre de Plans (V0 : approximé par `images.length` côté API tant que
   *  le nouveau schéma `Section.plans[]` n'existe pas en BDD). */
  numPlans: number
  /** True si c'est une fin (victory/death). Affiche un marker spécifique. */
  isEnding?: boolean
}

/** Configuration UI par type de section (icône + label + couleur). */
export interface SectionTypeOption {
  type: SectionTypeKey
  icon: string
  label: string
  color: string
}

export const SECTION_TYPE_OPTIONS: SectionTypeOption[] = [
  { type: 'narration', icon: '📖', label: 'Narration',   color: '#A1A1AA' },
  { type: 'combat',    icon: '⚔', label: 'Combat',      color: '#EF4444' },
  { type: 'dialogue',  icon: '💬', label: 'Dialogue',    color: '#A78BFA' },
  { type: 'puzzle',    icon: '🧩', label: 'Énigme',      color: '#F59E0B' },
  { type: 'choice',    icon: '⚖', label: 'Choix',       color: '#F472B6' },
  { type: 'ending',    icon: '🏁', label: 'Fin',         color: '#10B981' },
]

export const SECTION_TYPE_BY_KEY: Record<SectionTypeKey, SectionTypeOption> =
  Object.fromEntries(SECTION_TYPE_OPTIONS.map(o => [o.type, o])) as Record<SectionTypeKey, SectionTypeOption>

export const SECTION_STATUS_LABEL: Record<SectionStatusKey, string> = {
  draft: 'Brouillon',
  in_progress: 'En cours',
  validated: 'Validé',
}

/** Mapping `section` du `GET /api/books/{id}` vers SectionSummary.
 *  - title : extrait de `summary` (1 ligne max 12 mots) ou fallback "Section N"
 *  - type : dérivé heuristiquement depuis trial / discussion_scene / is_ending
 *  - numPlans : V0 proxy = images.length (legacy). À refacto quand le nouveau
 *    schéma `Section.plans[]` existera.
 *  - thumbUrl : `images[0].url` si dispo. */
export function mapApiSectionToSummary(apiSection: {
  id: string
  number: number
  summary?: string | null
  content?: string
  status?: string
  is_ending?: boolean
  trial?: { type?: string } | null
  discussion_scene?: unknown
  images?: { url?: string }[]
}): SectionSummary {
  // Heuristique type — narration par défaut, ending si flag, combat/dialogue/puzzle si signaux
  let type: SectionTypeKey = 'narration'
  if (apiSection.is_ending) type = 'ending'
  else if (apiSection.discussion_scene) type = 'dialogue'
  else if (apiSection.trial?.type === 'combat') type = 'combat'
  else if (apiSection.trial?.type) type = 'puzzle'

  return {
    id: apiSection.id,
    number: apiSection.number,
    title: apiSection.summary ?? null,
    type,
    status: (apiSection.status as SectionStatusKey) ?? 'draft',
    summary: apiSection.summary ?? null,
    thumbUrl: apiSection.images?.[0]?.url ?? null,
    numPlans: apiSection.images?.length ?? 0,
    isEnding: apiSection.is_ending ?? false,
  }
}
