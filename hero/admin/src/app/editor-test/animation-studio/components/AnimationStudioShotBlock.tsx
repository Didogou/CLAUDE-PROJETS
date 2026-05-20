'use client'
/**
 * AnimationStudioShotBlock — body d'UN shot dans la zone prompt centrale.
 *
 * Refonte 2026-05-10 : passage du modèle accordéon (header + body repliable)
 * au modèle **tabs** orchestré par AnimationStudioPromptZone. Ce composant
 * affiche uniquement le corps du shot actif :
 *   - Vignettes des persos du shot (avec speaker mis en valeur)
 *   - Click vignette = toggle speaker (set le perso comme parlant, ou démutage)
 *   - Bouton "+ perso" = ouvre la banque persos en drawer
 *   - Si speaker défini : Action + Dialogue. Sinon : Action seule pour tous.
 *   - Si plusieurs persos non-speaker : leur Action est éditable, pas leur Dialogue
 *
 * Header (numéro shot, meta, suppression) est désormais dans la tab.
 */

import React, { useRef } from 'react'
import { Plus, User, X } from 'lucide-react'
import { useEditorState, type Shot } from '@/components/image-editor/EditorStateContext'
import type { Character } from '@/lib/character-store'
import AudioTagPalette from '@/components/audio-tag-palette/AudioTagPalette'
import '@/components/audio-tag-palette/audio-tag-palette.css'

interface AnimationStudioShotBlockProps {
  shot: Shot
  /** Index du shot dans la pellicule (juste pour les aria-label). */
  shotIndex: number
  pelliculeId: string
  charsById: Map<string, Character>
  onAddCharacter: () => void
}

export default function AnimationStudioShotBlock({
  shot, shotIndex, pelliculeId, charsById, onAddCharacter,
}: AnimationStudioShotBlockProps) {
  const {
    updateAnimationPelliculeCharData,
    shotSetSpeaker, shotRemoveCharacter,
    updateAnimationShot,
  } = useEditorState()

  // Persos présents dans ce shot (résolus, fallback [] si shot persisté avant
  // la refonte 2026-05-07).
  const charsInShot = (shot.characterIds ?? [])
    .map(id => charsById.get(id))
    .filter((c): c is Character => !!c)

  return (
    <div className="as-shot-body" data-shot-index={shotIndex}>
      {/* Vignettes persos + bouton + */}
      <div className="as-shot-chars-row">
        {charsInShot.map(c => {
          const isSpeaker = c.id === shot.speakerId
          return (
            <div key={c.id} className="as-shot-char-vignette-wrap">
              <button
                type="button"
                className={`as-shot-char-vignette ${isSpeaker ? 'speaker' : ''}`}
                onClick={() => shotSetSpeaker(pelliculeId, shot.id, c.id)}
                title={isSpeaker
                  ? `${c.name} parle dans ce shot — clic pour démuter`
                  : `Cliquer pour faire parler ${c.name} dans ce shot`}
              >
                {c.portraitUrl
                  ? <img src={c.portraitUrl} alt={c.name} />
                  : <User size={20} />}
                <span className="as-shot-char-name">{c.name}</span>
                {isSpeaker && <span className="as-shot-char-badge">🎙</span>}
              </button>
              <button
                type="button"
                className="as-shot-char-remove"
                onClick={() => shotRemoveCharacter(pelliculeId, shot.id, c.id)}
                title="Retirer ce perso du shot"
                aria-label={`Retirer ${c.name} du shot`}
              >
                <X size={10} />
              </button>
            </div>
          )
        })}
        <button
          type="button"
          className="as-shot-add-char"
          onClick={onAddCharacter}
          title="Ajouter un perso à ce shot"
        >
          <Plus size={14} />
          <span>Perso</span>
        </button>
      </div>

      {/* Champs action / dialogue par perso. Speaker = action + dialogue.
          Autres = action seulement.
          Cas SANS perso (refonte 2026-05-13) : champ "Action de scène"
          pour décrire un mouvement / une animation pure (ex: plan aérien
          qui plonge, travelling, vue d'ensemble). */}
      {charsInShot.length === 0 ? (
        <div className="as-shot-fields">
          <div className="as-shot-char-fields">
            <div className="as-shot-char-fields-name">
              <span className="as-shot-char-fields-icon">🎬</span>
              Action de scène
            </div>
            <textarea
              className="as-shot-input"
              placeholder="Décris l'animation sans perso — ex: « Plan aérien qui plonge sur la ville futuriste, descend lentement vers l'entrée d'un immeuble »"
              value={shot.sceneAction ?? ''}
              onChange={e => updateAnimationShot(pelliculeId, shot.id, { sceneAction: e.target.value })}
              rows={3}
            />
            {/* Durée retirée 2026-05-13 — elle existe déjà dans le header du
             *  shot tab ("Plan moyen · Caméra fixe · 4 · Auto"). */}
          </div>
        </div>
      ) : (
        <div className="as-shot-fields">
          {charsInShot.map(c => (
            <CharFields
              key={c.id}
              char={c}
              isSpeaker={c.id === shot.speakerId}
              data={shot.perCharacter[c.id] ?? { action: '', dialogue: '' }}
              onUpdate={(field, value) =>
                updateAnimationPelliculeCharData(pelliculeId, shot.id, c.id, field, value)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sous-composant per-character (action + dialogue + palette intonations) ─
// Refonte 2026-05-12 — extraction pour permettre un ref dédié à la textarea
// dialogue (cible de l'AudioTagPalette pour insertion à la position du curseur).

interface CharFieldsProps {
  char: Character
  isSpeaker: boolean
  data: { action: string; dialogue: string }
  onUpdate: (field: 'action' | 'dialogue', value: string) => void
}

function CharFields({ char, isSpeaker, data, onUpdate }: CharFieldsProps) {
  const dialogueRef = useRef<HTMLTextAreaElement | null>(null)
  return (
    <div className={`as-shot-char-fields ${isSpeaker ? 'speaker' : ''}`}>
      <div className="as-shot-char-fields-name">
        {isSpeaker && <span className="as-shot-char-fields-icon">🎙</span>}
        {char.name}
      </div>
      <textarea
        className="as-shot-input"
        placeholder={isSpeaker
          ? "Action (FR) — ex: « se tourne, lève son verre, sourit »"
          : "Action (FR) — ex: « écoute attentivement, regarde »"}
        value={data.action}
        onChange={e => onUpdate('action', e.target.value)}
        rows={3}
      />
      {isSpeaker && (
        <>
          <textarea
            ref={dialogueRef}
            className="as-shot-input as-shot-input-dialogue"
            placeholder="Dialogue (FR) — généré en TTS via la voix du NPC + lipsync"
            value={data.dialogue}
            onChange={e => onUpdate('dialogue', e.target.value)}
            rows={2}
          />
          {/* Palette d'intonations ElevenLabs v3 — insertion [tag] à la position
           *  du curseur dans le dialogue. Le serveur TTS bascule sur eleven_v3
           *  dès qu'un tag [...] est détecté. */}
          <AudioTagPalette
            textareaRef={dialogueRef}
            onInsert={() => {
              // L'insertion DOM via setter est déjà faite, on resync le state
              // React (input controllé) en lisant la nouvelle valeur du DOM.
              if (dialogueRef.current) {
                onUpdate('dialogue', dialogueRef.current.value)
              }
            }}
          />
        </>
      )}
    </div>
  )
}
