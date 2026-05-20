'use client'
/**
 * ImpactZonesSubBlock — UI panel droit pour gérer les zones d'impact d'un
 * effet pluie (M4b refonte 2026-05-15dk).
 *
 * Une zone d'impact = une surface (water/hard/soft/glass) + une zone
 * géométrique (full/rect/brush) + paramètres (size, intensity, splash, flash).
 *
 * Les surfaces influencent le rendu visuel quand une goutte de pluie touche
 * la zone : water = anneau, hard = éclat, soft = absorption, glass = goutte
 * qui glisse (rainyday.js — disponible côté images, sera porté plus tard).
 */

import React from 'react'
import { Trash2, Plus } from 'lucide-react'
import type { WeatherParams, ImpactZoneEntry, ImpactSurface } from '@/components/image-editor/types'

interface ImpactZonesSubBlockProps {
  weather: WeatherParams
  weatherIdx: number
  editingImpact: { wIdx: number; iIdx: number } | null
  onSetEditingImpact: (next: { wIdx: number; iIdx: number } | null) => void
  onUpdateImpactZones: (
    updater: (zones: ImpactZoneEntry[]) => ImpactZoneEntry[],
  ) => void
}

const SURFACE_LABELS: Record<ImpactSurface, string> = {
  water: '💧 Eau (anneau)',
  hard:  '🪨 Dur (éclat)',
  soft:  '🌿 Absorbant',
  glass: '🪟 Vitre (V2)',
}

function makeId() {
  return `iz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export default function ImpactZonesSubBlock({
  weather, weatherIdx, editingImpact, onSetEditingImpact, onUpdateImpactZones,
}: ImpactZonesSubBlockProps) {
  const zones = weather.impactZones ?? []

  function addZone(surface: ImpactSurface) {
    onUpdateImpactZones((curr) => [...curr, {
      id: makeId(),
      surface,
      zone: { mode: 'full' },
      size: 16,
      intensity: 0.7,
      splash: surface === 'water' || surface === 'hard',
      flash: false,
      opacity: 1,
    }])
  }

  function patchZone(iIdx: number, patch: Partial<ImpactZoneEntry>) {
    onUpdateImpactZones((curr) => curr.map((z, i) => i === iIdx ? { ...z, ...patch } : z))
  }

  function deleteZone(iIdx: number) {
    onUpdateImpactZones((curr) => curr.filter((_, i) => i !== iIdx))
    if (editingImpact?.wIdx === weatherIdx && editingImpact?.iIdx === iIdx) {
      onSetEditingImpact(null)
    }
  }

  return (
    <div className="efx-impacts-block">
      <div className="efx-impacts-header">
        <span>Zones d'impact</span>
        <span className="efx-impacts-count">{zones.length}</span>
      </div>
      {zones.length === 0 && (
        <div className="efx-impacts-empty">
          Aucune zone définie. Les gouttes tombent partout sans effet d'impact.
        </div>
      )}
      {zones.map((z, i) => {
        const isEditing = editingImpact?.wIdx === weatherIdx && editingImpact?.iIdx === i
        return (
          <div key={z.id} className={`efx-impact-entry ${isEditing ? 'is-editing' : ''}`}>
            <div className="efx-impact-row">
              <select
                className="efx-impact-surface"
                value={z.surface}
                onChange={(e) => patchZone(i, { surface: e.target.value as ImpactSurface })}
                disabled={z.surface === 'glass'}
                title={z.surface === 'glass' ? 'Glass nécessite la frame vidéo (V2)' : undefined}
              >
                {(Object.keys(SURFACE_LABELS) as ImpactSurface[]).map((s) => (
                  <option key={s} value={s} disabled={s === 'glass'}>{SURFACE_LABELS[s]}</option>
                ))}
              </select>
              <button
                type="button"
                className="efx-impact-delete"
                onClick={() => deleteZone(i)}
                title="Supprimer cette zone d'impact"
                aria-label="Supprimer"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <div className="efx-impact-zone-row">
              <span className="efx-impact-zone-label">Zone :</span>
              <div className="efx-impact-zone-tabs">
                <button
                  type="button"
                  className={`efx-impact-zone-tab ${(z.zone?.mode ?? 'full') === 'full' ? 'is-active' : ''}`}
                  onClick={() => {
                    patchZone(i, { zone: { mode: 'full' } })
                    if (isEditing) onSetEditingImpact(null)
                  }}
                >Plein</button>
                <button
                  type="button"
                  className={`efx-impact-zone-tab ${z.zone?.mode === 'rect' ? 'is-active' : ''}`}
                  onClick={() => {
                    patchZone(i, { zone: { mode: 'rect', rect: z.zone?.rect } })
                    onSetEditingImpact({ wIdx: weatherIdx, iIdx: i })
                  }}
                >Rect</button>
                <button
                  type="button"
                  className={`efx-impact-zone-tab ${z.zone?.mode === 'brush' ? 'is-active' : ''}`}
                  onClick={() => {
                    patchZone(i, { zone: {
                      mode: 'brush',
                      strokes: z.zone?.strokes ?? [],
                      brushSize: z.zone?.brushSize ?? 0.04,
                      brushMode: z.zone?.brushMode ?? 'paint',
                    } })
                    onSetEditingImpact({ wIdx: weatherIdx, iIdx: i })
                  }}
                >Pinceau</button>
              </div>
              {(z.zone?.mode === 'rect' || z.zone?.mode === 'brush') && (
                <button
                  type="button"
                  className="efx-impact-edit-btn"
                  onClick={() => onSetEditingImpact(isEditing ? null : { wIdx: weatherIdx, iIdx: i })}
                >
                  {isEditing ? 'OK' : 'Éditer'}
                </button>
              )}
            </div>
            {/* Sliders impact size/intensity */}
            <div className="efx-impact-sliders">
              <label className="efx-impact-slider">
                <span>Taille</span>
                <input type="range" min={5} max={50} step={1}
                  value={z.size ?? 16}
                  onChange={(e) => patchZone(i, { size: Number(e.target.value) })} />
                <span className="efx-impact-val">{z.size ?? 16}</span>
              </label>
              <label className="efx-impact-slider">
                <span>Intensité</span>
                <input type="range" min={0.05} max={1} step={0.05}
                  value={z.intensity ?? 0.7}
                  onChange={(e) => patchZone(i, { intensity: Number(e.target.value) })} />
                <span className="efx-impact-val">{(z.intensity ?? 0.7).toFixed(2)}</span>
              </label>
              <label className="efx-impact-slider">
                <span>Opacité</span>
                <input type="range" min={0} max={1} step={0.05}
                  value={z.opacity ?? 1}
                  onChange={(e) => patchZone(i, { opacity: Number(e.target.value) })} />
                <span className="efx-impact-val">{(z.opacity ?? 1).toFixed(2)}</span>
              </label>
            </div>
            <div className="efx-impact-toggles">
              <label className="efx-impact-toggle">
                <input type="checkbox" checked={!!z.splash}
                  onChange={(e) => patchZone(i, { splash: e.target.checked })} />
                Éclaboussures
              </label>
              <label className="efx-impact-toggle">
                <input type="checkbox" checked={!!z.flash}
                  onChange={(e) => patchZone(i, { flash: e.target.checked })} />
                Flash
              </label>
            </div>
          </div>
        )
      })}
      <div className="efx-impacts-add-row">
        <span className="efx-impacts-add-label">+ Ajouter zone :</span>
        <button type="button" className="efx-impacts-add-btn" onClick={() => addZone('water')}>
          <Plus size={10} /> Eau
        </button>
        <button type="button" className="efx-impacts-add-btn" onClick={() => addZone('hard')}>
          <Plus size={10} /> Dur
        </button>
        <button type="button" className="efx-impacts-add-btn" onClick={() => addZone('soft')}>
          <Plus size={10} /> Absorbant
        </button>
      </div>
    </div>
  )
}
