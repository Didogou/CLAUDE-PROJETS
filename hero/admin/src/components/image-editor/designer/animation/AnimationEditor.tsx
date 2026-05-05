'use client'
/**
 * AnimationEditor — éditeur inline sous la timeline pour la pellicule active.
 *
 * Phase E (2026-05-05) : rendu conditionnel selon `pell.type` :
 *   - 'animation'    : actions + dialogue par perso + bouton Générer (LTX)
 *   - 'image_static' : upload d'une image fixe + preview
 *   - 'conversation' : placeholder "à configurer dans Studio Creator"
 *
 * Cadrage / Caméra / Durée sont dans le modal Options de la cellule timeline
 * (cf AnimationOptionsModal). L'éditeur en bas se concentre sur le contenu
 * spécifique au type.
 */

import React, { useMemo, useRef, useState } from 'react'
import { Loader2, Upload, Image as ImageIcon, MessageSquare } from 'lucide-react'
import { useCharacterStore, type Character } from '@/lib/character-store'
import { useEditorState } from '@/components/image-editor/EditorStateContext'
import { WEATHER_PRESETS } from '@/components/image-editor/types'

/** V1 — sous-ensemble des presets WEATHER applicables comme effet ambiance
 *  sur une image_static (rain/snow/fog/cloud — pas lightning qui demande un
 *  composant à part). Ordre = ordre d'affichage dans la palette. */
const IMAGE_EFFECT_PRESETS = WEATHER_PRESETS.filter(p =>
  p.kind === 'rain' || p.kind === 'snow' || p.kind === 'fog' || p.kind === 'cloud'
)

interface AnimationEditorProps {
  /** Callback de génération LTX — câblé dans le parent car nécessite l'image
   *  source (canvas state) et la liste des persos. */
  onGenerate: (pelliculeId: string) => void
  /** ID de la pellicule en cours de génération (null = aucune). */
  generatingPelliculeId?: string | null
  /** Label de progression LTX courant (vide quand pas de gen). */
  generatingProgressLabel?: string
  /** Préfixe Supabase pour les uploads image_static. */
  storagePathPrefix: string
}

export default function AnimationEditor({
  onGenerate,
  generatingPelliculeId = null,
  generatingProgressLabel = '',
  storagePathPrefix,
}: AnimationEditorProps) {
  const { characters } = useCharacterStore()
  const {
    animationPellicules,
    animationSelectedPelliculeId,
    animationSelectedCharIds,
    updateAnimationPellicule,
    updateAnimationPelliculeCharData,
    setBakeStatus,
  } = useEditorState()

  const pell = useMemo(
    () => animationPellicules.find(p => p.id === animationSelectedPelliculeId) ?? null,
    [animationPellicules, animationSelectedPelliculeId],
  )
  const selectedChars = useMemo(
    () => animationSelectedCharIds
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is Character => !!c),
    [animationSelectedCharIds, characters],
  )

  // Upload image_static — local state pour le file input + indicateur busy
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // États guides : invitent l'auteur à compléter avant d'éditer
  if (!pell) {
    return (
      <div className="dz-anim-editor dz-anim-editor-empty">
        <span>
          Sélectionne une pellicule dans la timeline ou clique <strong>+</strong> pour en créer une.
        </span>
      </div>
    )
  }

  const isGenerating = generatingPelliculeId === pell.id

  // ────────────────────────────────────────────────────────────────────────
  // Type 'image_static' — upload d'une image fixe
  // ────────────────────────────────────────────────────────────────────────
  async function handleImageUpload(file: File) {
    if (!pell) return
    if (!file.type.startsWith('image/')) {
      setUploadError(`Format non supporté : ${file.type || 'inconnu'}`)
      return
    }
    setUploading(true); setUploadError(null)
    setBakeStatus({
      startedAt: Date.now(),
      phase: 'Upload image…',
      kind: 'animation',
      estimatedTotalSec: 10,
    })
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Lecture du fichier échouée'))
        reader.readAsDataURL(file)
      })
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${storagePathPrefix}_pellicule_static_${pell.id}.${ext === 'jpeg' ? 'jpg' : ext}`
      const res = await fetch('/api/storage/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, path }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      // Pour image_static : firstFrame == lastFrame (l'image est statique)
      // → permet aussi la continuité visuelle avec la pellicule suivante.
      updateAnimationPellicule(pell.id, {
        firstFrameUrl: data.url,
        lastFrameUrl: data.url,
        // videoUrl reste null (pas de vidéo)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[AnimationEditor] image upload failed:', msg)
      setUploadError(msg)
    } finally {
      setUploading(false)
      setBakeStatus(null)
    }
  }

  function pickImageFile() {
    if (uploading) return
    fileInputRef.current?.click()
  }
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleImageUpload(file)
    e.target.value = ''
  }

  // ────────────────────────────────────────────────────────────────────────
  // Render conditionnel par type
  // ────────────────────────────────────────────────────────────────────────

  if (pell.type === 'image_static') {
    return (
      <div className="dz-anim-editor">
        <div className="dz-anim-editor-type-header">
          <ImageIcon size={14} />
          <span>Image fixe — {pell.duration}s d'affichage</span>
        </div>

        {pell.firstFrameUrl ? (
          <div className="dz-anim-editor-image-preview">
            <img src={pell.firstFrameUrl} alt="Image fixe" />
          </div>
        ) : (
          <div className="dz-anim-editor-guide">
            Aucune image — choisis-en une dans la banque (panneau de gauche)
            ou importe-la depuis ton ordinateur (bouton ci-dessous).
          </div>
        )}

        {/* Phase E — Section Effets : presets ambiance par-dessus l'image */}
        {pell.firstFrameUrl && (
          <div className="dz-anim-editor-effects">
            <div className="dz-anim-editor-effects-label">Effet ambiance</div>
            <div className="dz-anim-editor-effects-row">
              <button
                type="button"
                className={`dz-anim-editor-effect-btn ${!pell.effectPreset ? 'active' : ''}`}
                onClick={() => updateAnimationPellicule(pell.id, { effectPreset: null })}
                title="Aucun effet"
              >
                <span style={{ fontSize: '0.75rem' }}>∅</span>
                <span>Aucun</span>
              </button>
              {IMAGE_EFFECT_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  className={`dz-anim-editor-effect-btn ${pell.effectPreset === preset.key ? 'active' : ''}`}
                  onClick={() => updateAnimationPellicule(pell.id, { effectPreset: preset.key })}
                  title={preset.hint}
                >
                  <span style={{ fontSize: '0.85rem' }}>{preset.icon}</span>
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="dz-anim-editor-actions">
          {uploadError && (
            <div className="dza-upload-error" title={uploadError}>
              ⚠ {uploadError.length > 90 ? uploadError.slice(0, 90) + '…' : uploadError}
            </div>
          )}
          <button
            type="button"
            className="dz-anim-editor-gen-btn"
            onClick={pickImageFile}
            disabled={uploading}
          >
            {uploading ? (
              <><Loader2 size={14} className="dza-spin" /><span>Upload…</span></>
            ) : (
              <><Upload size={14} /><span>{pell.firstFrameUrl ? 'Changer l\'image' : 'Importer depuis l\'ordi'}</span></>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>
    )
  }

  if (pell.type === 'conversation') {
    return (
      <div className="dz-anim-editor">
        <div className="dz-anim-editor-type-header">
          <MessageSquare size={14} />
          <span>Conversation — branching dialogue</span>
        </div>
        <div className="dz-anim-editor-guide">
          À venir : la pellicule conversation sera configurée depuis le Studio Creator
          (arbre de dialogues avec choix joueur). Pour l'instant, change le type
          dans Options pour Animation ou Image fixe.
        </div>
      </div>
    )
  }

  // type === 'animation' — UI existante (chars + actions + generate)
  const noChars = selectedChars.length === 0
  const promptOk = Object.values(pell.perCharacter).some(d => d.action.trim().length > 0)
  const canGenerate = !noChars && promptOk && !isGenerating

  return (
    <div className="dz-anim-editor">
      {/* Actions + dialogues par perso (1 ligne par perso sélectionné).
       *  Cadrage / Caméra / Durée sont dans le modal Options de la cellule. */}
      {noChars ? (
        <div className="dz-anim-editor-guide">
          Sélectionne 1-2 personnages dans le panneau de gauche pour configurer leurs actions.
        </div>
      ) : (
        <div className="dz-anim-editor-chars">
          {selectedChars.map(c => {
            const data = pell.perCharacter[c.id] ?? { action: '', dialogue: '' }
            return (
              <div key={c.id} className="dz-anim-editor-char">
                <div className="dz-anim-editor-char-name">
                  {c.gender === 'male' ? '♂' : '♀'} {c.name}
                </div>
                <input
                  type="text"
                  className="dz-anim-editor-input"
                  placeholder="Action en anglais (ex: tilts his glass slightly toward the woman on the sofa, takes a slow sip)"
                  value={data.action}
                  onChange={e => updateAnimationPelliculeCharData(pell.id, c.id, 'action', e.target.value)}
                  disabled={isGenerating}
                />
                <input
                  type="text"
                  className="dz-anim-editor-input"
                  placeholder="Dialogue (optionnel — laisse vide pour V1, lipsync LTX faible)"
                  value={data.dialogue}
                  onChange={e => updateAnimationPelliculeCharData(pell.id, c.id, 'dialogue', e.target.value)}
                  disabled={isGenerating}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Bouton Générer / Régénérer */}
      <div className="dz-anim-editor-actions">
        <button
          type="button"
          className="dz-anim-editor-gen-btn"
          onClick={() => onGenerate(pell.id)}
          disabled={!canGenerate}
          title={
            noChars     ? 'Sélectionne 1-2 personnages d\'abord' :
            !promptOk   ? 'Renseigne au moins une action' :
            isGenerating ? 'Génération en cours…' :
            pell.videoUrl ? 'Régénérer cette pellicule' : 'Générer cette pellicule'
          }
        >
          {isGenerating ? (
            <>
              <Loader2 size={14} className="dza-spin" />
              <span>{generatingProgressLabel || 'Génération…'}</span>
            </>
          ) : (
            <span>{pell.videoUrl ? 'Régénérer ce plan' : 'Générer ce plan'}</span>
          )}
        </button>
      </div>
    </div>
  )
}
