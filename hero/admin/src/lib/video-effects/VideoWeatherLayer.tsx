'use client'
/**
 * VideoWeatherLayer — wrapper qui pose les effets météo (pluie/neige/brouillard/
 * nuages/éclairs) PAR-DESSUS une vidéo. Réutilise les composants déjà éprouvés
 * côté images (ParticleLayer, LightningEffect, RainyDayGlassLayer) qui sont
 * autonomes et n'assument rien sur leur parent (juste posés en absolute/inset:0).
 *
 * Refonte 2026-05-15de — Phase weather M1 : intégration des 8 presets weather
 * dans le système d'effets vidéo. Plein écran V0 (zones rect + brush en M3-M4).
 *
 * Empile N effets weather. Chaque entry du tableau est un WeatherParams complet
 * (cf. types.ts côté image-editor). Persiste dans `effects_params.weather`.
 */

import React from 'react'
import ParticleLayer from '@/components/image-editor/ParticleLayer'
import LightningEffect from '@/components/image-editor/LightningEffect'
import type { WeatherParams } from '@/components/image-editor/types'

interface VideoWeatherLayerProps {
  weather?: WeatherParams[] | null
}

export default function VideoWeatherLayer({ weather }: VideoWeatherLayerProps) {
  if (!weather || weather.length === 0) return null
  return (
    <>
      {weather.map((w, idx) => {
        if (!w || !w.kind) return null
        const key = `weather-${idx}-${w.kind}-${w.preset ?? 'custom'}`
        // Position absolue inset:0 par-dessus la zone parent (preview-box etc.).
        // Refonte 2026-05-15df — z-index 4+idx (au lieu de 8+) pour rester SOUS
        // les overlays HUD/Sniper (z=9-11). Sinon la pluie cache le crosshair.
        const style: React.CSSProperties = {
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 4 + idx,
        }
        if (w.kind === 'lightning') {
          return <LightningEffect key={key} weather={w} style={style} />
        }
        // rain / snow / fog / cloud → ParticleLayer
        return <ParticleLayer key={key} weather={w} style={style} />
      })}
    </>
  )
}
