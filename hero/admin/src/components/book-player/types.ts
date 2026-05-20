/**
 * BookPlayer — types pour le renderer du livre-joué.
 *
 * Source de vérité : `SectionImage[]` (= plans) stockés dans `sections.images` JSONB.
 * Chaque plan a `kind: 'image' | 'animation' | 'choice'` qui drive le rendu.
 *
 * Pour kind='animation' : on lit `pellicules[]` (timeline complète) si présent,
 * fallback sur `base_video_url` legacy. Une pellicule joue son `videoUrl` puis
 * fige sur `lastFrameUrl` ; `audioTracks[]` mixés en parallèle ; `textOverlays[]`
 * rendus par-dessus.
 *
 * Pour kind='choice' : on affiche `choice_data.image_url` + overlay options
 * positionnées.
 *
 * V1 minimal 2026-05-13.
 */

import type { SectionImage, PelliculePersisted } from '@/types'

/** Source d'une section, telle qu'attendue par BookPlayer. */
export interface PlayerSection {
  id: string
  title?: string | null
  number?: number | null
  /** Liste des plans (= section.images en DB). */
  plans: SectionImage[]
  /** Choix sortants de la section (depuis `choices` table). */
  choices: PlayerChoice[]
}

export interface PlayerChoice {
  id: string
  label: string
  target_section_id: string | null
  sort_order?: number | null
}

/** État courant du player. Plat pour simplifier le re-render. */
export interface PlayerState {
  /** Index du plan courant dans `section.plans`. */
  planIdx: number
  /** Pellicule courante (pour kind='animation' avec pellicules[]). null sinon. */
  pelliculeIdx: number
  /** Phase de la lecture du plan/pellicule courant. */
  phase: 'playing' | 'paused' | 'ended' | 'choice' | 'section_end'
  /** Curseur en ms dans le shot/pellicule courant — utile pour text overlay sync. */
  cursorMs: number
}

/** Helper : retourne la pellicule courante d'un plan animation (ou null). */
export function currentPellicule(plan: SectionImage, pelliculeIdx: number): PelliculePersisted | null {
  if (plan.kind !== 'animation') return null
  if (!plan.pellicules || plan.pellicules.length === 0) return null
  return plan.pellicules[pelliculeIdx] ?? null
}

/** Helper : durée d'un plan en ms (somme pellicules ou défaut 3s pour image). */
export function planDurationMs(plan: SectionImage): number {
  if (plan.kind === 'image' || !plan.kind) return 3000  // image fixe : 3s
  if (plan.kind === 'choice') return 0                  // attend interaction
  // animation
  if (plan.pellicules && plan.pellicules.length > 0) {
    return plan.pellicules.reduce((sum, p) => {
      const shotsDur = (p.shots ?? []).reduce((s, sh) => s + (sh.duration ?? 4), 0)
      return sum + shotsDur * 1000
    }, 0)
  }
  return 4000  // legacy single-video : 4s par défaut
}
