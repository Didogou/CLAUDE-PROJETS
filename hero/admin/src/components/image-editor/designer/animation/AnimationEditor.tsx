'use client'
/**
 * AnimationEditor — éditeur inline sous la timeline pour la pellicule active.
 *
 * Affiche UNIQUEMENT les contrôles narratifs (= ce que font les persos) :
 *   - Action + dialogue par perso sélectionné (max 2)
 *   - Bouton Générer / Régénérer
 *
 * Refonte 2026-05-05 : Cadrage / Caméra / Durée sont remontés dans la cellule
 * pellicule de la timeline (sous le thumbnail). Permet à l'auteur de scanner
 * les paramètres caméra de tout le storyboard d'un coup d'œil, sans déplier
 * pellicule par pellicule. L'éditeur en bas se concentre sur le contenu narratif
 * (qui est le vrai cœur de la prompting LTX).
 *
 * Si aucune pellicule sélectionnée → message guide.
 * Si pellicule sélectionnée mais aucun perso choisi → message guide.
 *
 * V1 mono-type 'animation'. En Phase C les contrôles seront conditionnels au
 * type (image_static n'a pas actions, conversation lit l'arbre Studio Creator
 * au lieu de prompt actions).
 */

import React, { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useCharacterStore, type Character } from '@/lib/character-store'
import { useEditorState } from '@/components/image-editor/EditorStateContext'

interface AnimationEditorProps {
  /** Callback de génération LTX — câblé dans le parent car nécessite l'image
   *  source (canvas state) et la liste des persos. */
  onGenerate: (pelliculeId: string) => void
  /** ID de la pellicule en cours de génération (null = aucune). */
  generatingPelliculeId?: string | null
  /** Label de progression LTX courant (vide quand pas de gen). */
  generatingProgressLabel?: string
}

export default function AnimationEditor({
  onGenerate,
  generatingPelliculeId = null,
  generatingProgressLabel = '',
}: AnimationEditorProps) {
  const { characters } = useCharacterStore()
  const {
    animationPellicules,
    animationSelectedPelliculeId,
    animationSelectedCharIds,
    updateAnimationPelliculeCharData,
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
  const noChars = selectedChars.length === 0
  const promptOk = Object.values(pell.perCharacter).some(d => d.action.trim().length > 0)
  const canGenerate = !noChars && promptOk && !isGenerating

  return (
    <div className="dz-anim-editor">
      {/* Actions + dialogues par perso (1 ligne par perso sélectionné).
       *  Cadrage / Caméra / Durée sont dans la cellule timeline pour scan rapide. */}
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
