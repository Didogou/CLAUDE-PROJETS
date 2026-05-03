'use client'
import React, { useEffect, useMemo, useState } from 'react'
import PlanPlayer from './PlanPlayer'
import {
  ensureTransitionStylesInjected,
  getTransitionAnimations,
  type TransitionEffect,
} from '@/lib/transitions'
import { effectivePlanPrefs, effectiveRedWords, type PlanPrefsOverride } from '@/lib/reading-prefs'
import { splitIntoSubPhrases, type AvailableMediaSnapshot, type MediaBlock } from '@/lib/timeline'
import type { AnimationInstance } from '@/lib/animations'
import type { Npc } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

/** Vue minimale d'un plan utilisée par SectionPlayer. */
export interface SectionPlanInput {
  url?: string
  text_position?: { x: number; y: number }
  plan_prefs?: PlanPrefsOverride
  reading_settings?: PlanPrefsOverride // legacy fallback
  red_words?: string[]
  bubble_positions?: Record<string, { x: number; y: number }>
  comfyui_settings?: {
    variants?: string[]
    media_timeline?: MediaBlock[]
    animations?: AnimationInstance[]
  }
}

export interface SectionPlayerProps {
  /** Liste ordonnée des plans à jouer. */
  plans: SectionPlanInput[]
  /** Distribution des phrases — tableau parallèle aux plans. */
  phraseDistribution: string[][]
  /** Mots rouges auto (PNJ + lieux) — augmentés par red_words de chaque plan. */
  redWordsAuto: Set<string>
  /** Liste de tous les PNJ (lookup portrait dans bulles). */
  npcs?: Npc[]
  /** Défauts globaux (simPrefs depuis localStorage). */
  globalSimPrefs?: Record<string, unknown>

  /** Effet de transition entre plans. Défaut 'fade-to-black'. */
  planTransition?: TransitionEffect
  planTransitionMs?: number
  /** Effet de transition entre médias INTRA-plan (sur la timeline). */
  mediaTransition?: TransitionEffect
  mediaTransitionMs?: number

  /** Largeur du frame (mode phone). 'fullscreen' = remplit le parent. */
  layout?: 'phone' | 'fullscreen'
  width?: number

  /** Callback fin de section (tous les plans joués). */
  onComplete?: () => void
  /** Callback à chaque tick. */
  onProgress?: (planIdx: number, cursorMs: number, totalMs: number) => void

  /** Démarre en lecture (true) ou attend un clic (false). */
  autoPlay?: boolean

  /** Override : permet de forcer un plan de départ. Défaut 0. */
  initialPlanIdx?: number
}

/**
 * Orchestre la lecture séquentielle des plans d'une section.
 * Chaque plan est joué via <PlanPlayer> avec ses prefs effectives ; entre 2 plans,
 * une transition cinématique est injectée (effet configurable).
 *
 * Réutilisable pour : preview section dans BookPage, simulateur futur, partage URL public.
 */
export default function SectionPlayer({
  plans,
  phraseDistribution,
  redWordsAuto,
  npcs = [],
  globalSimPrefs,
  planTransition = 'fade-to-black',
  planTransitionMs = 500,
  mediaTransition = 'crossfade',
  mediaTransitionMs = 750,
  layout = 'phone',
  width,
  onComplete,
  onProgress,
  autoPlay = true,
  initialPlanIdx = 0,
}: SectionPlayerProps) {
  useEffect(() => { ensureTransitionStylesInjected() }, [])

  const playablePlans = useMemo(() => plans.filter(p => p.url || (p.comfyui_settings?.media_timeline?.length ?? 0) > 0 || (phraseDistribution[plans.indexOf(p)]?.length ?? 0) > 0), [plans, phraseDistribution])

  const [currentIdx, setCurrentIdx] = useState(initialPlanIdx)
  const [isPlaying, setIsPlaying] = useState(autoPlay)
  // Phase de transition entre plans
  const [transitionPhase, setTransitionPhase] = useState<'idle' | 'transitioning'>('idle')
  // L'index pendant la transition (overlay) pour render la couche sortante
  const [transitionFromIdx, setTransitionFromIdx] = useState<number | null>(null)

  const planTransAnims = useMemo(() => getTransitionAnimations(planTransition, planTransitionMs), [planTransition, planTransitionMs])

  const advanceToNext = () => {
    const next = currentIdx + 1
    if (next >= plans.length) {
      // Fin de section
      setIsPlaying(false)
      onComplete?.()
      return
    }
    // Commit immédiat de currentIdx → NEW. transitionFromIdx garde la trace de l'ancien.
    // Pendant la transition : layer "courante" = NEW (incoming), overlay absolu = OLD (outgoing).
    setTransitionFromIdx(currentIdx)
    setCurrentIdx(next)
    setTransitionPhase('transitioning')
    window.setTimeout(() => {
      setTransitionFromIdx(null)
      setTransitionPhase('idle')
    }, planTransAnims.totalDurationMs)
  }

  const skipPlan = () => {
    if (transitionPhase !== 'idle') return
    advanceToNext()
  }

  const currentPlan = plans[currentIdx]
  const fromPlan = transitionFromIdx != null ? plans[transitionFromIdx] : null

  if (!currentPlan) {
    return (
      <div style={{ width: layout === 'phone' ? (width ?? 280) : '100%', padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontStyle: 'italic' }}>
        Aucun plan jouable dans cette section.
      </div>
    )
  }

  const renderPlan = (plan: SectionPlanInput, idx: number) => {
    // Atomise comme le simulateur (simPhrases ligne 10719) : chaque sentence et chaque
    // bloc [tag]…[/tag] devient un atome séparé. PHRASE_GAP_MS s'applique entre atomes
    // → comportement identique au simulateur (tap-to-advance / auto-advance par atome).
    const phrases = (phraseDistribution[idx] ?? []).flatMap(splitIntoSubPhrases)
    const planPrefs = (plan.plan_prefs ?? plan.reading_settings) as PlanPrefsOverride | undefined
    const eff = effectivePlanPrefs(planPrefs, globalSimPrefs)
    const redWords = effectiveRedWords(redWordsAuto, plan.red_words)
    const cs = plan.comfyui_settings ?? {}
    const available: AvailableMediaSnapshot = {
      imageUrl: plan.url?.split('?')[0],
      variants: cs.variants ?? [],
      animations: (cs.animations ?? []).map(a => ({ id: a.id, url: a.output?.url, urls: a.output?.urls })),
    }
    return (
      <PlanPlayer
        phrases={phrases}
        timeline={cs.media_timeline ?? []}
        available={available}
        fallbackImageUrl={plan.url}
        wpm={eff.wpm}
        wordIntervalMs={eff.wordIntervalMs}
        phraseGapMs={eff.phraseGapMs}
        redWords={redWords}
        textPosition={plan.text_position}
        textFontSize={eff.textFontSize}
        npcs={npcs}
        bubblePositions={plan.bubble_positions}
        isPlaying={isPlaying && idx === currentIdx && transitionPhase === 'idle'}
        onComplete={() => { if (idx === currentIdx && transitionPhase === 'idle') advanceToNext() }}
        onCursorChange={ms => { if (idx === currentIdx && ms != null) onProgress?.(idx, ms, 0) }}
        onFrameClick={skipPlan}
        mediaTransition={mediaTransition}
        mediaTransitionMs={mediaTransitionMs}
        aspectRatio={layout === 'phone' ? '9/19.5' : 'auto'}
        phoneChrome={layout === 'phone'}
        width={layout === 'phone' ? (width ?? 320) : undefined}
      />
    )
  }

  // Pour fade-to-black/white, on démarre l'incoming avec opacity 0 (avant que son animation ne le révèle)
  const incomingInitialOpacity = planTransAnims.inDelayMs ? 0 : 1

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.6rem', alignItems: 'center', width: layout === 'phone' ? (width ?? 320) : '100%' }}>
      {/* Stack : incoming en couche relative (donne la hauteur au container), outgoing en absolute par-dessus pendant la transition */}
      <div style={{ position: 'relative', width: '100%', background: planTransAnims.background ?? 'transparent' }}>
        {/* Plan courant (ou incoming pendant transition) — TOUJOURS relative pour donner la taille au stack.
            Le délai est intégré dans le shorthand inAnimation (cf. lib/transitions.ts) — ne pas mixer animationDelay. */}
        <div style={{ position: 'relative', animation: transitionPhase === 'transitioning' && fromPlan ? planTransAnims.inAnimation : 'none', opacity: transitionPhase === 'transitioning' && fromPlan ? incomingInitialOpacity : 1 }}>
          {renderPlan(currentPlan, currentIdx)}
        </div>
        {/* Plan sortant — superposé en absolute, joue son animation `out` */}
        {fromPlan && transitionPhase === 'transitioning' && transitionFromIdx != null && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 2, animation: planTransAnims.outAnimation, pointerEvents: 'none' }}>
            {renderPlan(fromPlan, transitionFromIdx)}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'center' }}>
        <button onClick={() => setIsPlaying(p => !p)} style={{ background: isPlaying ? '#c94c4c' : 'var(--accent)', border: 'none', borderRadius: '6px', padding: '0.4rem 1.2rem', color: '#0f0f14', fontSize: '0.78rem', fontWeight: 'bold', cursor: 'pointer' }}>
          {isPlaying ? '⏸ Pause' : '▶ Lecture'}
        </button>
        <button onClick={skipPlan} disabled={transitionPhase !== 'idle'} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.4rem 0.9rem', color: 'var(--muted)', fontSize: '0.7rem', cursor: transitionPhase !== 'idle' ? 'not-allowed' : 'pointer', opacity: transitionPhase !== 'idle' ? 0.5 : 1 }}>
          ⏭ Plan suivant
        </button>
        <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
          Plan {currentIdx + 1} / {plans.length}
        </span>
      </div>
    </div>
  )
}
