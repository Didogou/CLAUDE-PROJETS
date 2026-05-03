'use client'
/**
 * Fold « Paramètres » — champs dynamiques selon le kind choisi.
 *
 * Actuellement implémenté : **motion_brush**.
 * Params exposés :
 *   - denoise  (0.3-0.9) : force motion vs préservation apparence
 *   - frames   (4-24)    : nombre de frames du loop (impact majeur sur temps)
 *   - steps    (10-40)   : qualité diffusion (impact linéaire sur temps)
 *   - fps      (6-16)    : vitesse de lecture du loop
 *
 * Stocké dans `layer.animation.params` (Record<string, unknown>) → persisté
 * par calque, lu par FoldAnimationBake au moment du bake.
 */
import React from 'react'
import { useEditorState } from '../EditorStateContext'
import type { LayerAnimationKind } from '../types'

// Défauts centralisés — importés aussi par FoldAnimationBake pour cohérence
export const MOTION_BRUSH_DEFAULTS = {
  denoise: 0.4,
  frames: 6,
  steps: 15,
  fps: 8,
  // Negative prompt solide contre le color shift / distortion AnimateDiff
  prompt_negative: 'static, frozen, distorted, morphing, blurry, identical frames, no motion, color shift, saturation change, different hue, recoloring, style drift, appearance change, different pose, different shape',
} as const

interface MotionBrushParams {
  denoise?: number
  frames?: number
  steps?: number
  fps?: number
  prompt_positive?: string
  prompt_negative?: string
}

export default function FoldAnimationParams() {
  const { layers, activeLayerIdx, updateLayer } = useEditorState()
  const layer = layers[activeLayerIdx]
  const kind = layer?.animation?.kind

  if (!kind) {
    return (
      <div style={hintStyle}>Sélectionne d&apos;abord un type d&apos;animation.</div>
    )
  }

  // Les deux kinds câblés partagent les mêmes params (denoise/frames/steps/fps
   // + prompts positif/négatif). Les autres kinds affichent le placeholder.
  const isParamsSupported = kind === 'motion_brush' || kind === 'cinemagraph'
  if (!isParamsSupported) {
    return (
      <div style={hintStyle}>Paramètres « {kind} » — à venir.</div>
    )
  }

  const params = (layer.animation?.params ?? {}) as MotionBrushParams
  const denoise = params.denoise ?? MOTION_BRUSH_DEFAULTS.denoise
  const frames = params.frames ?? MOTION_BRUSH_DEFAULTS.frames
  const steps = params.steps ?? MOTION_BRUSH_DEFAULTS.steps
  const fps = params.fps ?? MOTION_BRUSH_DEFAULTS.fps
  const promptPositive = params.prompt_positive ?? ''
  const promptNegative = params.prompt_negative ?? MOTION_BRUSH_DEFAULTS.prompt_negative

  function updateParam<K extends keyof MotionBrushParams>(key: K, value: MotionBrushParams[K]) {
    updateLayer(activeLayerIdx, {
      animation: {
        ...(layer!.animation ?? {}),
        kind: kind as LayerAnimationKind,
        params: { ...params, [key]: value },
      },
    })
  }

  // Estimation du temps de bake : ~linéaire en (steps × frames).
  // Base 8 Go laptop : ~15s/step pour 16 frames → ~0.94s/(step·frame).
  const estimatedSec = Math.round(steps * frames * 0.94 + 30)
  const estimatedMin = Math.floor(estimatedSec / 60)
  const estimatedRest = estimatedSec % 60
  const timeLabel = estimatedMin > 0
    ? `~${estimatedMin}min ${estimatedRest.toString().padStart(2, '0')}s`
    : `~${estimatedSec}s`

  async function suggestPromptFromVision() {
    if (!layer?.media_url) return
    try {
      const res = await fetch('/api/editor/describe-motion-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: layer.media_url }),
      })
      const d = await res.json() as { prompt?: string; error?: string }
      if (res.ok && d.prompt) updateParam('prompt_positive', d.prompt)
    } catch (err) {
      console.warn('[FoldAnimationParams] describe-motion failed:', err)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-3)' }}>
      {/* Prompts — positive + negative, éditables */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)' }}>
          <span>Prompt positif (décris le mouvement, en EN)</span>
          <button
            onClick={() => void suggestPromptFromVision()}
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 'var(--ie-radius-sm)',
              border: '1px solid var(--ie-border-strong)',
              background: 'transparent',
              color: 'var(--ie-text-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            title="Claude Vision analyse l'image du calque et rédige un prompt de motion"
          >✨ Suggérer</button>
        </div>
        <textarea
          value={promptPositive}
          onChange={(e) => updateParam('prompt_positive', e.target.value)}
          placeholder="ex: leaves gently swaying in the wind, organic motion"
          rows={2}
          style={textareaStyle}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
        <div style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)' }}>
          Prompt négatif (ce qu&apos;il faut éviter — crucial contre le color shift)
        </div>
        <textarea
          value={promptNegative}
          onChange={(e) => updateParam('prompt_negative', e.target.value)}
          placeholder={MOTION_BRUSH_DEFAULTS.prompt_negative}
          rows={3}
          style={textareaStyle}
        />
        {promptNegative !== MOTION_BRUSH_DEFAULTS.prompt_negative && (
          <button
            onClick={() => updateParam('prompt_negative', MOTION_BRUSH_DEFAULTS.prompt_negative)}
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 'var(--ie-radius-sm)',
              border: 'none',
              background: 'transparent',
              color: 'var(--ie-text-muted)',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
              textDecoration: 'underline',
            }}
          >↺ Réinitialiser au défaut</button>
        )}
      </div>

      {/* Presets rapides */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ie-space-1)' }}>
        <button
          onClick={() => {
            updateLayer(activeLayerIdx, {
              animation: {
                ...(layer.animation ?? {}),
                kind,
                params: { denoise: 0.4, frames: 6, steps: 15, fps: 8 },
              },
            })
          }}
          style={presetBtnStyle}
          title="6 frames · 15 steps · ~1min 20s"
        >⚡ Rapide</button>
        <button
          onClick={() => {
            updateLayer(activeLayerIdx, {
              animation: {
                ...(layer.animation ?? {}),
                kind,
                params: { denoise: 0.45, frames: 16, steps: 25, fps: 8 },
              },
            })
          }}
          style={presetBtnStyle}
          title="16 frames · 25 steps · ~6-7min"
        >🎬 Qualité</button>
      </div>

      <Slider
        label="Force du mouvement (denoise)"
        value={denoise}
        min={0.1} max={0.9} step={0.05}
        onChange={(v) => updateParam('denoise', v)}
        hint={
          denoise < 0.2 ? 'Zero drift couleurs — motion à peine perceptible'
          : denoise < 0.35 ? 'Motion très subtile, apparence parfaitement préservée'
          : denoise < 0.5 ? 'Motion visible, apparence bien préservée'
          : denoise < 0.65 ? 'Motion forte — couleurs/formes peuvent dériver'
          : 'Re-génération quasi complète de la zone'
        }
      />

      <Slider
        label="Frames (longueur du loop)"
        value={frames}
        min={4} max={16} step={2}
        onChange={(v) => updateParam('frames', v)}
        hint={`Loop de ${(frames / fps).toFixed(2)}s · limité à 16 (context natif AnimateDiff)`}
      />

      <Slider
        label="Steps (qualité diffusion)"
        value={steps}
        min={10} max={40} step={5}
        onChange={(v) => updateParam('steps', v)}
        hint={steps < 15 ? 'Rapide mais peut être bruité' : steps > 30 ? 'Très propre mais lent' : 'Compromis standard'}
      />

      <Slider
        label="FPS (vitesse lecture)"
        value={fps}
        min={6} max={16} step={1}
        onChange={(v) => updateParam('fps', v)}
        hint={`${fps} images/sec · loop ${(frames / fps).toFixed(2)}s`}
      />

      <div style={{
        padding: 'var(--ie-space-2) var(--ie-space-3)',
        background: 'var(--ie-surface-2)',
        border: '1px solid var(--ie-border)',
        borderRadius: 'var(--ie-radius)',
        fontSize: 'var(--ie-text-xs)',
        color: 'var(--ie-text-muted)',
        textAlign: 'center',
      }}>
        Temps estimé par bake : <b style={{ color: 'var(--ie-text)' }}>{timeLabel}</b>
      </div>
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, step, onChange, hint,
}: {
  label: string
  value: number
  min: number; max: number; step: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-muted)',
      }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: 'var(--ie-text)', fontVariantNumeric: 'tabular-nums' }}>
          {Number.isInteger(step) ? value : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--ie-accent)' }}
      />
      {hint && (
        <div style={{ fontSize: 'var(--ie-text-xs)', color: 'var(--ie-text-faint)', fontStyle: 'italic', lineHeight: 1.3 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const hintStyle: React.CSSProperties = {
  padding: 'var(--ie-space-3)',
  fontSize: 'var(--ie-text-sm)',
  color: 'var(--ie-text-muted)',
  fontStyle: 'italic',
}

const presetBtnStyle: React.CSSProperties = {
  padding: 'var(--ie-space-2) var(--ie-space-3)',
  borderRadius: 'var(--ie-radius)',
  border: '1px solid var(--ie-border-strong)',
  background: 'var(--ie-surface)',
  color: 'var(--ie-text)',
  fontSize: 'var(--ie-text-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'all var(--ie-transition)',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--ie-space-2)',
  background: 'var(--ie-surface)',
  border: '1px solid var(--ie-border-strong)',
  borderRadius: 'var(--ie-radius)',
  color: 'var(--ie-text)',
  fontSize: 'var(--ie-text-sm)',
  fontFamily: 'inherit',
  outline: 'none',
  resize: 'vertical',
  lineHeight: 1.4,
  minHeight: 48,
}
