'use client'
/**
 * VideoEffectsPanel — Refonte 2026-05-15bq.
 *
 * Composant réutilisable pour éditer les VideoEffectsParams d'une pellicule.
 * Sliders groupés (Color / Cinéma / Spécial) + grille presets cliquables +
 * Reset. Émet `onChange(params)` à chaque mouvement de slider.
 *
 * Conçu pour vivre dans un drawer/inspector du Studio — pas de canvas dedans.
 * Le caller gère l'affichage du preview avec VideoEffectsCanvas séparément.
 */

import React from 'react'
import {
  type VideoEffectsParams, PRESETS, PRESET_LABELS,
} from './VideoEffectsCanvas'

const NEUTRAL: VideoEffectsParams = {
  brightness: 0, contrast: 0, saturate: 0, hue: 0,
  vignette: 0, filmGrain: 0, chromaticAberration: 0, bloom: 0,
  pixelate: 0, glitch: 'off',
}

interface VideoEffectsPanelProps {
  params: VideoEffectsParams | null | undefined
  onChange: (params: VideoEffectsParams) => void
  /** Désactive tous les contrôles (pendant un save async par ex). */
  disabled?: boolean
}

export default function VideoEffectsPanel({ params, onChange, disabled }: VideoEffectsPanelProps) {
  const p = params ?? NEUTRAL

  function patch(diff: Partial<VideoEffectsParams>) {
    onChange({ ...p, ...diff })
  }

  function applyPreset(key: keyof typeof PRESETS) {
    onChange({ ...NEUTRAL, ...PRESETS[key] })
  }

  function reset() {
    onChange(NEUTRAL)
  }

  return (
    <div className="vep-root" style={{
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
      fontSize: '0.85rem', color: 'var(--ie-text)',
      opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto',
    }}>
      {/* Presets */}
      <section>
        <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: 'var(--ie-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Presets
        </h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map(key => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className="vep-preset-btn"
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
          <button type="button" onClick={reset} className="vep-reset-btn">
            Reset
          </button>
        </div>
      </section>

      {/* Color */}
      <Group title="Color">
        <Slider label="Brightness" value={p.brightness ?? 0} min={-1} max={1} step={0.01}
          onChange={v => patch({ brightness: v })} />
        <Slider label="Contrast" value={p.contrast ?? 0} min={-1} max={1} step={0.01}
          onChange={v => patch({ contrast: v })} />
        <Slider label="Saturate" value={p.saturate ?? 0} min={-1} max={1} step={0.01}
          onChange={v => patch({ saturate: v })} />
        <Slider label="Hue" value={p.hue ?? 0} min={-1} max={1} step={0.01}
          onChange={v => patch({ hue: v })} />
      </Group>

      {/* Cinéma */}
      <Group title="Cinéma">
        <Slider label="Vignette" value={p.vignette ?? 0} min={0} max={1} step={0.01}
          onChange={v => patch({ vignette: v })} />
        <Slider label="Film grain" value={p.filmGrain ?? 0} min={0} max={1} step={0.01}
          onChange={v => patch({ filmGrain: v })} />
        <Slider label="Bloom" value={p.bloom ?? 0} min={0} max={1} step={0.01}
          onChange={v => patch({ bloom: v })} />
        <Slider label="Chrom. Aberr." value={p.chromaticAberration ?? 0} min={0} max={1} step={0.01}
          onChange={v => patch({ chromaticAberration: v })} />
      </Group>

      {/* Spécial */}
      <Group title="Spécial">
        <Slider label="Pixelate" value={p.pixelate ?? 0} min={0} max={1} step={0.01}
          onChange={v => patch({ pixelate: v })} />
        <label style={{ display: 'grid', gridTemplateColumns: '6rem 1fr', gap: '0.5rem', alignItems: 'center' }}>
          <span>Glitch</span>
          <select
            value={p.glitch ?? 'off'}
            onChange={e => patch({ glitch: e.target.value as VideoEffectsParams['glitch'] })}
            style={{ padding: '0.2rem 0.4rem' }}
          >
            <option value="off">Off</option>
            <option value="sporadic">Sporadique</option>
            <option value="constant">Constant</option>
          </select>
        </label>
      </Group>

      <style jsx>{`
        .vep-preset-btn {
          padding: 0.3rem 0.6rem;
          font-size: 0.78rem;
          background: var(--ie-surface);
          border: 1px solid var(--ie-border);
          color: var(--ie-text);
          border-radius: 0.25rem;
          cursor: pointer;
        }
        .vep-preset-btn:hover {
          border-color: var(--ie-accent);
        }
        .vep-reset-btn {
          padding: 0.3rem 0.6rem;
          font-size: 0.78rem;
          background: transparent;
          border: 1px solid var(--ie-accent);
          color: var(--ie-accent);
          border-radius: 0.25rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <h4 style={{
        margin: 0, fontSize: '0.75rem', color: 'var(--ie-text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {title}
      </h4>
      {children}
    </section>
  )
}

function Slider({
  label, value, min, max, step, onChange,
}: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label style={{
      display: 'grid', gridTemplateColumns: '6rem 1fr 3rem',
      gap: '0.5rem', alignItems: 'center', fontSize: '0.78rem',
    }}>
      <span>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />
      <span style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--ie-text-muted)' }}>
        {value.toFixed(2)}
      </span>
    </label>
  )
}
