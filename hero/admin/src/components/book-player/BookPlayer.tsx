'use client'
/**
 * BookPlayer — orchestrateur du livre-joué.
 *
 * Responsabilités :
 *   - Charger une section (via /api/sections/[id])
 *   - Itérer sur ses plans : image fixe / animation (pellicules[]) / choix
 *   - À la fin du plan → next plan (auto)
 *   - À la fin de la section → afficher choix sortants (table `choices`)
 *   - Au click sur un choix → naviguer vers la section cible
 *
 * V1 2026-05-13 — phases B.1 + B.2 + B.3 + B.4 cumulées.
 *
 * Limitations V1 :
 *   - Pas de compositing plan_layers (à venir avec PlanRenderer enrichi)
 *   - Pas de support Plan.kind='choice' positions sur image (V1 = liste seule)
 *   - Pas de transition cross-fade entre plans (cut sec)
 *   - Pas de support pellicule.exit='choices' (V2 — chaîne en auto pour V1)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Maximize2 } from 'lucide-react'
import type { SectionImage, PelliculePersisted } from '@/types'
import PelliculeRenderer from './PelliculeRenderer'
import ChoiceOverlay, { type ChoiceOption } from './ChoiceOverlay'
import type { PlayerSection, PlayerChoice } from './types'
import { currentPellicule, planDurationMs } from './types'
import './book-player.css'

interface BookPlayerProps {
  bookId: string
  sectionId: string
  /** Callback pour naviguer vers une autre section au clic sur un choix.
   *  Si non fourni, navigation via window.location. */
  onNavigateSection?: (sectionId: string) => void
}

export default function BookPlayer({ bookId, sectionId, onNavigateSection }: BookPlayerProps) {
  const [section, setSection] = useState<PlayerSection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── État de lecture ────────────────────────────────────────────────────
  const [planIdx, setPlanIdx] = useState(0)
  const [pelliculeIdx, setPelliculeIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [showSectionEnd, setShowSectionEnd] = useState(false)
  const [imageStaticTimer, setImageStaticTimer] = useState(0)  // ms écoulés sur image fixe
  const imgStaticRafRef = useRef<number | null>(null)

  // ── Fetch section ───────────────────────────────────────────────────────
  useEffect(() => {
    let aborted = false
    setLoading(true)
    setError(null)
    setPlanIdx(0)
    setPelliculeIdx(0)
    setShowSectionEnd(false)
    setImageStaticTimer(0)

    void (async () => {
      try {
        const res = await fetch(`/api/sections/${sectionId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as {
          section: { id: string; title?: string; number?: number; images?: SectionImage[] }
          choices?: Array<{ id: string; text?: string; label?: string; target_section_id?: string; sort_order?: number }>
        }
        if (aborted) return
        const playerSec: PlayerSection = {
          id: data.section.id,
          title: data.section.title ?? null,
          number: data.section.number ?? null,
          plans: data.section.images ?? [],
          choices: (data.choices ?? []).map(c => ({
            id: c.id,
            label: c.text ?? c.label ?? '(sans label)',
            target_section_id: c.target_section_id ?? null,
            sort_order: c.sort_order ?? null,
          })),
        }
        setSection(playerSec)
      } catch (err) {
        if (!aborted) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [sectionId])

  const currentPlan: SectionImage | null = section?.plans[planIdx] ?? null

  // ── Image fixe : timer rAF (pour avancer auto après 3s par défaut) ─────
  useEffect(() => {
    setImageStaticTimer(0)
    if (imgStaticRafRef.current) {
      cancelAnimationFrame(imgStaticRafRef.current)
      imgStaticRafRef.current = null
    }
    if (!currentPlan) return
    const isImage = currentPlan.kind === 'image' || !currentPlan.kind
    if (!isImage || !isPlaying) return
    const totalMs = planDurationMs(currentPlan)
    const start = performance.now()
    function tick(now: number) {
      const elapsed = now - start
      setImageStaticTimer(elapsed)
      if (elapsed >= totalMs) {
        handlePelliculeEnd()
        return
      }
      imgStaticRafRef.current = requestAnimationFrame(tick)
    }
    imgStaticRafRef.current = requestAnimationFrame(tick)
    return () => {
      if (imgStaticRafRef.current) cancelAnimationFrame(imgStaticRafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planIdx, isPlaying, currentPlan?.kind])

  // ── Navigation entre pellicules / plans ─────────────────────────────────
  const handlePelliculeEnd = useCallback(() => {
    if (!section || !currentPlan) return
    // Si plan animation avec plusieurs pellicules → next pellicule
    if (currentPlan.kind === 'animation' && currentPlan.pellicules) {
      if (pelliculeIdx + 1 < currentPlan.pellicules.length) {
        setPelliculeIdx(i => i + 1)
        return
      }
    }
    // Sinon → next plan ou fin de section
    if (planIdx + 1 < section.plans.length) {
      setPlanIdx(i => i + 1)
      setPelliculeIdx(0)
    } else {
      // Fin de section → affiche choix sortants si présents, sinon end banner
      setIsPlaying(false)
      setShowSectionEnd(true)
    }
  }, [section, currentPlan, planIdx, pelliculeIdx])

  function handlePrev() {
    // Reculer : si on est sur pellicule >0 → recul. Sinon plan -1.
    if (pelliculeIdx > 0) {
      setPelliculeIdx(i => i - 1)
      return
    }
    if (planIdx > 0) {
      const prevPlan = section?.plans[planIdx - 1]
      const prevPelliculeCount = prevPlan?.pellicules?.length ?? 1
      setPlanIdx(i => i - 1)
      setPelliculeIdx(Math.max(0, prevPelliculeCount - 1))
    }
    setShowSectionEnd(false)
    setIsPlaying(true)
  }

  function handleNext() {
    handlePelliculeEnd()
    setIsPlaying(true)
  }

  function handleRestart() {
    setPlanIdx(0)
    setPelliculeIdx(0)
    setShowSectionEnd(false)
    setIsPlaying(true)
    setImageStaticTimer(0)
  }

  function handleNavigateSection(targetSectionId: string) {
    if (onNavigateSection) {
      onNavigateSection(targetSectionId)
    } else {
      // Fallback : on update query params via URL (page parent gère)
      const url = new URL(window.location.href)
      url.searchParams.set('sectionId', targetSectionId)
      window.location.href = url.toString()
    }
  }

  // ── Construction des options de choix ───────────────────────────────────
  // Cas 1 : Plan kind='choice' → choice_data.options
  // Cas 2 : Section.choices (fin de section)
  const planChoiceOptions: ChoiceOption[] = useMemo(() => {
    if (!currentPlan || currentPlan.kind !== 'choice' || !currentPlan.choice_data) return []
    return currentPlan.choice_data.options.map<ChoiceOption>(o => {
      if (o.source.kind === 'section') {
        // Référence à un Choice de la section parente — résolu depuis section.choices
        const sectionChoiceId = o.source.section_choice_id
        const sectionChoice = section?.choices.find(c => c.id === sectionChoiceId)
        return {
          id: o.id,
          label: sectionChoice?.label ?? '(choix introuvable)',
          target: { kind: 'section', sectionId: sectionChoice?.target_section_id ?? null },
        }
      }
      // source.kind === 'plan' : navigue vers un autre plan de la section
      return {
        id: o.id,
        label: o.source.label,
        target: { kind: 'plan_index', index: o.source.target_plan_index },
      }
    })
  }, [currentPlan, section?.choices])

  const sectionEndOptions: ChoiceOption[] = useMemo(() => {
    if (!section) return []
    return section.choices
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(c => ({
        id: c.id,
        label: c.label,
        target: { kind: 'section', sectionId: c.target_section_id },
      }))
  }, [section])

  function handlePickChoice(opt: ChoiceOption) {
    if (opt.target.kind === 'section') {
      if (opt.target.sectionId) {
        handleNavigateSection(opt.target.sectionId)
      } else {
        // null = fin de livre / pas de cible → reset
        setShowSectionEnd(true)
      }
      return
    }
    if (opt.target.kind === 'plan_index') {
      const idx = opt.target.index
      if (section && idx >= 0 && idx < section.plans.length) {
        setPlanIdx(idx)
        setPelliculeIdx(0)
        setShowSectionEnd(false)
        setIsPlaying(true)
      }
      return
    }
    // pellicule kind — pas géré V1 (auto-chain)
  }

  // ── Rendu ───────────────────────────────────────────────────────────────
  if (loading) return <div className="bp-root"><div className="bp-loading">Chargement de la section…</div></div>
  if (error) return (
    <div className="bp-root">
      <div className="bp-error">
        <div className="bp-error-title">Impossible de charger la section</div>
        <div className="bp-error-detail">{error}</div>
      </div>
    </div>
  )
  if (!section || !currentPlan) return (
    <div className="bp-root">
      <div className="bp-error">
        <div className="bp-error-title">Section vide</div>
        <div className="bp-error-detail">Aucun plan à jouer dans cette section.</div>
      </div>
    </div>
  )

  // Calcul progress pour la barre
  const totalPlans = section.plans.length
  const planProgress = (() => {
    const isImage = currentPlan.kind === 'image' || !currentPlan.kind
    if (isImage) {
      const total = planDurationMs(currentPlan)
      return total > 0 ? imageStaticTimer / total : 0
    }
    // Animation : approxime via pelliculeIdx
    const totalPellicules = currentPlan.pellicules?.length ?? 1
    return (pelliculeIdx + 0.5) / totalPellicules
  })()
  const overallProgress = ((planIdx + planProgress) / Math.max(1, totalPlans)) * 100

  // Détermine quoi rendre dans la stage
  const isPlanChoice = currentPlan.kind === 'choice'
  const isPlanAnimation = currentPlan.kind === 'animation'
  const pell: PelliculePersisted | null = currentPellicule(currentPlan, pelliculeIdx)

  return (
    <div className="bp-root controls-shown">
      {/* Bandeau haut */}
      <div className="bp-header">
        <div className="bp-header-title">
          {section.title ?? `Section ${section.number ?? section.id.slice(0, 6)}`}
        </div>
        <div className="bp-header-step">
          Plan {planIdx + 1} / {totalPlans}
          {isPlanAnimation && currentPlan.pellicules && currentPlan.pellicules.length > 1
            && ` · Pellicule ${pelliculeIdx + 1}/${currentPlan.pellicules.length}`}
        </div>
      </div>

      {/* Stage central */}
      <div className="bp-stage">
        {isPlanChoice && currentPlan.choice_data ? (
          // Plan choix variant 'image' — affiche image, options en overlay
          currentPlan.choice_data.image_url ? (
            <img src={currentPlan.choice_data.image_url} alt="" className="bp-canvas-media" />
          ) : (
            <div className="bp-error">Image du plan choix manquante</div>
          )
        ) : isPlanAnimation && pell ? (
          <PelliculeRenderer
            key={`${planIdx}-${pelliculeIdx}-${pell.id}`}
            pellicule={pell}
            isPlaying={isPlaying && !showSectionEnd}
            onComplete={handlePelliculeEnd}
          />
        ) : (
          // Image fixe (kind='image' ou défaut)
          currentPlan.url ? (
            <img src={currentPlan.url} alt="" className="bp-canvas-media" />
          ) : (
            <div className="bp-error">Plan sans image</div>
          )
        )}
      </div>

      {/* Overlays choix */}
      {isPlanChoice && planChoiceOptions.length > 0 && (
        <ChoiceOverlay options={planChoiceOptions} onPick={handlePickChoice} />
      )}

      {/* Fin de section */}
      {showSectionEnd && (
        sectionEndOptions.length > 0 ? (
          <ChoiceOverlay
            prompt="Quelle direction prends-tu ?"
            options={sectionEndOptions}
            onPick={handlePickChoice}
          />
        ) : (
          <div className="bp-end-banner">
            <div className="bp-end-title">Fin de la section</div>
            <div className="bp-end-actions">
              <button type="button" className="bp-btn bp-btn-primary" onClick={handleRestart}>
                <RotateCcw size={14} style={{ marginRight: '0.4rem' }} /> Recommencer
              </button>
            </div>
          </div>
        )
      )}

      {/* Barre de contrôle bas */}
      <div className="bp-controls">
        <button
          type="button"
          className="bp-btn"
          onClick={handlePrev}
          disabled={planIdx === 0 && pelliculeIdx === 0}
          title="Précédent"
        >
          <SkipBack size={14} />
        </button>
        <button
          type="button"
          className="bp-btn bp-btn-primary"
          onClick={() => setIsPlaying(p => !p)}
          disabled={isPlanChoice || showSectionEnd}
          title={isPlaying ? 'Pause' : 'Lecture'}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          className="bp-btn"
          onClick={handleNext}
          disabled={isPlanChoice || showSectionEnd}
          title="Suivant"
        >
          <SkipForward size={14} />
        </button>
        <div className="bp-progress">
          <div
            className="bp-progress-bar"
            onClick={(e) => {
              // Click pour seek au plan correspondant (V1 = jump entier)
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = (e.clientX - rect.left) / rect.width
              const targetPlan = Math.floor(pct * totalPlans)
              if (targetPlan >= 0 && targetPlan < totalPlans) {
                setPlanIdx(targetPlan)
                setPelliculeIdx(0)
                setShowSectionEnd(false)
                setIsPlaying(true)
              }
            }}
          >
            <div className="bp-progress-fill" style={{ width: `${overallProgress}%` }} />
          </div>
          <div className="bp-progress-info">
            <span>{section.title ?? `Section ${section.number ?? ''}`}</span>
            <span>{planIdx + 1} / {totalPlans}</span>
          </div>
        </div>
        <button
          type="button"
          className="bp-btn"
          onClick={() => {
            const el = document.documentElement
            if (document.fullscreenElement) {
              void document.exitFullscreen()
            } else {
              void el.requestFullscreen?.().catch(() => {})
            }
          }}
          title="Plein écran"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  )
}
