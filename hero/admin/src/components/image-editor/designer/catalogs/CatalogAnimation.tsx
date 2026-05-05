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

import React, { useState, useMemo, useRef } from 'react'
import { ChevronRight, Plus, X, Loader2, Check, Upload } from 'lucide-react'
import CatalogShell from './CatalogShell'
import { useCharacterStore, type Character } from '@/lib/character-store'
import { runLtx23Dual } from '@/lib/comfyui-ltx-dual'
import { useEditorState } from '@/components/image-editor/EditorStateContext'
import { flattenLayersToImage } from '@/lib/flatten-layers'
import { extractFramesFromVideo } from '@/lib/extract-frames'
import type { EditorLayer } from '@/components/image-editor/types'

interface CatalogAnimationProps {
  onClose: () => void
  onNavigateToBanks?: () => void
  storagePathPrefix: string
  /** URL de l'image de base du plan en cours dans le canvas Designer.
   *  Si fournie, sera utilisée comme image source LTX I2V (animation qui
   *  démarre depuis ta scène existante). Sinon, fallback sur le portrait du
   *  1er perso sélectionné (V0 T2V mode pseudo-I2V). */
  baseImageUrl?: string | null
  /** IDs des Characters réellement présents dans le plan en cours (extraits
   *  des calques avec character_id renseigné). Le sélecteur n'affiche que
   *  ces persos — l'auteur ne peut animer que les persos déjà dans la scène.
   *  Liste vide => message "Aucun perso dans la scène, insère-en un d'abord". */
  presentCharacterIds?: string[]
  /** Calques actuels du plan (base + overlays persos + effets). Utilisés pour
   *  flatten en 1 image source LTX (sinon LTX reçoit la base seule sans persos
   *  = perte d'identité). Cf décision 2026-05-03. */
  currentLayers?: EditorLayer[]
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

/** Labels affichés en UI (FR). Pour l'envoi au prompt LTX EN, voir SHOT_PROMPT. */
const SHOT_LABELS: Record<ShotType, string> = {
  wide: 'Plan large',
  medium: 'Plan moyen',
  close_up: 'Gros plan',
  extreme_close_up: 'Très gros plan',
}

/** Termes EN injectés dans le prompt LTX (le modèle est entraîné en EN). */
const SHOT_PROMPT: Record<ShotType, string> = {
  wide: 'wide shot',
  medium: 'medium shot',
  close_up: 'close-up',
  extreme_close_up: 'extreme close-up',
}

/** Labels affichés en UI (FR). Pour l'envoi au prompt LTX EN, voir CAMERA_PROMPT. */
const CAMERA_LABELS: Record<CameraMotion, string> = {
  static: 'Caméra fixe',
  slow_zoom_in: 'Zoom avant lent',
  slow_zoom_out: 'Zoom arrière lent',
  pan_left: 'Panoramique gauche',
  pan_right: 'Panoramique droite',
  dolly_in: 'Travelling avant',
  dolly_out: 'Travelling arrière',
  handheld: 'Caméra portée',
}

/** Termes EN injectés dans le prompt LTX (le modèle est entraîné en EN). */
const CAMERA_PROMPT: Record<CameraMotion, string> = {
  static: 'static',
  slow_zoom_in: 'slow zoom in',
  slow_zoom_out: 'slow zoom out',
  pan_left: 'pan left',
  pan_right: 'pan right',
  dolly_in: 'dolly in',
  dolly_out: 'dolly out',
  handheld: 'handheld',
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
 *
 * Format attendu par le LoRA (LTX2.3-IC-LoRA-Dual-Character v0.1, Civitai 2500098) :
 *   [Scene] description du décor
 *   [Characters]
 *   Female: ... description courte
 *   Male: ... description courte
 *   [Shot N] (Cadrage, durée)
 *   Female: action.
 *   Male: action.
 *
 * ⚠ Le LoRA est entraîné sur les LABELS GÉNÉRIQUES `Male:` / `Female:`,
 *    PAS sur les noms propres. Utiliser `Duke:` / `Epsi:` force des tokens
 *    hors-distribution → identité dégradée. C'est pourquoi on mappe via
 *    `c.gender` (champ ajouté 2026-05-04, simplifié à 2 valeurs 2026-05-05).
 *
 * Cas particuliers :
 *   - Plusieurs persos du même genre → suffixe d'index (`Female:` puis `Female 2:`)
 *   - `c.gender` manquant (legacy) → défaut 'female'
 *
 * Pour le mode light test : 1 pellicule = 1 shot.
 */
function buildVantagePrompt(pell: Pellicule, chars: Character[]): string {
  const lines: string[] = []

  // ── Mapping perso → label Vantage ─────────────────────────────────────
  // Compteur par bucket (female / male) pour gérer les collisions multi-persos.
  // Legacy 'other' / undefined → 'female' (sanitization au load + ici en filet).
  const counts = { female: 0, male: 0 }
  const labelByCharId = new Map<string, string>()
  for (const c of chars) {
    const g: 'female' | 'male' = c.gender === 'male' ? 'male' : 'female'
    counts[g] += 1
    const base = g === 'female' ? 'Female' : 'Male'
    const label = counts[g] === 1 ? base : `${base} ${counts[g]}`
    labelByCharId.set(c.id, label)
  }

  // [Scene] : placeholder tant que la scène n'est pas extraite du plan parent.
  // TODO Phase 4 : passer une description de scène depuis Designer.
  lines.push('[Scene] Cinematic scene with two characters interacting.')
  lines.push('')

  // [Characters] : description physique courte par perso, indexée par label
  if (chars.length > 0) {
    lines.push('[Characters]')
    for (const c of chars) {
      const desc = c.prompt?.trim() || 'a person'
      const label = labelByCharId.get(c.id) ?? c.name
      // On garde le nom propre en commentaire fin de ligne pour la lisibilité
      // humaine quand on debug le prompt — le LoRA ignore le `#` final.
      lines.push(`${label}: ${desc}  # ${c.name}`)
    }
    lines.push('')
  }

  // [Shot 1] : cadrage + caméra + actions
  // ⚠ Utilise _PROMPT (EN) ici, pas _LABELS (FR UI) — LTX est entraîné en EN.
  // Format Civitai : `(Wide Shot, 5s)` — on inclut la durée de la pellicule.
  const cameraDesc = CAMERA_PROMPT[pell.camera]
  const shotDesc = SHOT_PROMPT[pell.shot]
  lines.push(`[Shot 1] (${shotDesc}, ${pell.duration}s, ${cameraDesc} camera)`)
  for (const c of chars) {
    const data = pell.perCharacter[c.id]
    if (!data) continue
    const action = data.action.trim()
    const dialogue = data.dialogue.trim()
    if (!action && !dialogue) continue
    const label = labelByCharId.get(c.id) ?? c.name
    let line = `${label}:`
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
  onClose, onNavigateToBanks, baseImageUrl, presentCharacterIds = [],
  currentLayers = [],
}: CatalogAnimationProps) {
  const { characters } = useCharacterStore()
  // BakeProgressModal global pour bloquer l'UI pendant les ~17 min de gen
  // LTX (sinon clic ailleurs = perte du state pellicule + animation perdue).
  // setCurrentVideo : pousse la vidéo générée dans EditorState pour que Canvas
  // l'affiche immédiatement à la place de l'image base.
  const { setBakeStatus, setCurrentVideo } = useEditorState()
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
  // Upload manuel : ref input + busy flag (bloque les double-clics)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

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
    // Active BakeProgressModal — bloque IMPÉRATIVEMENT l'UI : LTX 2.3 prend
    // ~17 min sur 8 GB. Si clic ailleurs en cours de route = perte du state.
    setBakeStatus({
      startedAt: Date.now(),
      phase: 'Préparation…',
      kind: 'animation',
      estimatedTotalSec: 1020,  // 17 min en secondes
    })
    try {
      // Source image LTX I2V : on FLATTEN base + calques visibles (persos,
      // effets) en 1 image composite avant de soumettre. Sinon LTX reçoit la
      // base seule SANS les persos posés en calques = perte d'identité visuelle.
      // Cf décision 2026-05-03 (option β + flatten on-demand).
      let sourceImage: string
      if (baseImageUrl) {
        setProgressLabel('Composition de l\'image source…')
        try {
          sourceImage = await flattenLayersToImage({
            baseImageUrl,
            layers: currentLayers,
            storagePathPrefix: `test/animation_source/${Date.now()}`,
          })
        } catch (flatErr) {
          console.warn('[CatalogAnimation] flatten failed, fallback baseImageUrl:', flatErr)
          sourceImage = baseImageUrl  // fallback : on perd les persos calques mais on génère quand même
        }
      } else {
        // Pas d'image base → fallback sur fullbody/portrait du 1er perso
        const fallback = selectedChars[0]?.fullbodyUrl ?? selectedChars[0]?.portraitUrl
        if (!fallback) {
          throw new Error('Aucune image source : ni base de plan, ni perso avec image.')
        }
        sourceImage = fallback
      }

      const positivePrompt = buildVantagePrompt(pell, selectedChars)

      const result = await runLtx23Dual({
        imageUrl: sourceImage,
        positivePrompt,
        seed: -1,
        // BakeProgressModal a son chrono auto, on update juste le label local
        onProgress: p => setProgressLabel(p.label ?? p.stage),
      })

      // Stocke dans la pellicule (preview catalogue) ET pousse dans EditorState
      // pour que le Canvas affiche immédiatement la vidéo à la place de l'image.
      // Les frames first/last servent de poster + vignette banque (Phase 4).
      updatePellicule(pelliculeId, { videoUrl: result.video_url })
      setCurrentVideo(result.video_url, result.first_frame_url, result.last_frame_url)
    } catch (err) {
      console.error('[CatalogAnimation] gen pellicule failed:', err)
      alert('Erreur génération : ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setGeneratingId(null)
      setProgressLabel('')
      // Ferme BakeProgressModal global même en cas d'erreur
      setBakeStatus(null)
    }
  }

  async function generateAll() {
    for (const p of pellicules) {
      if (p.videoUrl) continue  // skip déjà généré
      await generatePellicule(p.id)
    }
  }

  /**
   * Upload manuel d'une vidéo existante depuis le PC.
   * Comportement identique à une gen LTX réussie :
   *   1. Read file → data URL → POST /api/storage/upload-video → URL Supabase
   *   2. Extract first/last frames côté client (poster + vignette banque)
   *   3. updatePellicule(currentPellicule.videoUrl) → preview catalogue
   *   4. setCurrentVideo(...) → Canvas affiche la vidéo
   *   Au save Ctrl+S suivant, la vidéo + frames + kind='animation' sont persistées.
   */
  async function handleVideoUpload(file: File) {
    if (!file.type.startsWith('video/')) {
      setUploadError(`Format non supporté : ${file.type || 'inconnu'} (attendu : video/mp4, webm, mov…)`)
      return
    }
    // Pellicule cible : la 1ère sans video. Si toutes ont déjà une vidéo → on
    // remplace celle de la 1ère pellicule (UX simple V1, on peut affiner après).
    const target = pellicules.find(p => !p.videoUrl) ?? pellicules[0]
    if (!target) return

    setUploading(true); setUploadError(null)
    setBakeStatus({
      startedAt: Date.now(),
      phase: 'Lecture du fichier…',
      kind: 'animation',
      estimatedTotalSec: 30,  // upload + frames extraction est rapide
    })
    try {
      // 1. Read file → data URL
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
        reader.readAsDataURL(file)
      })
      setBakeStatus({
        startedAt: Date.now(),
        phase: 'Upload Supabase…',
        kind: 'animation',
        estimatedTotalSec: 30,
      })
      // 2. Upload Supabase
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `studio/uploads/video_${Date.now()}.${ext}`
      const upRes = await fetch('/api/storage/upload-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path }),
      })
      const upData = await upRes.json() as { url?: string; error?: string }
      if (!upRes.ok || !upData.url) {
        throw new Error(upData.error ?? `HTTP ${upRes.status}`)
      }
      const videoUrl = upData.url

      // 3. Extract frames (best-effort — si échoue, vidéo OK quand même, juste pas de poster)
      setBakeStatus({
        startedAt: Date.now(),
        phase: 'Capture des miniatures…',
        kind: 'animation',
        estimatedTotalSec: 15,
      })
      let firstFrameUrl: string | null = null
      let lastFrameUrl: string | null = null
      try {
        const frames = await extractFramesFromVideo({
          videoUrl,
          storagePathPrefix: 'studio/uploads/frames',
        })
        firstFrameUrl = frames.first_frame_url
        lastFrameUrl = frames.last_frame_url
      } catch (frameErr) {
        console.warn('[CatalogAnimation] frame extraction failed (non-bloquant):', frameErr)
      }

      // 4. Comportement = gen LTX réussie : pellicule preview + EditorState
      updatePellicule(target.id, { videoUrl })
      setCurrentVideo(videoUrl, firstFrameUrl, lastFrameUrl)
      console.log('[CatalogAnimation] manual video upload OK:', videoUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[CatalogAnimation] video upload failed:', msg)
      setUploadError(msg)
    } finally {
      setUploading(false)
      setBakeStatus(null)
    }
  }

  function pickVideoFile() {
    if (uploading) return
    fileInputRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleVideoUpload(file)
    e.target.value = ''  // reset pour permettre re-upload du même fichier
  }

  const canGenerate = selectedChars.length >= 1 && pellicules.length >= 1
  // Source des persos dans le sélecteur :
  // - Si presentCharacterIds non vide → on filtre (auto-detect via calques OU
  //   bakedCharacterIds, cf option A décision 2026-05-04)
  // - Sinon → fallback B : on affiche TOUS les persos de la banque, l'auteur
  //   sélectionne manuellement ceux qu'il a mis dans la scène.
  const persosInScene = useMemo(
    () => presentCharacterIds.length > 0
      ? characters.filter(c => presentCharacterIds.includes(c.id))
      : characters,  // fallback B : tous les persos
    [characters, presentCharacterIds],
  )
  /** True si on est en mode fallback B (sélection manuelle). */
  const fallbackManual = presentCharacterIds.length === 0 && characters.length > 0

  return (
    <CatalogShell
      title={<BreadcrumbTitle onNavigateToBanks={onNavigateToBanks} />}
      onClose={onClose}
      showSearch={false}
    >
      {/* Upload manuel d'une vidéo existante (alternative à la gen LTX) */}
      <div className="dza-section">
        <div className="dza-section-title">
          <span>Importer une vidéo existante</span>
          <span className="dza-hint">MP4, WebM, MOV</span>
        </div>
        <button
          type="button"
          className="dza-upload-btn"
          onClick={pickVideoFile}
          disabled={uploading}
          title="Importe une vidéo depuis ton ordinateur. Elle sera affichée dans le Studio comme une animation générée."
        >
          {uploading ? (
            <>
              <Loader2 size={14} className="dza-spin" />
              <span>{progressLabel || 'Upload en cours…'}</span>
            </>
          ) : (
            <>
              <Upload size={14} />
              <span>Choisir une vidéo</span>
            </>
          )}
        </button>
        {uploadError && (
          <div className="dza-upload-error" title={uploadError}>
            ⚠ {uploadError.length > 90 ? uploadError.slice(0, 90) + '…' : uploadError}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* Sélecteur de persos */}
      <div className="dza-section">
        <div className="dza-section-title">
          <span>{fallbackManual ? 'Personnages disponibles' : 'Personnages dans la scène'}</span>
          <span className="dza-hint">2 max</span>
        </div>
        {fallbackManual && (
          <div className="dza-empty" style={{ marginBottom: 8, fontSize: 10, fontStyle: 'italic' }}>
            Aucun perso identifié auto. Sélectionne ceux que tu vois dans la scène.
          </div>
        )}
        <div className="dza-char-row">
          {persosInScene.length === 0 ? (
            <div className="dza-empty">Aucun perso dans la banque. Crée-en un d&apos;abord (Personnage → Ajouter → Nouveau).</div>
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
