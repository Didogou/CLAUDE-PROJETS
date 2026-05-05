'use client'
/**
 * DevStudioPicker — grille 4×3 de plans pré-créés en DB pour le Dev-Studio.
 *
 * Au mount, appelle POST /api/dev-studio/init (idempotent) qui crée/réutilise
 * le book "Dev-Studio" + 4 sections × 3 plans pré-remplis avec les prompts
 * test-scenes.json. Affiche la grille → click sur un plan = ouvre le Studio
 * Designer sur ce plan (bookId + sectionId + planIndex).
 *
 * Remplace l'ancien SceneTestPicker (basé localStorage) — décision 2026-05-03 :
 * tout doit être en DB Supabase, pas localStorage (cf
 * project_studio_designer_is_real_not_test.md).
 */

import { useEffect, useState } from 'react'
import type { SectionImage } from '@/types'

export interface DevStudioSection {
  id: string
  number: number
  name: string
  plans: SectionImage[]
}

export interface DevStudioInitResult {
  bookId: string
  bookTitle: string
  sections: DevStudioSection[]
}

/** Sélection d'un plan par l'utilisateur. */
export interface PickedPlan {
  bookId: string
  sectionId: string
  sectionName: string
  sectionNumber: number
  planIndex: number
  plan: SectionImage
}

interface DevStudioPickerProps {
  onPick: (picked: PickedPlan) => void
}

export default function DevStudioPicker({ onPick }: DevStudioPickerProps) {
  const [data, setData] = useState<DevStudioInitResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/dev-studio/init', { method: 'POST' })
        const d = await res.json() as DevStudioInitResult & { error?: string }
        if (cancelled) return
        if (!res.ok) throw new Error(d.error ?? `init HTTP ${res.status}`)
        setData(d)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[DevStudioPicker] init failed:', msg)
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div style={dsStyles.container}>
        <div style={dsStyles.title}>Studio Designer — Dev workspace</div>
        <div style={dsStyles.subtitle}>Initialisation du book Dev-Studio en cours…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={dsStyles.container}>
        <div style={dsStyles.title}>Studio Designer — Erreur</div>
        <div style={{ ...dsStyles.subtitle, color: '#ef4444' }}>
          Init failed : {error}
        </div>
        <div style={dsStyles.subtitle}>
          Vérifie que Supabase est accessible. Le book "Dev-Studio" sera (re)créé au prochain refresh.
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div style={dsStyles.container}>
      <div style={dsStyles.title}>Studio Designer — Dev workspace</div>
      <div style={dsStyles.subtitle}>
        Book <code style={dsStyles.code}>{data.bookTitle}</code> · {data.sections.length} sections × 3 plans = {data.sections.length * 3} cellules.
        Tout est persisté en Supabase. Click sur un plan pour l&apos;ouvrir.
      </div>

      <div style={dsStyles.grid}>
        {data.sections.map(section => (
          <div key={section.id} style={dsStyles.row}>
            <div style={dsStyles.rowHeader}>
              <span style={dsStyles.sectionNumber}>S{section.number}</span>
              <span style={dsStyles.sectionName}>{section.name}</span>
            </div>
            <div style={dsStyles.cells}>
              {section.plans.map((plan, planIdx) => (
                <button
                  key={planIdx}
                  type="button"
                  style={dsStyles.cell}
                  onClick={() => onPick({
                    bookId: data.bookId,
                    sectionId: section.id,
                    sectionName: section.name,
                    sectionNumber: section.number,
                    planIndex: planIdx,
                    plan,
                  })}
                >
                  {plan.url ? (
                    <img src={plan.url} alt={plan.description ?? `Plan ${planIdx + 1}`} style={dsStyles.cellThumb} />
                  ) : (
                    <div style={dsStyles.cellEmpty}>
                      <span style={dsStyles.cellEmptyIcon}>+</span>
                      <span style={dsStyles.cellEmptyText}>Vide — prompt prêt</span>
                    </div>
                  )}
                  <div style={dsStyles.cellLabel}>
                    <div style={dsStyles.cellTitle}>{plan.description ?? `Plan ${planIdx + 1}`}</div>
                    <div style={dsStyles.cellSub}>
                      {plan.kind === 'animation' ? '🎬 anim' : '🖼 image'}
                      {plan.url && ' · ✓ généré'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Styles inline (page de dev, pas la peine d'externaliser CSS) ─────────

const dsStyles: Record<string, React.CSSProperties> = {
  container: {
    padding: 32,
    minHeight: '100vh',
    background: '#0d0d0d',
    color: '#e8e8e8',
    fontFamily: 'system-ui, sans-serif',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: '-0.01em',
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    marginBottom: 24,
    lineHeight: 1.5,
  },
  code: {
    background: '#1f1f1f',
    color: '#9cdcfe',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 12,
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    maxWidth: 1400,
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  rowHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    paddingBottom: 6,
    borderBottom: '1px solid #2a2a2a',
  },
  sectionNumber: {
    fontSize: 11,
    fontWeight: 700,
    color: '#ec4899',
    letterSpacing: '0.5px',
  },
  sectionName: {
    fontSize: 16,
    fontWeight: 600,
    color: '#e8e8e8',
  },
  cells: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    padding: 0,
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'border-color 120ms, transform 120ms',
    color: 'inherit',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  cellThumb: {
    width: '100%',
    aspectRatio: '16 / 9',
    objectFit: 'cover',
    background: '#0a0a0a',
  },
  cellEmpty: {
    width: '100%',
    aspectRatio: '16 / 9',
    background: '#0a0a0a',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    color: '#444',
  },
  cellEmptyIcon: {
    fontSize: 28,
    fontWeight: 300,
    lineHeight: 1,
  },
  cellEmptyText: {
    fontSize: 10,
    fontStyle: 'italic',
  },
  cellLabel: {
    padding: '8px 10px',
    borderTop: '1px solid #2a2a2a',
  },
  cellTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#e8e8e8',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cellSub: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
}
