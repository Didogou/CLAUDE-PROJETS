'use client'
/**
 * CatalogAnimation — panneau slide "Banques › Personnages › Animation".
 *
 * Triggered par Personnage → Animer dans la toolbar Phase B.
 *
 * Concept : storyboard horizontal pour scénariser une animation cinématique
 * multi-perso. Chaque "pellicule" = 1 plan (5s par défaut) = 1 workflow LTX 2.3.
 * N pellicules en séquence = vidéo concaténée de N×5s avec continuité visuelle
 * (FirstAndLast frame chaining).
 *
 * UX validée 2026-05-02 :
 *   - Sélecteur 2 persos max (limitation IC LoRA Dual Characters)
 *   - Slider durée totale → calcule N pellicules
 *   - Chaque pellicule : type plan + camera + action/dialogue par perso
 *   - Re-render sélectif (1 pellicule à la fois sans toucher aux autres)
 *   - Continuité par défaut (toggle "Cut" possible)
 *   - Qualité : Brouillon · Standard · Finale
 *
 * Backend : helper `runLtx23Sequence({ pellicules, characters })` à venir.
 */

import React, { useState, useMemo } from 'react'
import { ChevronRight, Plus, X, Loader2, Check } from 'lucide-react'
import CatalogShell from './CatalogShell'
import { useCharacterStore, type Character } from '@/lib/character-store'
import { runLtx23Dual } from '@/lib/comfyui-ltx-dual'

interface CatalogAnimationProps {
  onClose: () => void
  onNavigateToBanks?: () => void
  storagePathPrefix: string
}

/** Type de plan (cadrage). */
type ShotType = 'wide' | 'medium' | 'close_up' | 'extreme_close_up'

/** Mouvement caméra. */
type CameraMotion =
  | 'static' | 'slow_zoom_in' | 'slow_zoom_out'
  | 'pan_left' | 'pan_right' | 'dolly_in' | 'dolly_out' | 'handheld'

/** Niveau de qualité (drive durée + steps + résolution). */
type Quality = 'draft' | 'standard' | 'final'

/** 1 plan dans le storyboard. */
interface Pellicule {
  id: string
  duration: number  // secondes (3-8)
  shot: ShotType
  camera: CameraMotion
  /** Action + dialogue par perso (clé = character.id) */
  perCharacter: Record<string, { action: string; dialogue: string }>
  /** Continuité visuelle avec le plan précédent (FirstFrame = LastFrame N-1) */
  continuity: boolean
  /** URL de la vidéo générée (null = pas encore généré) */
  videoUrl: string | null
}

const SHOT_LABELS: Record<ShotType, string> = {
  wide: 'Wide shot',
  medium: 'Medium shot',
  close_up: 'Close-up',
  extreme_close_up: 'Extreme CU',
}

const CAMERA_LABELS: Record<CameraMotion, string> = {
  static: 'Static',
  slow_zoom_in: 'Slow zoom in',
  slow_zoom_out: 'Slow zoom out',
  pan_left: 'Pan left',
  pan_right: 'Pan right',
  dolly_in: 'Dolly in',
  dolly_out: 'Dolly out',
  handheld: 'Handheld',
}

const QUALITY_OPTIONS: { value: Quality; emoji: string; label: string; time: string }[] = [
  { value: 'draft',    emoji: '⚡', label: 'Brouillon', time: '~1 min/pellicule' },
  { value: 'standard', emoji: '🎬', label: 'Standard',  time: '~5 min/pellicule' },
  { value: 'final',    emoji: '✨', label: 'Finale',    time: '~10 min/pellicule' },
]

/** Durée par pellicule par défaut. LTX 2.3 sweet spot. */
const PELLICULE_DURATION = 5
const MAX_TOTAL_DURATION = 20  // secondes
const MIN_TOTAL_DURATION = 5

function genId(): string {
  return `pell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Construit le prompt structuré au format Vantage (LTX 2.3 + IC LoRA Dual).
 * Le format attendu par le custom node :
 *   [Scene] description du décor
 *   [Characters] Female: ... | Male: ...
 *   [Shot N] (cadrage, caméra)
 *   <CharName>: action / "dialogue"
 *
 * Pour le mode light test : 1 pellicule = 1 shot.
 */
function buildVantagePrompt(pell: Pellicule, chars: Character[]): string {
  const lines: string[] = []

  // [Scene] : on n'a pas de scene globale dans CatalogAnimation pour l'instant.
  // À enrichir post-validation (extraire du plan parent ?).
  lines.push('[Scene] Cinematic scene with two characters interacting.')
  lines.push('')

  // [Characters] : description physique courte par perso
  if (chars.length > 0) {
    lines.push('[Characters]')
    for (const c of chars) {
      const desc = c.prompt?.trim() || 'a person'
      lines.push(`${c.name}: ${desc}`)
    }
    lines.push('')
  }

  // [Shot 1] : cadrage + caméra + actions/dialogues
  const cameraDesc = CAMERA_LABELS[pell.camera]
  const shotDesc = SHOT_LABELS[pell.shot]
  lines.push(`[Shot 1] (${shotDesc}, ${cameraDesc} camera)`)
  for (const c of chars) {
    const data = pell.perCharacter[c.id]
    if (!data) continue
    const action = data.action.trim()
    const dialogue = data.dialogue.trim()
    if (!action && !dialogue) continue
    let line = `${c.name}:`
    if (action) line += ` ${action}.`
    if (dialogue) line += ` "${dialogue}"`
    lines.push(line)
  }

  return lines.join('\n')
}

function newPellicule(continuity: boolean = true): Pellicule {
  return {
    id: genId(),
    duration: PELLICULE_DURATION,
    shot: 'medium',
    camera: 'static',
    perCharacter: {},
    continuity,
    videoUrl: null,
  }
}

function BreadcrumbTitle({ onNavigateToBanks }: { onNavigateToBanks?: () => void }) {
  return (
    <span className="dz-catalog-breadcrumb">
      <button
        type="button"
        className="dz-breadcrumb-parent"
        onClick={onNavigateToBanks}
        disabled={!onNavigateToBanks}
        title="Retour à Banques"
      >
        Banques
      </button>
      <ChevronRight size={11} className="dz-breadcrumb-sep" aria-hidden />
      <span className="dz-breadcrumb-parent" style={{ cursor: 'default' }}>Personnages</span>
      <ChevronRight size={11} className="dz-breadcrumb-sep" aria-hidden />
      <span className="dz-breadcrumb-current">Animation</span>
    </span>
  )
}

export default function CatalogAnimation({
  onClose, onNavigateToBanks,
}: CatalogAnimationProps) {
  const { characters } = useCharacterStore()
  // Sélection de persos (max 2)
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([])
  // Storyboard : array de pellicules
  const [pellicules, setPellicules] = useState<Pellicule[]>([newPellicule(false)])
  // Qualité globale
  const [quality, setQuality] = useState<Quality>('standard')
  // Pellicule en cours de génération (null = aucune)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  // Label de progression (en cours de génération)
  const [progressLabel, setProgressLabel] = useState<string>('')

  const totalDuration = useMemo(
    () => pellicules.reduce((acc, p) => acc + p.duration, 0),
    [pellicules]
  )

  const selectedChars = useMemo(
    () => selectedCharIds.map(id => characters.find(c => c.id === id)).filter((c): c is Character => !!c),
    [selectedCharIds, characters]
  )

  function toggleCharacter(charId: string) {
    setSelectedCharIds(prev => {
      if (prev.includes(charId)) {
        return prev.filter(id => id !== charId)
      }
      if (prev.length >= 2) {
        // Max 2 — remplace le 1er
        return [prev[1], charId]
      }
      return [...prev, charId]
    })
  }

  function addPellicule() {
    if (totalDuration >= MAX_TOTAL_DURATION) return
    setPellicules(prev => [...prev, newPellicule(true)])
  }

  function removePellicule(id: string) {
    setPellicules(prev => prev.length > 1 ? prev.filter(p => p.id !== id) : prev)
  }

  function updatePellicule(id: string, patch: Partial<Pellicule>) {
    setPellicules(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
  }

  function updatePelliculeCharData(
    pelliculeId: string, charId: string,
    field: 'action' | 'dialogue', value: string,
  ) {
    setPellicules(prev => prev.map(p => {
      if (p.id !== pelliculeId) return p
      const cur = p.perCharacter[charId] ?? { action: '', dialogue: '' }
      return {
        ...p,
        perCharacter: { ...p.perCharacter, [charId]: { ...cur, [field]: value } },
      }
    }))
  }

  async function generatePellicule(pelliculeId: string) {
    if (selectedChars.length === 0) {
      alert('Sélectionne au moins 1 personnage avant de générer.')
      return
    }
    const pell = pellicules.find(p => p.id === pelliculeId)
    if (!pell) return

    setGeneratingId(pelliculeId)
    setProgressLabel('Préparation…')
    try {
      // Le wf Vantage est en mode T2V (chaîne LoadImage bypassée), mais le
      // helper exige une URL d'image. On passe le portrait du 1er perso en
      // satisfaction du contrat — le wf l'ignorera côté ComfyUI.
      const placeholderImage =
        selectedChars[0]?.fullbodyUrl ?? selectedChars[0]?.portraitUrl
      if (!placeholderImage) {
        throw new Error('Le 1er perso sélectionné n\'a ni portrait ni fullbody.')
      }

      const positivePrompt = buildVantagePrompt(pell, selectedChars)

      const result = await runLtx23Dual({
        imageUrl: placeholderImage,
        positivePrompt,
        seed: -1,
        onProgress: p => setProgressLabel(p.label ?? p.stage),
      })

      // result.first_frame_url / .last_frame_url seront utilisées Phase 4
      // (persistance plan + vignette banque). Pour l'instant on garde juste
      // la vidéo affichée dans la pellicule.
      updatePellicule(pelliculeId, { videoUrl: result.video_url })
    } catch (err) {
      console.error('[CatalogAnimation] gen pellicule failed:', err)
      alert('Erreur génération : ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setGeneratingId(null)
      setProgressLabel('')
    }
  }

  async function generateAll() {
    for (const p of pellicules) {
      if (p.videoUrl) continue  // skip déjà généré
      await generatePellicule(p.id)
    }
  }

  const canGenerate = selectedChars.length >= 1 && pellicules.length >= 1
  const persosInScene = characters // TODO : filtrer par layers de la scène quand character_id sera lié

  return (
    <CatalogShell
      title={<BreadcrumbTitle onNavigateToBanks={onNavigateToBanks} />}
      onClose={onClose}
      showSearch={false}
    >
      {/* Sélecteur de persos */}
      <div className="dza-section">
        <div className="dza-section-title">
          <span>Personnages dans la scène</span>
          <span className="dza-hint">2 max</span>
        </div>
        <div className="dza-char-row">
          {persosInScene.length === 0 ? (
            <div className="dza-empty">Aucun perso dans la scène. Insère d'abord un perso via Personnage → Ajouter.</div>
          ) : persosInScene.map(c => {
            const checked = selectedCharIds.includes(c.id)
            const thumbUrl = c.portraitUrl ?? c.fullbodyUrl
            return (
              <button
                key={c.id}
                type="button"
                className={`dza-char-card ${checked ? 'selected' : ''}`}
                onClick={() => toggleCharacter(c.id)}
                title={`Sélectionner ${c.name}`}
              >
                {thumbUrl
                  ? <img src={thumbUrl} alt={c.name} className="dza-char-img" />
                  : <div className="dza-char-empty">👤</div>}
                <div className="dza-char-name">{c.name}</div>
                {checked && <span className="dza-char-check"><Check size={11} strokeWidth={3} /></span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Header storyboard avec durée */}
      <div className="dza-section">
        <div className="dza-section-title">
          <span>Storyboard</span>
          <span className="dza-hint">
            {pellicules.length} plan{pellicules.length > 1 ? 's' : ''} · {totalDuration}s total
          </span>
        </div>

        {/* Storyboard horizontal scroll */}
        <div className="dza-storyboard">
          {pellicules.map((pell, idx) => (
            <PelliculeCard
              key={pell.id}
              index={idx}
              pellicule={pell}
              characters={selectedChars}
              isGenerating={generatingId === pell.id}
              progressLabel={generatingId === pell.id ? progressLabel : ''}
              canRemove={pellicules.length > 1}
              onUpdate={(patch) => updatePellicule(pell.id, patch)}
              onUpdateCharData={(charId, field, value) =>
                updatePelliculeCharData(pell.id, charId, field, value)}
              onRemove={() => removePellicule(pell.id)}
              onGenerate={() => generatePellicule(pell.id)}
            />
          ))}

          {/* Bouton + ajouter pellicule */}
          {totalDuration < MAX_TOTAL_DURATION && (
            <button
              type="button"
              className="dza-pellicule-add"
              onClick={addPellicule}
              title={`Ajouter un plan de ${PELLICULE_DURATION}s`}
            >
              <Plus size={20} />
              <span>+ {PELLICULE_DURATION}s</span>
            </button>
          )}
        </div>
        <div className="dza-storyboard-info">
          Max {MAX_TOTAL_DURATION}s · 1 plan = 1 workflow LTX 2.3 · Continuité visuelle entre plans
        </div>
      </div>

      {/* Qualité globale */}
      <div className="dza-section">
        <div className="dza-section-title">Qualité</div>
        <div className="dza-quality-row">
          {QUALITY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`dza-quality-btn ${quality === opt.value ? 'active' : ''}`}
              onClick={() => setQuality(opt.value)}
            >
              <span className="dza-quality-emoji">{opt.emoji}</span>
              <span className="dza-quality-label">{opt.label}</span>
              <span className="dza-quality-time">{opt.time}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bouton générer tout */}
      <div className="dza-add-bar">
        <button
          type="button"
          className="dzc-add-btn"
          onClick={generateAll}
          disabled={!canGenerate || generatingId !== null}
        >
          {generatingId !== null
            ? `Génération en cours…`
            : `🎬 Générer la séquence (${pellicules.length}× ${PELLICULE_DURATION}s)`}
        </button>
      </div>
    </CatalogShell>
  )
}

// ─── Sous-composant : 1 pellicule ──────────────────────────────────────────

interface PelliculeCardProps {
  index: number
  pellicule: Pellicule
  characters: Character[]
  isGenerating: boolean
  progressLabel: string
  canRemove: boolean
  onUpdate: (patch: Partial<Pellicule>) => void
  onUpdateCharData: (charId: string, field: 'action' | 'dialogue', value: string) => void
  onRemove: () => void
  onGenerate: () => void
}

function PelliculeCard({
  index, pellicule, characters, isGenerating, progressLabel, canRemove,
  onUpdate, onUpdateCharData, onRemove, onGenerate,
}: PelliculeCardProps) {
  const labelColor = pellicule.videoUrl ? '#10B981' : '#71717A'

  return (
    <div className="dza-pellicule">
      {/* Header : index, durée, supprimer */}
      <div className="dza-pellicule-header">
        <span className="dza-pellicule-num" style={{ color: labelColor }}>
          PLAN {index + 1}
        </span>
        <span className="dza-pellicule-duration">{pellicule.duration}s</span>
        {canRemove && (
          <button
            type="button"
            className="dza-pellicule-remove"
            onClick={onRemove}
            title="Supprimer ce plan"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Thumbnail / preview vidéo */}
      <div className="dza-pellicule-thumb">
        {pellicule.videoUrl ? (
          <video src={pellicule.videoUrl} muted loop autoPlay className="dza-pellicule-video" />
        ) : isGenerating ? (
          <div className="dza-pellicule-busy">
            <Loader2 size={20} className="dza-spin" />
            <span>{progressLabel || 'Génération…'}</span>
          </div>
        ) : (
          <div className="dza-pellicule-empty">Pas encore généré</div>
        )}
      </div>

      {/* Type de plan + caméra */}
      <div className="dza-pellicule-row">
        <select
          value={pellicule.shot}
          onChange={e => onUpdate({ shot: e.target.value as ShotType })}
          className="dza-pellicule-select"
        >
          {Object.entries(SHOT_LABELS).map(([v, l]) =>
            <option key={v} value={v}>{l}</option>)}
        </select>
        <select
          value={pellicule.camera}
          onChange={e => onUpdate({ camera: e.target.value as CameraMotion })}
          className="dza-pellicule-select"
        >
          {Object.entries(CAMERA_LABELS).map(([v, l]) =>
            <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* Actions + dialogues par perso */}
      {characters.length === 0 ? (
        <div className="dza-pellicule-empty-msg">
          Sélectionne d'abord 1-2 personnages
        </div>
      ) : (
        characters.map(c => {
          const data = pellicule.perCharacter[c.id] ?? { action: '', dialogue: '' }
          return (
            <div key={c.id} className="dza-pellicule-char">
              <div className="dza-pellicule-char-name">🎬 {c.name}</div>
              <textarea
                className="dza-pellicule-textarea"
                placeholder="Action (ex: prend une bouffée et regarde par la fenêtre)"
                value={data.action}
                onChange={e => onUpdateCharData(c.id, 'action', e.target.value)}
                rows={2}
              />
              <textarea
                className="dza-pellicule-textarea"
                placeholder='Dialogue (optionnel, ex: "Tiens, regarde qui arrive")'
                value={data.dialogue}
                onChange={e => onUpdateCharData(c.id, 'dialogue', e.target.value)}
                rows={1}
              />
            </div>
          )
        })
      )}

      {/* Bouton re-render sélectif */}
      <button
        type="button"
        className="dza-pellicule-gen"
        onClick={onGenerate}
        disabled={isGenerating || characters.length === 0}
      >
        {isGenerating ? '…' : pellicule.videoUrl ? 'Régénérer ce plan' : 'Générer ce plan'}
      </button>
    </div>
  )
}
