'use client'
/**
 * SectionPlansPanel — panneau qui s'affiche en dessous d'une SectionTile
 * étendue (refonte UX 2026-05-12) et liste les plans de la section sous forme
 * de mini-tiles.
 *
 * Refonte V2 2026-05-14 : data source = /api/sections/[id]/timeline
 * (= rows section_timeline track=video_image avec asset hydraté). Click
 * mini-tile → push vers Designer/AnimationStudio avec ?assetId=X (V2).
 * Auparavant : table legacy `plans` avec ?planId=X.
 *
 * Layout : utilise grid-column: 1/-1 pour occuper toute la largeur de la
 * grille parent (= la grille des sections). Visuellement, devient un bandeau
 * sous la rangée contenant la section ouverte.
 */

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Image as ImageIcon, Film, Plus, Loader2 } from 'lucide-react'

interface TimelineBlockRow {
  id: string
  asset_type: 'image' | 'animation' | 'audio' | 'text'
  asset_id: string
  position_idx: number
  track: string
  asset?: {
    label?: string | null
    url?: string | null
    first_frame_url?: string | null
  } | null
}

interface PlanTile {
  id: string                // section_timeline.id
  assetId: string
  assetType: 'image' | 'animation'
  title: string | null
  thumb: string | null
  positionIdx: number
}

interface SectionPlansPanelProps {
  sectionId: string
  /** Nom de la section pour l'affichage du header. */
  sectionLabel: string
  /** Click sur une mini-tile = ouvrir l'asset dans le Studio Designer/AnimationStudio.
   *  Reçoit assetId + assetType pour que le parent route vers la bonne page. */
  onOpenPlan: (assetId: string, assetType: 'image' | 'animation') => void
  /** Click sur "+ Nouveau plan" — V1 redirige vers Studio Section pour créer. */
  onCreatePlan?: () => void
}

const TYPE_ICONS = {
  image: { icon: <ImageIcon size={14} />, label: 'Image', color: '#3b82f6' },
  animation: { icon: <Film size={14} />, label: 'Anim', color: '#a855f7' },
} as const

export default function SectionPlansPanel({
  sectionId, sectionLabel, onOpenPlan, onCreatePlan,
}: SectionPlansPanelProps) {
  const [plans, setPlans] = useState<PlanTile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    setLoading(true); setError(null)
    fetch(`/api/sections/${sectionId}/timeline`)
      .then(r => r.json() as Promise<{ blocks?: TimelineBlockRow[]; error?: string }>)
      .then(d => {
        if (aborted) return
        if (d.error) { setError(d.error); setPlans([]); return }
        const tiles = (d.blocks ?? [])
          .filter(b => b.track === 'video_image'
                    && (b.asset_type === 'image' || b.asset_type === 'animation'))
          .map(b => ({
            id: b.id,
            assetId: b.asset_id,
            assetType: b.asset_type as 'image' | 'animation',
            title: b.asset?.label ?? null,
            thumb: b.asset?.first_frame_url ?? b.asset?.url ?? null,
            positionIdx: b.position_idx,
          }))
        setPlans(tiles)
      })
      .catch(err => {
        if (aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setPlans([])
      })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
  }, [sectionId])

  return (
    <motion.div
      className="sc-plans-panel"
      // Animation très douce — durée plus longue + easing à forte décélération
      // (out-expo style) pour un mouvement luxueux qui s'étire à la fin plutôt
      // que de claquer.
      initial={{ opacity: 0, height: 0, y: -8 }}
      animate={{ opacity: 1, height: 'auto', y: 0 }}
      exit={{ opacity: 0, height: 0, y: -8 }}
      transition={{
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],  // out-expo — démarre vite, freine longtemps
        opacity: { duration: 0.4 },  // fade un peu plus rapide pour éviter clipping
      }}
      style={{ overflow: 'hidden' }}
    >
      <header className="sc-plans-panel-header">
        <span className="sc-plans-panel-title">
          Plans de <strong>{sectionLabel}</strong>
        </span>
        {plans && plans.length > 0 && (
          <span className="sc-plans-panel-count">{plans.length} plan{plans.length > 1 ? 's' : ''}</span>
        )}
      </header>

      {loading && (
        <div className="sc-plans-panel-loading">
          <Loader2 size={14} className="sc-plans-spin" />
          <span>Chargement…</span>
        </div>
      )}

      {!loading && error && (
        <div className="sc-plans-panel-error">⚠ {error}</div>
      )}

      {!loading && plans && plans.length === 0 && !error && (
        <div className="sc-plans-panel-empty">
          Aucun plan dans cette section. Crée-en un en éditant la section.
        </div>
      )}

      {!loading && plans && plans.length > 0 && (
        <div className="sc-plans-panel-grid">
          {plans.map(p => {
            const typeMeta = TYPE_ICONS[p.assetType]
            return (
              <button
                key={p.id}
                type="button"
                className="sc-plan-mini"
                onClick={() => onOpenPlan(p.assetId, p.assetType)}
                title={p.title ?? `Plan ${p.positionIdx + 1}`}
              >
                <div className="sc-plan-mini-thumb">
                  {p.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumb} alt="" />
                  ) : (
                    <div className="sc-plan-mini-thumb-empty">
                      <ImageIcon size={20} />
                    </div>
                  )}
                  <span className="sc-plan-mini-num">P{p.positionIdx + 1}</span>
                  <span className="sc-plan-mini-type" style={{ color: typeMeta.color }}>
                    {typeMeta.icon}
                  </span>
                </div>
                <span className="sc-plan-mini-title">
                  {p.title || <span style={{ color: 'var(--ie-text-faint)', fontStyle: 'italic' }}>Sans titre</span>}
                </span>
              </button>
            )
          })}
          {onCreatePlan && (
            <button
              type="button"
              className="sc-plan-mini sc-plan-mini-new"
              onClick={onCreatePlan}
              title="Créer un nouveau plan"
            >
              <Plus size={20} />
              <span>Nouveau plan</span>
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}
