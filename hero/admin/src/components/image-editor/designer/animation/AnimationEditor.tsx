'use client'
/**
 * AnimationEditor — éditeur inline sous la timeline pour la pellicule active.
 *
 * Refacto multi-shots β.1+ 2026-05-06 : la pellicule contient maintenant
 * `shots: Shot[]` (1..N). Pour chaque shot, l'auteur définit cadrage / caméra
 * (via AnimationOptionsModal) + perCharacter (action + dialogue inline ici).
 * Les shots s'enchaînent dans 1 SEUL appel LTX qui produit 1 SEULE vidéo.
 *
 * Cas usage :
 *   - 1 shot   = pellicule simple (mono-perso ou cas 2 conversation interactive)
 *   - N shots  = cas 1 conversation entre PNJ (alternance des plans)
 *
 * Description de la scène (visible/offscreen/characters_appearance) est en bas
 * via SceneDescriptionAccordion (replié par défaut).
 */

import React, { useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCharacterStore, type Character } from '@/lib/character-store'
import { useEditorState } from '@/components/image-editor/EditorStateContext'
import type { Shot } from '@/components/image-editor/EditorStateContext'
import { SHOT_LABELS, CAMERA_LABELS } from './labels'
import SceneDescriptionAccordion from './SceneDescriptionAccordion'
import { resolveEffectiveScene, resolveSceneSourceImage, type SceneFields } from '@/lib/scene-description'
import AudioTagPalette from '@/components/audio-tag-palette/AudioTagPalette'
import '@/components/audio-tag-palette/audio-tag-palette.css'

interface AnimationEditorProps {
  /** Callback de génération LTX — câblé dans le parent car nécessite l'image
   *  source (canvas state) et la liste des persos. */
  onGenerate: (pelliculeId: string) => void
  /** ID de la pellicule en cours de génération (null = aucune). */
  generatingPelliculeId?: string | null
  /** Label de progression LTX courant (vide quand pas de gen). */
  generatingProgressLabel?: string
  /** Préfixe Supabase pour les uploads (gardé pour back-compat — non utilisé
   *  dans la version revert). */
  storagePathPrefix?: string
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
    updateAnimationPellicule,
    addAnimationShot,
    removeAnimationShot,
    imageUrl: baseImageUrl,
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
  // Génération possible si au moins un shot a au moins une action remplie
  const promptOk = pell.shots.some(s =>
    Object.values(s.perCharacter).some(d => d.action.trim().length > 0),
  )
  const canGenerate = !noChars && promptOk && !isGenerating

  return (
    <div className="dz-anim-editor">
      {noChars ? (
        <div className="dz-anim-editor-guide">
          Sélectionne 1-2 personnages dans le panneau de gauche pour configurer leurs actions.
        </div>
      ) : (
        <div className="dz-anim-editor-shots">
          {pell.shots.map((shot, idx) => (
            <ShotBlock
              key={shot.id}
              shotIndex={idx}
              shot={shot}
              pelliculeId={pell.id}
              selectedChars={selectedChars}
              isGenerating={isGenerating}
              canRemove={pell.shots.length > 1}
              onUpdateCharData={(charId, field, value) =>
                updateAnimationPelliculeCharData(pell.id, shot.id, charId, field, value)
              }
              onRemove={() => removeAnimationShot(pell.id, shot.id)}
            />
          ))}

          {/* Bouton ajouter shot — pour le cas conversation à plusieurs plans */}
          <button
            type="button"
            className="dz-anim-editor-add-shot"
            onClick={() => addAnimationShot(pell.id)}
            disabled={isGenerating}
            title="Ajouter un shot (= un plan supplémentaire dans cette pellicule, pour faire alterner les angles entre persos)"
          >
            <Plus size={14} />
            <span>Ajouter un shot</span>
          </button>
        </div>
      )}

      {/* Description de la scène — accordéon replié par défaut. Permet à
       *  l'auteur de définir le décor, l'apparence des persos en scène, et
       *  le décor hors caméra. Avec bouton 🪄 pour pré-remplir via Qwen VL. */}
      <SceneDescriptionAccordion
        ownFields={{
          scene_visible: pell.scene_visible,
          scene_offscreen: pell.scene_offscreen,
          characters_appearance: pell.characters_appearance,
        }}
        effectiveFields={resolveEffectiveScene(pell, animationPellicules)}
        isFirstPellicule={animationPellicules[0]?.id === pell.id}
        imageSourceUrl={resolveSceneSourceImage(pell, animationPellicules, baseImageUrl)}
        onChange={(patch: Partial<SceneFields>) => updateAnimationPellicule(pell.id, patch)}
      />

      {/* Bouton Générer / Régénérer */}
      <div className="dz-anim-editor-actions">
        <button
          type="button"
          className="dz-anim-editor-gen-btn"
          onClick={() => onGenerate(pell.id)}
          disabled={!canGenerate}
          title={
            noChars     ? 'Sélectionne 1-2 personnages d\'abord' :
            !promptOk   ? 'Renseigne au moins une action dans un shot' :
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

// ── Bloc shot individuel — extrait pour la lisibilité ─────────────────────

interface ShotBlockProps {
  shotIndex: number
  shot: Shot
  pelliculeId: string
  selectedChars: Character[]
  isGenerating: boolean
  /** Affiche le bouton corbeille uniquement si la pellicule a > 1 shot
   *  (refus de supprimer le dernier shot dans le reducer). */
  canRemove: boolean
  onUpdateCharData: (charId: string, field: 'action' | 'dialogue', value: string) => void
  onRemove: () => void
}

function ShotBlock({
  shotIndex, shot, selectedChars, isGenerating, canRemove,
  onUpdateCharData, onRemove,
}: ShotBlockProps) {
  // Repliage : par défaut, le shot 1 est ouvert et les suivants fermés.
  // Évite que la liste s'allonge à l'infini si la pellicule a 4-5 shots.
  // L'auteur peut ouvrir n'importe quel shot pour l'éditer.
  const [open, setOpen] = useState(shotIndex === 0)

  // Aperçu du contenu : 1ère réplique non vide pour info dans le header replié
  const preview = (() => {
    for (const c of selectedChars) {
      const d = shot.perCharacter[c.id]
      if (d?.dialogue?.trim()) {
        const txt = d.dialogue.trim()
        return `${c.name}: « ${txt.length > 50 ? txt.slice(0, 50) + '…' : txt} »`
      }
      if (d?.action?.trim()) {
        const txt = d.action.trim()
        return `${c.name} · ${txt.length > 50 ? txt.slice(0, 50) + '…' : txt}`
      }
    }
    return null
  })()

  return (
    <div className="dz-anim-editor-shot">
      <div className="dz-anim-editor-shot-header">
        <button
          type="button"
          className="dz-anim-editor-shot-toggle"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={open ? 'Replier ce shot' : 'Déplier ce shot'}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="dz-anim-editor-shot-label">Shot {shotIndex + 1}</span>
        </button>
        <span className="dz-anim-editor-shot-meta">
          {SHOT_LABELS[shot.shot]} · {CAMERA_LABELS[shot.camera]} · {shot.duration}s
          {!open && preview ? ` — ${preview}` : ''}
        </span>
        {canRemove && (
          <button
            type="button"
            className="dz-anim-editor-shot-remove"
            onClick={onRemove}
            disabled={isGenerating}
            title="Supprimer ce shot"
            aria-label="Supprimer ce shot"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="shot-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="dz-anim-editor-chars">
              {selectedChars.map(c => (
                <CharRow
                  key={c.id}
                  char={c}
                  data={shot.perCharacter[c.id] ?? { action: '', dialogue: '' }}
                  isGenerating={isGenerating}
                  onUpdateCharData={onUpdateCharData}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Bloc per-character (action + dialogue + palette intonations) ─────────
// Refonte 2026-05-12 — extraction de la rangée perso pour permettre un ref
// dédié à la textarea dialogue (cible de l'AudioTagPalette).

interface CharRowProps {
  char: Character
  data: { action: string; dialogue: string }
  isGenerating: boolean
  onUpdateCharData: (charId: string, field: 'action' | 'dialogue', value: string) => void
}

function CharRow({ char, data, isGenerating, onUpdateCharData }: CharRowProps) {
  const dialogueRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="dz-anim-editor-char">
      <div className="dz-anim-editor-char-name">
        {char.gender === 'male' ? '♂' : '♀'} {char.name}
      </div>
      <input
        type="text"
        className="dz-anim-editor-input"
        placeholder="Action (FR ou EN — ex: « se tourne vers la femme sur le canapé, lève son verre »). Traduit auto en EN avant LTX."
        value={data.action}
        onChange={e => onUpdateCharData(char.id, 'action', e.target.value)}
        disabled={isGenerating}
      />
      <input
        ref={dialogueRef}
        type="text"
        className="dz-anim-editor-input"
        placeholder="Dialogue (optionnel — si rempli, génère TTS via la voix du NPC + lipsync LTX. Le perso doit avoir une voix définie dans la banque)"
        value={data.dialogue}
        onChange={e => onUpdateCharData(char.id, 'dialogue', e.target.value)}
        disabled={isGenerating}
      />
      {/* Palette d'intonations ElevenLabs v3 — insère [tag] à la position du
       *  curseur dans le dialogue. Bascule auto sur le modèle eleven_v3 côté
       *  serveur dès qu'un tag [...] est détecté dans le texte. */}
      <AudioTagPalette
        textareaRef={dialogueRef}
        onInsert={() => {
          // Le tag est déjà inséré dans la valeur du DOM via dispatch event
          // (cf AudioTagPalette.handleInsert), mais on force aussi le state
          // React pour rester synchro (l'event input du DOM est consommé par
          // l'onChange standard, mais ici on doit aussi notifier le parent
          // car l'input est controllé). On lit la nouvelle valeur du DOM.
          if (dialogueRef.current) {
            onUpdateCharData(char.id, 'dialogue', dialogueRef.current.value)
          }
        }}
        disabled={isGenerating}
      />
    </div>
  )
}
