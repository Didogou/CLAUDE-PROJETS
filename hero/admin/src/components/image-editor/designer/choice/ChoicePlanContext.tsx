'use client'
/**
 * ChoicePlanContext — state des markers d'un Plan choix.
 *
 * Activé uniquement pour les plans `kind='choice'`. Hydraté depuis
 * `picked.plan.choice_data` au chargement. Persisté vers l'API
 * `/api/plans/:id` (PATCH `data.choice_data`) à chaque mutation.
 *
 * Exposé via hook `useChoicePlan()` aux composants du Designer
 * (CatalogChoix panneau gauche, ChoiceMarkersOverlay sur canvas).
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { SectionImage } from '@/types'

export type ChoiceOption = NonNullable<SectionImage['choice_data']>['options'][number]
export type ChoiceData = NonNullable<SectionImage['choice_data']>

/** Choice tel que retourné par GET /api/sections/:id (table `choices`).
 *  Le champ DB s'appelle `label` (cf migration 001_initial_schema). */
export interface SectionChoice {
  id: string
  section_id: string
  sort_order: number
  label: string
  target_section_number: number | null
}

interface ChoicePlanContextValue {
  /** True si on est sur un Plan choix (= active l'outil Choix dans le rail). */
  isPlanChoice: boolean
  /** Variant courant ('image' V1, 'conversation' V2). */
  variant: 'image' | 'conversation'
  /** Markers posés sur l'image. Position normalisée 0..1. */
  options: ChoiceOption[]
  /** Choix de la Section parente (drag source pour les markers de type
   *  `source.kind='section'`). */
  sectionChoices: SectionChoice[]
  /** Style d'affichage des markers sur le canvas.
   *  - 'pin' = pastille numérotée discrète (édition par défaut)
   *  - 'preview' = WYSIWYG bouton style runtime (preview joueur) */
  markerStyle: 'pin' | 'preview'
  setMarkerStyle: (s: 'pin' | 'preview') => void
  /** Marker actuellement focus (édition / suppression). */
  selectedOptionId: string | null
  setSelectedOptionId: (id: string | null) => void

  // ── mutations ─────────────────────────────────────────────────────────
  addSectionMarker: (sectionChoiceId: string) => void
  addPlanMarker: (label: string, targetPlanIndex: number) => void
  removeOption: (optionId: string) => void
  moveOption: (optionId: string, x: number, y: number) => void
  updateOption: (optionId: string, patch: Partial<ChoiceOption>) => void
}

const ChoicePlanContext = createContext<ChoicePlanContextValue | null>(null)

interface ChoicePlanProviderProps {
  isPlanChoice: boolean
  initialChoiceData?: ChoiceData
  sectionChoices: SectionChoice[]
  /** Callback déclenché à chaque mutation des options (debounced ou non
   *  selon le parent). Le parent persiste vers l'API. */
  onChange?: (data: ChoiceData) => void
  children: React.ReactNode
}

export function ChoicePlanProvider({
  isPlanChoice, initialChoiceData, sectionChoices, onChange, children,
}: ChoicePlanProviderProps) {
  const [variant] = useState<'image' | 'conversation'>(initialChoiceData?.variant ?? 'image')
  const [options, setOptions] = useState<ChoiceOption[]>(initialChoiceData?.options ?? [])
  const [markerStyle, setMarkerStyle] = useState<'pin' | 'preview'>('pin')
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)

  const commit = useCallback((next: ChoiceOption[]) => {
    setOptions(next)
    onChange?.({ variant, options: next })
  }, [variant, onChange])

  const addSectionMarker = useCallback((sectionChoiceId: string) => {
    // Pas de doublon : si le choice est déjà placé, on no-op.
    if (options.some(o => o.source.kind === 'section' && o.source.section_choice_id === sectionChoiceId)) {
      return
    }
    const id = `opt_${Math.random().toString(36).slice(2, 9)}`
    commit([...options, {
      id,
      position: { x: 0.5, y: 0.5 },
      source: { kind: 'section', section_choice_id: sectionChoiceId },
    }])
    setSelectedOptionId(id)
  }, [options, commit])

  const addPlanMarker = useCallback((label: string, targetPlanIndex: number) => {
    const id = `opt_${Math.random().toString(36).slice(2, 9)}`
    commit([...options, {
      id,
      position: { x: 0.5, y: 0.5 },
      source: { kind: 'plan', label, target_plan_index: targetPlanIndex },
    }])
    setSelectedOptionId(id)
  }, [options, commit])

  const removeOption = useCallback((optionId: string) => {
    commit(options.filter(o => o.id !== optionId))
    if (selectedOptionId === optionId) setSelectedOptionId(null)
  }, [options, commit, selectedOptionId])

  const moveOption = useCallback((optionId: string, x: number, y: number) => {
    // Clamp 0..1 + arrondi à 4 décimales pour éviter de polluer le JSON.
    const cx = Math.max(0, Math.min(1, Math.round(x * 10000) / 10000))
    const cy = Math.max(0, Math.min(1, Math.round(y * 10000) / 10000))
    commit(options.map(o => o.id === optionId ? { ...o, position: { x: cx, y: cy } } : o))
  }, [options, commit])

  const updateOption = useCallback((optionId: string, patch: Partial<ChoiceOption>) => {
    commit(options.map(o => o.id === optionId ? { ...o, ...patch } : o))
  }, [options, commit])

  const value = useMemo<ChoicePlanContextValue>(() => ({
    isPlanChoice,
    variant,
    options,
    sectionChoices,
    markerStyle,
    setMarkerStyle,
    selectedOptionId,
    setSelectedOptionId,
    addSectionMarker,
    addPlanMarker,
    removeOption,
    moveOption,
    updateOption,
  }), [
    isPlanChoice, variant, options, sectionChoices, markerStyle, selectedOptionId,
    addSectionMarker, addPlanMarker, removeOption, moveOption, updateOption,
  ])

  return <ChoicePlanContext.Provider value={value}>{children}</ChoicePlanContext.Provider>
}

export function useChoicePlan(): ChoicePlanContextValue {
  const ctx = useContext(ChoicePlanContext)
  if (!ctx) {
    // Default no-op : permet aux composants Designer de monter même hors
    // d'un Plan choix (isPlanChoice=false → ils se rendent invisibles).
    return {
      isPlanChoice: false,
      variant: 'image',
      options: [],
      sectionChoices: [],
      markerStyle: 'pin',
      setMarkerStyle: () => {},
      selectedOptionId: null,
      setSelectedOptionId: () => {},
      addSectionMarker: () => {},
      addPlanMarker: () => {},
      removeOption: () => {},
      moveOption: () => {},
      updateOption: () => {},
    }
  }
  return ctx
}
