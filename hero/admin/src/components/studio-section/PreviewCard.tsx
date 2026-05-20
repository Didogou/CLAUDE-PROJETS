'use client'
/**
 * PreviewCard — grosse carte au-dessus de la timeline.
 *
 * 2 zones séparées visuellement :
 *   1. Top : image du Plan sélectionné + overlay play + progress bar
 *      (simulation de lecture pour V1 — pas encore branché à un vrai player)
 *   2. Bottom : infos textuelles du plan (numéro, titre, type, chips, durée)
 *
 * Click play → anime la progress bar pendant `durationSec` secondes (V1 mock).
 * Plan 1 affiché par défaut (= 1er Plan de la liste, pas forcément `selectedPlan`).
 */

import React, { useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import type { Plan } from './types'

interface PreviewCardProps {
  plan: Plan | null
  /** Affiché quand aucun plan dans la timeline. */
  emptyMessage?: string
}

export default function PreviewCard({
  plan,
  emptyMessage = 'Aucun plan dans la timeline. Crée-en un pour commencer.',
}: PreviewCardProps) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)  // 0..1
  const startedAtRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  // Durée simulée en secondes pour la progress bar V1.
  const durationSec = parsePlanDuration(plan?.durationLabel)

  // Tick la progress bar via requestAnimationFrame quand playing=true.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      startedAtRef.current = null
      return
    }
    if (durationSec <= 0) { setPlaying(false); return }

    startedAtRef.current = performance.now() - progress * durationSec * 1000
    function tick(now: number) {
      const elapsed = (now - (startedAtRef.current ?? now)) / 1000
      const next = Math.min(1, elapsed / durationSec)
      setProgress(next)
      if (next >= 1) {
        setPlaying(false)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, durationSec])

  // Reset progress quand on change de plan
  useEffect(() => {
    setProgress(0)
    setPlaying(false)
  }, [plan?.id])

  function togglePlay() {
    if (!plan) return
    if (progress >= 1) setProgress(0)  // restart si fini
    setPlaying(p => !p)
  }

  if (!plan) {
    return (
      <div className="ss-preview-stack">
        <div className="ss-preview-card ss-preview-card-empty">
          <div className="ss-preview-empty-msg">{emptyMessage}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="ss-preview-stack">

      {/* ── CARD 1 : image encadrée + play overlay + progress bar ─────── */}
      <div className="ss-preview-card ss-preview-card-image">
        <div className="ss-preview-image-wrap">
          {plan.thumb.url ? (
            <img src={plan.thumb.url} alt={plan.title} className="ss-preview-image" />
          ) : (
            <div className="ss-preview-image ss-preview-image-placeholder">
              <span className="ss-preview-image-placeholder-icon">{typeIcon(plan.type)}</span>
              <span className="ss-preview-image-placeholder-label">
                Aucune image — édite dans Studio Designer
              </span>
            </div>
          )}

          {/* Overlay play (visible au hover ou pendant lecture) */}
          <button
            type="button"
            className={`ss-preview-play-btn ${playing ? 'is-playing' : ''}`}
            onClick={togglePlay}
            title={playing ? 'Pause' : 'Lecture'}
            aria-label={playing ? 'Pause' : 'Lecture'}
          >
            {playing
              ? <Pause size={28} fill="currentColor" />
              : <Play size={28} fill="currentColor" />}
          </button>
        </div>

        {/* Progress bar + temps sous l'image, dans la même card */}
        <div className="ss-preview-progress-row">
          <div className="ss-preview-progress-track" onClick={(e) => seekFromClick(e, durationSec, setProgress)}>
            <div
              className="ss-preview-progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="ss-preview-time">
            {formatTime(progress * durationSec)} <span className="muted">/ {formatTime(durationSec)}</span>
          </div>
        </div>
      </div>

      {/* ── CARD 2 : infos plan (séparée par un gap) ──────────────────── */}
      <div className="ss-preview-card ss-preview-card-info">
        <div className="ss-preview-info-header">
          <span className="ss-preview-info-num">P{plan.order}</span>
          <span className={`ss-preview-info-type type-${plan.type}`}>
            {typeIcon(plan.type)} {typeLabel(plan.type)}
          </span>
          <h3 className="ss-preview-info-title">{plan.title}</h3>
        </div>
        <div className="ss-preview-info-chips">
          <span className="ss-preview-info-chip primary">⏱ {plan.durationLabel}</span>
          {plan.chips.map((chip, i) => (
            <span key={i} className={`ss-preview-info-chip ${chip.kind ?? ''}`}>
              {chip.label}
            </span>
          ))}
          {plan.chips.length === 0 && (
            <span className="ss-preview-info-chip muted">aucun effet/calque</span>
          )}
        </div>
      </div>

    </div>
  )
}

/** Click sur la progress bar = seek à la position cliquée. */
function seekFromClick(
  e: React.MouseEvent<HTMLDivElement>,
  durationSec: number,
  setProgress: (n: number) => void,
) {
  if (durationSec <= 0) return
  const rect = e.currentTarget.getBoundingClientRect()
  const x = e.clientX - rect.left
  const ratio = Math.max(0, Math.min(1, x / rect.width))
  setProgress(ratio)
}

// ── Helpers ─────────────────────────────────────────────────────────────

function typeIcon(type: Plan['type']): string {
  switch (type) {
    case 'static': return '🖼'
    case 'animation': return '🎬'
    case 'conversation': return '💬'
    case 'choice': return '🎯'
  }
}
function typeLabel(type: Plan['type']): string {
  switch (type) {
    case 'static': return 'Image fixe'
    case 'animation': return 'Animation'
    case 'conversation': return 'Conversation'
    case 'choice': return 'Plan choix'
  }
}

/** Parse "5s" / "15s" / "∞" / "var." / "—" → secondes (default 5). */
function parsePlanDuration(label: string | undefined): number {
  if (!label) return 5
  const m = label.match(/^(\d+(?:\.\d+)?)s$/)
  if (m) return parseFloat(m[1])
  return 5  // pour ∞, var., — : on simule 5s
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
