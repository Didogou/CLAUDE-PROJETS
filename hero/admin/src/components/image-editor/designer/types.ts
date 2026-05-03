/**
 * Types partagés du Studio Designer (modèle 2 phases).
 *
 * Définit les shapes des données qui transitent entre les composants du
 * Designer pendant la phase de création de la base. Ces types sont stables
 * dans le temps : quand on branchera les vraies données (Phase 7+), seuls
 * les fournisseurs de données changeront, pas les composants consommateurs.
 *
 * Cf. project_designer_full_vision_2phases.md pour la vision complète.
 */

import type { GenerationVariantStatus } from '../hooks/useImageGeneration'

/** Phase courante du Designer.
 * - 'creation' : User construit/choisit la base (banque + variantes + form)
 * - 'editing'  : Base figée, user édite calques/annotations/effets */
export type DesignerPhase = 'creation' | 'editing'

/** Une image disponible dans la banque (source utilisateur ou plans précédents). */
export interface BankImage {
  /** ID stable (UUID ou path Supabase) */
  id: string
  /** URL accessible (HTTPS) */
  url: string
  /** Thumbnail URL pour la grille (peut === url si pas de thumb) */
  thumbnailUrl?: string
  /** Tags pour filtre/recherche (ex: ['forêt', 'nuit', 'bar']) */
  tags?: string[]
  /** Nom court (ex: "forêt brumeuse · plan 12") */
  label?: string
  /** Date d'ajout (ISO) — pour tri */
  createdAt?: string
  /** Source : upload manuel, plan précédent, génération mise en banque */
  source?: 'upload' | 'plan' | 'generated'
}

/** Provenance d'une variante affichée dans le strip du drawer. */
export type VariantSource =
  | { kind: 'bank'; bankId: string }                        // pick depuis la banque
  | { kind: 'generated'; modelKey: string; modelLabel: string } // sortie d'un checkpoint

/** Une variante candidate à devenir la base du plan.
 * Wrapper autour de GenerationVariantStatus + métadonnées source/référence. */
export interface DesignerVariant {
  /** ID local stable (généré à l'ajout) */
  id: string
  /** URL de l'image (peut être null en cours de génération) */
  url: string | null
  /** Stage de génération (utile pour skeleton/spinner) */
  stage?: GenerationVariantStatus['stage']
  /** Label affiché sur la tuile (modèle ou nom banque) */
  label: string
  /** D'où vient cette variante */
  source: VariantSource
  /** Cochée comme image de référence pour la prochaine génération (img2img) */
  isReference: boolean
  /** Erreur de génération si stage === 'error' */
  error?: string
  /** Timestamp ajout */
  addedAt: number
}

/** Helper : convertit un GenerationVariantStatus (ancien format) vers DesignerVariant. */
export function variantFromGenerationStatus(s: GenerationVariantStatus): DesignerVariant {
  return {
    id: `gen-${s.modelKey}-${s.updatedAt}`,
    url: s.url ?? null,
    stage: s.stage,
    label: s.modelLabel,
    source: { kind: 'generated', modelKey: s.modelKey, modelLabel: s.modelLabel },
    isReference: false,
    error: s.error,
    addedAt: s.updatedAt,
  }
}

/** Helper : crée une variante depuis un pick de banque. */
export function variantFromBankImage(img: BankImage): DesignerVariant {
  return {
    id: `bank-${img.id}-${Date.now()}`,
    url: img.url,
    stage: 'done',
    label: img.label ?? 'Banque',
    source: { kind: 'bank', bankId: img.id },
    isReference: false,
    addedAt: Date.now(),
  }
}
