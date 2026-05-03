'use client'
/**
 * Panneau de génération compact — tient dans ~180px sans scroll.
 *
 * Structure en 3 lignes serrées :
 *   Ligne 1 : Style | Format | Cadrage+Force | Angle | Type | Modèles (6 selects)
 *   Ligne 2 : Prompt FR (wide) + bouton Traduire
 *   Ligne 3 : Negative (wide) + bouton Générer
 *
 * Design :
 *   - Inter, tailles 11px labels + 13px fields (cohérent avec le thème)
 *   - Rose accent #EC4899 pour l'état actif et le bouton primaire
 *   - Radius 6px, ombres douces, transitions 150ms
 *   - Whitespace proportionnel mais resserré pour éviter tout scroll
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Sparkles, Languages, ChevronUp, Check } from 'lucide-react'
import { CHECKPOINTS, STYLE_SUFFIXES } from '@/lib/comfyui'
import { FRAMING_OPTIONS, POV_OPTIONS } from '@/components/wizard/common/cameraOptions'
import type { EditorContext, EditorImageType } from './types'
import { TYPES_BY_CONTEXT } from './types'
import type { GenerationRequest } from './hooks/useImageGeneration'

interface GenerationPanelProps {
  context: EditorContext
  storagePathPrefix: string
  onGenerate: (req: GenerationRequest) => void
  isRunning: boolean
  initialPrompt?: string
  initialNegative?: string
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Format lifté au parent pour que le Canvas puisse ajuster le placeholder. */
  format: string
  onFormatChange: (f: string) => void
}

const TYPE_LABELS: Record<EditorImageType, string> = {
  portrait: 'Portrait',
  fullbody: 'Plein pied',
  object: 'Objet',
  plan_standard: 'Plan standard',
  panorama_360: 'Panorama 360°',
}

const STYLE_LABELS: Record<string, string> = {
  realistic: 'Réaliste',
  photo: 'Photo cinéma',
  manga: 'Manga',
  bnw: 'Noir & blanc',
  watercolor: 'Aquarelle',
  comic: 'Comic BD',
  dark_fantasy: 'Dark fantasy',
  pixel: 'Pixel art',
  sketch: 'Crayonné',
}

/** Formats standards avec leur usage réel. Les ratios non-SDXL-natifs sont
 *  auto-mappés en interne vers les dimensions compliantes via generatePayload. */
export const FORMATS: { value: string; label: string }[] = [
  { value: '16:9',      label: '16:9  Cinéma' },
  { value: '3:2',       label: '3:2   Photo' },
  { value: '4:3',       label: '4:3   Tablette' },
  { value: '1:1',       label: '1:1   Carré' },
  { value: '9:16',      label: '9:16  Téléphone' },
  { value: '2:1 pano',  label: '2:1   Panorama' },
]

/** Convertit un format utilisateur en aspect-ratio CSS (pour placeholders). */
export function formatToAspectRatio(format: string): string {
  switch (format) {
    case '1:1': return '1 / 1'
    case '9:16': return '9 / 16'
    case '3:2': return '3 / 2'
    case '4:3': return '4 / 3'
    case '2:1 pano': return '2 / 1'
    case '16:9':
    default: return '16 / 9'
  }
}

export default function GenerationPanel({
  context, storagePathPrefix, onGenerate, isRunning, initialPrompt, initialNegative, collapsed, onToggleCollapsed,
  format, onFormatChange,
}: GenerationPanelProps) {
  const types = TYPES_BY_CONTEXT[context]

  const [promptFr, setPromptFr] = useState(initialPrompt ?? '')
  const [negativeFr, setNegativeFr] = useState(initialNegative ?? '')
  const [style, setStyle] = useState<string>('realistic')
  const [framing, setFraming] = useState<string>('')
  const [pov, setPov] = useState<string>('')
  // Force cadrage/angle retirée de l'UI (jugée peu discoverable). Les tags
  // cadrage/angle sont toujours ajoutés au prompt mais sans pondération forcée.
  const forceCamera = false
  const [imageType, setImageType] = useState<EditorImageType>(types[0])
  const [selectedModels, setSelectedModels] = useState<string[]>(['juggernaut'])
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [translating, setTranslating] = useState(false)

  async function handleTranslate() {
    if (!promptFr.trim() || translating) return
    setTranslating(true)
    try {
      const res = await fetch('/api/translate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_fr: promptFr }),
      })
      if (res.ok) {
        const d = await res.json()
        if (d.prompt_en) setPromptFr(d.prompt_en)
      }
    } catch { /* silencieux */ } finally {
      setTranslating(false)
    }
  }

  function handleGenerate() {
    if (isRunning || !promptFr.trim()) return
    onGenerate({
      promptFr, negativeFr, type: imageType,
      format, style, framing, pov, forceCamera,
      modelKeys: selectedModels.length > 0 ? selectedModels : ['juggernaut'],
      storagePathPrefix,
    })
  }

  function toggleModel(key: string) {
    setSelectedModels(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    )
  }

  // ── Mode replié : bande fine avec prompt résumé + bouton Générer ──
  if (collapsed) {
    return (
      <motion.div
        className="ie-gen-panel-collapsed"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <motion.button
          onClick={onToggleCollapsed}
          className="ie-btn ie-btn-icon"
          title="Déplier les options"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          style={{ width: 32, height: 32 }}
        >
          <ChevronUp size={16} />
        </motion.button>
        <div style={{ fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {promptFr ? promptFr : <em>Options de génération repliées — grab la poignée pour déplier</em>}
        </div>
        <motion.button
          className="ie-btn ie-btn-primary"
          onClick={handleGenerate}
          disabled={isRunning || !promptFr.trim() || selectedModels.length === 0}
          whileHover={!isRunning && promptFr.trim() ? { scale: 1.02 } : undefined}
          whileTap={!isRunning && promptFr.trim() ? { scale: 0.97 } : undefined}
          style={{
            padding: '6px 14px',
            fontSize: 'var(--ie-text-sm)',
            fontWeight: 600,
            opacity: (isRunning || !promptFr.trim() || selectedModels.length === 0) ? 0.5 : 1,
            cursor: (isRunning || !promptFr.trim() || selectedModels.length === 0) ? 'not-allowed' : 'pointer',
          }}
        >
          <Sparkles size={14} />
          {isRunning ? 'Génération…' : 'Générer'}
        </motion.button>
      </motion.div>
    )
  }

  // ── Mode plein : 3 lignes compactes ──────────────────────────────────
  return (
    <motion.div
      className="ie-gen-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {/* Ligne 1 : 6 selects compacts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        <CompactSelect
          label="Style"
          value={style}
          onChange={setStyle}
          options={Object.keys(STYLE_SUFFIXES).map(k => ({ value: k, label: STYLE_LABELS[k] ?? k }))}
        />
        <CompactSelect
          label="Format"
          value={format}
          onChange={onFormatChange}
          options={FORMATS}
          disabled={imageType === 'portrait' || imageType === 'object' || imageType === 'panorama_360'}
        />
        <CompactSelect
          label="Cadrage"
          value={framing}
          onChange={setFraming}
          options={FRAMING_OPTIONS.map(o => ({ value: o.key, label: o.label }))}
        />
        <CompactSelect
          label="Angle"
          value={pov}
          onChange={setPov}
          options={POV_OPTIONS.map(o => ({ value: o.key, label: o.label }))}
        />
        <CompactSelect
          label="Type"
          value={imageType}
          onChange={v => setImageType(v as EditorImageType)}
          options={types.map(t => ({ value: t, label: TYPE_LABELS[t] }))}
        />
        {/* Modèles : dropdown custom multi-sélection */}
        <ModelsPicker
          selected={selectedModels}
          onToggle={toggleModel}
          open={showModelPicker}
          setOpen={setShowModelPicker}
        />
      </div>

      {/* Ligne 2 : Prompt FR + Traduire */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <CompactLabel>Prompt</CompactLabel>
          <input
            type="text"
            value={promptFr}
            onChange={e => setPromptFr(e.target.value)}
            placeholder="Décris la scène — ex : un bar enfumé à 3h du matin, néons rouges…"
            style={compactInput}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--ie-accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--ie-accent-faint)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--ie-border-strong)'; e.currentTarget.style.boxShadow = 'none' }}
          />
        </div>
        <motion.button
          onClick={() => void handleTranslate()}
          disabled={translating || !promptFr.trim()}
          whileHover={!translating && promptFr.trim() ? { scale: 1.02 } : undefined}
          whileTap={!translating && promptFr.trim() ? { scale: 0.96 } : undefined}
          style={{
            alignSelf: 'flex-end',
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '6px 10px',
            background: 'transparent',
            color: 'var(--ie-text-muted)',
            border: '1px solid var(--ie-border-strong)',
            borderRadius: 'var(--ie-radius)',
            fontSize: 'var(--ie-text-sm)',
            fontWeight: 500,
            opacity: (!promptFr.trim() || translating) ? 0.5 : 1,
            cursor: (!promptFr.trim() || translating) ? 'not-allowed' : 'pointer',
            height: 30,
            flex: '0 0 auto',
          }}
          title="Traduire FR → EN optimisé SDXL (remplace le prompt courant)"
        >
          <Languages size={13} />
          {translating ? '…' : 'Traduire'}
        </motion.button>
      </div>

      {/* Ligne 3 : Negative + Générer */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <CompactLabel>Negative (à éviter)</CompactLabel>
          <input
            type="text"
            value={negativeFr}
            onChange={e => setNegativeFr(e.target.value)}
            placeholder="Ex : trop sombre, visage flou, deux personnes…"
            style={compactInput}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--ie-accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--ie-accent-faint)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--ie-border-strong)'; e.currentTarget.style.boxShadow = 'none' }}
          />
        </div>
        <motion.button
          className="ie-btn ie-btn-primary"
          onClick={handleGenerate}
          disabled={isRunning || !promptFr.trim() || selectedModels.length === 0}
          whileHover={!isRunning && promptFr.trim() ? { scale: 1.02, boxShadow: 'var(--ie-shadow)' } : undefined}
          whileTap={!isRunning && promptFr.trim() ? { scale: 0.97 } : undefined}
          style={{
            alignSelf: 'flex-end',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px',
            fontSize: 'var(--ie-text-sm)',
            fontWeight: 600,
            height: 30,
            flex: '0 0 auto',
            opacity: (isRunning || !promptFr.trim() || selectedModels.length === 0) ? 0.5 : 1,
            cursor: (isRunning || !promptFr.trim() || selectedModels.length === 0) ? 'not-allowed' : 'pointer',
          }}
        >
          <Sparkles size={14} />
          {isRunning ? 'Génération…' : `Générer (${selectedModels.length})`}
        </motion.button>
      </div>
    </motion.div>
  )
}

// ── Sub-components compacts ─────────────────────────────────────────────

function CompactLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 'var(--ie-text-xs)',
      fontWeight: 600,
      color: 'var(--ie-text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
    }}>{children}</span>
  )
}

function CompactSelect({
  label, options, value, onChange, disabled, suffix,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  suffix?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <CompactLabel>{label}</CompactLabel>
      <div style={{ position: 'relative' }}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          style={{
            ...compactInput,
            paddingRight: suffix ? 26 : 8,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        {suffix}
      </div>
    </div>
  )
}

function ModelsPicker({
  selected, onToggle, open, setOpen,
}: {
  selected: string[]
  onToggle: (k: string) => void
  open: boolean
  setOpen: (v: boolean) => void
}) {
  const labelText = selected.length === 0
    ? 'Aucun'
    : selected.length === 1
      ? CHECKPOINTS.find(c => c.key === selected[0])?.label?.split(' ')[0] ?? selected[0]
      : `${selected.length} modèles`

  // Le dropdown est rendu via portal dans document.body pour échapper au
  // `overflow: hidden` du wrapper GenerationPanel (nécessaire pour l'anim de
  // collapse). Position calculée à partir du rect du bouton, ré-calculée au
  // scroll/resize tant que le menu est ouvert.
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return }
    function updatePos() {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      // Ancrage par `bottom` = distance depuis le bas du viewport jusqu'au
      // haut du bouton + gap de 4px. Ouvre naturellement vers le haut sans
      // transform (qui serait écrasé par l'animate y de framer-motion).
      setMenuPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 4,
        width: Math.max(rect.width, 220),
      })
    }
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open])

  // Clic hors du menu ET hors du bouton → ferme
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, setOpen])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, position: 'relative' }}>
      <CompactLabel>Modèles ({selected.length})</CompactLabel>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        style={{
          ...compactInput,
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 8px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelText}</span>
        <span style={{ color: 'var(--ie-text-faint)', marginLeft: 4, fontSize: 10 }}>▾</span>
      </button>
      {open && menuPos && typeof document !== 'undefined' && createPortal(
        // Wrapper avec `image-editor-root` + data-theme pour que les variables
        // CSS (--ie-surface, --ie-border-strong…) se résolvent dans le portal
        // (qui est rendu dans document.body, hors du scope de l'éditeur).
        <div
          className="image-editor-root"
          data-theme={document.querySelector('.image-editor-root')?.getAttribute('data-theme') ?? 'light'}
          // `contents` : le wrapper disparaît de l'arbre de rendu (pas de
          // box, pas de background hérité de `.image-editor-root`), mais
          // les custom properties continuent de cascader via l'arbre DOM.
          style={{ display: 'contents' }}
        >
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12 }}
          style={{
            position: 'fixed',
            left: menuPos.left,
            bottom: menuPos.bottom,
            minWidth: menuPos.width,
            background: 'var(--ie-surface)',
            border: '1px solid var(--ie-border-strong)',
            borderRadius: 'var(--ie-radius)',
            boxShadow: 'var(--ie-shadow-lg)',
            zIndex: 2000,
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {CHECKPOINTS.map(ckpt => {
            const sel = selected.includes(ckpt.key)
            return (
              <button
                key={ckpt.key}
                onClick={() => onToggle(ckpt.key)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px',
                  background: sel ? 'var(--ie-accent-faint)' : 'transparent',
                  color: 'var(--ie-text)',
                  cursor: 'pointer',
                  fontSize: 'var(--ie-text-sm)',
                  textAlign: 'left',
                  transition: 'background var(--ie-transition)',
                }}
              >
                <span style={{
                  width: 14, height: 14,
                  borderRadius: 3,
                  border: `1.5px solid ${sel ? 'var(--ie-accent)' : 'var(--ie-border-strong)'}`,
                  background: sel ? 'var(--ie-accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {sel && <Check size={10} color="white" strokeWidth={3} />}
                </span>
                <span style={{ flex: 1, fontWeight: 500 }}>{ckpt.label}</span>
              </button>
            )
          })}
        </motion.div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── Styles compacts partagés ───────────────────────────────────────────

const compactInput: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  background: 'var(--ie-surface)',
  border: '1px solid var(--ie-border-strong)',
  borderRadius: 'var(--ie-radius)',
  fontSize: 'var(--ie-text-sm)',
  fontFamily: 'inherit',
  color: 'var(--ie-text)',
  outline: 'none',
  height: 28,
  transition: 'border-color var(--ie-transition), box-shadow var(--ie-transition)',
}
