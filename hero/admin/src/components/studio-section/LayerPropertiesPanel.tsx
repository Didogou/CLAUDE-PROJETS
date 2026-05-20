'use client'
/**
 * LayerPropertiesPanel — éditeur de propriétés d'UN calque sélectionné.
 *
 * Phase A bis.4 du chantier 2026-05-18.
 *
 * Remplace l'ancien `PelliculeLayersPanel` (qui mélangait liste + éditeur).
 * Désormais : la liste est gérée par la track Calques de la timeline (les
 * blocks visuels), et CE panel n'affiche que l'édition contextuelle du calque
 * actuellement cliqué (= block sélectionné).
 *
 * Layout : ancré en bas de la zone timeline, plein largeur, hauteur ~14rem.
 * Contient : thumb du média + sliders transform + mask + (futur) effects.
 *
 * Données : fetch ce calque via /api/pellicules/[parentId]/layers (filtre par
 * layerId). Mutations via PATCH même route.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import type { PelliculeLayerRow, LayerBlendMode } from '@/lib/pellicule-layers-types'

const BLEND_MODES: LayerBlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'soft-light', 'hard-light', 'difference',
]

interface LayerPropertiesPanelProps {
  /** ID de la pellicule parente (= section_timeline.id, FK pellicule_layers). */
  parentPelliculeId: string
  /** ID du calque à éditer (= pellicule_layers.id). */
  layerId: string
  /** Layer hydraté depuis le parent (évite un fetch supplémentaire ; le parent
   *  a déjà la liste via layersByPelliculeId). Si null/undefined le panel
   *  fetch lui-même. */
  layer?: PelliculeLayerRow | null
  onClose: () => void
  /** Émis à chaque mutation pour rafraîchir le state parent. */
  onLayerChange?: (updatedLayer: PelliculeLayerRow) => void
  onLayerDelete?: () => void
  /** Phase A.5 — pilotage mask drawing (re-utilise le state global maskDraft). */
  onStartMaskEdit?: (shape: 'rect' | 'polygon') => void
  onCancelMaskEdit?: () => void
  maskDraftActive?: boolean
  maskDraftShape?: 'rect' | 'polygon' | null
  maskDraftPoints?: Array<[number, number]>
  onFinishMaskEdit?: () => void
}

export default function LayerPropertiesPanel({
  parentPelliculeId, layerId, layer: layerFromProps, onClose, onLayerChange, onLayerDelete,
  onStartMaskEdit, onCancelMaskEdit, maskDraftActive, maskDraftShape, maskDraftPoints, onFinishMaskEdit,
}: LayerPropertiesPanelProps) {
  const [layer, setLayer] = useState<PelliculeLayerRow | null>(layerFromProps ?? null)
  const [loading, setLoading] = useState(!layerFromProps)

  // Si le parent fournit le layer, on l'utilise directement (sync state local).
  useEffect(() => {
    if (layerFromProps) {
      setLayer(layerFromProps)
      setLoading(false)
    }
  }, [layerFromProps])

  // Fallback : fetch tous les layers de la pellicule + filtre.
  useEffect(() => {
    if (layerFromProps) return
    setLoading(true)
    fetch(`/api/pellicules/${parentPelliculeId}/layers`)
      .then(r => r.json() as Promise<{ layers: PelliculeLayerRow[] }>)
      .then(({ layers }) => {
        setLayer(layers.find(l => l.id === layerId) ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [parentPelliculeId, layerId, layerFromProps])

  const patchLayer = useCallback(async (patch: Partial<PelliculeLayerRow>) => {
    if (!layer) return
    const optimistic = { ...layer, ...patch }
    setLayer(optimistic)
    onLayerChange?.(optimistic)
    try {
      const res = await fetch(`/api/pellicules/${parentPelliculeId}/layers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: [{ id: layerId, ...patch }] }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[LayerProps PATCH]', err)
    }
  }, [parentPelliculeId, layerId, layer, onLayerChange])

  const handleDelete = async () => {
    if (!confirm('Supprimer ce calque ?')) return
    try {
      await fetch(`/api/pellicules/${parentPelliculeId}/layers?layerId=${layerId}`, { method: 'DELETE' })
      onLayerDelete?.()
      onClose()
    } catch (err) {
      console.error('[LayerProps DELETE]', err)
    }
  }

  if (loading) {
    return (
      <div className="ste-lprops">
        <Header onClose={onClose} title="Chargement…" />
      </div>
    )
  }
  if (!layer) {
    return (
      <div className="ste-lprops">
        <Header onClose={onClose} title="Calque introuvable" />
      </div>
    )
  }

  const canFinishMask = maskDraftActive && maskDraftShape && (maskDraftPoints ?? []).length >= (maskDraftShape === 'rect' ? 2 : 3)
  const hasMask = !!layer.mask

  return (
    <div className="ste-lprops">
      <Header onClose={onClose} title={`Calque · ${layer.type}`} onDelete={handleDelete} />
      <div className="ste-lprops-body">
        {/* Colonne gauche : thumb + infos */}
        <div className="ste-lprops-thumb-col">
          <div className="ste-lprops-thumb">
            {layer.media_url && layer.type !== 'video' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={layer.media_url} alt="" />
            )}
            {layer.media_url && layer.type === 'video' && (
              <video src={layer.media_url} autoPlay loop muted playsInline />
            )}
          </div>
          <div className="ste-lprops-info">
            <span>{layer.type} #{layer.z_index}</span>
            <span>{Math.round(layer.start_ms_rel)}ms → {layer.duration_ms ?? '∞'}ms</span>
          </div>
        </div>

        {/* Colonne centrale : transform */}
        <div className="ste-lprops-col">
          <Slider label="Position X" value={layer.position_x} min={0} max={100} step={0.5}
            onChange={v => void patchLayer({ position_x: v })} suffix="%" />
          <Slider label="Position Y" value={layer.position_y} min={0} max={100} step={0.5}
            onChange={v => void patchLayer({ position_y: v })} suffix="%" />
          <Slider label="Taille" value={layer.scale} min={0.1} max={3} step={0.05}
            onChange={v => void patchLayer({ scale: v })} suffix="×" />
          <Slider label="Rotation" value={layer.rotation} min={-180} max={180} step={1}
            onChange={v => void patchLayer({ rotation: v })} suffix="°" />
          <Slider label="Opacité" value={layer.opacity} min={0} max={1} step={0.01}
            onChange={v => void patchLayer({ opacity: v })}
            valueFormat={v => `${Math.round(v * 100)}%`} />
          <div className="ste-lprops-field">
            <label>Blend</label>
            <select value={layer.blend}
              onChange={e => void patchLayer({ blend: e.target.value as LayerBlendMode })}>
              {BLEND_MODES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        {/* Colonne droite : timing + mask */}
        <div className="ste-lprops-col">
          <NumField label="Début (ms rel.)" value={layer.start_ms_rel} min={0} step={50}
            onChange={v => void patchLayer({ start_ms_rel: v })} />
          <NumField label="Durée (ms)" value={layer.duration_ms ?? 0} min={0} step={50}
            onChange={v => void patchLayer({ duration_ms: v > 0 ? v : null })}
            placeholder="0 = jusqu'à la fin de la pellicule" />

          <div className="ste-lprops-section">
            <div className="ste-lprops-section-title">Mask (zone visible)</div>
            {!maskDraftActive ? (
              <div className="ste-lprops-mask-row">
                <button type="button" className="ste-lprops-btn"
                  onClick={() => onStartMaskEdit?.('rect')}
                  disabled={!onStartMaskEdit}>▭ Rectangle</button>
                <button type="button" className="ste-lprops-btn"
                  onClick={() => onStartMaskEdit?.('polygon')}
                  disabled={!onStartMaskEdit}>◇ Polygone</button>
                {hasMask && (
                  <button type="button" className="ste-lprops-btn is-danger"
                    onClick={() => void patchLayer({ mask: null })}>Effacer</button>
                )}
                <span className="ste-lprops-status">
                  {hasMask ? `${layer.mask!.shape} (${layer.mask!.points.length} pts)` : 'Aucun'}
                </span>
              </div>
            ) : (
              <div className="ste-lprops-mask-row">
                <span className="ste-lprops-status">
                  {maskDraftShape} : {(maskDraftPoints ?? []).length} point{(maskDraftPoints ?? []).length > 1 ? 's' : ''}
                </span>
                <button type="button" className="ste-lprops-btn is-primary"
                  onClick={onFinishMaskEdit} disabled={!canFinishMask}>Terminer</button>
                <button type="button" className="ste-lprops-btn"
                  onClick={onCancelMaskEdit}>Annuler</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sous-composants ─────────────────────────────────────────────────────

function Header({ onClose, title, onDelete }: {
  onClose: () => void; title: string; onDelete?: () => void
}) {
  return (
    <div className="ste-lprops-header">
      <span className="ste-lprops-title">{title}</span>
      {onDelete && (
        <button type="button" className="ste-lprops-headerbtn is-danger"
          onClick={onDelete} title="Supprimer le calque">
          <Trash2 size={12} />
        </button>
      )}
      <button type="button" className="ste-lprops-headerbtn"
        onClick={onClose} title="Fermer">
        <X size={12} />
      </button>
    </div>
  )
}

function Slider({ label, value, min, max, step, suffix, valueFormat, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  suffix?: string; valueFormat?: (v: number) => string; onChange: (v: number) => void
}) {
  return (
    <div className="ste-lprops-field">
      <label>
        <span>{label}</span>
        <span className="ste-lprops-value">
          {valueFormat ? valueFormat(value) : `${value}${suffix ?? ''}`}
        </span>
      </label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

function NumField({ label, value, min, step, onChange, placeholder }: {
  label: string; value: number; min?: number; step?: number;
  placeholder?: string; onChange: (v: number) => void
}) {
  return (
    <div className="ste-lprops-field">
      <label>{label}</label>
      <input type="number" min={min} step={step} value={value}
        placeholder={placeholder}
        onChange={e => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(v)
        }} />
    </div>
  )
}
