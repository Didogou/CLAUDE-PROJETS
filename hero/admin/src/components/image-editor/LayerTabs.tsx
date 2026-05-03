'use client'
/**
 * Onglets de calques — barre pleine largeur sous le header (style Chrome/Figma).
 *
 * Calque "Base" (index 0) :
 *   - Toujours en premier (épinglé, hors du Reorder.Group)
 *   - Légèrement plus grand que les autres onglets
 *   - Pas de poignée drag, pas de bouton supprimer
 *   - Trait rose (accent principal)
 *   - Fond rose subtil même inactif
 *
 * Calques additionnels (index ≥ 1) :
 *   - Drag pour réordonner (Reorder.Group framer-motion)
 *   - Bouton × pour supprimer (toujours visible)
 *   - Trait indigo (couleur "calque additionnel")
 *
 * Onglets inactifs : opacité réduite + saturation atténuée → focus sur l'actif.
 * L'onglet actif a `background: var(--ie-bg)` pour merger visuellement avec
 * la zone d'édition en-dessous (pas de ligne de séparation visible).
 */
import React, { useState } from 'react'
import { Reorder, useDragControls, motion } from 'framer-motion'
import { Plus, Eye, EyeOff, X } from 'lucide-react'
import type { EditorLayer } from './types'
import { getWeatherLayerIcon } from './types'
import { useEditorState } from './EditorStateContext'

const BASE_TRAIT_COLOR = 'var(--ie-accent)'
const LAYER_TRAIT_COLOR = '#818CF8'
const BASE_TINT_BG = 'rgba(236, 72, 153, 0.06)'

export default function LayerTabs() {
  const { layers, activeLayerIdx, addLayer, removeLayer, setActiveLayer, updateLayer, setLayers } = useEditorState()
  const [editingUid, setEditingUid] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  function startRename(layer: EditorLayer) {
    setEditingUid(layer._uid)
    setEditValue(layer.name)
  }
  function commitRename(index: number) {
    if (editValue.trim()) updateLayer(index, { name: editValue.trim() })
    setEditingUid(null)
    setEditValue('')
  }

  const baseLayer = layers[0]
  const otherLayers = layers.slice(1)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 0,
        padding: '0 var(--ie-space-3)',
        height: 'var(--ie-tab-height)',
        background: 'var(--ie-surface-2)',
        borderBottom: '1px solid var(--ie-border)',
        flexShrink: 0,
        width: '100%',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'thin',
      }}
    >
      {/* ── Calque Base : épinglé en premier, pas drag, pas supprimable ── */}
      {baseLayer && (
        <BaseTab
          layer={baseLayer}
          isActive={activeLayerIdx === 0}
          isEditing={editingUid === baseLayer._uid}
          editValue={editValue}
          setEditValue={setEditValue}
          onActivate={() => setActiveLayer(0)}
          onToggleVisible={(e) => {
            e.stopPropagation()
            updateLayer(0, { visible: !baseLayer.visible })
          }}
          onStartRename={() => startRename(baseLayer)}
          onCommitRename={() => commitRename(0)}
        />
      )}

      {/* ── Calques additionnels : draggable via Reorder.Group ── */}
      <Reorder.Group
        as="div"
        axis="x"
        values={otherLayers}
        onReorder={(newOthers) => {
          // Reconstruit l'array complet en gardant Base en première position
          const newLayers = [baseLayer, ...newOthers]
          // Recalcule activeLayerIdx pour suivre le calque actif
          const activeUid = layers[activeLayerIdx]?._uid
          const newActiveIdx = newLayers.findIndex(l => l._uid === activeUid)
          setLayers(newLayers, newActiveIdx >= 0 ? newActiveIdx : 0)
        }}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 0,
          listStyle: 'none',
          padding: 0,
          margin: 0,
          height: '100%',
          flex: 1,
        }}
      >
        {otherLayers.map((layer) => {
          // Index réel dans `layers` (offset +1 à cause de Base)
          const realIndex = layers.findIndex(l => l._uid === layer._uid)
          const isActive = realIndex === activeLayerIdx
          const isEditing = editingUid === layer._uid
          return (
            <LayerTab
              key={layer._uid}
              layer={layer}
              isActive={isActive}
              isEditing={isEditing}
              editValue={editValue}
              setEditValue={setEditValue}
              onActivate={() => setActiveLayer(realIndex)}
              onToggleVisible={(e) => {
                e.stopPropagation()
                updateLayer(realIndex, { visible: !layer.visible })
              }}
              onStartRename={() => startRename(layer)}
              onCommitRename={() => commitRename(realIndex)}
              onRemove={(e) => {
                e.stopPropagation()
                if (confirm(`Supprimer le calque « ${layer.name} » ?`)) removeLayer(realIndex)
              }}
            />
          )
        })}
      </Reorder.Group>

      <motion.button
        onClick={() => addLayer()}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.94 }}
        title="Ajouter un calque"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1.875rem', height: '1.625rem',
          marginBottom: 'var(--ie-space-1)', marginLeft: 'var(--ie-space-2)',
          background: 'transparent',
          color: 'var(--ie-text-muted)',
          border: '1px dashed var(--ie-border-strong)',
          borderRadius: 'var(--ie-radius)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Plus size={14} />
      </motion.button>
    </div>
  )
}

// ── Onglet Base (épinglé, plus grand, non draggable, non supprimable) ────

interface BaseTabProps {
  layer: EditorLayer
  isActive: boolean
  isEditing: boolean
  editValue: string
  setEditValue: (v: string) => void
  onActivate: () => void
  onToggleVisible: (e: React.MouseEvent) => void
  onStartRename: () => void
  onCommitRename: () => void
}

function BaseTab({
  layer, isActive, isEditing, editValue, setEditValue,
  onActivate, onToggleVisible, onStartRename, onCommitRename,
}: BaseTabProps) {
  return (
    <div
      onClick={onActivate}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--ie-space-2)',
        height: 'var(--ie-tab-height)',            // hauteur pleine des onglets
        padding: '0 var(--ie-space-4) 0 var(--ie-space-3)',
        background: isActive ? 'var(--ie-bg)' : BASE_TINT_BG,
        borderTop: `0.25rem solid ${isActive ? BASE_TRAIT_COLOR : 'transparent'}`,
        borderTopLeftRadius: 'var(--ie-radius-md)',
        borderTopRightRadius: 'var(--ie-radius-md)',
        cursor: 'pointer',
        opacity: isActive ? 1 : 0.55,
        filter: isActive ? 'none' : 'saturate(0.6)',
        marginBottom: -1,
        marginRight: 'var(--ie-space-1)',          // espacement avec les autres calques
        transition: 'background 150ms, opacity 150ms, filter 150ms',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {isEditing ? (
        <input
          autoFocus
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename()
            if (e.key === 'Escape') { setEditValue(''); onCommitRename() }
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--ie-surface)',
            border: '1px solid var(--ie-accent)',
            borderRadius: 3,
            padding: '1px 4px',
            fontSize: 'var(--ie-text-lg)',
            color: 'var(--ie-text)',
            outline: 'none',
            width: 110,
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <span
          onDoubleClick={(e) => { e.stopPropagation(); onStartRename() }}
          style={{
            // Police plus grande pour la prominence (16px vs 12px des autres)
            fontSize: 'var(--ie-text-lg)',
            fontWeight: isActive ? 700 : 600,
            color: isActive ? 'var(--ie-text)' : 'var(--ie-text-muted)',
            maxWidth: 160,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            padding: '0 2px',
            letterSpacing: '0.01em',
          }}
          title="Calque de base — toujours en premier"
        >
          {layer.name}
        </span>
      )}

      <motion.button
        onClick={onToggleVisible}
        whileTap={{ scale: 0.88 }}
        title={layer.visible ? 'Masquer le calque' : 'Afficher le calque'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20,
          background: 'transparent',
          color: layer.visible ? 'var(--ie-text-muted)' : 'var(--ie-text-faint)',
          flexShrink: 0,
        }}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </motion.button>
    </div>
  )
}

// ── Onglet Calque additionnel (draggable, supprimable) ─────────────────

interface LayerTabProps {
  layer: EditorLayer
  isActive: boolean
  isEditing: boolean
  editValue: string
  setEditValue: (v: string) => void
  onActivate: () => void
  onToggleVisible: (e: React.MouseEvent) => void
  onStartRename: () => void
  onCommitRename: () => void
  onRemove: (e: React.MouseEvent) => void
}

function LayerTab({
  layer, isActive, isEditing, editValue, setEditValue,
  onActivate, onToggleVisible, onStartRename, onCommitRename, onRemove,
}: LayerTabProps) {
  const dragControls = useDragControls()

  return (
    <Reorder.Item
      as="div"
      value={layer}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={{ zIndex: 10, scale: 1.02, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--ie-space-1)',
        height: 'var(--ie-tab-inner-height)',
        padding: '0 var(--ie-space-2) 0 var(--ie-space-1)',
        background: isActive ? 'var(--ie-bg)' : 'transparent',
        borderTop: `0.1875rem solid ${isActive ? LAYER_TRAIT_COLOR : 'transparent'}`,
        borderTopLeftRadius: 'var(--ie-radius)',
        borderTopRightRadius: 'var(--ie-radius)',
        position: 'relative',
        cursor: 'pointer',
        opacity: isActive ? 1 : 0.55,
        filter: isActive ? 'none' : 'saturate(0.6)',
        marginBottom: -1,
        transition: 'background 150ms, opacity 150ms, filter 150ms',
        flexShrink: 0,
        userSelect: 'none',
      }}
      onClick={onActivate}
    >
      <div
        onPointerDown={(e) => { if (!isEditing) dragControls.start(e) }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 12,
          cursor: 'grab',
          color: 'var(--ie-text-faint)',
          flexShrink: 0,
        }}
        title="Glisser pour réordonner"
      >
        <span style={{ fontSize: 9, lineHeight: 1, letterSpacing: -2 }}>⋮⋮</span>
      </div>

      {isEditing ? (
        <input
          autoFocus
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename()
            if (e.key === 'Escape') { setEditValue(''); onCommitRename() }
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--ie-surface)',
            border: '1px solid var(--ie-accent)',
            borderRadius: 3,
            padding: '1px 4px',
            fontSize: 'var(--ie-text-sm)',
            color: 'var(--ie-text)',
            outline: 'none',
            width: 110,
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <span
          onDoubleClick={(e) => { e.stopPropagation(); onStartRename() }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.25em',
            fontSize: 'var(--ie-text-sm)',
            fontWeight: isActive ? 600 : 500,
            color: isActive ? 'var(--ie-text)' : 'var(--ie-text-muted)',
            maxWidth: '8rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            padding: '0 0.15em',
          }}
          title="Double-clic pour renommer"
        >
          {/* Icône emoji si le calque est météo (pluie, neige, nuages…).
              font-size 1.05em → se scale avec le texte, pas de px. */}
          {layer.weather && (
            <span style={{ fontSize: '1.05em', lineHeight: 1, flexShrink: 0 }}>
              {getWeatherLayerIcon(layer.weather, layer.name)}
            </span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{layer.name}</span>
        </span>
      )}

      <motion.button
        onClick={onToggleVisible}
        whileTap={{ scale: 0.88 }}
        title={layer.visible ? 'Masquer le calque' : 'Afficher le calque'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16,
          background: 'transparent',
          color: layer.visible ? 'var(--ie-text-muted)' : 'var(--ie-text-faint)',
          flexShrink: 0,
        }}
      >
        {layer.visible ? <Eye size={11} /> : <EyeOff size={11} />}
      </motion.button>

      {!isEditing && (
        <motion.button
          onClick={onRemove}
          whileTap={{ scale: 0.88 }}
          whileHover={{ background: 'rgba(239, 68, 68, 0.14)' }}
          title="Supprimer le calque"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16,
            // rgba transparent équivalent visuel de 'transparent' mais animatable
            // par framer-motion (sinon warning "value not animatable").
            background: 'rgba(239, 68, 68, 0)',
            color: 'var(--ie-text-faint)',
            borderRadius: 3,
            flexShrink: 0,
            marginLeft: 2,
          }}
        >
          <X size={11} strokeWidth={2.5} />
        </motion.button>
      )}
    </Reorder.Item>
  )
}
