/**
 * Studio Section — types du nouveau modèle (2026-05-05).
 *
 * Architecture validée après refonte fondamentale :
 *   Section ─→ Plans[] (timeline storyboard)
 *               └─ type : 'static' | 'animation' | 'conversation'
 *
 * REMPLACE : l'ancien modèle où une Section avait 1 Plan unique avec des
 * `pellicules[]` à l'intérieur. Maintenant chaque "pellicule" devient un Plan
 * de premier ordre.
 *
 * Phase 0 = mock data en local state. La persistance Supabase viendra après
 * que le UI soit validé sur le mockup.
 */

export type PlanType = 'static' | 'animation' | 'conversation' | 'choice'

/** Métadonnées affichées dans la cellule timeline + l'inspecteur. */
export interface PlanThumb {
  /** URL de l'image de thumbnail (preview cellule). Null = placeholder. */
  url: string | null
  /** Pour Animation : URL du firstFrame (vidéo de la 1re séquence générée). */
  firstFrameUrl?: string | null
}

/** Stat affichée en chip dans la cellule (séquences, choix attachés…). */
export interface PlanChip {
  label: string
  /** Couleur sémantique (music = teal, choice = pink, etc.) */
  kind?: 'neutral' | 'music' | 'choice' | 'effect'
}

/** Vignette d'un personnage présent dans le plan. */
export interface PlanCharacter {
  id: string
  name: string
  /** URL portrait (carré, idéalement 64×64+). Si null → fallback initiale. */
  portraitUrl?: string | null
}

/** Vignette d'un objet présent sur la scène du plan. */
export interface PlanItem {
  id: string
  name: string
  /** URL icône (idéalement 32×32+). Si null → fallback emoji 📦. */
  iconUrl?: string | null
}

/** Séquence (= "pellicule") d'un Plan animation. Contient les URLs nécessaires
 *  au preview vidéo + les bornes de trim appliquées dans l'AnimationStudio. */
export interface PlanSequence {
  /** Identifiant stable (généralement l'id pellicule du AnimationStudio). */
  id: string
  videoUrl: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  /** Durée nominale en secondes (somme des shots). Fallback si videoMetadata
   *  pas chargée encore. */
  duration: number
  trimStart?: number
  trimEnd?: number
}

/** Une entrée du storyboard de la Section. */
export interface Plan {
  id: string
  type: PlanType
  /** Numéro d'ordre dans la timeline (1-indexed pour affichage P1, P2…). */
  order: number
  /** Titre court éditable par l'auteur (ex: "Travis entre dans le bar"). */
  title: string
  /** Résumé court du plan (1-2 lignes). Anciennement `section.images[].description`
   *  côté legacy. À migrer en colonne BDD `plans.summary`. */
  summary?: string | null
  /** Durée affichée dans la cellule. Pour static = "∞ → choix" si exit choices,
   *  pour animation = somme des séquences, pour conversation = "var.". */
  durationLabel: string
  /** Thumbnail pour la preview cellule. */
  thumb: PlanThumb
  /** Chips de stats sous le titre (séquences, choix, musique…). */
  chips: PlanChip[]
  /** Personnages présents dans ce Plan (vignettes affichées sous l'image). */
  characters?: PlanCharacter[]
  /** Objets présents sur la scène du Plan (vignettes affichées sous l'image). */
  items?: PlanItem[]
  // ── Champs spécifiques par type (optionnels, lecture par le Designer) ──
  /** Animation : nombre de séquences internes. */
  sequenceCount?: number
  /** Animation : séquences détaillées (videoUrl + trim). Utilisé par le
   *  StickyPreviewPanel pour rendre la vraie vidéo + crossfade. */
  sequences?: PlanSequence[]
  /** Static : true si l'effet "Choix" est attaché (affiche les section.choices). */
  hasChoiceEffect?: boolean
  /** Effets visuels actifs (rain, snow, fog…). */
  effectPreset?: string | null
  /** Conversation : nombre de nœuds de dialogue + branches. */
  conversationNodes?: number
  conversationBranches?: number
  /** URL de la musique de fond attachée à ce Plan (peut être héritée d'une
   *  piste musique de section qui span plusieurs Plans). */
  musicUrl?: string | null
  musicLabel?: string
  /** Personnages présents dans ce Plan (IDs — V0 legacy, à dépréciér au
   *  profit de `characters` qui transporte les vignettes complètes). */
  characterIds?: string[]
}

/** Un bloc de musique posé sur la piste musique de la timeline section.
 *  Peut couvrir 1 ou plusieurs Plans (spanning). */
export interface SectionMusicBlock {
  id: string
  /** Index du Plan où la musique commence (inclusif). */
  fromPlanIdx: number
  /** Index du Plan où la musique se termine (inclusif). */
  toPlanIdx: number
  url: string
  label: string
}

/** La Section telle que vue par Studio Section (pas le full Section type
 *  de l'ancien admin — juste ce qui sert au UI Storyboard pour l'instant).
 *  À enrichir/typer pleinement quand on connectera Supabase. */
export interface SectionSnapshot {
  id: string
  number: number
  title: string
  bookTitle: string
  plans: Plan[]
  musicBlocks: SectionMusicBlock[]
  /** Stats agrégées calculées côté UI (estimation durée totale, etc.). */
  totalDurationLabel: string
  // ── Settings existants à préserver (cf inventaire ancien admin) ──
  readingTime?: number | null
  decisionTime?: number | null
}

/** Définition d'un type de Plan pour le dropdown "+" (label, icône, couleur). */
export interface PlanTypeOption {
  type: PlanType
  label: string
  icon: string
  description: string
  /** Variable CSS pour la couleur d'accent du type. */
  colorVar: string
}

export const PLAN_TYPE_OPTIONS: PlanTypeOption[] = [
  {
    type: 'static',
    label: 'Image fixe',
    icon: '🖼',
    description: 'Pause, écran de choix, illustration',
    colorVar: '--ss-static',
  },
  {
    type: 'animation',
    label: 'Animation',
    icon: '🎬',
    description: 'Une ou plusieurs séquences vidéo',
    colorVar: '--ss-anim',
  },
  {
    type: 'conversation',
    label: 'Conversation',
    icon: '💬',
    description: 'Arbre de dialogue avec NPC',
    colorVar: '--ss-conv',
  },
  {
    type: 'choice',
    label: 'Plan choix',
    icon: '🎯',
    description: 'Écran de décision : image + options à cliquer',
    colorVar: '--ss-choice',
  },
]

export const PLAN_TYPE_BY_KEY: Record<PlanType, PlanTypeOption> =
  Object.fromEntries(PLAN_TYPE_OPTIONS.map(o => [o.type, o])) as Record<PlanType, PlanTypeOption>

// ──────────────────────────────────────────────────────────────────────────
// Mapping row BDD `plans` → UI Plan (Phase B.4 wiring real data).
// Le contenu `data` JSONB est type-spécifique : on en dérive les champs
// d'affichage (durationLabel, chips, thumb...). Tant que `data` est vide
// (Plan fraichement créé), on retombe sur des défauts génériques.
// ──────────────────────────────────────────────────────────────────────────

interface ApiPlanRow {
  id: string
  book_id: string
  section_id: string
  sort_order: number
  type: PlanType
  title: string | null
  data: Record<string, unknown> | null
  // Phase 076 — colonnes top-level (depuis migration 076_plans_summary_refs.sql)
  summary?: string | null
  npc_ids?: string[] | null
  item_ids?: string[] | null
  // Phase 076 — hydraté côté API (joint sur npcs/items)
  characters?: PlanCharacter[]
  items?: PlanItem[]
}

interface StaticPlanData {
  imageUrl?: string | null
  effects?: { kind?: string }[]
  characterIds?: string[]
}
interface AnimationPlanData {
  sequences?: {
    id?: string
    duration?: number
    videoUrl?: string | null
    firstFrameUrl?: string | null
    lastFrameUrl?: string | null
    trimStart?: number
    trimEnd?: number
  }[]
  musicUrl?: string | null
}
interface ConversationPlanData {
  scene?: { choices?: unknown[] } | null
}
/** Données d'un Plan choix (kind='choice') — refonte 2026-05-11 Step 3b.
 *  Variant 'image' = écran de décision avec image fixe + markers positionnés.
 *  L'image est éditée via Studio Designer + nouvel outil "Choix" pour drag-drop. */
interface ChoicePlanData {
  variant?: 'image' | 'conversation'
  imageUrl?: string | null
  imageEffect?: 'none' | 'blur' | 'vignette' | 'glow'
  /** Markers de choix positionnés sur l'image. */
  options?: Array<{
    id: string
    /** Position normalisée 0-1 (x = horizontal, y = vertical). */
    position: { x: number; y: number }
    /** Source : 'section' (réf Section choice) ou 'plan' (choix interne). */
    source:
      | { kind: 'section'; section_choice_id: string }
      | { kind: 'plan'; label: string; target_plan_index: number }
  }>
}

/** Champs communs à tous types de Plan dans le data JSONB :
 *  summary, characters[], items[]. À termes ces 3 champs migreront en colonnes
 *  BDD top-level (cf migration 076 à venir). */
interface CommonPlanData {
  summary?: string | null
  characters?: PlanCharacter[]
  items?: PlanItem[]
}

export function mapApiPlanToPlan(row: ApiPlanRow): Plan {
  const data = (row.data ?? {}) as CommonPlanData & Record<string, unknown>
  const order = row.sort_order + 1   // 0-indexé en BDD, 1-indexé en UI (P1, P2…)
  const titleFallback: Record<PlanType, string> = {
    static: 'Image fixe',
    animation: 'Animation',
    conversation: 'Dialogue',
    choice: 'Plan choix',
  }
  const title = row.title || titleFallback[row.type]
  // Champs communs : depuis 076 ils sont en colonnes top-level (summary)
  // et hydratés par l'API via join (characters/items). Fallback data JSONB
  // pour back-compat des appels qui n'ont pas l'hydratation.
  const summary = row.summary ?? data.summary ?? null
  const characters = row.characters
    ?? (Array.isArray(data.characters) ? data.characters : [])
  const items = row.items
    ?? (Array.isArray(data.items) ? data.items : [])

  // Derive type-specific UI fields
  if (row.type === 'static') {
    const sd = data as unknown as StaticPlanData
    const effectCount = (sd.effects ?? []).length
    return {
      id: row.id,
      type: 'static',
      order,
      title,
      summary,
      durationLabel: '∞',  // static = jusqu'au choix joueur (settings section)
      thumb: { url: sd.imageUrl ?? null },
      chips: effectCount > 0 ? [{ label: `${effectCount} effet${effectCount > 1 ? 's' : ''}`, kind: 'effect' }] : [],
      characters,
      items,
      effectPreset: null,
      characterIds: sd.characterIds ?? [],
    }
  }
  if (row.type === 'animation') {
    const ad = data as unknown as AnimationPlanData & { imageUrl?: string | null; firstFrameUrl?: string | null }
    const sequences = ad.sequences ?? []
    const totalDur = sequences.reduce((a, s) => a + (s.duration ?? 0), 0)
    // Fallback chain pour la thumb : firstFrame de la 1re séquence > firstFrame
    // top-level (legacy) > imageUrl base (sauvée depuis Designer) > null.
    const firstFrameUrl = sequences[0]?.firstFrameUrl
      ?? ad.firstFrameUrl
      ?? ad.imageUrl
      ?? null
    const chips: Plan['chips'] = []
    if (sequences.length > 0) chips.push({ label: `${sequences.length} séq.`, kind: 'neutral' })
    if (ad.musicUrl) chips.push({ label: '♪', kind: 'music' })
    return {
      id: row.id,
      type: 'animation',
      order,
      title,
      summary,
      durationLabel: totalDur > 0 ? `${totalDur}s` : '—',
      thumb: { url: firstFrameUrl, firstFrameUrl },
      chips,
      characters,
      items,
      sequenceCount: sequences.length,
      sequences: sequences.map((s, i) => ({
        id: s.id ?? `seq-${i}`,
        videoUrl: s.videoUrl ?? null,
        firstFrameUrl: s.firstFrameUrl ?? null,
        lastFrameUrl: s.lastFrameUrl ?? null,
        duration: s.duration ?? 0,
        trimStart: s.trimStart,
        trimEnd: s.trimEnd,
      })),
      musicUrl: ad.musicUrl ?? null,
    }
  }
  if (row.type === 'choice') {
    // Plan choix (refonte 2026-05-11 Step 3) — écran de décision avec image
    // fixe (V1) + overlay options. variant='conversation' parqué V2+.
    const cd = data as unknown as ChoicePlanData
    const optsCount = cd.options?.length ?? 0
    const chips: Plan['chips'] = []
    if (optsCount > 0) chips.push({ label: `${optsCount} option${optsCount > 1 ? 's' : ''}`, kind: 'choice' })
    if (cd.imageEffect && cd.imageEffect !== 'none') chips.push({ label: cd.imageEffect, kind: 'effect' })
    return {
      id: row.id,
      type: 'choice',
      order,
      title,
      summary,
      durationLabel: '∞',  // un Plan choix attend une décision = pas de durée
      thumb: { url: cd.imageUrl ?? null },
      chips,
      characters,
      items,
    }
  }
  // type === 'conversation'
  const cd = data as unknown as ConversationPlanData
  const choiceCount = cd.scene?.choices?.length ?? 0
  return {
    id: row.id,
    type: 'conversation',
    order,
    title,
    summary,
    durationLabel: 'var.',
    thumb: { url: null },
    chips: choiceCount > 0
      ? [{ label: `${choiceCount} nœud${choiceCount > 1 ? 's' : ''}`, kind: 'neutral' }]
      : [],
    characters,
    items,
    conversationNodes: choiceCount,
    conversationBranches: 0,  // V0 — calcul plus fin quand on aura le tree
  }
}
