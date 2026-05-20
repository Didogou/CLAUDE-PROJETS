'use client'
/**
 * TimelineLibrary — bibliothèque latérale source de drag pour MultiTrackTimeline.
 *
 * 5 sections rétractables :
 *   🎞 Animations  — pellicules vidéo déjà générées (LTX) ou uploadées
 *   🖼 Images      — images fixes (variantes/uploads) pour pellicules image_static
 *   🔊 Sons        — banque audio SFX du livre + bouton "Générer SFX" (ElevenLabs)
 *   ✨ Musique     — musiques d'ambiance (banque + génération)
 *   📝 Textes      — bouton "Nouveau texte" (le contenu se définit après drop)
 *
 * Drag = serializa un DragPayload (cf MultiTrackTimeline.tsx) dans le
 * dataTransfer avec mimetype TIMELINE_DRAG_MIME. Le composant timeline le
 * reçoit au drop, le snap, et appelle onDropFromLibrary.
 *
 * Phase 1 V1 (2026-05-12) : sections Animations + Images câblées ;
 * Sons/Musique/Textes en Phases 2/3.
 */

import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Film, Image as ImageIcon, Volume2, Music, Type, Plus, FastForward, Upload, ImagePlus, Trash2, Pencil } from 'lucide-react'
import { TIMELINE_DRAG_MIME, currentDragInfoRef, type DragPayload } from './MultiTrackTimeline'

// ── Types des items que la bibliothèque peut exposer ──────────────────────

export interface LibraryAnimation {
  id: string                 // pelliculeId source ou uploadId
  label: string
  videoUrl: string | null    // null = à générer (placeholder)
  firstFrameUrl: string | null
  durationSec: number
  pelliculeId: string        // pour reconstruire le bloc côté Hero
  shotId: string             // shot principal ou stub
  /** True si cette pellicule a déjà un bloc sur la timeline (refonte 2026-05-14
   *  pour ne plus la cacher de la library — affiche un badge à la place). */
  placedOnTimeline?: boolean
}

export interface LibraryImage {
  id: string
  label: string
  url: string
}

export interface LibrarySfx {
  id: string
  label: string
  url: string
  durationSec: number
}

export interface LibraryMusic {
  id: string
  label: string
  url: string
  durationSec: number
}

interface TimelineLibraryProps {
  animations?: LibraryAnimation[]
  images?: LibraryImage[]
  sfx?: LibrarySfx[]
  music?: LibraryMusic[]
  /** "+ Pellicule vide" — crée une nouvelle pellicule animation à générer
   *  via LTX. Phase 1bis 2026-05-12 (réintégration depuis l'ancien
   *  AnimationStudioTimeline). */
  onAddPellicule?: () => void
  /** "+ Image fixe" — crée une nouvelle pellicule type='image_static' à
   *  laquelle l'auteur attache une image (banque ou Z-Image). Affichée X
   *  secondes (shot.duration) entre 2 vidéos. Refonte 2026-05-12. */
  onAddImageStatic?: () => void
  /** "Continuer la vidéo" — V2V Extend depuis la dernière pellicule générée.
   *  Affiché si au moins une pellicule a déjà une videoUrl. */
  onContinueVideo?: () => void
  /** Upload d'une vidéo MP4 depuis le PC (file picker). */
  onUploadVideo?: (file: File) => void
  /** Bouton "+ Générer SFX" (ouvre une modal de génération ElevenLabs Sound
   *  Effects). Phase 2. Si non fourni → bouton caché. */
  onGenerateSfx?: () => void
  /** Bouton "+ Importer" pour SFX/musique (file picker mp3/wav). Phase 2. */
  onImportAudio?: (kind: 'sfx' | 'music', file: File) => void
  /** Bouton "+ Nouveau texte" — crée un payload text qui sera dropé sur la
   *  piste texte (le contenu se renseigne dans l'éditeur après drop). */
  onPrepareText?: () => void
  /** Suppression d'une pellicule depuis sa tile dans la library Animations
   *  (corbeille au hover). Reçoit l'id de la pellicule (= LibraryAnimation.id).
   *  Le caller orchestre : DELETE storage + retire de section.images +
   *  removeAnimationPellicule du contexte. Refonte 2026-05-13. */
  onDeleteAnimation?: (animationId: string) => void
  /** Édition d'une pellicule depuis sa tile (crayon). Reçoit l'id (=
   *  LibraryAnimation.id). Le caller route vers l'éditeur correspondant. */
  onEditAnimation?: (animationId: string) => void
  /** Renomme une pellicule (double-click sur le label). */
  onRenameAnimation?: (animationId: string, newLabel: string) => void
  /** Click simple sur une tile pellicule → highlight sur la timeline.
   *  Refonte 2026-05-14ay. */
  onSelectAnimation?: (animationId: string) => void
  /** Click simple sur une tile image → highlight sur la timeline. */
  onSelectImage?: (imageId: string) => void
  /** ID actuellement sélectionné dans la library (mirror animationSelectedPelliculeId). */
  selectedAnimationId?: string | null
  selectedImageId?: string | null
  /** Édition d'une image depuis sa tile (crayon). Route vers Studio Designer. */
  onEditImage?: (imageId: string) => void
  /** Suppression d'une image depuis sa tile (corbeille). */
  onDeleteImage?: (imageId: string) => void
  /** Filtre quelles sections de la library afficher. Default = toutes les 5
   *  (animations, images, sfx, music, text). Utile pour /animation-studio
   *  qui n'affiche que Animations + Images. Refonte 2026-05-13. */
  visibleSections?: Array<'animations' | 'images' | 'sfx' | 'music' | 'text'>
}

export default function TimelineLibrary({
  animations = [], images = [], sfx = [], music = [],
  onAddPellicule, onAddImageStatic, onContinueVideo, onUploadVideo,
  onGenerateSfx, onImportAudio, onPrepareText, onDeleteAnimation, onEditAnimation, onRenameAnimation,
  onEditImage, onDeleteImage,
  onSelectAnimation, onSelectImage,
  selectedAnimationId, selectedImageId,
  visibleSections = ['animations', 'images', 'sfx', 'music', 'text'],
}: TimelineLibraryProps) {
  const showAnimations = visibleSections.includes('animations')
  const showImages = visibleSections.includes('images')
  const showSfx = visibleSections.includes('sfx')
  const showMusic = visibleSections.includes('music')
  const showText = visibleSections.includes('text')
  // Accordéon — 1 seule section ouverte à la fois (refonte 2026-05-14).
  // Defaults sur la 1ère section visible. Animation slide via CSS max-height.
  type SectionId = 'animations' | 'images' | 'sfx' | 'music' | 'text'
  const firstVisible: SectionId = (showAnimations ? 'animations'
    : showImages ? 'images'
    : showSfx ? 'sfx'
    : showMusic ? 'music'
    : 'text') as SectionId
  const [openSection, setOpenSection] = useState<SectionId | null>(firstVisible)
  function toggle(id: SectionId) {
    setOpenSection(curr => curr === id ? null : id)
  }
  // Détection : peut-on continuer la vidéo ? Au moins 1 pellicule avec videoUrl.
  const canContinueVideo = animations.some(a => a.videoUrl != null)
  return (
    <div className="mtt-lib">
      {showAnimations && (
      <Section title="Animations" icon={<Film size={12} />} count={animations.length} open={openSection === 'animations'} onToggle={() => toggle('animations')}>
        {/* Toolbar actions création pellicules (réintégrée Phase 1bis +
         *  bouton Image fixe ajouté 2026-05-12). */}
        {(onAddPellicule || onAddImageStatic || onContinueVideo || onUploadVideo) && (
          <div className="mtt-lib-actions">
            {onAddPellicule && (
              <button
                type="button"
                className="mtt-lib-action-btn"
                onClick={onAddPellicule}
                title="Créer une nouvelle pellicule vidéo à générer"
              >
                <Plus size={11} /> Pellicule
              </button>
            )}
            {onAddImageStatic && (
              <button
                type="button"
                className="mtt-lib-action-btn"
                onClick={onAddImageStatic}
                title="Créer une pellicule image fixe (affichée X secondes entre 2 vidéos)"
              >
                <ImagePlus size={11} /> Image fixe
              </button>
            )}
            {onContinueVideo && canContinueVideo && (
              <button
                type="button"
                className="mtt-lib-action-btn"
                onClick={onContinueVideo}
                title="Continuer la vidéo (V2V Extend depuis la dernière pellicule générée)"
              >
                <FastForward size={11} /> Continuer
              </button>
            )}
            {onUploadVideo && (
              <FileImportButton
                accept="video/mp4,video/quicktime"
                label="Vidéo"
                icon={<Upload size={11} />}
                onFile={onUploadVideo}
              />
            )}
          </div>
        )}
        {animations.length === 0 ? (
          <Empty msg="Aucune animation. Crée-en une via le bouton + ci-dessus." />
        ) : (
          animations.map(a => (
            <DragItem
              key={a.id}
              label={a.placedOnTimeline ? `${a.label} · sur timeline` : a.label}
              thumbUrl={a.firstFrameUrl}
              durationSec={a.durationSec}
              payload={{
                blockKind: 'video',
                defaultDurationMs: a.durationSec * 1000,
                data: { pelliculeId: a.pelliculeId, shotId: a.shotId },
              }}
              onEdit={onEditAnimation ? () => onEditAnimation(a.id) : undefined}
              onDelete={onDeleteAnimation ? () => onDeleteAnimation(a.id) : undefined}
              onRename={onRenameAnimation ? (newLabel) => onRenameAnimation(a.id, newLabel) : undefined}
              onSelect={onSelectAnimation ? () => onSelectAnimation(a.id) : undefined}
              selected={selectedAnimationId === a.id}
            />
          ))
        )}
      </Section>
      )}

      {showImages && (
      <Section title="Images" icon={<ImageIcon size={12} />} count={images.length} open={openSection === 'images'} onToggle={() => toggle('images')}>
        {images.length === 0 ? (
          <Empty msg="Aucune image dans la banque. Génère via Z-Image/Flux ou upload." />
        ) : (
          images.map(i => (
            <DragItem
              key={i.id}
              label={i.label}
              thumbUrl={i.url}
              durationSec={3}
              payload={{
                blockKind: 'image_static',
                defaultDurationMs: 3000,
                data: { imageId: i.id, imageUrl: i.url },
              }}
              onEdit={onEditImage ? () => onEditImage(i.id) : undefined}
              onDelete={onDeleteImage ? () => onDeleteImage(i.id) : undefined}
              onSelect={onSelectImage ? () => onSelectImage(i.id) : undefined}
              selected={selectedImageId === i.id}
            />
          ))
        )}
      </Section>
      )}

      {showSfx && (
      <Section title="Sons" icon={<Volume2 size={12} />} count={sfx.length} open={openSection === 'sfx'} onToggle={() => toggle('sfx')}>
        <div className="mtt-lib-actions">
          {onGenerateSfx && (
            <button type="button" className="mtt-lib-action-btn" onClick={onGenerateSfx}>
              <Plus size={11} /> Générer SFX
            </button>
          )}
          {onImportAudio && (
            <FileImportButton
              accept="audio/*"
              label="Importer"
              onFile={f => onImportAudio('sfx', f)}
            />
          )}
        </div>
        {sfx.length === 0 ? (
          <Empty msg="Aucun SFX dans la banque." />
        ) : (
          sfx.map(s => (
            <DragItem
              key={s.id}
              label={s.label}
              audioUrl={s.url}
              durationSec={s.durationSec}
              payload={{
                blockKind: 'sfx',
                defaultDurationMs: s.durationSec * 1000,
                data: { audioId: s.id, audioUrl: s.url, label: s.label },
              }}
            />
          ))
        )}
      </Section>
      )}

      {showMusic && (
      <Section title="Musique" icon={<Music size={12} />} count={music.length} open={openSection === 'music'} onToggle={() => toggle('music')}>
        <div className="mtt-lib-actions">
          {onImportAudio && (
            <FileImportButton
              accept="audio/*"
              label="Importer"
              onFile={f => onImportAudio('music', f)}
            />
          )}
        </div>
        {music.length === 0 ? (
          <Empty msg="Aucune musique. Importe un mp3/wav." />
        ) : (
          music.map(m => (
            <DragItem
              key={m.id}
              label={m.label}
              audioUrl={m.url}
              durationSec={m.durationSec}
              payload={{
                blockKind: 'music',
                defaultDurationMs: m.durationSec * 1000,
                data: { audioId: m.id, audioUrl: m.url, label: m.label },
              }}
            />
          ))
        )}
      </Section>
      )}

      {showText && (
      <Section title="Textes" icon={<Type size={12} />} count={0} open={openSection === 'text'} onToggle={() => toggle('text')}>
        {onPrepareText ? (
          <button type="button" className="mtt-lib-action-btn" onClick={onPrepareText}>
            <Plus size={11} /> Nouveau texte
          </button>
        ) : (
          <Empty msg="Drag direct possible — placeholder Phase 3." />
        )}
        {/* En attendant Phase 3, on offre quand même un drag-source générique
         *  qui crée un texte vide à éditer après. */}
        <DragItem
          label="Texte vide"
          payload={{
            blockKind: 'text',
            defaultDurationMs: 3000,
            data: { text: '', template: 'fade', position: 'center', size: 'lg' },
          }}
        />
      </Section>
      )}
    </div>
  )
}

// ── Section repliable ─────────────────────────────────────────────────────

interface SectionProps {
  title: string
  icon: React.ReactNode
  count: number
  children: React.ReactNode
  /** Mode controlled (refonte 2026-05-14 — accordéon TimelineLibrary). */
  open?: boolean
  onToggle?: () => void
  /** Mode uncontrolled (legacy). Ignoré si `open` est fourni. */
  defaultOpen?: boolean
}

function Section({ title, icon, count, children, open: controlledOpen, onToggle, defaultOpen = true }: SectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  function handleToggle() {
    if (onToggle) onToggle()
    else setUncontrolledOpen(o => !o)
  }
  return (
    <div className="mtt-lib-section">
      <button type="button" className="mtt-lib-section-header" onClick={handleToggle}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span>{title}</span>
        <span className="mtt-lib-section-count">({count})</span>
      </button>
      {/* Slide animation via grid-template-rows : 0fr (closed) → 1fr (open).
       *  Plus simple que max-height car s'adapte à tout contenu. Refonte 2026-05-14. */}
      <div className={`mtt-lib-section-slide${open ? ' is-open' : ''}`}>
        <div className="mtt-lib-section-slide-inner">
          <div className="mtt-lib-section-body">{children}</div>
        </div>
      </div>
    </div>
  )
}

// ── Item draggable ────────────────────────────────────────────────────────

interface DragItemProps {
  label: string
  thumbUrl?: string | null
  audioUrl?: string
  durationSec?: number
  payload: DragPayload
  /** Si fourni, affiche un bouton crayon AVANT la corbeille (édition pellicule). */
  onEdit?: () => void
  /** Si fourni, affiche un bouton corbeille (confirm() puis appelle). */
  onDelete?: () => void
  /** Si fourni, double-click sur le label l'active en mode édition inline.
   *  Au blur/Enter, appelle onRename avec la nouvelle valeur. */
  onRename?: (newLabel: string) => void
  /** Si fourni, click simple sur la tile (hors boutons + label en mode édition)
   *  → highlight de la pellicule sur la timeline. Refonte 2026-05-14ay. */
  onSelect?: () => void
  /** Highlight visuel quand sélectionnée. */
  selected?: boolean
}

function DragItem({ label, thumbUrl, audioUrl, durationSec, payload, onEdit, onDelete, onRename, onSelect, selected }: DragItemProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(label)
  React.useEffect(() => { setDraft(label) }, [label])

  function commitRename() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== label && onRename) {
      onRename(trimmed)
    } else {
      setDraft(label)
    }
  }
  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData(TIMELINE_DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
    // Refonte 2026-05-14bb : expose duration au ref module-level pour
    // la réorganisation visuelle des blocs voisins pendant le drag.
    currentDragInfoRef.current = { blockId: null, durationMs: payload.defaultDurationMs }
  }
  function handleDragEnd() {
    currentDragInfoRef.current = null
  }
  return (
    <div
      className={`mtt-lib-item${selected ? ' is-selected' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      title={`Glisser sur la timeline — ${label}`}
    >
      {thumbUrl
        ? <img src={thumbUrl} alt="" className="mtt-lib-item-thumb" />
        : audioUrl
          ? <span className="mtt-lib-item-audio-ico">🔊</span>
          : <span className="mtt-lib-item-no-thumb">📄</span>}
      {editing && onRename ? (
        <input
          autoFocus
          className="mtt-lib-item-label-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            else if (e.key === 'Escape') { setEditing(false); setDraft(label) }
          }}
        />
      ) : (
        <span
          className="mtt-lib-item-label"
          onDoubleClick={onRename ? () => setEditing(true) : undefined}
          title={onRename ? 'Double-cliquer pour renommer' : undefined}
        >{label}</span>
      )}
      {durationSec !== undefined && (
        <span className="mtt-lib-item-dur">{durationSec.toFixed(1)}s</span>
      )}
      {onEdit && (
        <button
          type="button"
          className="mtt-lib-item-edit"
          onClick={e => { e.stopPropagation(); onEdit() }}
          title="Modifier cette pellicule"
          aria-label="Modifier"
        >
          <Pencil size={11} />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="mtt-lib-item-delete"
          onClick={e => {
            e.stopPropagation()
            if (confirm(`Supprimer "${label}" ?\n\nCette action est irréversible (vidéo + fichiers storage supprimés).`)) {
              onDelete()
            }
          }}
          title="Supprimer cette pellicule (DB + storage)"
          aria-label="Supprimer"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}

// ── File picker ──────────────────────────────────────────────────────────

interface FileImportButtonProps {
  accept: string
  label: string
  icon?: React.ReactNode
  onFile: (file: File) => void
}

function FileImportButton({ accept, label, icon, onFile }: FileImportButtonProps) {
  const ref = React.useRef<HTMLInputElement | null>(null)
  return (
    <>
      <button type="button" className="mtt-lib-action-btn" onClick={() => ref.current?.click()}>
        {icon ?? <Plus size={11} />} {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────

function Empty({ msg }: { msg: string }) {
  return <div className="mtt-lib-empty">{msg}</div>
}
