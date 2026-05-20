'use client'
/**
 * AnimationTimeline — strip horizontal des pellicules de la Section courante.
 *
 * Layout (Phase A) :
 *   [P1] [P2] [P3] [+]      ▶ Lire séquence    Total: 15s · 3 plans
 *
 * Comportements :
 *   - 1 clic vignette = sélectionne la pellicule (= statique dans le canvas
 *     central, pas de play). L'éditeur en dessous (AnimationEditor) montre
 *     les contrôles de la pellicule sélectionnée.
 *   - Bouton ▶ sur la vignette = lance la lecture isolée (Canvas joue le
 *     videoUrl, fige sur lastFrame à la fin).
 *   - Drag & drop pour réordonner (framer-motion <Reorder>).
 *   - Vignette = poster `firstFrameUrl` ; placeholder dashed si pas générée.
 *   - Bouton "+" en fin de strip = nouvelle pellicule vide auto-sélectionnée.
 *
 * Phase C : drag avec warning continuité, lecture séquence ▶ chaînage.
 *
 * State partagé via EditorState (animationPellicules, animationSelected*).
 */

import React, { useState } from 'react'
import { Reorder, motion, AnimatePresence } from 'framer-motion'
import { Plus, Play, Pause, Trash2, Film, Settings2, Link2, AlertTriangle } from 'lucide-react'
import { useEditorState, type AnimationPellicule } from '@/components/image-editor/EditorStateContext'
import { SHOT_LABELS, CAMERA_LABELS } from './labels'
import AnimationOptionsModal from './AnimationOptionsModal'

interface AnimationTimelineProps {
  /** Callback play d'une pellicule isolée — câblé sur setCurrentVideo dans le
   *  parent (DesignerLayout / page) car la lecture passe par le Canvas global. */
  onPlayPellicule: (pellicule: AnimationPellicule) => void
}

export default function AnimationTimeline({ onPlayPellicule }: AnimationTimelineProps) {
  const {
    animationPellicules,
    animationSelectedPelliculeId,
    setAnimationSelectedPellicule,
    addAnimationPellicule,
    removeAnimationPellicule,
    setAnimationPelliculesOrder,
    imageUrl,  // base image du plan — fallback racine pour vignettes non générées
    sequencePlayheadIdx, startSequence, stopSequence,  // Phase C
  } = useEditorState()

  // ID de la pellicule dont on édite les options (modal). null = aucun ouvert.
  const [optionsForPelliculeId, setOptionsForPelliculeId] = useState<string | null>(null)
  const optionsForPellicule = optionsForPelliculeId
    ? animationPellicules.find(p => p.id === optionsForPelliculeId) ?? null
    : null

  // Multi-shots β.1+ 2026-05-06 : durée pellicule = somme des durées de ses shots
  const totalDuration = animationPellicules.reduce(
    (acc, p) => acc + p.shots.reduce((sa, s) => sa + s.duration, 0),
    0,
  )
  // Count "playable" : pellicules animation avec videoUrl générée
  const playableCount = animationPellicules.filter(p => !!p.videoUrl).length
  const isSequencePlaying = sequencePlayheadIdx !== null
  const canPlaySequence = playableCount > 0

  function handleToggleSequence() {
    if (isSequencePlaying) {
      stopSequence()
    } else if (canPlaySequence) {
      startSequence()
    }
  }

  // framer-motion Reorder donne directement la nouvelle permutation complète.
  // On la passe au reducer qui valide que c'est bien une permutation stricte.
  // (Avant 2026-05-05 : on tentait de détecter from/to manuellement, bug
  // sur les drag non-adjacents → swaps mal interprétés.)
  function handleReorder(newOrder: AnimationPellicule[]) {
    setAnimationPelliculesOrder(newOrder)
  }

  function handleAdd() {
    addAnimationPellicule()  // duration/shot/camera defaults + auto-select
  }

  function handleRemove(e: React.MouseEvent, id: string) {
    e.stopPropagation()  // évite de re-sélectionner la pellicule en supprimant
    removeAnimationPellicule(id)
  }

  function handlePlay(e: React.MouseEvent, p: AnimationPellicule) {
    e.stopPropagation()
    if (!p.videoUrl) return
    onPlayPellicule(p)
  }

  return (
    <div className="dz-anim-timeline">
      <div className="dz-anim-timeline-header">
        <div className="dz-anim-timeline-title">
          <Film size={12} />
          <span>Storyboard</span>
        </div>
        <div className="dz-anim-timeline-meta">
          {animationPellicules.length === 0
            ? 'Aucune pellicule — clique + pour commencer'
            : `${animationPellicules.length} pellicule${animationPellicules.length > 1 ? 's' : ''} · ${totalDuration}s · ${playableCount} prête${playableCount > 1 ? 's' : ''}`}
        </div>
        {/* Bouton ▶ Lire séquence : chaîne toutes les pellicules générées dans
         *  le canvas. Disabled si aucune générée. Toggle play/stop. */}
        <button
          type="button"
          className={`dz-anim-timeline-play-seq ${isSequencePlaying ? 'playing' : ''}`}
          onClick={handleToggleSequence}
          disabled={!canPlaySequence && !isSequencePlaying}
          title={
            !canPlaySequence ? 'Génère au moins une pellicule pour pouvoir lire la séquence'
            : isSequencePlaying ? 'Arrêter la lecture séquence'
            : 'Lire toutes les pellicules à la suite'
          }
        >
          {isSequencePlaying
            ? <><Pause size={12} fill="currentColor" /><span>Arrêter</span></>
            : <><Play size={12} fill="currentColor" /><span>Lire séquence</span></>
          }
        </button>
      </div>

      <div className="dz-anim-timeline-strip">
        <Reorder.Group
          axis="x"
          values={animationPellicules}
          onReorder={handleReorder}
          className="dz-anim-timeline-cells"
          // Layout flex appliqué via className — Reorder.Group accepte les
          // styles CSS standards.
        >
          <AnimatePresence initial={false}>
            {animationPellicules.map((p, idx) => {
              const selected = p.id === animationSelectedPelliculeId
              const generated = !!p.videoUrl
              // True si cette pellicule est en cours de lecture séquence.
              // Drive un highlight pulsant pour signaler "is now playing".
              const isPlayingInSequence = sequencePlayheadIdx === idx
              // Image affichée dans la vignette = "image de départ" de la pellicule.
              // Même règle que le Canvas : firstFrame > prev.lastFrame > baseImage.
              // Garantit une cohérence visuelle quand on scanne la timeline (chaque
              // vignette montre par où la pellicule commence/commencera).
              const prev = idx > 0 ? animationPellicules[idx - 1] : null
              const startImage = p.firstFrameUrl ?? prev?.lastFrameUrl ?? imageUrl ?? null
              // Phase D1 — Détection continuité avec la pellicule précédente.
              // Continu = firstFrameUrl strictement === prev.lastFrameUrl (gen
              // l'a forcé en mode continuité, cf handleGeneratePellicule).
              // Status :
              //   - first cell (idx 0) → pas d'indicateur
              //   - both ont firstFrame/lastFrame + URL match → continu (✓ vert)
              //   - both ont les frames + URL mismatch → rupture (⚠ ambre)
              //   - l'une n'a pas de frame → neutre (pas pertinent à comparer)
              // Couvre animation ET image_static (les 2 ont firstFrame/lastFrame).
              const continuityStatus: 'continuous' | 'broken' | 'na' =
                idx === 0 ? 'na'
                : (!p.firstFrameUrl || !prev?.lastFrameUrl) ? 'na'
                : p.firstFrameUrl === prev.lastFrameUrl ? 'continuous' : 'broken'
              return (
                <Reorder.Item
                  key={p.id}
                  value={p}
                  className={`dz-anim-cell ${selected ? 'selected' : ''} ${generated ? 'generated' : 'pending'} ${isPlayingInSequence ? 'playing-sequence' : ''}`}
                  onClick={() => {
                    // Si une séquence est en cours → la stopper d'abord (le user
                    // veut prendre le contrôle manuel d'une pellicule isolée).
                    if (sequencePlayheadIdx !== null) stopSequence()
                    // Sélectionne la pellicule + auto-play si vidéo dispo.
                    // Comportement design 2026-05-05 : 1 clic = je veux voir
                    // la vidéo jouer 1× puis revenir à l'état initial (firstFrame)
                    // pour pouvoir éditer l'image de base et régénérer.
                    setAnimationSelectedPellicule(p.id)
                    if (p.videoUrl) onPlayPellicule(p)
                  }}
                  whileDrag={{ scale: 1.04, zIndex: 5 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  // Layout shared pour animation fluide au drag/drop
                  layout
                >
                  {/* Phase D1 — Badge continuité visuelle (chevauche le bord
                   *  gauche de la cellule, apparait dans le gap entre cellules).
                   *  ✓ vert si firstFrame == prev.lastFrame, ⚠ ambre si rupture. */}
                  {continuityStatus !== 'na' && (
                    <div
                      className={`dz-anim-cell-continuity-badge dz-anim-cell-continuity-${continuityStatus}`}
                      title={
                        continuityStatus === 'continuous'
                          ? `Continuité visuelle OK avec P${idx} (cette pellicule démarre depuis la dernière frame de la précédente).`
                          : `⚠ Rupture visuelle avec P${idx} — la lecture séquence aura un saut ici. Régénère cette pellicule pour rétablir la continuité (efface la firstFrame avant de cliquer Régénérer).`
                      }
                    >
                      {continuityStatus === 'continuous'
                        ? <Link2 size={9} />
                        : <AlertTriangle size={9} />}
                    </div>
                  )}
                  {/* Titre cellule : "P1 — Plan moyen, Caméra fixe, 5s" + tag à générer */}
                  <div className="dz-anim-cell-num">
                    <span className="dz-anim-cell-num-id">P{idx + 1}</span>
                    <span className="dz-anim-cell-num-sep">—</span>
                    <span className="dz-anim-cell-num-params">
                      <Film size={9} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.2rem' }} />
                      {/* Multi-shots β.1+ : affiche le 1er shot + nb total de shots si > 1
                       *  + somme des durées (durée totale de la pellicule). */}
                      {(() => {
                        const first = p.shots[0]
                        const total = p.shots.reduce((acc, s) => acc + s.duration, 0)
                        if (!first) return `${total}s`
                        const meta = `${SHOT_LABELS[first.shot]}, ${CAMERA_LABELS[first.camera]}`
                        const shotsLabel = p.shots.length > 1 ? ` (${p.shots.length} shots)` : ''
                        return `${meta}${shotsLabel}, ${total}s`
                      })()}
                    </span>
                    {!generated && (
                      <span className="dz-anim-cell-pending-tag">à générer</span>
                    )}
                  </div>
                  <div className="dz-anim-cell-thumb">
                    {startImage ? (
                      <img src={startImage} alt={`Pellicule ${idx + 1}`} />
                    ) : (
                      // Aucune image disponible (pas de base ET pas de pellicule
                      // précédente) — fallback ultime : icône neutre.
                      <div className="dz-anim-cell-thumb-empty">
                        <Film size={20} />
                      </div>
                    )}
                    {/* Overlay play (visible au hover si générée) */}
                    {generated && (
                      <button
                        type="button"
                        className="dz-anim-cell-play"
                        onClick={(e) => handlePlay(e, p)}
                        title="Lire cette pellicule"
                      >
                        <Play size={14} fill="currentColor" />
                      </button>
                    )}
                  </div>
                  {/* Bouton Options + Supprimer côte à côte sous le thumbnail.
                   *  stopPropagation pour ne pas re-sélectionner la pellicule au clic. */}
                  <div className="dz-anim-cell-actions-row">
                    <button
                      type="button"
                      className="dz-anim-cell-options-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOptionsForPelliculeId(p.id)
                      }}
                      title="Modifier cadrage, caméra, durée"
                    >
                      <Settings2 size={11} />
                      <span>Options</span>
                    </button>
                    <button
                      type="button"
                      className="dz-anim-cell-delete-btn"
                      onClick={(e) => handleRemove(e, p.id)}
                      title="Supprimer cette pellicule"
                    >
                      <Trash2 size={11} />
                      <span>Supprimer</span>
                    </button>
                  </div>
                </Reorder.Item>
              )
            })}
          </AnimatePresence>
        </Reorder.Group>

        {/* Bouton + ajouter pellicule (séparé du drag group) */}
        <motion.button
          type="button"
          className="dz-anim-cell-add"
          onClick={handleAdd}
          title="Ajouter une nouvelle pellicule"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.15 }}
        >
          <Plus size={20} />
          <span>Ajouter</span>
        </motion.button>
      </div>

      {/* Modal Options de pellicule (Cadrage / Caméra / Durée).
       *  Ouvert via bouton Options dans la cellule. */}
      <AnimatePresence>
        {optionsForPellicule && (
          <AnimationOptionsModal
            pellicule={optionsForPellicule}
            onClose={() => setOptionsForPelliculeId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
