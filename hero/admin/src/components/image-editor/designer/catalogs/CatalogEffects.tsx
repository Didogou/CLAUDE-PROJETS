'use client'
/**
 * CatalogEffects — catalogue des effets visuels (atmosphère, surfaces, filtres).
 *
 * En v1 = WEATHER_PRESETS uniquement (rain/snow/fog/cloud/lightning). Les
 * effets glass/particles/filtres viendront plus tard quand on aura décidé
 * de leur structure de données stable.
 *
 * Click sur un preset → addWeatherLayer (réutilise la fonction existante).
 */

import React, { useState } from 'react'
import CatalogShell from './CatalogShell'
import { WEATHER_PRESETS } from '../../types'
import { addWeatherLayer } from '../../folds/FoldAtmosphere'
import { useEditorState } from '../../EditorStateContext'

interface CatalogEffectsProps {
  onClose: () => void
}

export default function CatalogEffects({ onClose }: CatalogEffectsProps) {
  const { addLayer } = useEditorState()
  const [search, setSearch] = useState('')

  const filtered = WEATHER_PRESETS.filter(p =>
    p.label.toLowerCase().includes(search.toLowerCase()) ||
    p.hint?.toLowerCase().includes(search.toLowerCase()),
  )

  // Groupe par kind
  const grouped = filtered.reduce<Record<string, typeof WEATHER_PRESETS>>((acc, p) => {
    if (!acc[p.kind]) acc[p.kind] = []
    acc[p.kind].push(p)
    return acc
  }, {})

  const KIND_LABELS: Record<string, string> = {
    rain: 'Pluie',
    snow: 'Neige',
    fog: 'Brouillard',
    cloud: 'Nuages',
    lightning: 'Éclairs',
  }

  function handleAdd(preset: typeof WEATHER_PRESETS[number]) {
    addWeatherLayer(preset, addLayer)
    // On ne ferme pas auto le catalogue : l'auteur peut vouloir empiler plusieurs effets
  }

  return (
    <CatalogShell
      title="🌧 Effets visuels"
      onClose={onClose}
      searchPlaceholder="Rechercher un effet…"
      searchValue={search}
      onSearchChange={setSearch}
    >
      {Object.entries(grouped).map(([kind, presets]) => (
        <div key={kind} className="dz-catalog-section">
          <div className="dz-catalog-section-title">{KIND_LABELS[kind] ?? kind}</div>
          <div className="dz-catalog-grid">
            {presets.map(p => (
              <button
                key={p.key}
                type="button"
                className="dz-catalog-item"
                onClick={() => handleAdd(p)}
                title={p.hint}
              >
                <span className="dz-catalog-item-ico">{p.icon}</span>
                <span className="dz-catalog-item-label">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="dz-catalog-empty">Aucun effet ne correspond à « {search} »</div>
      )}
      <div className="dz-catalog-note">
        Vitre, particles custom, filtres glfx — viendront dans les prochaines versions.
      </div>
    </CatalogShell>
  )
}
