'use client'
/**
 * PelliculeLayersPanel — éditeur de calques pour UNE pellicule (Studio Section).
 *
 * Phase A.4 du chantier keyframes 2026-05-18.
 *
 * Responsabilités :
 *   - Fetch /api/pellicules/[id]/layers au mount + sur change pelliculeId
 *   - Liste des calques (ordre z_index ASC = du bas vers le haut)
 *   - "+ Ajouter calque" : 2 sources (banque ou upload)
 *   - Sélection d'un calque → édition position/scale/rotation/opacity/blend/visible
 *   - Suppression
 *   - Émet onLayersChange à chaque mutation pour que le parent puisse propager
 *     au PreviewModal embedded (live preview)
 *
 * Hors scope Phase A.4 (à venir en A.5 + A.6) :
 *   - Outil dessin mask (rect + polygon)
 *   - Éditeur effets (glow / shadow / blur)
 *
 * Hors scope Phase A (= Phase B+) :
 *   - Keyframes (animation dans le temps)
 *   - Drag-reorder z_index (placeholder buttons up/down V1)
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, Loader2, Upload, FolderOpen, Sparkles } from 'lucide-react'
import type {
  PelliculeLayerRow,
  PelliculeLayerType,
  LayerBlendMode,
} from '@/lib/pellicule-layers-types'
import type { PelliculeKeyframe, KeyframeEasing } from '@/lib/pellicule-keyframes'

interface PelliculeLayersPanelProps {
  pelliculeId: string
  onClose: () => void
  /** Notifié quand la liste des calques change (création/suppression/édition).
   *  Le parent peut alors re-fournir les layers au PreviewModal pour live preview. */
  onLayersChange?: (layers: PelliculeLayerRow[]) => void
  /** Optionnel : ouverture d'un picker depuis la banque. Reçoit le type cible
   *  et un callback à appeler avec l'URL choisie. Si non fourni, le bouton
   *  "Depuis banque" est désactivé (V1 minimal — l'upload reste actif). */
  onPickFromBank?: (type: PelliculeLayerType, onPicked: (mediaUrl: string) => void) => void
  /** Optionnel : fonction d'upload qui retourne une URL Supabase. Si non fournie,
   *  le bouton Upload est désactivé. */
  onUpload?: (file: File) => Promise<string>
  /** Phase A.5 — démarre un dessin de mask sur la pellicule courante.
   *  Le parent crée le state global { pelliculeId, shape, points: [], onAddPoint }
   *  et le passe au PreviewModal pour rendre l'overlay drawing.
   *  Le panel récupère les points via getMaskDraftPoints (controlled depuis le parent). */
  onStartMaskEdit?: (layerId: string, shape: 'rect' | 'polygon') => void
  /** Phase A.5 — annule le dessin en cours (= maskDraft state cleared parent). */
  onCancelMaskEdit?: () => void
  /** Phase A.5 — récupère les points actuellement dessinés sur le preview. Le
   *  panel les affiche en preview et propose Terminer quand assez de points. */
  maskDraftPoints?: Array<[number, number]>
  maskDraftShape?: 'rect' | 'polygon' | null
  maskDraftLayerId?: string | null

  /** Phase B keyframes 2026-05-18 — animation runtime de la pellicule entière.
   *  Le panel affiche/édite ces keyframes en haut. Le parent persist via API
   *  (PATCH /api/sections/[id]/timeline body { blocks: [{ id, keyframes }] }). */
  pelliculeKeyframes?: PelliculeKeyframe[] | null
  onKeyframesChange?: (keyframes: PelliculeKeyframe[]) => void
  /** Phase B.3 — cursor partagé du preview en ms (relatif à la pellicule éditée),
   *  utilisé par "Ajouter keyframe au temps courant". Si non fourni, "Ajouter"
   *  crée un keyframe à t=0. */
  sharedCursorRelMs?: number
  /** Durée totale de la pellicule (ms) pour clamper les t des keyframes. */
  pelliculeDurationMs?: number
}

const BLEND_MODES: LayerBlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'soft-light', 'hard-light', 'difference',
]

export default function PelliculeLayersPanel({
  pelliculeId, onClose, onLayersChange, onPickFromBank, onUpload,
  onStartMaskEdit, onCancelMaskEdit,
  maskDraftPoints, maskDraftShape, maskDraftLayerId,
  pelliculeKeyframes, onKeyframesChange, sharedCursorRelMs, pelliculeDurationMs,
}: PelliculeLayersPanelProps) {
  const [layers, setLayers] = useState<PelliculeLayerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuType, setAddMenuType] = useState<PelliculeLayerType>('image')

  // Notifie le parent quand layers change (live preview).
  const onLayersChangeRef = React.useRef(onLayersChange)
  useEffect(() => { onLayersChangeRef.current = onLayersChange }, [onLayersChange])

  // Reset la sélection quand on change de pellicule (sinon le selectedLayerId
  // pointe vers une row d'une autre pellicule → l'éditeur affiche du n'importe quoi).
  useEffect(() => { setSelectedLayerId(null) }, [pelliculeId])

  // Fetch au mount + sur change pelliculeId
  const fetchLayers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pellicules/${pelliculeId}/layers`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { layers: rows } = await res.json() as { layers: PelliculeLayerRow[] }
      setLayers(rows)
      onLayersChangeRef.current?.(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [pelliculeId])
  useEffect(() => { void fetchLayers() }, [fetchLayers])

  // ── Mutations ──────────────────────────────────────────────────────────

  const createLayer = useCallback(async (type: PelliculeLayerType, mediaUrl: string) => {
    try {
      const res = await fetch(`/api/pellicules/${pelliculeId}/layers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, media_url: mediaUrl }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errBody.error ?? `HTTP ${res.status}`)
      }
      const { layer } = await res.json() as { layer: PelliculeLayerRow }
      const next = [...layers, layer].sort((a, b) => a.z_index - b.z_index)
      setLayers(next)
      onLayersChangeRef.current?.(next)
      setSelectedLayerId(layer.id)
    } catch (err) {
      alert(`Création calque échouée : ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [pelliculeId, layers])

  const patchLayer = useCallback(async (layerId: string, patch: Partial<PelliculeLayerRow>) => {
    // Optimistic update
    const optimistic = layers.map(l => l.id === layerId ? { ...l, ...patch } : l)
    setLayers(optimistic)
    onLayersChangeRef.current?.(optimistic)
    try {
      const res = await fetch(`/api/pellicules/${pelliculeId}/layers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: [{ id: layerId, ...patch }] }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { errors } = await res.json() as { errors?: Array<{ id: string; error: string }> }
      if (errors && errors.length > 0) {
        console.warn('[LayersPanel] PATCH errors:', errors)
        // Rollback en re-fetchant
        await fetchLayers()
      }
    } catch (err) {
      console.error('[LayersPanel] PATCH failed:', err)
      await fetchLayers()
    }
  }, [pelliculeId, layers, fetchLayers])

  const deleteLayer = useCallback(async (layerId: string) => {
    if (!confirm('Supprimer ce calque ?')) return
    // Optimistic
    const next = layers.filter(l => l.id !== layerId)
    setLayers(next)
    onLayersChangeRef.current?.(next)
    if (selectedLayerId === layerId) setSelectedLayerId(null)
    try {
      const res = await fetch(
        `/api/pellicules/${pelliculeId}/layers?layerId=${layerId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[LayersPanel] DELETE failed:', err)
      await fetchLayers()
    }
  }, [pelliculeId, layers, selectedLayerId, fetchLayers])

  const moveLayer = useCallback(async (layerId: string, direction: 'up' | 'down') => {
    // Swap z_index avec le voisin
    const sorted = [...layers].sort((a, b) => a.z_index - b.z_index)
    const idx = sorted.findIndex(l => l.id === layerId)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx + 1 : idx - 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swapIdx]
    // Optimistic
    const next = layers.map(l => {
      if (l.id === a.id) return { ...l, z_index: b.z_index }
      if (l.id === b.id) return { ...l, z_index: a.z_index }
      return l
    })
    setLayers(next)
    onLayersChangeRef.current?.(next)
    try {
      await fetch(`/api/pellicules/${pelliculeId}/layers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layers: [
            { id: a.id, z_index: b.z_index },
            { id: b.id, z_index: a.z_index },
          ],
        }),
      })
    } catch (err) {
      console.error('[LayersPanel] reorder failed:', err)
      await fetchLayers()
    }
  }, [pelliculeId, layers, fetchLayers])

  // ── Add flow ───────────────────────────────────────────────────────────

  const handleAddFromBank = useCallback(() => {
    if (!onPickFromBank) return
    onPickFromBank(addMenuType, (mediaUrl) => {
      setAddMenuOpen(false)
      void createLayer(addMenuType, mediaUrl)
    })
  }, [onPickFromBank, addMenuType, createLayer])

  const handleUploadFile = useCallback(async (file: File) => {
    if (!onUpload) return
    setAddMenuOpen(false)
    try {
      const url = await onUpload(file)
      void createLayer(addMenuType, url)
    } catch (err) {
      alert(`Upload échoué : ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [onUpload, addMenuType, createLayer])

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="ste-layers-panel">
        <Header onClose={onClose} />
        <div className="ste-layers-loading">
          <Loader2 size={16} className="ste-spin" /> Chargement des calques…
        </div>
      </div>
    )
  }

  const selected = layers.find(l => l.id === selectedLayerId) ?? null
  // Affichage : du haut (z_index élevé) vers le bas (= comme Photoshop)
  const sortedDesc = [...layers].sort((a, b) => b.z_index - a.z_index)

  return (
    <div className="ste-layers-panel">
      <Header onClose={onClose} count={layers.length} />
      {error && <div className="ste-layers-error">⚠ {error}</div>}

      {/* Phase B.3 keyframes 2026-05-18 — section animation pellicule en haut */}
      {onKeyframesChange && (
        <KeyframesEditor
          keyframes={pelliculeKeyframes ?? []}
          onChange={onKeyframesChange}
          cursorRelMs={sharedCursorRelMs ?? 0}
          durationMs={pelliculeDurationMs ?? 0}
        />
      )}

      {/* Liste */}
      <div className="ste-layers-list">
        {sortedDesc.length === 0 && (
          <div className="ste-layers-empty">
            Aucun calque. Ajoute une image, vidéo ou gif au-dessus de cette pellicule.
          </div>
        )}
        {sortedDesc.map(layer => (
          <LayerRow
            key={layer.id}
            layer={layer}
            selected={selectedLayerId === layer.id}
            onSelect={() => setSelectedLayerId(layer.id)}
            onToggleVisible={() => void patchLayer(layer.id, { visible: !layer.visible })}
            onMoveUp={() => void moveLayer(layer.id, 'up')}
            onMoveDown={() => void moveLayer(layer.id, 'down')}
            onDelete={() => void deleteLayer(layer.id)}
          />
        ))}
      </div>

      {/* Ajouter */}
      <div className="ste-layers-add-row">
        {addMenuOpen ? (
          <div className="ste-layers-add-menu">
            <select
              value={addMenuType}
              onChange={(e) => setAddMenuType(e.target.value as PelliculeLayerType)}
              className="ste-layers-add-type"
            >
              <option value="image">Image</option>
              <option value="video">Vidéo (loop)</option>
              <option value="gif">GIF</option>
            </select>
            <button
              type="button"
              className="ste-layers-add-source"
              onClick={handleAddFromBank}
              disabled={!onPickFromBank}
              title={onPickFromBank ? 'Choisir depuis la banque' : 'Picker non fourni'}
            >
              <FolderOpen size={12} /> Banque
            </button>
            <label className={`ste-layers-add-source ${!onUpload ? 'is-disabled' : ''}`}>
              <Upload size={12} /> Upload
              <input
                type="file"
                accept={addMenuType === 'image' ? 'image/*' : addMenuType === 'video' ? 'video/*' : 'image/gif'}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleUploadFile(f)
                }}
                hidden
                disabled={!onUpload}
              />
            </label>
            <button
              type="button"
              className="ste-layers-add-cancel"
              onClick={() => setAddMenuOpen(false)}
            >Annuler</button>
          </div>
        ) : (
          <button
            type="button"
            className="ste-layers-add-btn"
            onClick={() => setAddMenuOpen(true)}
          >
            <Plus size={12} /> Ajouter un calque
          </button>
        )}
      </div>

      {/* Édition du calque sélectionné */}
      {selected && (
        <LayerEditor
          layer={selected}
          onChange={(patch) => void patchLayer(selected.id, patch)}
          maskDraftActive={maskDraftLayerId === selected.id}
          maskDraftShape={maskDraftShape ?? null}
          maskDraftPoints={maskDraftPoints ?? []}
          onStartMaskEdit={onStartMaskEdit ? (shape) => onStartMaskEdit(selected.id, shape) : undefined}
          onCancelMaskEdit={onCancelMaskEdit}
          onFinishMaskEdit={() => {
            const pts = maskDraftPoints ?? []
            const shape = maskDraftShape
            if (!shape || pts.length < (shape === 'rect' ? 2 : 3)) return
            // Pour rect, on convertit les 2 points cliqués (coins opposés) en
            // 4 corners (TL/TR/BR/BL) avant persistance — le runtime attend
            // un polygon en clip-path.
            const finalPoints: Array<[number, number]> = shape === 'rect' && pts.length === 2
              ? (() => {
                  const [[x1, y1], [x2, y2]] = pts
                  const xMin = Math.min(x1, x2), xMax = Math.max(x1, x2)
                  const yMin = Math.min(y1, y2), yMax = Math.max(y1, y2)
                  return [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]]
                })()
              : pts
            void patchLayer(selected.id, {
              mask: { shape, points: finalPoints },
            } as Partial<PelliculeLayerRow>)
            onCancelMaskEdit?.()  // exit edit mode
          }}
          onClearMask={() => void patchLayer(selected.id, { mask: null } as Partial<PelliculeLayerRow>)}
        />
      )}
    </div>
  )
}

// ── Sous-composants ─────────────────────────────────────────────────────

function Header({ onClose, count }: { onClose: () => void; count?: number }) {
  return (
    <header className="ste-layers-header">
      <span className="ste-layers-title">
        Calques {count != null && <span className="ste-layers-count">({count})</span>}
      </span>
      <button
        type="button"
        className="ste-layers-close"
        onClick={onClose}
        title="Fermer"
        aria-label="Fermer"
      >×</button>
    </header>
  )
}

interface LayerRowProps {
  layer: PelliculeLayerRow
  selected: boolean
  onSelect: () => void
  onToggleVisible: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}
function LayerRow({
  layer, selected, onSelect, onToggleVisible, onMoveUp, onMoveDown, onDelete,
}: LayerRowProps) {
  return (
    <div
      className={`ste-layers-row${selected ? ' is-selected' : ''}${!layer.visible ? ' is-hidden' : ''}`}
      onClick={onSelect}
    >
      <span className="ste-layers-row-thumb">
        {layer.media_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={layer.media_url} alt="" />
          : <span className="ste-layers-row-thumb-placeholder">{layer.type[0]}</span>}
      </span>
      <span className="ste-layers-row-meta">
        <span className="ste-layers-row-name">{layer.type} #{layer.z_index}</span>
        <span className="ste-layers-row-info">
          {Math.round(layer.position_x)}, {Math.round(layer.position_y)} · ×{layer.scale.toFixed(2)}
        </span>
      </span>
      <span className="ste-layers-row-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onToggleVisible} title={layer.visible ? 'Masquer' : 'Afficher'}>
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button type="button" onClick={onMoveUp} title="Monter (z+1)"><ArrowUp size={12} /></button>
        <button type="button" onClick={onMoveDown} title="Descendre (z-1)"><ArrowDown size={12} /></button>
        <button type="button" onClick={onDelete} title="Supprimer"><Trash2 size={12} /></button>
      </span>
    </div>
  )
}

interface LayerEditorProps {
  layer: PelliculeLayerRow
  onChange: (patch: Partial<PelliculeLayerRow>) => void
  // Phase A.5 — mask editing
  maskDraftActive: boolean
  maskDraftShape: 'rect' | 'polygon' | null
  maskDraftPoints: Array<[number, number]>
  onStartMaskEdit?: (shape: 'rect' | 'polygon') => void
  onCancelMaskEdit?: () => void
  onFinishMaskEdit?: () => void
  onClearMask?: () => void
}
function LayerEditor({
  layer, onChange,
  maskDraftActive, maskDraftShape, maskDraftPoints,
  onStartMaskEdit, onCancelMaskEdit, onFinishMaskEdit, onClearMask,
}: LayerEditorProps) {
  const hasMask = !!layer.mask
  const canFinishMask = maskDraftActive && maskDraftShape && maskDraftPoints.length >= (maskDraftShape === 'rect' ? 2 : 3)
  return (
    <div className="ste-layers-editor">
      <div className="ste-layers-editor-title">Édition</div>
      <Slider label="Position X" value={layer.position_x} min={0} max={100} step={0.5}
        onChange={(v) => onChange({ position_x: v })} suffix="%" />
      <Slider label="Position Y" value={layer.position_y} min={0} max={100} step={0.5}
        onChange={(v) => onChange({ position_y: v })} suffix="%" />
      <Slider label="Taille"     value={layer.scale} min={0.1} max={3} step={0.05}
        onChange={(v) => onChange({ scale: v })} suffix="×" />
      <Slider label="Rotation"   value={layer.rotation} min={-180} max={180} step={1}
        onChange={(v) => onChange({ rotation: v })} suffix="°" />
      <Slider label="Opacité"    value={layer.opacity} min={0} max={1} step={0.01}
        onChange={(v) => onChange({ opacity: v })} suffix="" valueFormat={(v) => `${Math.round(v * 100)}%`} />
      <div className="ste-layers-field">
        <label>Blend</label>
        <select
          value={layer.blend}
          onChange={(e) => onChange({ blend: e.target.value as LayerBlendMode })}
        >
          {BLEND_MODES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Phase A.5 keyframes 2026-05-18 — Mask editing.
       * Le panel ne capture pas les clicks (= le preview overlay le fait). Ici
       * juste : démarrer le dessin (rect ou polygon), voir le compteur de
       * points, valider/annuler/effacer. */}
      <div className="ste-layers-mask-section">
        <div className="ste-layers-editor-subtitle">Mask (zone visible)</div>
        {!maskDraftActive ? (
          <div className="ste-layers-mask-controls">
            <button
              type="button"
              className="ste-layers-mask-btn"
              onClick={() => onStartMaskEdit?.('rect')}
              disabled={!onStartMaskEdit}
              title="Dessiner un mask rectangulaire (2 coins opposés)"
            >▭ Rectangle</button>
            <button
              type="button"
              className="ste-layers-mask-btn"
              onClick={() => onStartMaskEdit?.('polygon')}
              disabled={!onStartMaskEdit}
              title="Dessiner un mask polygone (≥3 points)"
            >◇ Polygone</button>
            {hasMask && (
              <button
                type="button"
                className="ste-layers-mask-btn is-danger"
                onClick={onClearMask}
                title="Retirer le mask actuel"
              >Effacer</button>
            )}
            <span className="ste-layers-mask-status">
              {hasMask ? `Actuel : ${layer.mask!.shape} (${layer.mask!.points.length} pts)` : 'Aucun mask'}
            </span>
          </div>
        ) : (
          <div className="ste-layers-mask-edit">
            <span className="ste-layers-mask-status">
              Dessin {maskDraftShape} en cours — {maskDraftPoints.length} point{maskDraftPoints.length > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              className="ste-layers-mask-btn is-primary"
              onClick={onFinishMaskEdit}
              disabled={!canFinishMask}
              title={canFinishMask ? 'Appliquer le mask au calque' : `Encore ${maskDraftShape === 'rect' ? 2 : 3} points min`}
            >Terminer</button>
            <button
              type="button"
              className="ste-layers-mask-btn"
              onClick={onCancelMaskEdit}
              title="Annuler le dessin en cours"
            >Annuler</button>
          </div>
        )}
      </div>

      {/* Phase A.6 : effects (glow / shadow / blur) ici. */}
    </div>
  )
}

// ── Phase B.3 keyframes 2026-05-18 — éditeur animation pellicule ────────

const KEYFRAME_EASINGS: KeyframeEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out']

interface KeyframesEditorProps {
  keyframes: PelliculeKeyframe[]
  onChange: (kfs: PelliculeKeyframe[]) => void
  cursorRelMs: number   // ms relatif à la pellicule pour "Ajouter au temps courant"
  durationMs: number    // ms total pellicule (cap)
}
function KeyframesEditor({ keyframes, onChange, cursorRelMs, durationMs }: KeyframesEditorProps) {
  const sorted = [...keyframes].sort((a, b) => a.t - b.t)

  const addAtCursor = () => {
    const t = durationMs > 0 ? Math.max(0, Math.min(durationMs, Math.round(cursorRelMs))) : 0
    // Crée un keyframe neutre (toutes valeurs par défaut)
    const next: PelliculeKeyframe = {
      t,
      props: { scale: 1, opacity: 1, position_x: 0, position_y: 0, rotation: 0 },
      easing: 'ease-in-out',
    }
    onChange([...sorted, next])
  }

  const updateKf = (idx: number, patch: Partial<PelliculeKeyframe>) => {
    const next = sorted.map((kf, i) => i === idx ? { ...kf, ...patch } : kf)
    onChange(next)
  }
  const updateKfProp = (idx: number, key: keyof PelliculeKeyframe['props'], value: number) => {
    const next = sorted.map((kf, i) => i === idx
      ? { ...kf, props: { ...kf.props, [key]: value } }
      : kf
    )
    onChange(next)
  }
  const removeKf = (idx: number) => {
    onChange(sorted.filter((_, i) => i !== idx))
  }

  // Preset Ken Burns : 2 keyframes (t=0 scale 1, t=fin scale 1.2)
  const applyKenBurns = () => {
    if (durationMs <= 0) return
    onChange([
      { t: 0, props: { scale: 1, opacity: 1 }, easing: 'ease-in-out' },
      { t: durationMs, props: { scale: 1.2, opacity: 1 }, easing: 'linear' },
    ])
  }
  const applyFadeIn = () => {
    if (durationMs <= 0) return
    onChange([
      { t: 0, props: { opacity: 0 }, easing: 'ease-out' },
      { t: Math.min(800, durationMs), props: { opacity: 1 }, easing: 'linear' },
    ])
  }

  return (
    <div className="ste-kf-section">
      <div className="ste-kf-header">
        <span className="ste-kf-title"><Sparkles size={12} /> Animation pellicule</span>
        <span className="ste-kf-count">{sorted.length} kf</span>
      </div>
      {/* Presets rapides */}
      <div className="ste-kf-presets">
        <button type="button" className="ste-kf-preset-btn" onClick={applyKenBurns} disabled={durationMs <= 0}
          title="Zoom progressif × 1.2 sur toute la durée">Ken Burns</button>
        <button type="button" className="ste-kf-preset-btn" onClick={applyFadeIn} disabled={durationMs <= 0}
          title="Fade in 0.8s au début">Fade in</button>
        <button type="button" className="ste-kf-preset-btn is-danger" onClick={() => onChange([])} disabled={sorted.length === 0}
          title="Supprimer tous les keyframes">Effacer</button>
      </div>
      {/* Liste keyframes */}
      <div className="ste-kf-list">
        {sorted.length === 0 && (
          <div className="ste-kf-empty">Aucun keyframe. Ajoute-en pour animer la pellicule.</div>
        )}
        {sorted.map((kf, i) => (
          <div key={i} className="ste-kf-row">
            <span className="ste-kf-time">
              <input
                type="number" min={0} max={durationMs > 0 ? durationMs : undefined} step={50}
                value={kf.t}
                onChange={e => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v)) updateKf(i, { t: Math.max(0, durationMs > 0 ? Math.min(durationMs, v) : v) })
                }}
              /><span>ms</span>
            </span>
            <span className="ste-kf-props">
              <KfPropMini label="scale" value={kf.props.scale ?? 1}
                min={0.1} max={3} step={0.05}
                onChange={v => updateKfProp(i, 'scale', v)} />
              <KfPropMini label="opacity" value={kf.props.opacity ?? 1}
                min={0} max={1} step={0.05}
                onChange={v => updateKfProp(i, 'opacity', v)} />
              <KfPropMini label="x%" value={kf.props.position_x ?? 0}
                min={-100} max={100} step={1}
                onChange={v => updateKfProp(i, 'position_x', v)} />
              <KfPropMini label="y%" value={kf.props.position_y ?? 0}
                min={-100} max={100} step={1}
                onChange={v => updateKfProp(i, 'position_y', v)} />
              <KfPropMini label="rot°" value={kf.props.rotation ?? 0}
                min={-180} max={180} step={1}
                onChange={v => updateKfProp(i, 'rotation', v)} />
            </span>
            <select
              className="ste-kf-easing"
              value={kf.easing ?? 'linear'}
              onChange={e => updateKf(i, { easing: e.target.value as KeyframeEasing })}
              title="Easing entre ce keyframe et le suivant"
            >
              {KEYFRAME_EASINGS.map(ez => <option key={ez} value={ez}>{ez}</option>)}
            </select>
            <button
              type="button" className="ste-kf-del"
              onClick={() => removeKf(i)}
              title="Supprimer ce keyframe"
            ><Trash2 size={11} /></button>
          </div>
        ))}
      </div>
      <button type="button" className="ste-kf-add" onClick={addAtCursor}>
        <Plus size={12} /> Ajouter au temps courant ({Math.round(cursorRelMs)}ms)
      </button>
    </div>
  )
}

interface KfPropMiniProps {
  label: string
  value: number
  min: number; max: number; step: number
  onChange: (v: number) => void
}
function KfPropMini({ label, value, min, max, step, onChange }: KfPropMiniProps) {
  return (
    <label className="ste-kf-propmini" title={`${label}: ${value}`}>
      <span>{label}</span>
      <input
        type="number" min={min} max={max} step={step}
        value={value}
        onChange={e => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)))
        }}
      />
    </label>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  valueFormat?: (v: number) => string
  onChange: (v: number) => void
}
function Slider({ label, value, min, max, step, suffix, valueFormat, onChange }: SliderProps) {
  return (
    <div className="ste-layers-field">
      <label>
        <span>{label}</span>
        <span className="ste-layers-field-value">
          {valueFormat ? valueFormat(value) : `${value}${suffix ?? ''}`}
        </span>
      </label>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}
