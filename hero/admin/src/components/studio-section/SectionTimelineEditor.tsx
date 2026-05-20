'use client'
/**
 * SectionTimelineEditor — body de /editor-test/studio-section refondu 2026-05-13.
 *
 * Layout 3 zones (= /editor-test/animation-studio sans rail ni zone prompt) :
 *
 *   ┌──────────┬───────────────────────┬───────────┐
 *   │ Folders  │   Timeline 4 pistes   │ Preview   │
 *   │ (lib)    │                       │ phone     │
 *   └──────────┴───────────────────────┴───────────┘
 *                  Boutons : Anim | Image | Conv | Choix
 *
 * Sémantique 2026-05-13 :
 *   - 1 section = 1 plan unique = 1 timeline
 *   - 1 animation contient N pellicules placées à la suite sur la timeline
 *     (chaque pellicule = 1 bloc, comme dans /animation-studio)
 *   - Les images fixes (kind='image') et choix (kind='choice') deviennent
 *     des pellicules image_static synthétiques pour fluidité d'édition
 *
 * Réutilise tels quels :
 *   - MultiTrackEditor (folders + timeline 4 pistes, hydraté via context)
 *   - AnimationStudioPreview (preview device avec scrub multi-pellicules)
 *
 * Le caller (studio-section/page.tsx) hydrate le contexte EditorStateContext
 * avec animationPellicules = aplatissement de section.images, et résout
 * pellicule.id → section.images[planIndex] pour le routing au click.
 */

import React, { useMemo } from 'react'
import { Sparkles, Image as ImageIcon, MessageSquare, GitFork, Loader2 } from 'lucide-react'
import MultiTrackEditor from '@/app/editor-test/animation-studio/components/multi-track-timeline/MultiTrackEditor'
import AnimationStudioPreview from '@/app/editor-test/animation-studio/components/AnimationStudioPreview'
import { useEditorState } from '@/components/image-editor/EditorStateContext'
import type { TimelineBlock } from '@/app/editor-test/animation-studio/components/multi-track-timeline/types'
import './section-timeline-editor.css'
// Import des CSS des composants réutilisés (animation-studio.css contient les
// styles de .as-preview-frame phone outline, et multi-track-timeline.css
// contient les styles des pistes/blocs). Sans, le rendu tombe sur des
// rectangles noirs sans bordure. Refonte 2026-05-13.
import '@/app/editor-test/animation-studio/animation-studio.css'
import '@/app/editor-test/animation-studio/components/multi-track-timeline/multi-track-timeline.css'

interface SectionTimelineEditorProps {
  loading?: boolean
  error?: string | null
  /** Click sur un bloc → ouvre l'éditeur. Reçoit le pelliculeId, le caller
   *  retrouve le planIndex dans sa map et route vers le bon éditeur. */
  onOpenPellicule: (pelliculeId: string) => void
  onAddAnimation: () => void
  onAddImage: () => void
  /** E.1 : protection double-clic. Non-null pendant le routage vers l'éditeur,
   *  désactive les boutons "Créer une animation/image". Refonte 2026-05-13. */
  creating?: 'animation' | 'image' | null
  /** ID du livre — passé au MultiTrackEditor pour la banque audio. */
  bookId: string | null
  /** Images de la section (kind='image') — alimente folder Images library.
   *  Refonte 2026-05-13 (bug "folder Images vide" en Studio Section). */
  bankImages?: Array<{ id: string; url: string; label?: string }>
  /** Suppression d'une pellicule depuis la library Animations (corbeille).
   *  Reçoit l'id (= pelliculeId). Le caller orchestre DELETE storage + DB. */
  onDeleteAnimation?: (animationId: string) => void
  /** Édition d'une pellicule depuis la library Animations (crayon). */
  onEditAnimation?: (animationId: string) => void
}

export default function SectionTimelineEditor({
  loading, error, onOpenPellicule, onAddAnimation, onAddImage, bookId, onDeleteAnimation, onEditAnimation,
  creating, bankImages,
}: SectionTimelineEditorProps) {
  const { animationPellicules, imageUrl } = useEditorState()

  // Preview phone : on ne passe que les pellicules avec une vraie vidéo
  // (= générées). Les placeholders sans videoUrl cassent le rendu du preview.
  // Fix 2026-05-13.
  const pelliculesForPreview = useMemo(
    () => animationPellicules.filter(p => p.videoUrl != null || p.type === 'image_static'),
    [animationPellicules],
  )

  function handleSelectBlock(block: TimelineBlock) {
    // VideoBlock + ImageStaticBlock portent un pelliculeId. Pour les autres
    // blocs (audio, text), pas d'action V1.
    if ('pelliculeId' in block) {
      onOpenPellicule(block.pelliculeId)
    }
  }

  if (loading) {
    return (
      <div className="ste-status">
        <Loader2 size={16} className="ste-spin" /> Chargement de la section…
      </div>
    )
  }
  if (error) {
    return <div className="ste-status ste-status-error">⚠ Erreur : {error}</div>
  }

  return (
    <div className="ste-root">
      <div className="ste-three-cols">
        <div className="ste-col-mte">
          <MultiTrackEditor
            bookId={bookId}
            bankImages={bankImages}
            onSelectBlock={handleSelectBlock}
            /* Boutons "+ Pellicule" / "+ Image fixe" retirés de la library
             *  Studio Section (= doublons avec les boutons "Créer" en bas).
             *  Refonte 2026-05-13. */
            onDeleteAnimation={onDeleteAnimation}
            onEditAnimation={onEditAnimation}
          />
        </div>
        <div className="ste-col-preview">
          <AnimationStudioPreview
            visible={true}
            pellicules={pelliculesForPreview}
            baseImageUrl={imageUrl}
          />
        </div>
      </div>

      {/* Boutons création en bas (décision UX 2026-05-13) */}
      <div className="ste-create-bar">
        <button
          type="button"
          className={`ste-create-btn ${creating ? 'ste-create-btn-disabled' : 'ste-create-btn-primary'}`}
          onClick={onAddAnimation}
          disabled={!!creating}
          title={creating === 'animation' ? 'Création en cours…' : 'Créer une animation'}
        >
          <Sparkles size={14} />
          <span>{creating === 'animation' ? 'Création…' : 'Créer une animation'}</span>
        </button>
        <button
          type="button"
          className={`ste-create-btn ${creating ? 'ste-create-btn-disabled' : 'ste-create-btn-primary'}`}
          onClick={onAddImage}
          disabled={!!creating}
          title={creating === 'image' ? 'Création en cours…' : 'Créer une image'}
        >
          <ImageIcon size={14} />
          <span>{creating === 'image' ? 'Création…' : 'Créer une image'}</span>
        </button>
        <button
          type="button"
          className="ste-create-btn ste-create-btn-disabled"
          disabled
          title="Bientôt disponible"
        >
          <MessageSquare size={14} />
          <span>Créer une conversation</span>
          <span className="ste-create-btn-badge">À venir</span>
        </button>
        <button
          type="button"
          className="ste-create-btn ste-create-btn-disabled"
          disabled
          title="Bientôt disponible"
        >
          <GitFork size={14} />
          <span>Créer un plan choix</span>
          <span className="ste-create-btn-badge">À venir</span>
        </button>
      </div>
    </div>
  )
}
