'use client'
/**
 * AnimationStudioPromptZone — zone centrale prompt (shots + scène en onglets).
 *
 * Refonte 2026-05-10 :
 *   1. Modèle **onglets** pour les shots (max 2 / pellicule, garde-fou côté
 *      reducer aussi). Au-delà = signe qu'il faut splitter en 2 pellicules.
 *   2. Onglet **Scène** à droite (séparé visuellement) qui héberge la
 *      description de la scène — remplace l'ancien accordéon en bas. Bonus :
 *      les "Paramètres avancés" deviennent une simple section dans le body
 *      (un seul niveau de disclosure).
 *
 *   Tabs row :  [Shot 1 🎙Roman ✕] [Shot 2 🎙Marvyn ✕] [+]   ──   [📋 Scène ✓]
 *               ────────────────
 *   Body actif (selon la tab):
 *     - shot   → meta cadrage + vignettes persos + Action/Dialogue par perso
 *     - scene  → fields décor + apparence + paramètres avancés
 *
 * Cross-fade horizontal entre tabs via framer-motion (mode="wait").
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ClipboardList, Plus, Upload, X, Wand2 } from 'lucide-react'
import { useEditorState, type AnimationPellicule, type Shot } from '@/components/image-editor/EditorStateContext'
import { useCharacterStore } from '@/lib/character-store'
import type { Npc } from '@/types'
import AnimationStudioShotBlock from './AnimationStudioShotBlock'
import { SceneFieldsBody, isSceneValidated } from '@/components/image-editor/designer/animation/SceneDescriptionAccordion'
import { resolveEffectiveScene, resolveSceneSourceImage, type SceneFields } from '@/lib/scene-description'
import { SHOT_LABELS, CAMERA_LABELS } from '@/components/image-editor/designer/animation/labels'

// Easing standard Material 3 + durée commune pour les box open/close.
const PZ_EASE = [0.2, 0, 0, 1] as const
const PZ_DUR = 0.3

// Limite produit : alternance dialogue A↔B max. Au-delà → splitter en 2 pellicules.
// Garde-fou aussi côté reducer (add_animation_shot no-op à 2).
const MAX_SHOTS_PER_PELLICULE = 2

/** Tab actif : un shot ciblé (kind='shot') ou la description (kind='scene'). */
type ActiveTab = { kind: 'shot'; id: string } | { kind: 'scene' }

interface AnimationStudioPromptZoneProps {
  pellicule: AnimationPellicule | null
  npcs: Npc[]
  /** Callback pour ouvrir la banque persos sur un shot précis (pour ajout). */
  onOpenCharactersForShot: (shotId: string) => void
  /** Callback pour lancer la génération LTX (porté par le parent).
   *  Si `fromOriginalScene = true` → reset firstFrameUrl + lastFrameUrl AVANT
   *  le gen, pour que l'orchestrator fallback sur plan.imageUrl (= scène
   *  d'origine propre, pas la frame dérivée de la précédente gen). Refonte
   *  2026-05-11 — fix cycle vicieux de dérive d'identité au fil des régens. */
  onGenerate?: (fromOriginalScene?: boolean) => void
  /** Indique si une génération est en cours (= disable le bouton). */
  generatingPelliculeId?: string | null
  /** Label de progression LTX en cours. */
  generatingProgressLabel?: string
  /** Callback pour ouvrir l'éditeur d'exit de la pellicule active. Affiché
   *  UNIQUEMENT sur la dernière pellicule du plan animation (Step 2 refonte
   *  2026-05-11 — l'exit définit ce qui se passe à la fin du plan : auto,
   *  choix joueur, ou fin de section). */
  onOpenExitEditor?: () => void
  /** True si la pellicule active est la dernière du plan. Drive l'affichage
   *  du bouton "Exit de fin". */
  isLastPellicule?: boolean
}

export default function AnimationStudioPromptZone({
  pellicule, onOpenCharactersForShot, onGenerate,
  generatingPelliculeId = null, generatingProgressLabel = '',
  onOpenExitEditor, isLastPellicule = false,
}: AnimationStudioPromptZoneProps) {
  const {
    addAnimationShot, removeAnimationShot, updateAnimationPellicule, updateAnimationShot,
    animationPellicules, imageUrl: baseImageUrl,
  } = useEditorState()
  const { characters } = useCharacterStore()

  /** Lookup char par id. */
  const charsById = useMemo(
    () => new Map(characters.map(c => [c.id, c])),
    [characters],
  )

  /** Tab active. Par défaut le 1er shot.
   *  - Pellicule change       → reset sur 1er shot
   *  - Shot actif supprimé    → fallback sur 1er shot restant
   *  - Shot ajouté (count ↑)  → bascule auto sur le nouveau (= dernier) */
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    pellicule?.shots[0]?.id
      ? { kind: 'shot', id: pellicule.shots[0].id }
      : { kind: 'scene' },
  )
  const prevPelliculeIdRef = useRef<string | null>(null)
  const prevShotsLenRef = useRef<number>(0)
  useEffect(() => {
    if (!pellicule) {
      prevPelliculeIdRef.current = null
      prevShotsLenRef.current = 0
      return
    }
    const len = pellicule.shots.length
    if (prevPelliculeIdRef.current !== pellicule.id) {
      // Pellicule changée : reset focus sur 1er shot, ne pas interpréter la
      // variation de length comme un ajout.
      prevPelliculeIdRef.current = pellicule.id
      prevShotsLenRef.current = len
      const firstShot = pellicule.shots[0]
      setActiveTab(firstShot ? { kind: 'shot', id: firstShot.id } : { kind: 'scene' })
      return
    }
    // Même pellicule, count grimpe → bascule sur le dernier shot ajouté
    if (len > prevShotsLenRef.current) {
      const last = pellicule.shots[len - 1]
      if (last) setActiveTab({ kind: 'shot', id: last.id })
    }
    // Si l'actif est un shot supprimé → 1er restant (ou scene si plus de shot)
    if (activeTab.kind === 'shot') {
      const stillExists = pellicule.shots.some(s => s.id === activeTab.id)
      if (!stillExists) {
        const fallback = pellicule.shots[0]
        setActiveTab(fallback ? { kind: 'shot', id: fallback.id } : { kind: 'scene' })
      }
    }
    prevShotsLenRef.current = len
  }, [pellicule, activeTab])

  if (!pellicule) {
    return (
      <section className="as-prompt-zone as-prompt-zone-empty">
        <p>Sélectionne une pellicule dans la timeline pour configurer ses shots.</p>
      </section>
    )
  }

  // Refonte 2026-05-14bn — Le prompt n'est affiché QUE pour :
  //   - une pellicule image_static (= image fixe à modifier)
  //   - une pellicule v2vContinue (= continuation à générer)
  //   - une pellicule animation pas encore générée (videoUrl=null, prompt à composer)
  // Sinon (= animation déjà générée OU uploadée OU ajoutée depuis la banque),
  // on affiche juste l'état "Vidéo importée" en lecture seule. L'auteur a
  // toujours le preview pour jouer/trimmer, ou supprime+regen ailleurs.
  const ext = pellicule as typeof pellicule & { type?: string; v2vContinue?: boolean }
  const isReadyVideo = !!pellicule.videoUrl && ext.type !== 'image_static' && !ext.v2vContinue
  if (isReadyVideo) {
    const isUploaded = pellicule.source === 'upload'
    return (
      <section className="as-prompt-zone as-prompt-zone-upload" aria-label="Vidéo importée">
        <div className="as-prompt-upload-card">
          <div className="as-prompt-upload-icon"><Upload size={20} /></div>
          <h3>{isUploaded ? 'Vidéo importée' : 'Vidéo de la banque'}</h3>
          <p>
            {isUploaded
              ? 'Cette pellicule utilise une vidéo chargée depuis ton ordinateur.'
              : 'Cette pellicule réutilise une vidéo de la banque d\'animations.'}
            {' '}Pas de prompt à éditer ici — utilise le preview pour la lecture,
            ou « Continuer » dans le header timeline pour étendre cette vidéo.
          </p>
        </div>
      </section>
    )
  }

  // Calcul effectiveFields une seule fois (utilisé par la tab Scène body
  // ET par la chip ✓ validée dans le label de la tab).
  const effectiveFields: SceneFields = resolveEffectiveScene(pellicule, animationPellicules)
  const sceneValidated = isSceneValidated(effectiveFields)

  const activeShot = activeTab.kind === 'shot'
    ? pellicule.shots.find(s => s.id === activeTab.id) ?? pellicule.shots[0] ?? null
    : null
  const activeIndex = activeShot ? pellicule.shots.findIndex(s => s.id === activeShot.id) : -1

  /** Pellicule sans shot : guard pour pellicules persistées avant la refonte
   *  multi-shots (ou cas d'erreur). On affiche juste l'invitation à créer. */
  if (pellicule.shots.length === 0) {
    return (
      <section className="as-prompt-zone as-prompt-zone-empty">
        <p>Cette pellicule n'a aucun shot — clique <strong>+ Ajouter un shot</strong>.</p>
        <button
          type="button"
          className="as-prompt-add-shot"
          onClick={() => addAnimationShot(pellicule.id)}
        >
          + Ajouter un shot
        </button>
      </section>
    )
  }

  const canAddShot = pellicule.shots.length < MAX_SHOTS_PER_PELLICULE
  const isSceneActive = activeTab.kind === 'scene'

  // Clé unique pour AnimatePresence : id du shot OU sentinel 'scene'
  const tabKey = activeTab.kind === 'scene' ? '__scene__' : activeTab.id

  return (
    <section className="as-prompt-zone" aria-label="Édition des shots et scène">
      {/* ── Onglets ──────────────────────────────────────────────────────
       *  Shots à gauche, séparateur flexible, onglet Scène à droite.
       *  Underline animée via framer-motion layoutId (slide entre tabs). */}
      <div className="as-tabs-row" role="tablist" aria-label="Shots et description de la pellicule">
        {pellicule.shots.map((shot: Shot, idx: number) => {
          const isActive = activeTab.kind === 'shot' && shot.id === activeTab.id
          const speaker = shot.speakerId ? charsById.get(shot.speakerId) ?? null : null
          const canRemove = pellicule.shots.length > 1
          return (
            <div
              key={shot.id}
              className={`as-tab-wrap ${isActive ? 'active' : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="as-tab"
                onClick={() => setActiveTab({ kind: 'shot', id: shot.id })}
                title={`Shot ${idx + 1}${speaker ? ` — ${speaker.name} parle` : ''}`}
              >
                <span className="as-tab-label">Shot {idx + 1}</span>
                {speaker && (
                  <span className="as-tab-speaker" aria-label={`Speaker : ${speaker.name}`}>
                    🎙 {speaker.name}
                  </span>
                )}
              </button>
              {canRemove && (
                <button
                  type="button"
                  className="as-tab-remove"
                  onClick={() => removeAnimationShot(pellicule.id, shot.id)}
                  title="Supprimer ce shot"
                  aria-label={`Supprimer le shot ${idx + 1}`}
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              )}
              {isActive && (
                <motion.span
                  className="as-tab-underline"
                  layoutId="as-tab-underline"
                  transition={{ duration: PZ_DUR * 0.7, ease: PZ_EASE }}
                  aria-hidden
                />
              )}
            </div>
          )
        })}

        {canAddShot && (
          <button
            type="button"
            className="as-tab as-tab-add"
            onClick={() => addAnimationShot(pellicule.id)}
            title={`Ajouter un shot (max ${MAX_SHOTS_PER_PELLICULE} — alternance auto du speaker)`}
            aria-label="Ajouter un shot"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        )}

        {/* Spacer flexible : pousse l'onglet Scène à droite */}
        <div className="as-tabs-spacer" aria-hidden />

        {/* Onglet Scène (description pellicule). Visuellement distinct via
         *  icône clipboard + position droite, pour qu'il ne soit pas confondu
         *  avec un shot supplémentaire. */}
        <div className={`as-tab-wrap as-tab-wrap-scene ${isSceneActive ? 'active' : ''}`}>
          <button
            type="button"
            role="tab"
            aria-selected={isSceneActive}
            className="as-tab as-tab-scene"
            onClick={() => setActiveTab({ kind: 'scene' })}
            title="Description de la scène (décor, apparence des persos, hors caméra)"
          >
            <ClipboardList size={12} strokeWidth={2.2} aria-hidden />
            <span className="as-tab-label">Scène</span>
            {sceneValidated && (
              <span className="as-tab-scene-badge" aria-label="Description validée">✓</span>
            )}
          </button>
          {isSceneActive && (
            <motion.span
              className="as-tab-underline"
              layoutId="as-tab-underline"
              transition={{ duration: PZ_DUR * 0.7, ease: PZ_EASE }}
              aria-hidden
            />
          )}
        </div>
      </div>

      {/* ── Meta du shot actif — durée éditable + auto-estimation ────────
       *  Refonte 2026-05-10 : durée inline (au lieu de devoir ouvrir la modal
       *  options sur la timeline pellicule). Bouton "Auto" estime depuis le
       *  texte des actions (~1s par atome séparé par virgule/point), aligné
       *  sur la règle prompting LTX (1 atome ≈ 1 seconde de mouvement). */}
      {activeShot && (
        <div className="as-active-shot-meta" aria-live="polite">
          <span>{SHOT_LABELS[activeShot.shot]} · {CAMERA_LABELS[activeShot.camera]} · </span>
          <input
            type="number"
            min={1}
            max={20}
            value={activeShot.duration}
            onChange={(e) => {
              const v = Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1)))
              updateAnimationShot(pellicule.id, activeShot.id, { duration: v })
            }}
            className="as-active-shot-duration-input"
            aria-label="Durée du shot en secondes"
          />
          <span>s</span>
          <button
            type="button"
            className="as-active-shot-duration-auto"
            onClick={() => {
              // Compte les atomes : split sur ponctuation virgule/point/point-
              // virgule, ET sur les conjonctions "et" / "puis" / "and" / "then"
              // qui chaînent des actions parallèles dans une même clause.
              // Ex : "s'approche du panier et saute et met la balle dans le
              // panier" = 3 atomes (et pas 1). Refonte 2026-05-11 — algo
              // initial loupait ce cas. Une action = un atome ≈ 1s. On somme
              // tous les persos. Min 3s pour pas tomber à 1s sur un input vide.
              const SPLIT_RE = /[,.;]+|\s+(?:et|puis|and|then)\s+/i
              const atomsCount = Object.values(activeShot.perCharacter ?? {}).reduce((sum, d) => {
                const text = (d?.action ?? '').trim()
                if (!text) return sum
                const atoms = text.split(SPLIT_RE).map(s => s.trim()).filter(s => s.length > 0)
                return sum + atoms.length
              }, 0)
              const estimated = Math.max(3, Math.min(20, atomsCount))
              updateAnimationShot(pellicule.id, activeShot.id, { duration: estimated })
            }}
            title="Estimer automatiquement la durée depuis les actions (1s par atome séparé par virgule/point)"
          >
            <Wand2 size={11} />
            <span>Auto</span>
          </button>
        </div>
      )}

      {/* ── Body actif — cross-fade horizontal entre tabs ──────────────── */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tabKey}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{
            opacity: { duration: PZ_DUR * 0.6, ease: PZ_EASE },
            x: { duration: PZ_DUR * 0.6, ease: PZ_EASE },
          }}
          className="as-active-shot-wrap"
        >
          {activeShot ? (
            <AnimationStudioShotBlock
              shot={activeShot}
              shotIndex={activeIndex}
              pelliculeId={pellicule.id}
              charsById={charsById}
              onAddCharacter={() => onOpenCharactersForShot(activeShot.id)}
            />
          ) : (
            <SceneFieldsBody
              ownFields={{
                scene_visible: pellicule.scene_visible,
                scene_offscreen: pellicule.scene_offscreen,
                characters_appearance: pellicule.characters_appearance,
              }}
              effectiveFields={effectiveFields}
              isFirstPellicule={animationPellicules[0]?.id === pellicule.id}
              imageSourceUrl={resolveSceneSourceImage(pellicule, animationPellicules, baseImageUrl)}
              onChange={(patch: Partial<SceneFields>) => updateAnimationPellicule(pellicule.id, patch)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Bouton "Générer la pellicule" — lance la pipeline LTX complète.
       *  Renommé 2026-05-10 : "plan" → "pellicule" car le terme métier Hero
       *  c'est pellicule (1 vidéo générée). "Plan" est ambigu (= plan de
       *  section au sens narratif). */}
      {onGenerate && (() => {
        const isGenerating = generatingPelliculeId === pellicule.id
        const promptOk = pellicule.shots.some(s => {
          const hasAction = Object.values(s.perCharacter ?? {})
            .some(d => (d?.action ?? '').trim().length > 0)
          const hasChars = (s.characterIds ?? []).length > 0
          // Refonte 2026-05-13 : sceneAction valide la pellicule sans perso
          // (animation pure type plan aérien, travelling sans sujet humain).
          const hasSceneAction = (s.sceneAction ?? '').trim().length > 0
          return hasAction || hasChars || hasSceneAction
        })
        // Label du bouton "Exit de fin" selon le type d'exit configuré
        const exitKind = pellicule.exit?.kind ?? 'auto'
        const exitLabel = exitKind === 'choices'
          ? `🎯 ${pellicule.exit && pellicule.exit.kind === 'choices' ? pellicule.exit.options.length : 0} choix de fin`
          : exitKind === 'end_section'
            ? '🏁 Fin de section'
            : '↪ Exit auto'
        return (
          <div className="as-prompt-generate-row">
            {/* Bouton "Exit de fin" — uniquement sur la dernière pellicule du
             *  plan (Step 2 refonte 2026-05-11). L'exit définit ce qui se passe
             *  à la fin du plan : auto / choix joueur / fin de section. */}
            {onOpenExitEditor && isLastPellicule && (
              <button
                type="button"
                className={`as-prompt-exit-btn ${exitKind !== 'auto' ? 'has-exit' : ''}`}
                onClick={onOpenExitEditor}
                disabled={isGenerating}
                title="Configurer ce qui se passe à la fin du plan"
              >
                {exitLabel}
              </button>
            )}
            <button
              type="button"
              className="as-prompt-generate-btn"
              onClick={() => onGenerate?.()}
              disabled={isGenerating || !promptOk}
              title={
                !promptOk    ? 'Renseigne au moins un perso, une action, ou une action de scène' :
                isGenerating ? 'Génération en cours…' :
                pellicule.videoUrl ? 'Régénérer cette pellicule' : 'Générer cette pellicule'
              }
            >
              {isGenerating
                ? `⏳ ${generatingProgressLabel || 'Génération…'}`
                : pellicule.videoUrl
                  ? '🎬 Régénérer la pellicule'
                  : '🎬 Générer la pellicule'}
            </button>
          </div>
        )
      })()}
    </section>
  )
}
