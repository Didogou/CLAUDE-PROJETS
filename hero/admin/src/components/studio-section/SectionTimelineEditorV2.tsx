'use client'
/**
 * SectionTimelineEditorV2 — refonte totale 2026-05-13.
 *
 * Stateless : prend tout en props. Pas de useEditorState (= contexte ignoré
 * pour cet écran). Consomme directement les data V2 fetched par le parent
 * via /api/sections/[id]/timeline + /api/assets/[type].
 *
 * Layout 3 zones (folders | timeline | preview) + boutons création en bas.
 */

import React, { useState } from 'react'
import { Film, Image as ImageIcon, Plus, Loader2, FastForward, RefreshCw, Edit2, Sparkles, Camera, Layers, Scissors } from 'lucide-react'
// Note : Film/Plus/Loader2/etc utilisés par les trackActions existants; ImageIcon
// utilisé pour le mini-rail toggle banque (chantier 1 refinement 2026-05-16).
import InspectorPanel, { type InspectorMode } from './InspectorPanel'
// Phase A bis.7 — PelliculeLayersPanel retiré (remplacé par track Calques +
// LayerPropertiesPanel ancré bas). Fichier source conservé pour réf temporaire.
import LayerPropertiesPanel from './LayerPropertiesPanel'
import type { PelliculeLayerRow } from '@/lib/pellicule-layers-types'
import type { PelliculeKeyframe } from '@/lib/pellicule-keyframes'
import MultiTrackTimeline from '@/app/editor-test/animation-studio/components/multi-track-timeline/MultiTrackTimeline'
import {
  type LibraryAnimation, type LibraryImage, type LibrarySfx, type LibraryMusic,
} from '@/app/editor-test/animation-studio/components/multi-track-timeline/TimelineLibrary'
// Refonte chantier 1 (2026-05-16) — TimelineLibrary remplacée par
// AnimationStudioBankPanel (banque unifiée Studios Hero).
import AnimationStudioBankPanel from '@/app/editor-test/animation-studio/components/AnimationStudioBankPanel'
// Refonte 2026-05-17 — AnimationStudioPreview retiré : remplacé par le
// PreviewModal unifié (cf memory project_preview_modal_unified), ouvert via
// le bouton 👁 Preview du StudioSectionLayout topbar. Le state previewPellicules
// est conservé (passé au PreviewModal côté page.tsx).
import type { TimelineState, TimelineBlock } from '@/app/editor-test/animation-studio/components/multi-track-timeline/types'

/** Calcule le timecode (ms) où placer un nouveau bloc en fin de track =
 *  max(start+duration) des blocs existants sur cette track. 0 si vide. */
function computeTrackEndMs(blocks: TimelineBlock[], track: string): number {
  let endMs = 0
  for (const b of blocks) {
    const bAny = b as { track?: string; startMs?: number; durationMs?: number }
    if (bAny.track !== track) continue
    const e = (bAny.startMs ?? 0) + (bAny.durationMs ?? 0)
    if (e > endMs) endMs = e
  }
  return endMs
}
import type { AnimationPellicule } from '@/components/image-editor/EditorStateContext'
import './section-timeline-editor.css'
// CSS critiques pour Library / Timeline / Preview phone — sans, tout
// s'affiche en texte brut vertical. Bug fix 2026-05-13.
import '@/app/editor-test/animation-studio/animation-studio.css'
import '@/app/editor-test/animation-studio/components/multi-track-timeline/multi-track-timeline.css'

interface SectionTimelineEditorV2Props {
  loading?: boolean
  error?: string | null

  /** State pré-mappé depuis /api/sections/[id]/timeline. */
  state: TimelineState

  /** Banques séparées par type, fetched depuis /api/assets/[type]. */
  bankAnimations?: LibraryAnimation[]
  bankImages?: LibraryImage[]
  bankSfx?: LibrarySfx[]
  bankMusic?: LibraryMusic[]

  /** Pellicules synthétiques pour le preview phone (= AnimationStudioPreview
   *  attend AnimationPellicule[] pour son scrub bar). */
  previewPellicules?: AnimationPellicule[]
  previewBaseImageUrl?: string | null

  /** Click sur un bloc → ouvre l'éditeur correspondant (route Designer ou
   *  AnimationStudio selon track + asset_type). Reçoit le block. */
  onSelectBlock?: (block: TimelineBlock) => void

  /** Boutons "Créer …" en bas. */
  onAddAnimation?: () => void
  onAddImage?: () => void

  /** E.1 : protection double-clic. */
  creating?: 'animation' | 'image' | null

  /** Suppression d'un bloc de la timeline (= row section_timeline DELETE).
   *  Note V2 : ça ne supprime PAS l'asset de la banque, juste le lien. */
  onDeleteBlock?: (blockId: string) => void

  /** Suppression complète d'un asset (= retire de la banque + cascade
   *  timeline). Reçoit asset_id + asset_type. */
  onDeleteAsset?: (assetId: string, assetType: 'image' | 'animation' | 'audio' | 'text') => void

  /** Édition d'un asset depuis la library (crayon). Le 3e arg `source`
   *  (chantier 3 2026-05-16) indique l'origine du clic : 'recents' = ouvre
   *  Studio standalone, 'section' = ouvre Studio avec contexte section.
   *  Compat backward : appelants legacy peuvent ignorer le 3e arg. */
  onEditAsset?: (
    assetId: string,
    assetType: 'image' | 'animation',
    source?: 'recents' | 'section',
  ) => void
  /** Chantier 3 — Créer nouvelle animation / image vide. */
  onCreateAnimation?: () => void
  onCreateImage?: () => void
  /** Refonte 2026-05-19 — V1 nav vers tab rail Companions / Objets. */
  onCreateCharacter?: () => void
  onCreateItem?: () => void
  /** Edit/Delete perso depuis la banque (refonte 2026-05-19). NpcRow shape. */
  onEditCharacter?: (npc: import('@/components/studio-creator/BookNpcCreatorModal').NpcRow) => void
  onDeleteCharacter?: (npc: import('@/components/studio-creator/BookNpcCreatorModal').NpcRow) => Promise<void> | void
  /** Edit/Delete objet depuis la banque (refonte 2026-05-19). ItemTile minimal. */
  onEditItem?: (item: { id: string; name: string; illustration_url?: string | null; category?: string | null }) => void
  onDeleteItem?: (item: { id: string; name: string }) => Promise<void> | void
  /** Refonte 2026-05-19 — counter incrémenté par le parent pour forcer la
   *  banque à refetch (ex: après save d'un perso édité depuis la bank tile). */
  bankRefreshKey?: number

  /** Chantier 1 refinement (2026-05-16) — Toggle de la banque animations+images.
   *  Ouverte par défaut. La croix interne du BankPanel + le bouton du mini-rail
   *  togglent le state via onToggleBankPanel. */
  bankPanelOpen?: boolean
  onToggleBankPanel?: () => void
  /** Refonte 2026-05-19 — scope de la banque quand ouverte via toolbar
   *  Animation/Image (lockedTab). null = libre. */
  bankLockedTab?: 'animations' | 'images' | null
  onBankLockedTabChange?: (tab: 'animations' | 'images' | null) => void

  /** Resize bloc (drag bord) → PATCH start_ms / duration_ms. */
  onResizeBlock?: (blockId: string, newStartMs: number, newDurationMs: number) => void

  /** Move bloc (drag depuis le centre) → PATCH start_ms (refonte 2026-05-17).
   *  Sans ce callback, le drop ne déplace rien (no-op silencieux dans
   *  MultiTrackTimeline). */
  onMoveBlock?: (blockId: string, newStartMs: number) => void

  /** Click Play sur la toolbar timeline (refonte 2026-05-17).
   *  Studio Section : ouvre le PreviewModal en slide + ferme la banque. */
  onPlayRequested?: () => void

  /** Refonte 2026-05-17 — sync bidirectionnelle isPlaying timeline ↔ preview. */
  sharedIsPlaying?: boolean | null
  onSharedPlayingChange?: (playing: boolean) => void
  /** Cursor global ms partagé entre timeline et preview. */
  sharedCursorMs?: number | null
  onSharedCursorChange?: (cursorMs: number) => void

  /** Refonte 2026-05-17 — Effets / Capture sur les vignettes pellicule (bandeau
   *  bas). Mêmes callbacks que Studio Animation : ouvrent la modale EffectsModal
   *  (mode normal ou mode='capture') ciblée sur l'asset_animation correspondant. */
  onOpenEffects?: (assetId: string) => void
  onOpenCapture?: (assetId: string) => void
  /** Refonte 2026-05-19 — ouvre la modale Couper (cut range + split en 2).
   *  Refonte 2026-05-20 : remplacé par onDeleteFrameAtCursor + onCutAtCursor
   *  inline. Prop conservée pour compat caller mais non utilisée. */
  onOpenCut?: (assetId: string) => void
  /** Refonte 2026-05-20 — feature Couper inline (toolbar timeline). */
  onDeleteFrameAtCursor?: (pelliculeId: string, cursorOffsetMs: number) => void | Promise<void>
  onCutAtCursor?: (pelliculeId: string, cursorOffsetMs: number) => void | Promise<void>
  /** Refonte 2026-05-20 — step ±frame user (boutons ou clavier) → open preview en pause + ferme banque. */
  onUserScrubAction?: () => void
  /** Refonte 2026-05-20 — désactive Play/step/Supprimer/Couper + figure scrub pendant un cut/split ffmpeg en cours. */
  cutProcessing?: boolean
  /** Refonte 2026-05-20 — upload vidéo / image depuis PC dans la banque
   *  slide-open. Retourne l'asset frais (POST asset DB) pour MAJ optimistic. */
  onUploadVideo?: (file: File) => Promise<import('@/app/editor-test/animation-studio/components/AnimationStudioBankPanel').BankAsset>
  onUploadImage?: (file: File) => Promise<import('@/app/editor-test/animation-studio/components/AnimationStudioBankPanel').BankAsset>

  /** Phase A.4 keyframes 2026-05-18 — notifié quand l'auteur édite les calques
   *  d'une pellicule (panneau Calques). Permet au parent de mettre à jour le
   *  PreviewModal embedded pour live preview. (pelliculeId, layersArray) */
  onLayersChange?: (pelliculeId: string, layers: PelliculeLayerRow[]) => void
  /** Upload d'un fichier (image/gif côté V1) vers Supabase → retourne l'URL.
   *  Le panneau Calques utilise ça quand l'auteur upload depuis disque. */
  onLayerUpload?: (file: File) => Promise<string>

  /** Phase A.5 keyframes 2026-05-18 — pilotage du dessin de mask sur le preview.
   *  Le parent gère l'état (overlay rendu dans PreviewModal embedded). Ici on
   *  reçoit juste les hooks pour démarrer/annuler le dessin + lire l'état courant. */
  onStartMaskEdit?: (pelliculeId: string, layerId: string, shape: 'rect' | 'polygon') => void
  onCancelMaskEdit?: () => void
  maskDraftPoints?: Array<[number, number]>
  maskDraftShape?: 'rect' | 'polygon' | null
  maskDraftLayerId?: string | null

  /** Phase B.3 keyframes 2026-05-18 — animation runtime pellicule + persistance.
   *  Le parent fetch les keyframes des pellicules via la timeline state, et
   *  expose un setter qui PATCH /api/sections/[id]/timeline avec keyframes JSONB. */
  pelliculeKeyframesById?: Record<string, PelliculeKeyframe[]>
  onPelliculeKeyframesChange?: (pelliculeId: string, keyframes: PelliculeKeyframe[]) => void
  /** Cursor partagé GLOBAL (ms cumul depuis le début de la section). Le composant
   *  calcule en interne le cursor RELATIF à la pellicule sélectionnée (en
   *  soustrayant les durées précédentes via state.blocks). */
  sharedCursorMsForKfs?: number

  /** Phase A bis.4 — finder qui retourne le layer hydraté pour le panel
   *  properties (= lookup direct dans la map du parent). */
  pelliculeLayersFinder?: (parentPelliculeId: string, layerId: string) => PelliculeLayerRow | null | undefined
  /** Phase A bis.4 — notifié quand un calque est modifié (transform/mask/etc.)
   *  ou supprimé via le panel properties ancré. Permet au parent de sync sa
   *  map layersByPelliculeId (re-fetch ou patch local). */
  onLayerMutated?: (parentPelliculeId: string, updated: PelliculeLayerRow) => void
  onLayerDeleted?: (parentPelliculeId: string, layerId: string) => void
  /** Phase A bis.7 — déclenche l'ajout d'un calque sur la pellicule donnée
   *  (le parent gère le file picker + POST API + sync map). */
  onAddLayerToPellicule?: (parentPelliculeId: string) => void

  /** Phase A bis bonus 2026-05-18 — notifié quand l'auteur clique sur un layer
   *  block : permet au parent d'ouvrir le preview ciblé sur la pellicule
   *  parente, paused, avec badge contextuel + scope playback. */
  onLayerSelected?: (info: {
    parentPelliculeId: string
    layerId: string
    layerLabel: string
    parentLabel: string
    parentStartMs: number
    parentDurationMs: number
  }) => void

  /** "Animer" sur un bloc image_static (refonte 2026-05-14). Reçoit le
   *  pelliculeId (= imageAssetId). Caller : DELETE bloc image + push
   *  vers AnimationStudio en draft animation avec firstFrameUrl pré-rempli. */
  onAnimateImageBlock?: (imageAssetId: string) => void

  /** "Continuer" sur un bloc animation (refonte 2026-05-14at). Reçoit
   *  l'assetId de la pellicule à étendre. Caller : navigate AnimationStudio
   *  avec ?continueFromAssetId=X qui auto-déclenche handleContinueVideo. */
  onContinueAnimationBlock?: (animationAssetId: string) => void

  /** "Ajouter" depuis lastFrame d'une animation (refonte 2026-05-17).
   *  Caller : navigate AnimationStudio en draft avec firstFrameUrl =
   *  lastFrameUrl de l'animation source. */
  onAddPelliculeFromAnimation?: (animationAssetId: string) => void

  /** Bloc actuellement sélectionné dans la timeline (refonte 2026-05-14s).
   *  Drive l'expansion de l'action toolbar correspondante (subTools) +
   *  highlight visuel sur le bloc dans MultiTrackTimeline. */
  selectedBlock?: { id: string; kind: 'video' | 'image_static'; assetId: string } | null
  onClearSelection?: () => void

  /** Drop d'un asset library sur la timeline → POST /api/sections/[id]/timeline. */
  onDropAssetOnTrack?: (
    track: 'video_image' | 'sfx' | 'music' | 'text',
    assetType: 'image' | 'animation' | 'audio' | 'text',
    assetId: string,
    dropMs: number,
  ) => void

  /** Conservé en signature pour compat — plus utilisé en V2 (icone Importer
   *  retiré 2026-05-14). À ré-activer si la feature revient. */
  bookId?: string | null
  sectionId?: string | null
  onImportSuccess?: () => void
}

export default function SectionTimelineEditorV2(props: SectionTimelineEditorV2Props) {
  const {
    loading, error, state,
    bankAnimations = [], bankImages = [], bankSfx = [], bankMusic = [],
    previewPellicules = [], previewBaseImageUrl = null,
    onSelectBlock, onAddAnimation, onAddImage, creating,
    onDeleteBlock, onDeleteAsset, onEditAsset, onResizeBlock,
    onDropAssetOnTrack, onAnimateImageBlock, onContinueAnimationBlock,
    onAddPelliculeFromAnimation,
    selectedBlock = null, onClearSelection,
    bookId = null, sectionId = null,
    onCreateAnimation, onCreateImage, onCreateCharacter, onCreateItem,
    onEditCharacter, onDeleteCharacter, onEditItem, onDeleteItem, bankRefreshKey,
    bankPanelOpen = true, onToggleBankPanel, bankLockedTab = null, onBankLockedTabChange,
    onMoveBlock,
    onPlayRequested,
    sharedIsPlaying, onSharedPlayingChange, sharedCursorMs, onSharedCursorChange,
    onOpenEffects, onOpenCapture, onOpenCut, onDeleteFrameAtCursor, onCutAtCursor, onUserScrubAction, cutProcessing,
    onUploadVideo, onUploadImage,
    onLayersChange, onLayerUpload,
    onStartMaskEdit, onCancelMaskEdit, maskDraftPoints, maskDraftShape, maskDraftLayerId,
    pelliculeKeyframesById, onPelliculeKeyframesChange,
    sharedCursorMsForKfs,
    pelliculeLayersFinder, onLayerMutated, onLayerDeleted,
    onAddLayerToPellicule, onLayerSelected,
  } = props

  // V1 visuel — phase C du merge AnimationStudio (refonte 2026-05-14).
  // Inspector mode null = panneau fermé. Sinon affiche le sous-panneau du
  // type sélectionné. La logique de génération est PHASE 2 (à brancher).
  const [inspectorMode, setInspectorMode] = useState<InspectorMode | null>(null)
  // Phase A.4 keyframes 2026-05-18 — pellicule dont les calques sont en cours
  // d'édition (panneau Calques ouvert). Mutuellement exclusif avec inspectorMode.
  const [layersPelliculeId, setLayersPelliculeId] = useState<string | null>(null)
  // Phase A bis.4 — calque cliqué sur la track Calques (panel properties ancré
  // s'ouvre en bas). { parentPelliculeId, layerId }
  const [selectedLayer, setSelectedLayer] = useState<{ parentId: string; layerId: string } | null>(null)

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

  // Refonte 2026-05-17 — pellicule vidéo sélectionnée a-t-elle un videoUrl ?
  // Sert à disable Effets / Capture sur les pellicules draft (sans vidéo générée).
  const selectedVideoHasUrl = selectedBlock?.kind === 'video'
    && !!(state.blocks.find(b => b.id === selectedBlock.id) as { videoUrl?: string | null } | undefined)?.videoUrl

  // Refonte 2026-05-17 — actions toolbar refondues (cf user feedback) :
  //  - Animation/Image = folders NON cliquables, s'expand auto via activeAction
  //    quand un bloc du type correspondant est sélectionné.
  //  - Sub-tools Animation : Continuer (V2V) + Ajouter (I2V depuis lastFrame)
  //  - Sub-tools Image     : Modifier (Designer) + Animer (I2V)
  //  - Quand l'un expand, l'autre folder reste visible mais désactivé (cf
  //    MultiTrackTimeline visibleEntries + disabled logic).
  //  - Son/Musique/Texte restent cliquables normalement, peu importe l'expand.
  const trackActions = {
    video_image: [
      {
        icon: <Film size={14} />,
        // Refonte 2026-05-19 — onClick = ouvrir la banque si pas déjà ouverte
        // (fallback pour timeline vide ou aucune pellicule sélectionnée). Si une
        // pellicule video est sélectionnée → expand auto via activeAction, et
        // re-click déclenche le toggle off (handleClick MTT).
        label: 'Animation',
        title: 'Animation — sélectionne une pellicule animation, ou clique pour ouvrir la banque',
        onClick: () => {
          onBankLockedTabChange?.('animations')
          if (!bankPanelOpen) onToggleBankPanel?.()
        },
        // Refonte 2026-05-17 — Effets / Capture déplacés ici (ex-bandeau bas
        // des vignettes pellicule), AVANT Continuer / Ajouter. Disabled si la
        // pellicule sélectionnée n'a pas encore de videoUrl (= pellicule draft).
        subTools: [
          {
            icon: <Sparkles size={14} />,
            label: 'Effets',
            title: selectedVideoHasUrl
              ? 'Ouvrir la bibliothèque d\'effets sur la pellicule sélectionnée'
              : 'Génère d\'abord une vidéo pour cette pellicule',
            disabled: !selectedVideoHasUrl,
            onClick: () => {
              if (selectedBlock?.kind === 'video' && onOpenEffects) {
                onOpenEffects(selectedBlock.assetId)
              }
            },
          },
          {
            icon: <Camera size={14} />,
            label: 'Capture',
            title: selectedVideoHasUrl
              ? 'Capturer une frame de la pellicule sélectionnée'
              : 'Génère d\'abord une vidéo pour cette pellicule',
            disabled: !selectedVideoHasUrl,
            onClick: () => {
              if (selectedBlock?.kind === 'video' && onOpenCapture) {
                onOpenCapture(selectedBlock.assetId)
              }
            },
          },
          // Refonte 2026-05-20 — bouton "Couper" RETIRÉ des sub-tools. Le
          // cut/split inline via toolbar timeline (à côté du Play) : boutons
          // Supprimer la frame + Couper à partir d'ici. Plus de modale séparée.
          {
            icon: <FastForward size={14} />,
            label: 'Continuer',
            title: 'Continuer la vidéo (V2V Extend) dans Animation Studio',
            onClick: () => {
              if (selectedBlock?.kind === 'video' && onContinueAnimationBlock) {
                onContinueAnimationBlock(selectedBlock.assetId)
              } else {
                alert('Sélectionne d\'abord une pellicule animation à continuer.')
              }
            },
          },
          {
            icon: <Plus size={14} />,
            label: 'Ajouter',
            title: 'Nouvelle animation depuis la dernière frame (I2V)',
            onClick: () => {
              if (selectedBlock?.kind === 'video' && onAddPelliculeFromAnimation) {
                onAddPelliculeFromAnimation(selectedBlock.assetId)
              } else {
                alert('Sélectionne d\'abord une animation pour créer une suite I2V.')
              }
            },
          },
          {
            // Phase A bis.7 keyframes 2026-05-18 — refonte : "+ Calque" upload
            // direct un fichier comme calque sur la pellicule sélectionnée.
            // L'édition se fait ensuite via la track Calques (click block →
            // LayerPropertiesPanel ancré bas).
            icon: <Layers size={14} />,
            label: '+ Calque',
            title: 'Ajouter un calque (image/gif) au-dessus de cette pellicule',
            keepActiveOnClick: true,
            onClick: () => {
              if (selectedBlock?.kind === 'video' && onAddLayerToPellicule) {
                onAddLayerToPellicule(selectedBlock.id)
              }
            },
          },
        ],
      },
      {
        icon: <ImageIcon size={14} />,
        // Refonte 2026-05-19 — symétrie Animation : onClick ouvre la banque
        // (fallback timeline vide). Expand auto via activeAction si selectedBlock
        // kind = image_static.
        label: 'Image',
        title: 'Image — sélectionne une pellicule image, ou clique pour ouvrir la banque',
        onClick: () => {
          onBankLockedTabChange?.('images')
          if (!bankPanelOpen) onToggleBankPanel?.()
        },
        subTools: [
          {
            icon: <Edit2 size={14} />,
            label: 'Modifier',
            title: 'Éditer cette image dans le Designer',
            onClick: () => {
              if (selectedBlock?.kind === 'image_static' && onEditAsset) {
                onEditAsset(selectedBlock.assetId, 'image', 'section')
              }
            },
          },
          {
            icon: <Film size={14} />,
            label: 'Animer',
            title: 'Animer cette image (LTX I2V)',
            onClick: () => {
              if (selectedBlock?.kind === 'image_static' && onAnimateImageBlock) {
                onAnimateImageBlock(selectedBlock.assetId)
              }
            },
          },
          {
            // Phase A bis.7 — idem pour pellicules image_static.
            icon: <Layers size={14} />,
            label: '+ Calque',
            title: 'Ajouter un calque (image/gif) au-dessus de cette image',
            keepActiveOnClick: true,
            onClick: () => {
              if (selectedBlock?.kind === 'image_static' && onAddLayerToPellicule) {
                onAddLayerToPellicule(selectedBlock.id)
              }
            },
          },
        ],
      },
    ],
    sfx:   [{ icon: <Plus size={14} />, label: 'Son',     title: 'Créer un son',     onClick: () => setInspectorMode('sfx') }],
    music: [{ icon: <Plus size={14} />, label: 'Musique', title: 'Créer une musique', onClick: () => setInspectorMode('music') }],
    text:  [{ icon: <Plus size={14} />, label: 'Texte',   title: 'Créer un texte',   onClick: () => setInspectorMode('text') }],
  }
  // Calcule l'action active selon le bloc sélectionné. video_image[0] = anim,
  // video_image[1] = image. Studio Section drive selectedBlock via onSelectBlock.
  const activeAction = selectedBlock
    ? { track: 'video_image' as const, index: selectedBlock.kind === 'video' ? 0 : 1 }
    : null
  // `creating` est unused depuis le retrait du panneau Inspector V1 visuel.
  // Reste en signature pour compat caller.
  void creating

  return (
    <div className="ste-root">
      <div className="ste-three-cols">
        {/* Stack gauche : [library + timeline] en row, puis Inspector dessous
         *  en pleine largeur. Slide-up animation à l'ouverture (refonte
         *  2026-05-14e). Library hauteur = stretch sur la row top, donc
         *  match naturellement la hauteur de la timeline. */}
        <div className="ste-left-stack">
          <div className="ste-top-row">
            {/* Refonte 2026-05-16 — mini-rail interne SUPPRIMÉ. Le toggle de la
             *  banque est délégué au PREMIER icône du rail principal
             *  (StudioSectionLayout, tab Storyboard). Voir prop onToggleBankPanel
             *  qui remonte au parent page.tsx → setBankPanelOpen. */}
            {/* Refonte chantier 1 (2026-05-16, memory project_hero_studios_architecture) :
             *  TimelineLibrary remplacée par AnimationStudioBankPanel (banque unifiée
             *  Studios Hero). Le rendu interne du BankPanel gère son propre layout
             *  (header + tabs + upload + search + sections accordéon). On force
             *  juste un wrapper de largeur fixe via .ste-col-library.
             *  bankPanelOpen=false → BankPanel masqué (toggle via mini-rail). */}
            {/* Refonte 2026-05-17 — wrapper toujours rendu pour permettre
             *  slide doux (flex-basis transition). Quand bankPanelOpen=false,
             *  classe is-bank-closed → flex:0 0 0 + opacity 0. */}
            <div className={`ste-col-library is-bankpanel${inspectorMode ? ' is-narrow' : ''}${!bankPanelOpen ? ' is-bank-closed' : ''}`}>
              <AnimationStudioBankPanel
                bookId={bookId ?? null}
                currentSectionId={sectionId ?? null}
                onClose={() => { onToggleBankPanel?.() }}
                onAddAnimation={(animationId) => {
                  // Ajoute à la fin de la timeline (track video_image).
                  const endMs = computeTrackEndMs(state.blocks, 'video_image')
                  onDropAssetOnTrack?.('video_image', 'animation', animationId, endMs)
                }}
                onUploadVideo={onUploadVideo}
                onUploadImage={onUploadImage}
                onAddImage={(imageId) => {
                  const endMs = computeTrackEndMs(state.blocks, 'video_image')
                  onDropAssetOnTrack?.('video_image', 'image', imageId, endMs)
                }}
                onDeleteAsset={onDeleteAsset
                  ? (asset, kind) => onDeleteAsset(asset.id, kind === 'animations' ? 'animation' : 'image')
                  : undefined}
                inTimelineAssetIds={state.blocks
                  .filter(b => b.kind === 'video' || b.kind === 'image_static')
                  .map(b => (b as { pelliculeId?: string }).pelliculeId ?? '')
                  .filter(Boolean)}
                onEditAsset={onEditAsset
                  ? (asset, kind, source) =>
                      onEditAsset(asset.id, kind === 'animations' ? 'animation' : 'image', source)
                  : undefined}
                onCreateAnimation={onCreateAnimation}
                onCreateImage={onCreateImage}
                onCreateCharacter={onCreateCharacter}
                onCreateItem={onCreateItem}
                onEditCharacter={onEditCharacter}
                onDeleteCharacter={onDeleteCharacter}
                onEditItem={onEditItem}
                onDeleteItem={onDeleteItem}
                refreshKey={bankRefreshKey}
                lockedTab={bankLockedTab}
              />
            </div>

            <div className="ste-col-mte">
              <div className="mtt-editor mtt-editor-no-library">
                <div className="mtt-editor-timeline">
                  <MultiTrackTimeline
                    state={state}
                    trackHeightRem={2}
                    /* Refonte 2026-05-17 — vignettes timeline agrandies
                     *  (3.5rem → 6rem). Plus lisibles sans encombrer. */
                    trackHeightsRem={{ video_image: 6 }}
                    /* Refonte 2026-05-17 — pxPerSec réduit (40 → 24) pour
                     *  compacter horizontalement la timeline (pellicules
                     *  plus petites + plus de contenu visible). */
                    pxPerSec={24}
                    /* Mode compact (refonte 2026-05-17) : pas de snap/findFreeSlot
                     *  au drop, le caller fait son reorder + compact. */
                    compactMode={true}
                    trackActions={trackActions}
                    onDeleteFrameAtCursor={onDeleteFrameAtCursor}
                    onCutAtCursor={onCutAtCursor}
                    onUserScrubAction={onUserScrubAction}
                    cutProcessing={cutProcessing}
                    activeAction={activeAction}
                    onActiveActionChange={(next) => { if (!next) onClearSelection?.() }}
                    onPlayingChange={(playing) => {
                      // Refonte 2026-05-17 — Play sur la toolbar timeline =
                      // ouvrir PreviewModal + fermer banque (Studio Section).
                      // Aussi : sync playing state vers PreviewModal.
                      if (playing) onPlayRequested?.()
                      onSharedPlayingChange?.(playing)
                    }}
                    externalIsPlaying={sharedIsPlaying}
                    externalCursorMs={sharedCursorMs}
                    onUserSeek={(ms) => onSharedCursorChange?.(ms)}
                    selectedBlockId={selectedBlock?.id ?? selectedLayer?.parentId ?? null}
                    onSelectBlock={(block) => {
                      // Phase A bis.4 — bloc layer : ouvre le panel properties
                      // ancré en bas (mutuellement exclusif avec selectedBlock).
                      if (block.kind === 'layer') {
                        setSelectedLayer({ parentId: block.parentPelliculeId, layerId: block.layerId })
                        // Refonte 2026-05-19 — IMPORTANT : clear selectedBlock
                        // (parent state) sinon le liseret rose reste sur l'ancien
                        // video block sélectionné. Avec selectedBlock=null,
                        // le fallback selectedLayer.parentId est utilisé pour
                        // highlighter LA bonne pellicule parente.
                        onClearSelection?.()
                        // Phase A bis bonus — notifie le parent pour qu'il
                        // ouvre le preview ciblé sur la pellicule parente.
                        const parentBlock = state.blocks.find(b =>
                          (b.kind === 'video' || b.kind === 'image_static') && b.id === block.parentPelliculeId,
                        )
                        if (parentBlock && onLayerSelected) {
                          const parentLabel = (parentBlock.kind === 'video' || parentBlock.kind === 'image_static')
                            ? parentBlock.label
                            : 'Pellicule'
                          onLayerSelected({
                            parentPelliculeId: block.parentPelliculeId,
                            layerId: block.layerId,
                            layerLabel: block.label,
                            parentLabel,
                            parentStartMs: parentBlock.startMs,
                            parentDurationMs: parentBlock.durationMs,
                          })
                        }
                        return
                      }
                      // Autres kinds : flow normal (sélection pellicule pour
                      // expand des sub-tools).
                      setSelectedLayer(null)
                      onSelectBlock?.(block)
                    }}
                    onResizeBlock={onResizeBlock}
                    onMoveBlock={onMoveBlock}
                    onDeleteBlock={onDeleteBlock ? (block) => onDeleteBlock(block.id) : undefined}
                    onAnimateBlock={onAnimateImageBlock}
                    /* Refonte 2026-05-17 — bandeau bas des vignettes pellicule
                     *  SUPPRIMÉ entièrement en Studio Section. Effets / Capture
                     *  / Modifier sont remontés dans les sub-tools de la toolbar
                     *  (folders Animation / Image). Aucun onOpenEffects /
                     *  onOpenCapture / onEditBlock passé au MTT → bandeau
                     *  bas non rendu (condition dans BlockView). */
                    onDropFromLibrary={(track, payload, dropMs) => {
                      const assetId = (payload.data.assetId
                        ?? payload.data.imageId
                        ?? payload.data.audioId
                        ?? payload.data.pelliculeId) as string | undefined
                      if (!assetId) {
                        console.warn('[SectionTimelineEditorV2] drop sans assetId:', payload)
                        return
                      }
                      const assetTypeMap: Record<string, 'image' | 'animation' | 'audio' | 'text'> = {
                        video: 'animation',
                        image_static: 'image',
                        sfx: 'audio',
                        music: 'audio',
                        text: 'text',
                      }
                      const at = assetTypeMap[payload.blockKind]
                      if (!at) return
                      // Phase A bis 2026-05-18 — track 'layers' n'accepte pas
                      // de drop direct depuis la banque (les calques sont
                      // créés via le panel properties contextuel).
                      if (track === 'layers') return
                      onDropAssetOnTrack?.(track, at, assetId, dropMs)
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Inspector pleine largeur du stack gauche, slide-up depuis le bas. */}
          {inspectorMode && (
            <div className="ste-inspector-slot">
              <InspectorPanel
                mode={inspectorMode}
                onClose={() => setInspectorMode(null)}
              />
            </div>
          )}
        </div>

        {/* Refonte 2026-05-17 — sidebar preview phone supprimé. Le preview
         *  passe par PreviewModal unifié (bouton 👁 Preview du topbar). */}
      </div>

      {/* Phase A bis.4 keyframes 2026-05-18 — Properties panel ancré bas,
       *  contextuel au calque cliqué sur la track Calques. Le panel fetch
       *  lui-même son layer (fallback) + PATCH API ; après chaque mutation on
       *  notifie le parent via onLayerMutated → re-fetch + sync map globale. */}
      {selectedLayer && (
        <LayerPropertiesPanel
          parentPelliculeId={selectedLayer.parentId}
          layerId={selectedLayer.layerId}
          layer={pelliculeLayersFinder?.(selectedLayer.parentId, selectedLayer.layerId) ?? null}
          onClose={() => setSelectedLayer(null)}
          onLayerChange={(updated) => onLayerMutated?.(selectedLayer.parentId, updated)}
          onLayerDelete={() => onLayerDeleted?.(selectedLayer.parentId, selectedLayer.layerId)}
          onStartMaskEdit={onStartMaskEdit
            ? (shape) => onStartMaskEdit(selectedLayer.parentId, selectedLayer.layerId, shape)
            : undefined}
          onCancelMaskEdit={onCancelMaskEdit}
          maskDraftActive={maskDraftLayerId === selectedLayer.layerId}
          maskDraftShape={maskDraftShape ?? null}
          maskDraftPoints={maskDraftPoints}
        />
      )}
    </div>
  )
}
