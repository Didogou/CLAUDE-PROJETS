'use client'
/**
 * AnimationStudioTimeline — timeline horizontale des pellicules.
 *
 * Refonte 2026-05-07 : version compacte de l'AnimationTimeline existant,
 * adaptée au layout 4 zones (au-dessus de la prompt zone, pas en bas).
 * Vignettes plus petites pour gagner en hauteur.
 *
 * Click sur cellule pellicule → sélection. Click bouton + → ajoute pellicule.
 * Click sur la vignette image (zone vidéo) → ouvre le lightbox plein écran
 * (Palier C, à venir).
 */

import React, { useRef } from 'react'
import { Plus, Film, Maximize2, Trash2, Upload, FastForward } from 'lucide-react'
import type { AnimationPellicule } from '@/components/image-editor/EditorStateContext'

interface AnimationStudioTimelineProps {
  pellicules: AnimationPellicule[]
  selectedPelliculeId: string | null
  onSelectPellicule: (id: string) => void
  onAddPellicule: () => void
  /** "Continuer la vidéo" (refonte 2026-05-11) : crée une pellicule v2vContinue=true
   *  qui chaîne le mouvement depuis les 8 dernières frames de la pellicule
   *  précédente (LTX 2.3 V2V Extend). Affiché seulement si au moins UNE
   *  pellicule a déjà une videoUrl (sinon rien à continuer). Si non fourni
   *  → bouton caché. */
  onContinueVideo?: () => void
  /** Upload d'une vidéo depuis le PC (file picker) — crée une pellicule avec
   *  videoUrl pré-remplie. Si non fourni, le bouton upload n'apparaît pas. */
  onUploadVideo?: (file: File) => void
  /** Suppression d'une pellicule. Si non fourni, le bouton corbeille n'apparaît pas. */
  onRemovePellicule?: (id: string) => void
  /** Ouvre le lightbox plein écran sur cette pellicule (Palier C). */
  onOpenLightbox?: (id: string) => void
  baseImageUrl: string | null
}

export default function AnimationStudioTimeline({
  pellicules, selectedPelliculeId, onSelectPellicule, onAddPellicule,
  onContinueVideo, onUploadVideo, onRemovePellicule, onOpenLightbox, baseImageUrl,
}: AnimationStudioTimelineProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function handleUploadClick() {
    fileInputRef.current?.click()
  }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && onUploadVideo) onUploadVideo(file)
    // Reset input pour permettre de re-sélectionner le même fichier après
    e.target.value = ''
  }
  // Durée totale = somme des durées de tous les shots de toutes les pellicules
  const totalDuration = pellicules.reduce(
    (acc, p) => acc + p.shots.reduce((sa, s) => sa + s.duration, 0),
    0,
  )
  const generatedCount = pellicules.filter(p => !!p.videoUrl).length

  return (
    <section className="as-timeline" aria-label="Storyboard">
      <header className="as-timeline-header">
        <span className="as-timeline-title">
          <Film size={12} /> Storyboard
        </span>
        <span className="as-timeline-meta">
          {pellicules.length} pellicule{pellicules.length > 1 ? 's' : ''}
          {' · '}
          {totalDuration.toFixed(1)}s
          {' · '}
          {generatedCount} prête{generatedCount > 1 ? 's' : ''}
        </span>
      </header>

      <div className="as-timeline-cells">
        {pellicules.map((p, idx) => {
          const startImage = p.firstFrameUrl ?? (idx > 0 ? pellicules[idx - 1].lastFrameUrl : null) ?? baseImageUrl
          const totalShotDuration = p.shots.reduce((acc, s) => acc + s.duration, 0)
          const isSelected = p.id === selectedPelliculeId
          const ready = !!p.videoUrl
          return (
            <div
              role="button"
              tabIndex={0}
              key={p.id}
              className={`as-timeline-cell ${isSelected ? 'selected' : ''} ${ready ? 'ready' : 'pending'}`}
              onClick={() => onSelectPellicule(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectPellicule(p.id)
                }
              }}
              aria-current={isSelected ? 'true' : undefined}
            >
              <div className="as-timeline-cell-header">
                <span className="as-timeline-cell-num">P{idx + 1}</span>
                <span className="as-timeline-cell-meta">
                  {p.shots.length > 1 ? `${p.shots.length} shots · ` : ''}
                  {totalShotDuration.toFixed(1)}s
                </span>
                {onRemovePellicule && (
                  <button
                    type="button"
                    className="as-timeline-cell-del"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Supprimer la pellicule P${idx + 1} ?`)) {
                        onRemovePellicule(p.id)
                      }
                    }}
                    title="Supprimer cette pellicule"
                    aria-label="Supprimer"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <div className="as-timeline-cell-thumb">
                {startImage ? (
                  <img src={startImage} alt={`Pellicule ${idx + 1}`} />
                ) : p.videoUrl ? (
                  /* Pas de firstFrameUrl extrait (= cas pellicule uploadée) :
                   *  on utilise la vidéo elle-même comme vignette. preload="metadata"
                   *  charge juste assez pour afficher la 1ère frame, pas tout le file. */
                  <video
                    src={p.videoUrl}
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={`Pellicule ${idx + 1}`}
                  />
                ) : (
                  <div className="as-timeline-cell-placeholder">—</div>
                )}
                {!ready && (
                  <div className="as-timeline-cell-status">À générer</div>
                )}
                {onOpenLightbox && (
                  <button
                    type="button"
                    className="as-timeline-cell-zoom"
                    title="Ouvrir en plein écran"
                    aria-label="Ouvrir en plein écran"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenLightbox(p.id)
                    }}
                  >
                    <Maximize2 size={11} />
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* "Ajouter" cell : 3 actions empilées — pellicule vide (I2V), continuer
         *  la vidéo (V2V chaînage de mouvement, refonte 2026-05-11), ou
         *  uploader depuis le PC. "Continuer la vidéo" affiché uniquement si
         *  au moins une pellicule existante a déjà une videoUrl (sinon rien
         *  à continuer côté motion). */}
        <div className="as-timeline-add-cell">
          <button
            type="button"
            className="as-timeline-add-btn primary"
            onClick={onAddPellicule}
            title="Ajouter une pellicule vide (continuité visuelle auto avec la précédente — perso figé sur la dernière frame)"
          >
            <Plus size={16} />
            <span>Pellicule vide</span>
          </button>
          {onContinueVideo && pellicules.some(p => !!p.videoUrl) && (
            <button
              type="button"
              className="as-timeline-add-btn secondary v2v"
              onClick={onContinueVideo}
              title="Continuer la vidéo précédente avec continuité de MOUVEMENT (LTX 2.3 V2V — extrait les 8 dernières frames pour préserver le mouvement)"
            >
              <FastForward size={14} />
              <span>Continuer la vidéo</span>
            </button>
          )}
          {onUploadVideo && (
            <>
              <button
                type="button"
                className="as-timeline-add-btn secondary"
                onClick={handleUploadClick}
                title="Charger une vidéo depuis ton ordinateur"
              >
                <Upload size={14} />
                <span>Depuis le PC</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </>
          )}
        </div>
      </div>
    </section>
  )
}
