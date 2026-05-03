'use client'
/**
 * CreditsButton — bouton 💎 dans le top bar avec popover plan/usage/upgrade.
 *
 * Phase 4 = données placeholder. Le wiring au backend billing viendra plus
 * tard (le système de plans/quotas n'est pas encore défini côté Hero).
 *
 * Logique d'affichage :
 *  - Couleur normale ≥ 30% restants
 *  - "low" (gold) entre 10-30%
 *  - "critical" (rouge + pulse) < 10%
 */

import React, { useEffect, useRef, useState } from 'react'
import { Gem } from 'lucide-react'

interface UsageRow {
  label: string
  used: number
  limit: number
  unit: string
}

// Mock data — sera fourni par le backend billing
const PLAN_NAME = 'Créateur Pro'
const PLAN_PRICE = '19€/mois'
const TOTAL_CREDITS = 200
const CURRENT_CREDITS = 142
const RENEWAL_DAYS = 14

const USAGE_ROWS: UsageRow[] = [
  { label: 'Images générées', used: 38, limit: 100, unit: '' },
  { label: 'Sons générés (IA)', used: 12, limit: 50, unit: '' },
  { label: 'Vidéos Wan', used: 6, limit: 20, unit: '' },
]

export default function CreditsButton() {
  const ratio = CURRENT_CREDITS / TOTAL_CREDITS
  const level: 'normal' | 'low' | 'critical' =
    ratio < 0.1 ? 'critical' : ratio < 0.3 ? 'low' : 'normal'

  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Click outside → close
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])

  return (
    <div className="dz-credits-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`dz-credits-btn ${level}`}
        onClick={() => setOpen(o => !o)}
        title="Plan & crédits"
      >
        <Gem size={13} />
        <span className="dz-credits-num">{CURRENT_CREDITS}</span>
        <span className="dz-credits-unit">crédits</span>
      </button>

      {open && (
        <div className="dz-credits-popover">
          <div className="dz-credits-header">
            <div className="dz-credits-plan">Plan {PLAN_NAME}</div>
            <div className="dz-credits-balance">
              {CURRENT_CREDITS} <span className="dz-credits-balance-unit">crédits restants</span>
            </div>
          </div>

          <div className="dz-credits-section">
            <div className="dz-catalog-section-title">Utilisation ce mois</div>
            {USAGE_ROWS.map((row, i) => {
              const pct = (row.used / row.limit) * 100
              const barLevel = pct > 80 ? 'critical' : pct > 60 ? 'warn' : 'normal'
              return (
                <div key={i}>
                  <div className="dz-credits-row">
                    <span>{row.label}</span>
                    <span className="dz-credits-row-right">
                      {row.used} / {row.limit}{row.unit}
                    </span>
                  </div>
                  <div className="dz-credits-bar">
                    <div className={`dz-credits-bar-fill ${barLevel}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
            <div className="dz-credits-renewal">
              Renouvellement dans {RENEWAL_DAYS} jours
            </div>
          </div>

          <div className="dz-credits-section">
            <div className="dz-catalog-section-title">Plan actuel</div>
            <div className="dz-credits-plan-name">{PLAN_NAME} · {PLAN_PRICE}</div>
            <div className="dz-credits-plan-desc">100 images · 50 sons · 20 vidéos / mois</div>
          </div>

          <div className="dz-credits-actions">
            <button
              type="button"
              className="dz-credits-action secondary"
              onClick={() => alert('Acheter pack 50 crédits supplémentaires : 9€')}
            >
              + Crédits
            </button>
            <button
              type="button"
              className="dz-credits-action primary"
              onClick={() => alert('Upgrade vers Studio Pro : 200 images / 100 sons / 50 vidéos pour 49€/mois')}
            >
              ⬆ Upgrade
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
