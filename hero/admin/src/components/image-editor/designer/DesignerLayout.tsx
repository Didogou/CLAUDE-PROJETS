'use client'
/**
 * DesignerLayout — orchestrateur du Studio Designer (modèle 2 phases).
 *
 * Phase A (creation) : choix d'une image base
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                    DesignerTopBar                            │
 *   ├──┬──────────────┬───────────────────────────────────────────┤
 *   │R │  BankPanel   │       CANVAS         │ (inspector caché) │
 *   │A │  (slide-in)  │       (children)     │                   │
 *   │I │              │                       │                   │
 *   │L │              ├──────────────────────┤                   │
 *   │  │              │  bottomDrawer        │                   │
 *   │  │              │  (variants + form)   │                   │
 *   └──┴──────────────┴──────────────────────┴───────────────────┘
 *      Bouton "Commencer l'édition" flottant bottom-right du canvas
 *
 * Phase B (editing) : édition de la base figée
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  TopBar (avec bouton ⟲ Nouvelle base)                        │
 *   ├──┬──────────────┬───────────────────────────┬──────────────┤
 *   │R │  Catalog     │       CANVAS              │  Inspector   │
 *   │A │  (optionnel) │       (children)          │  (folds)     │
 *   │I │              │                           │              │
 *   │L │              │                           │              │
 *   └──┴──────────────┴───────────────────────────┴──────────────┘
 *
 * Cf. project_designer_full_vision_2phases.md pour la vision complète.
 */

import React, { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Copy, Trash2, Layers, User, Package } from 'lucide-react'
import DesignerTopBar from './DesignerTopBar'
import DesignerLeftRail, { type RailCategory } from './DesignerLeftRail'
import DesignerCatalog, { type PersonnageMode } from './DesignerCatalog'
import AIAssistantPanel from './ai-assistant/AIAssistantPanel'
import NarrativeChoiceModal, {
  type NarrativeChoiceResult,
  type NarrativeBankItem,
} from './ai-assistant/NarrativeChoiceModal'
import DesignerCharactersDrawer from './DesignerCharactersDrawer'
import type { Npc } from '@/types'
import type { Character } from '@/lib/character-store'
import DesignerInspector from './DesignerInspector'
import DesignerPreviewModal from './DesignerPreviewModal'
import DesignerActionsToolbar, { type DesignerAction, type DesignerSecondaryAction } from './DesignerActionsToolbar'
import { useEditorState, type AnimationPellicule } from '../EditorStateContext'
import { AICutCommandProvider } from '../AICutCommandContext'
import { usePreAnalyzeImage } from '../hooks/usePreAnalyzeImage'
import SceneAnalysisPrompt from '../SceneAnalysisPrompt'
import AnimationTimeline from './animation/AnimationTimeline'
import AnimationEditor from './animation/AnimationEditor'
import ChoiceMarkersOverlay from './choice/ChoiceMarkersOverlay'
import ItemAttachmentPickerModal, {
  type BookItemBrief,
} from './objects/ItemAttachmentPickerModal'
import { cropAlphaBbox } from './objects/crop-alpha-bbox'
import HeroToast, { type HeroToastValue } from './HeroToast'
import { runQwenImageEdit } from '@/lib/comfyui-qwen-edit'
import { buildVantagePrompt } from '@/lib/ltx-vantage-prompt'
import { runLtx23Dual } from '@/lib/comfyui-ltx-dual'
import { flattenLayersToImage } from '@/lib/flatten-layers'
import { buildLivePreviewBlobUrl } from '../helpers/extractZones'
import { uploadBlobAsImage } from '@/lib/image-extraction-analysis'
import { useCharacterStore } from '@/lib/character-store'
import { buildDialogueAudio, MissingVoiceError } from '@/lib/dialogue-audio'
import {
  resolveEffectiveScene,
  describeSceneViaVision,
  translateSceneFieldToEn,
} from '@/lib/scene-description'
import type { DesignerPhase } from './types'

interface DesignerLayoutProps {
  /** Phase courante. 'creation' = choix base, 'editing' = édition. */
  phase: DesignerPhase

  /** Titre du plan (ex: "Plan 1") */
  planTitle: string
  /** Résumé court (ex: "Tu rentres dans le bar enfumé…") */
  planSummary?: string
  /** Label retour contextuel (ex: "Retour à la section §3") */
  returnLabel: string
  onReturn: () => void
  /** Zone canvas centrale — uniquement le <Canvas /> (LayerTabs et toolbar
   * sont passés via leurs props dédiées). */
  children: ReactNode

  /** LayerTabs (Phase B uniquement). Si non fourni, pas d'onglets affichés. */
  layerTabs?: ReactNode

  /** Actions au-dessus du canvas (Phase B uniquement). Découpe, Inpaint, etc.
   * Click sur une action → ouvre le catalog gauche correspondant. */
  actions?: DesignerAction[]

  /** Phase A — Banque d'images (slide-in à gauche du canvas). Optionnel. */
  bankPanel?: ReactNode
  /** Phase A — Drawer en bas (variantes + form génération). Optionnel. */
  bottomDrawer?: ReactNode
  /** Préfixe Supabase Storage pour uploads des outils du Designer
   * (ex: masks/sprites de Découpe SAM via CatalogEdit). Threadé aux catalogs
   * qui en ont besoin. */
  storagePathPrefix: string
  /** Phase A — Action "Commencer l'édition" (fige la base, bascule en Phase B).
   * Si non fourni, le bouton flottant n'apparaît pas. */
  onCommencer?: () => void
  /** Bouton secondaire "Commencer l'animation" (refonte 2026-05-07).
   *  Si fourni, affiche un 2ème bouton à côté de "Commencer l'édition" qui
   *  ouvre le nouvel écran AnimationStudio. Pour les plans typés animation. */
  onCommencerAnimation?: () => void
  commencerAnimationEnabled?: boolean
  /** Phase A — Bouton Commencer activé (= une variante a été sélectionnée). */
  commencerEnabled?: boolean
  /** Phase A — Label du bouton commencer (default: "Commencer l'édition") */
  commencerLabel?: string

  /** Phase B — Titre du calque actif (affiché dans l'inspecteur) */
  inspectorTitle?: ReactNode
  /** Phase B — Contenu de l'inspecteur (params du calque actif) */
  inspectorContent?: ReactNode
  /** Phase B — Action "Nouvelle base" qui rebascule en Phase A.
   * Si non fourni, le bouton n'apparaît pas dans le top bar. */
  onNouvelleBase?: () => void

  /** Top bar — actions communes */
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  theme?: 'light' | 'dark'
  onToggleTheme?: () => void

  /** Modal Aperçu (commun aux 2 phases) */
  previewImageUrl?: string | null
  /** URL vidéo MP4 si plan animation — joué dans la modal Aperçu en plus
   *  de l'image (β.1+ 2026-05-06 lipsync). */
  previewVideoUrl?: string | null
  previewSectionText?: string
  previewChoices?: Array<{ id: string; label: string }>

  /** Phase B — Mode actif sur l'action Personnage (drive le contenu rendu
   *  dans le catalog 'generate'). null = pas d'action Personnage active. */
  personnageMode?: PersonnageMode
  /** Phase B — Callback "Ajouter ce perso à la scène" depuis CatalogCharacters. */
  onAddCharacter?: (character: Character, placementPrompt: string, asLayer: boolean) => Promise<void> | void
  /** Phase E (2026-05-05) — Banque d'images affichée dans CatalogAnimation
   *  quand la pellicule sélectionnée est de type 'image_static'. */
  bankImages?: import('./types').BankImage[]
  /** Refonte 2026-05-09 — callback déclenché par l'action secondaire "Créer
   *  un personnage" du drawer Découper. Reçoit l'URL Supabase du PNG extrait
   *  (le détourage transparent). Le parent (new-layout) ouvre alors un
   *  CharacterCreatorModal pré-rempli (analyse portrait/fullbody + crop
   *  portrait depuis fullbody si besoin). */
  onCreateCharacterFromExtraction?: (extractionUrl: string) => void
  /** Choix de la Section parente — affichés en chips au-dessus du canvas
   *  pour rappeler à l'auteur ce qui doit être visible/jouable dans l'image
   *  (ex: si un choix est "ouvrir l'enveloppe", l'image doit montrer une
   *  enveloppe). Read-only — l'édition se fait dans Studio Section. */
  sectionChoices?: Array<{ id: string; sort_order: number; label: string; target_section_number: number | null }>
  /** Numéro de la Section parente, affiché dans le label du bandeau. */
  sectionNumber?: number
  /** Items du livre liés à cette section (filtrés par sections_used).
   *  Drive le contenu de CatalogObjects v2 quand la catégorie 'objects'
   *  est ouverte. Refonte Objet 2026-05-12. */
  sectionItems?: Array<{
    id: string
    name: string
    illustration_url: string | null
    description: string | null
    item_type: string
    category?: string
  }>
  /** Badges affichés sur les icônes du rail. Pour Objet : X/Y où X = nb
   *  d'objets posés sur l'image courante, Y = nb total d'objets de la section. */
  railBadges?: Partial<Record<import('./DesignerLeftRail').RailCategory, { positioned: number; total: number }>>
  /** Callback bouton "+ Nouveau" du CatalogObjects v2 — ouvre ItemCreatorModal
   *  en mode création (avec sections_used pré-rempli). */
  onCreateItem?: () => void
  /** Callback crayon sur tile du CatalogObjects v2 — ouvre ItemCreatorModal
   *  en mode édition. */
  onEditItem?: (item: NonNullable<DesignerLayoutProps['sectionItems']>[number]) => void
  /** Callback drop d'une tile Objet sur le canvas. Reçoit l'item id +
   *  position normalized 0..1. Le parent orchestre la pipeline (Kontext si
   *  illustration_url, sinon Qwen Edit) + image-diff + addLayer. */
  onDropItem?: (itemId: string, dropX: number, dropY: number) => Promise<void> | void
  /** Callback "Créer un nouvel objet depuis la découpe" (refonte 2026-05-12).
   *  Reçoit l'URL Supabase du PNG transparent extrait. Le parent ouvre
   *  ItemCreatorModal pré-rempli avec illustration_url = cutImageUrl. */
  onCreateItemFromExtraction?: (cutImageUrl: string) => void
  /** Tous les items du livre (avec flag section courante) pour le picker
   *  d'attachement. Optionnel : si non fourni, on tombe sur sectionItems. */
  allBookItems?: Array<{
    id: string
    name: string
    illustration_url: string | null
    sections_used?: string[]
  }>
  /** Callback après attachement réussi d'une découpe à un item existant.
   *  Reçoit l'itemId + le patch (= la nouvelle illustration_url). Permet
   *  au parent de rafraîchir son state local items[]. */
  onItemUpdatedAfterAttach?: (itemId: string, patch: { illustration_url: string }) => void
  /** Tous les NPCs du livre (depuis API). Source de vérité pour les vignettes
   *  + matching name dans le panneau Personnages (refonte 2026-05-12). */
  bookNpcs?: Npc[]
  /** IDs des NPCs déclarés présents dans la section courante. Source : parsing
   *  du résumé section ("**Persos présents :** ...") résolus contre bookNpcs
   *  côté parent. Utilisé pour la section "non détectés dans le plan" du
   *  panneau Personnages. */
  sectionCharacterIds?: string[]
  /** ID du livre — préfixe storage pour les ré-générations depuis l'édition
   *  fiche perso du drawer Personnages. */
  bookId?: string | null
  /** Catégorie active à l'ouverture initiale du Designer. Permet au parent
   *  d'ouvrir directement le bon catalog selon le kind du plan (ex: plan
   *  animation → 'generate' pour afficher la timeline + drawer animation).
   *  Si non fourni, le Designer s'ouvre sur aucune catégorie active. */
  initialActiveCategory?: RailCategory | null
}

export default function DesignerLayout({
  phase,
  planTitle,
  planSummary,
  returnLabel,
  onReturn,
  children,
  layerTabs,
  actions,
  bankPanel,
  bottomDrawer,
  storagePathPrefix,
  onCommencer,
  commencerEnabled = false,
  commencerLabel = "Commencer l'édition",
  onCommencerAnimation,
  commencerAnimationEnabled = false,
  inspectorTitle,
  inspectorContent,
  onNouvelleBase,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  theme,
  onToggleTheme,
  previewImageUrl,
  previewVideoUrl,
  previewSectionText,
  previewChoices,
  personnageMode = null,
  onAddCharacter,
  bankImages,
  onCreateCharacterFromExtraction,
  sectionChoices,
  sectionNumber,
  sectionItems,
  railBadges,
  onCreateItem,
  onEditItem,
  onDropItem,
  onCreateItemFromExtraction,
  allBookItems,
  onItemUpdatedAfterAttach,
  bookNpcs,
  sectionCharacterIds,
  bookId,
  initialActiveCategory,
}: DesignerLayoutProps) {
  const [activeCategory, setActiveCategory] = useState<RailCategory | null>(initialActiveCategory ?? null)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  // Panneau IA Ctrl+K (refonte 2026-05-12). Indépendant des catégories du
  // rail — un Ctrl+K global l'ouvre, et l'ouverture ferme tout catalog ouvert
  // pour libérer l'espace gauche (le panneau prend ~24rem).
  const [aiPanelOpen, setAiPanelOpen] = useState(false)

  // Modal narratif A/B/C — déclenchée quand l'IA détecte add_object narratif.
  // Cf project_objet_feature_spec.md + decision C 2026-05-13.
  const [narrativeRequest, setNarrativeRequest] = useState<{
    objectName: string
    editPrompt: string
  } | null>(null)

  // Calque actif (0 = Base, 1+ = overlays). Sert au data-active-layer
  // qui pilote la teinte du fond center (rose pour Base, indigo pour Calques).
  const {
    activeLayerIdx,
    imageUrl,
    effectiveImageUrl,
    layers,
    cutTool, cutMode, setCutMode, setLassoDraft,
    wandMasks,
    selectedWandUrls,
    brushStrokes,
    cutResultUrl,
    setCutResult,
    clearWand,
    clearBrushStrokes,
    clearCutResult,
    selectedDetectionId,
    setSelectedDetection,
    bakedCharacterIds,
    // Animation Phase A : timeline + gen LTX
    animationPellicules,
    animationSelectedCharIds,
    updateAnimationPellicule,
    updateAnimationShot,
    setBakeStatus,
    setCurrentVideo,
    currentVideoUrl,
    isAnimationPlaying,  // pour rétracter la bande basse pendant lecture
    sequencePlayheadIdx,  // Phase C : rétracte aussi pendant lecture séquence
    replaceBase,  // utilisé par AICommandBar Qwen edit (refonte 2026-05-11)
  } = useEditorState()
  const { characters } = useCharacterStore()
  // Pellicule en cours de gen LTX (null = aucune). Local au layout, pas
  // partagé via context (1 seule gen à la fois par design).
  const [generatingPelliculeId, setGeneratingPelliculeId] = useState<string | null>(null)
  const [generatingProgressLabel, setGeneratingProgressLabel] = useState('')
  // Hauteur manuelle de la bande basse (px). null = défaut CSS auto-fit.
  // Persisté pendant la session (résiste à open/close du drawer).
  const [animBottomHeightPx, setAnimBottomHeightPx] = useState<number | null>(null)

  // IDs des persos présents dans la scène — UNION de 2 sources :
  // 1. Calques avec character_id renseigné (mode asLayer=true à l'insertion)
  // 2. bakedCharacterIds du state (mode asLayer=false, perso aplati dans base)
  // Cf décision 2026-05-04 (option A : tracking explicite des persos baked).
  const presentCharacterIds = useMemo(() => {
    const fromLayers = layers
      .filter(l => l.character_id != null)
      .map(l => l.character_id!) as string[]
    // Dedupe via Set (évite doublons si un perso est à la fois en calque et baked)
    return Array.from(new Set([...fromLayers, ...bakedCharacterIds]))
  }, [layers, bakedCharacterIds])

  // Persos en scène enrichis pour AIAssistantPanel : id + name + description
  // + thumb (portrait du Character store). Mistral utilise name+description
  // pour matcher "Duke" / "le perso en blanc" → id.
  const aiCharactersInScene = useMemo(
    () => presentCharacterIds
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is Character => !!c)
      .map(c => ({
        id: c.id,
        name: c.name,
        // `prompt` du Character store = description visuelle qui sert à le
        // générer / note libre. Sert à Mistral pour matcher "le perso en blanc"
        // → id quand le user ne nomme pas explicitement le perso.
        description: c.prompt ?? undefined,
        thumbUrl: c.portraitUrl ?? c.fullbodyUrl ?? undefined,
      })),
    [presentCharacterIds, characters],
  )

  // Ctrl+K → ouvre le panneau IA + ferme tout catalog ouvert (les 2 panneaux
  // gauches sont mutuellement exclusifs, sinon ça serre trop). Capture global
  // au layout pour pas dépendre du focus d'un input particulier.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        // Ne pas hijack si l'utilisateur est dans un input/textarea autre que
        // ceux du panneau lui-même (ex: éditeur de description en bas)
        const target = e.target as HTMLElement | null
        const inOwnInput = target?.closest('.dz-ai-panel') != null
        if (inOwnInput) return
        e.preventDefault()
        setActiveCategory(null)
        setAiPanelOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // ── Animation Phase A — handlers play & gen ─────────────────────────────
  // Conditions d'ouverture du bottom (timeline + éditeur) : drawer Animer ouvert
  // (= category 'generate' avec personnageMode='animate', cf DesignerCatalog).
  const isAnimationDrawerOpen = phase === 'editing'
    && activeCategory === 'generate'
    && personnageMode === 'animate'


  /** Lecture isolée d'une pellicule (clic ▶ sur sa vignette). Pousse la vidéo
   *  dans EditorState.currentVideoUrl → Canvas joue automatiquement. */
  function handlePlayPellicule(p: AnimationPellicule) {
    if (!p.videoUrl) return
    setCurrentVideo(p.videoUrl, p.firstFrameUrl, p.lastFrameUrl)
  }

  /** Génération LTX d'une pellicule. Source image résolue selon la table :
   *  pell.firstFrameUrl (re-gen) || prev.lastFrameUrl (continuité) || flatten(base+layers). */
  async function handleGeneratePellicule(pelliculeId: string) {
    const pell = animationPellicules.find(p => p.id === pelliculeId)
    if (!pell) return
    const selectedChars = animationSelectedCharIds
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is Character => !!c)
    if (selectedChars.length === 0) {
      alert('Sélectionne au moins 1 personnage avant de générer.')
      return
    }

    setGeneratingPelliculeId(pelliculeId)
    setGeneratingProgressLabel('Préparation…')
    setBakeStatus({
      startedAt: Date.now(),
      phase: 'Préparation…',
      kind: 'animation',
      estimatedTotalSec: 1020,  // 17 min sur 8 GB
    })
    try {
      // Résolution source image — règle : firstFrame > prev.lastFrame > flatten(base)
      const idx = animationPellicules.findIndex(p => p.id === pelliculeId)
      const prev = idx > 0 ? animationPellicules[idx - 1] : null
      let sourceImage: string
      // Track si on a utilisé prev.lastFrame comme input (= continuité avec
      // la pellicule précédente). Si oui, on force firstFrameUrl = même URL
      // après gen → permet la détection visuelle de continuité par simple
      // comparaison d'URL côté timeline (badge ✓ vs ⚠).
      let usedPrevAsContinuityInput = false
      if (pell.firstFrameUrl) {
        sourceImage = pell.firstFrameUrl
      } else if (prev?.lastFrameUrl) {
        sourceImage = prev.lastFrameUrl
        usedPrevAsContinuityInput = true
      } else if (imageUrl) {
        setGeneratingProgressLabel('Composition de l\'image source…')
        sourceImage = await flattenLayersToImage({
          baseImageUrl: imageUrl,
          layers: layers,
          storagePathPrefix: `studio/animation_source/${Date.now()}`,
        })
      } else {
        throw new Error('Aucune image source : ni base de plan, ni pellicule précédente avec lastFrame.')
      }

      // β.1 lipsync (2026-05-06, multi-shots refacto) : on collecte les
      // dialogues de TOUS les shots de la pellicule, on génère N TTS via
      // les voice_id NPC, on concatène, et on patch les durées des shots
      // selon les TTS mesurés (TTS + 1s par shot, ou 3s si pas de dialogue).
      setGeneratingProgressLabel('Génération des voix…')
      let dialogueAudioUrl: string | undefined
      let computedShotDurations: Record<string, number> | undefined
      try {
        const dialogueResult = await buildDialogueAudio({
          shots: pell.shots,
          characterIds: pell.characterIds,
          // ⚠ characters = TOUT le store (pas selectedChars) : un perso peut
          // être référencé par la pellicule sans être coché globalement.
          characters,
          storagePathPrefix: `studio/animation_dialogue/${pelliculeId}`,
        })
        if (dialogueResult) {
          dialogueAudioUrl = dialogueResult.audioUrl
          computedShotDurations = dialogueResult.shotDurations
          console.log('[DesignerLayout] Dialogue audio généré:', dialogueAudioUrl,
            'segments:', dialogueResult.segments.map(s =>
              `[${s.shotId.slice(-6)}] ${s.charName}: "${s.text}" (${s.durationSec?.toFixed(1)}s)`).join(' / '),
            'shotDurations:', computedShotDurations)
        }
      } catch (err) {
        if (err instanceof MissingVoiceError) {
          alert(`⚠ Voix manquante\n\n${err.message}`)
          return
        }
        throw err
      }

      // Traduction FR→EN des actions de TOUS les shots avant buildVantagePrompt.
      setGeneratingProgressLabel('Traduction des actions…')
      const translatedShots = await Promise.all(pell.shots.map(async (shot) => {
        const translatedPerCharacter: typeof shot.perCharacter = {}
        await Promise.all(Object.entries(shot.perCharacter).map(async ([cid, data]) => {
          let actionEn = data.action
          if (data.action.trim()) {
            try {
              const tRes = await fetch('/api/translate-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: data.action }),
              })
              const tData = await tRes.json() as { text_en?: string; error?: string }
              if (tRes.ok && tData.text_en) actionEn = tData.text_en
            } catch (err) {
              console.warn(`[DesignerLayout] traduction action ${cid} (shot ${shot.id}) échouée, fallback FR:`, err)
            }
          }
          translatedPerCharacter[cid] = { action: actionEn, dialogue: data.dialogue }
        }))
        // Applique aussi la durée calculée par TTS (si disponible) au shot
        const computedDuration = computedShotDurations?.[shot.id]
        return {
          ...shot,
          perCharacter: translatedPerCharacter,
          duration: computedDuration ?? shot.duration,
        }
      }))
      const pellTranslated: typeof pell = { ...pell, shots: translatedShots }

      // Patch les durées calculées sur la pellicule réelle aussi (pour que
      // l'auteur voie les nouvelles durées dans l'éditeur après la gen).
      if (computedShotDurations) {
        pell.shots.forEach(shot => {
          const newDur = computedShotDurations[shot.id]
          if (typeof newDur === 'number' && newDur !== shot.duration) {
            updateAnimationShot(pelliculeId, shot.id, { duration: newDur })
          }
        })
      }

      // ── Description de la scène (β.1+ 2026-05-06) ─────────────────────
      // 1. Résout l'effective (avec héritage pellicule 1)
      // 2. Si scene_visible vide → auto-déclenche Qwen VL sur sourceImage
      //    (l'auteur n'a pas pris la peine de définir → on ne le bloque pas)
      // 3. Auto-Qwen pour characters_appearance aussi si vide (cohérence)
      // 4. Traduit FR→EN ce que l'auteur a saisi à la main (Qwen retourne déjà EN)
      let sceneEffective = resolveEffectiveScene(pell, animationPellicules)
      if (!sceneEffective.scene_visible?.trim()) {
        setGeneratingProgressLabel('Analyse de la scène (Qwen VL)…')
        try {
          const r = await describeSceneViaVision(sourceImage, 'scene')
          sceneEffective = { ...sceneEffective, scene_visible: r.description }
          // Patch silencieusement la pellicule pour que la description soit
          // sauvegardée et visible la prochaine fois (UX : éviter de relancer
          // Qwen à chaque génération).
          updateAnimationPellicule(pelliculeId, { scene_visible: r.description })
        } catch (err) {
          console.warn('[DesignerLayout] Qwen VL scene auto-suggest échoué, fallback prompt minimaliste:', err)
        }
      }
      if (!sceneEffective.characters_appearance?.trim()) {
        setGeneratingProgressLabel('Analyse des personnages (Qwen VL)…')
        try {
          const r = await describeSceneViaVision(sourceImage, 'characters')
          sceneEffective = { ...sceneEffective, characters_appearance: r.description }
          updateAnimationPellicule(pelliculeId, { characters_appearance: r.description })
        } catch (err) {
          console.warn('[DesignerLayout] Qwen VL characters auto-suggest échoué, fallback fiche NPC:', err)
        }
      }
      // Traduction des champs scène saisis à la main (no-op si déjà EN)
      const [sceneVisibleEn, sceneOffscreenEn, charactersAppearanceEn] = await Promise.all([
        sceneEffective.scene_visible ? translateSceneFieldToEn(sceneEffective.scene_visible) : Promise.resolve(null),
        sceneEffective.scene_offscreen ? translateSceneFieldToEn(sceneEffective.scene_offscreen) : Promise.resolve(null),
        sceneEffective.characters_appearance ? translateSceneFieldToEn(sceneEffective.characters_appearance) : Promise.resolve(null),
      ])

      const positivePrompt = buildVantagePrompt(pellTranslated, selectedChars, {
        sceneVisible: sceneVisibleEn,
        sceneOffscreen: sceneOffscreenEn,
        charactersAppearance: charactersAppearanceEn,
      })
      console.log('[DesignerLayout] LTX prompt:', positivePrompt)
      if (dialogueAudioUrl) console.log('[DesignerLayout] LTX mode: custom audio (lipsync)')
      else console.log('[DesignerLayout] LTX mode: foley (no dialogue)')

      const result = await runLtx23Dual({
        imageUrl: sourceImage,
        positivePrompt,
        audioUrl: dialogueAudioUrl,
        seed: -1,
        onProgress: p => setGeneratingProgressLabel(p.label ?? p.stage),
      })

      // Si gen en continuité → on force firstFrameUrl = prev.lastFrameUrl
      // (même URL Supabase) au lieu de la frame extraite par extract-frames.
      // Bénéfice : la timeline détecte la continuité par URL strict equality
      // → badge ✓ apparait entre P_(N-1) et P_N. Micro-jitter au play start
      // possible (LTX peut s'écarter de l'input image), acceptable car LTX
      // est très fidèle en mode I2V.
      updateAnimationPellicule(pelliculeId, {
        videoUrl: result.video_url,
        firstFrameUrl: usedPrevAsContinuityInput
          ? prev!.lastFrameUrl
          : result.first_frame_url,
        lastFrameUrl: result.last_frame_url,
      })
      // Auto-play après gen pour montrer le résultat
      setCurrentVideo(result.video_url, result.first_frame_url, result.last_frame_url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[DesignerLayout] gen pellicule failed:', msg)
      alert('Erreur génération : ' + msg)
    } finally {
      setGeneratingPelliculeId(null)
      setGeneratingProgressLabel('')
      setBakeStatus(null)
    }
  }

  /** Drag handler pour le handle de resize de la bande basse. Drag UP = expand,
   *  DOWN = shrink. Bornes : 9rem (~144px, juste timeline visible) à 80vh.
   *  Listeners attachés à window pour ne pas perdre le drag si le curseur
   *  sort du handle. */
  function handleAnimBottomResize(e: React.MouseEvent) {
    e.preventDefault()
    const startY = e.clientY
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize || '16')
    const minPx = 9 * rootFontSize  // 9rem = juste timeline visible
    // Max = quasi tout l'écran (laisse ~3rem en haut pour la top bar)
    const maxPx = window.innerHeight - (3 * rootFontSize)
    // Hauteur courante : si déjà manuel utiliser, sinon mesurer depuis le DOM
    const startHeight = animBottomHeightPx ?? (() => {
      const el = document.querySelector('.dz-anim-bottom') as HTMLElement | null
      return el?.getBoundingClientRect().height ?? window.innerHeight * 0.38
    })()

    function onMove(ev: MouseEvent) {
      const delta = startY - ev.clientY  // up = positive
      const next = Math.max(minPx, Math.min(maxPx, startHeight + delta))
      setAnimBottomHeightPx(next)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Pré-analyse de l'image courante (opt-in via popup 2026-05-04).
  // Si cache DB existe → load direct (rapide). Sinon → popup demande confirmation
  // utilisateur avant de lancer l'analyse (~50s + BakeProgressModal).
  // Stratégie validée : f_qwen_sam1hq (Florence + Qwen + DINO + SAM 1 HQ).
  // ⚠ ACTIF UNIQUEMENT EN PHASE B (editing) — Phase A = exploration libre.
  const sceneAnalyzePrompt = usePreAnalyzeImage(phase === 'editing')

  // ── Actions secondaires (Copier / Supprimer / Calque / Personnage / Objet)
  // Affichées à droite de l'icône Découper, désactivées tant qu'il n'y a rien
  // à exploiter (= aucune sélection sur le canvas). Les onClick sont stub
  // pour l'instant — la logique sera branchée plus tard.
  const hasExtraction = useMemo(
    () => brushStrokes.length > 0 || selectedWandUrls.length > 0 || wandMasks.length > 0,
    [brushStrokes.length, selectedWandUrls.length, wandMasks.length],
  )
  // Activées si : extraction manuelle en cours OU une détection auto est sélectionnée
  // (clic intérieur sur image découpée par la pré-analyse).
  const actionsEnabled = hasExtraction || !!selectedDetectionId
  /** Click "Créer un personnage" depuis le drawer Découper (refonte 2026-05-09).
   *  Calcule le PNG transparent de la sélection courante (= live preview),
   *  l'upload sur Supabase, puis délègue au parent via callback prop pour
   *  ouvrir le CharacterCreatorModal pré-rempli (analyse portrait/fullbody +
   *  crop portrait depuis fullbody si besoin). */
  async function handleCreateCharacterFromExtraction() {
    if (!effectiveImageUrl) return
    if (!onCreateCharacterFromExtraction) return
    setBakeStatus({
      startedAt: Date.now(),
      kind: 'sam_cut',
      phase: 'Préparation du personnage…',
      estimatedTotalSec: 4,
    })
    try {
      const blobUrl = await buildLivePreviewBlobUrl({
        imageUrl: effectiveImageUrl,
        baseExtractedUrl: cutResultUrl,
        selectedMaskUrls: selectedWandUrls.length > 0
          ? selectedWandUrls
          : wandMasks.map(m => m.url),
        brushStrokes,
      })
      if (!blobUrl) {
        alert('Aucun détourage à exporter — fais d\'abord une sélection.')
        return
      }
      // Convertit blob → bytes → upload Supabase. fetch() lit le blob en
      // mémoire AVANT le revoke → safe.
      const blob = await fetch(blobUrl).then(r => r.blob())
      URL.revokeObjectURL(blobUrl)
      const stableUrl = await uploadBlobAsImage(
        blob,
        `${storagePathPrefix}_extracted_char/${Date.now()}.png`,
      )
      if (!stableUrl) {
        alert('Upload du détourage échoué — vérifie ta connexion et réessaye.')
        return
      }
      onCreateCharacterFromExtraction(stableUrl)
    } catch (err) {
      console.error('[create-char-from-extract] erreur', err)
      alert('Création du perso impossible — détail dans la console.')
    } finally {
      setBakeStatus(null)
    }
  }

  // ── Action "Objet" du drawer Découper (refonte 2026-05-12) ──────────
  // L'auteur a fait une découpe et clique le cube → on extrait le PNG
  // transparent → upload Supabase → ouvre le picker qui propose :
  //   1. Créer un nouvel objet (callback parent → ItemCreatorModal pré-rempli)
  //   2. Attacher à un objet existant (PATCH item.illustration_url)
  const [itemPickerCutUrl, setItemPickerCutUrl] = useState<string | null>(null)
  const [toast, setToast] = useState<HeroToastValue | null>(null)

  async function handleCreateOrAttachItemFromExtraction() {
    if (!effectiveImageUrl) return
    setBakeStatus({
      startedAt: Date.now(),
      kind: 'sam_cut',
      phase: 'Préparation du détourage…',
      estimatedTotalSec: 4,
    })
    try {
      const blobUrl = await buildLivePreviewBlobUrl({
        imageUrl: effectiveImageUrl,
        baseExtractedUrl: cutResultUrl,
        selectedMaskUrls: selectedWandUrls.length > 0
          ? selectedWandUrls
          : wandMasks.map(m => m.url),
        brushStrokes,
      })
      if (!blobUrl) {
        setToast({ message: 'Aucun détourage — fais d\'abord une sélection.', kind: 'error' })
        return
      }
      // Crop au bbox de l'objet (refonte 2026-05-12) — sinon le PNG fait la
      // taille de la scène entière avec l'objet dans un coin = miniature vide.
      let croppedBlob: Blob
      try {
        croppedBlob = await cropAlphaBbox({ imageUrl: blobUrl, padding: 12 })
      } catch (err) {
        // Si crop échoue (image entièrement transparente p.ex.), fallback
        // au blob brut (au moins on a quelque chose à uploader).
        console.warn('[create-or-attach-item] crop bbox failed, fallback raw:', err)
        croppedBlob = await fetch(blobUrl).then(r => r.blob())
      }
      URL.revokeObjectURL(blobUrl)
      const stableUrl = await uploadBlobAsImage(
        croppedBlob,
        `${storagePathPrefix}_extracted_item/${Date.now()}.png`,
      )
      if (!stableUrl) {
        setToast({ message: 'Upload du détourage échoué.', kind: 'error' })
        return
      }
      setItemPickerCutUrl(stableUrl)
    } catch (err) {
      console.error('[create-or-attach-item] erreur', err)
      setToast({ message: 'Extraction impossible — détail dans la console.', kind: 'error' })
    } finally {
      setBakeStatus(null)
    }
  }

  const secondaryActions = useMemo<DesignerSecondaryAction[]>(() => [
    { id: 'copy',     label: 'Copier la découpe',         icon: <Copy size={16} />,    disabled: !actionsEnabled },
    { id: 'delete',   label: 'Supprimer la découpe',      icon: <Trash2 size={16} />,  disabled: !actionsEnabled },
    { id: 'layer',    label: 'Ajouter comme calque',      icon: <Layers size={16} />,  disabled: !actionsEnabled },
    {
      id: 'npc', label: 'Créer un personnage',
      icon: <User size={16} />,
      disabled: !actionsEnabled || !onCreateCharacterFromExtraction,
      onClick: handleCreateCharacterFromExtraction,
    },
    {
      id: 'item', label: 'Attacher à un objet',
      icon: <Package size={16} />,
      disabled: !actionsEnabled,
      onClick: handleCreateOrAttachItemFromExtraction,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [actionsEnabled, onCreateCharacterFromExtraction])

  // Injecte les secondaryActions dans l'action 'decoupe' (les autres actions —
  // Personnage, etc. — n'ont pas de secondaryActions). API per-action vs
  // top-level prop : chaque action déclare ce qui apparaît dans son drawer.
  const actionsWithSecondary = useMemo<DesignerAction[]>(() => {
    if (!actions) return []
    return actions.map(a =>
      a.id === 'decoupe' ? { ...a, secondaryActions } : a
    )
  }, [actions, secondaryActions])

  // Quand on bascule en Phase A : reset l'inspecteur (déplié si on revient en B)
  // et ferme tout catalog ouvert (pas de sens en Phase A).
  useEffect(() => {
    if (phase === 'creation') {
      setActiveCategory(null)
      setInspectorCollapsed(false)
    }
  }, [phase])

  // Au CHANGEMENT de calque actif : reset l'état de découpe complet (sélections
  // marching ants + brush strokes + composite extrait). Chaque calque a sa
  // propre session de découpe — on ne veut pas voir les pointillés du calque
  // précédent quand on switch. Couvre tous les cas (drawer ouvert ou fermé)
  // via un ref qui détecte la transition vraie (pas le mount initial).
  const prevLayerIdxRef = useRef(activeLayerIdx)
  useEffect(() => {
    if (prevLayerIdxRef.current !== activeLayerIdx) {
      clearWand()
      clearBrushStrokes()
      clearCutResult()
    }
    prevLayerIdxRef.current = activeLayerIdx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayerIdx])

  // Refonte 2026-05-09 : à l'arrivée sur un calque extraction, on ferme tout
  // catalogue du RAIL ouvert (Effets, Banques…) — ces catégories sont dimmées
  // sur ce type de calque. ⚠ On ne ferme PAS si activeCategory === 'edit' :
  // le catalog Découpe DOIT rester accessible sur un calque extraction (c'est
  // l'outil principal). Logique déclenchée seulement au changement de calque
  // (via prevLayerIdxRef), pas en boucle, pour ne pas re-fermer la palette
  // Découpe quand l'auteur l'ouvre depuis le calque extraction.
  const isExtractionLayer = layers[activeLayerIdx]?.mode === 'extraction'
  const prevExtractionLayerRef = useRef(isExtractionLayer)
  useEffect(() => {
    const justEntered = isExtractionLayer && !prevExtractionLayerRef.current
    prevExtractionLayerRef.current = isExtractionLayer
    if (justEntered && activeCategory !== null && activeCategory !== 'edit') {
      setActiveCategory(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExtractionLayer])

  // Synchronise le panneau gauche `edit` avec la sélection auto (Scene Analyzer) :
  //   - Sélection détection → panneau s'ouvre (si pas déjà ouvert) pour
  //     exposer la liste des découpes (entrée poussée par overlay via pushWandMask)
  //   - Désélection (clic gomme, click ailleurs, ESC) → panneau se ferme,
  //     wandMasks clearé pour repartir propre. On ne préserve pas l'état
  //     manuel ouvert avant la sélection — c'est conforme à la spec
  //     "drawer/panel se ferme au moment de la désélection".
  // Track "was selection-driven" pour ne fermer que si on a ouvert nous-mêmes.
  const panelOpenedBySelectionRef = useRef(false)
  useEffect(() => {
    if (selectedDetectionId) {
      if (activeCategory !== 'edit') {
        setActiveCategory('edit')
        panelOpenedBySelectionRef.current = true
      }
    } else if (panelOpenedBySelectionRef.current) {
      // On l'avait ouvert auto → on le referme + clear le catalog wandMasks
      setActiveCategory(null)
      clearWand()
      panelOpenedBySelectionRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetectionId])

  function toggleCategory(key: RailCategory) {
    setActiveCategory(prev => (prev === key ? null : key))
  }

  return (
    <AICutCommandProvider onOpenEditCatalog={() => setActiveCategory('edit')}>
    <div
      className="dz-root"
      data-phase={phase}
      data-active-layer={activeLayerIdx === 0 ? 'base' : 'layer'}
    >
      <DesignerTopBar
        planTitle={planTitle}
        planSummary={planSummary}
        returnLabel={returnLabel}
        onReturn={onReturn}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        // En Phase B uniquement : bouton "⟲ Nouvelle base" (équivalent du
        // 🖼 Base d'avant). Phase A n'a pas besoin de ce bouton (on est déjà
        // en train de créer la base).
        onOpenBase={phase === 'editing' ? onNouvelleBase : undefined}
        openBaseLabel="Nouvelle base"
        openBaseVariant="rebase"
        onOpenPreview={() => setPreviewOpen(true)}
        theme={theme}
        onToggleTheme={onToggleTheme}
        // Wire IA edit (Qwen Image Edit) — image courante + callback replace.
        // Si imageUrl absent (Phase A pas encore d'image), bar reste mockée.
        aiEditCurrentImageUrl={imageUrl}
        onAiEditApplied={url => replaceBase(url)}
        aiEditStoragePathPrefix="studio/qwen-edit"
      />

      <div className="dz-body">
        <DesignerLeftRail
          activeCategory={activeCategory}
          onToggleCategory={toggleCategory}
          // En Phase A, seule la banque (1ère icône) est cliquable.
          // Les autres apparaîtront en Phase B.
          phase={phase}
          // Refonte 2026-05-09 : si le calque actif est un calque d'extraction,
          // toutes les catégories du rail sont dimmées (cf DesignerLeftRail).
          extractionMode={layers[activeLayerIdx]?.mode === 'extraction'}
          badges={railBadges}
        />

        {/* Panneau IA (Ctrl+K). Slide depuis la gauche, à droite du rail et
         *  AVANT le bank panel / catalog drawer. Mutuellement exclusif avec
         *  les catalogs (le useEffect Ctrl+K ferme activeCategory). Refonte
         *  2026-05-12. */}
        <AIAssistantPanel
          open={aiPanelOpen}
          onClose={() => setAiPanelOpen(false)}
          currentImageUrl={imageUrl}
          charactersInScene={aiCharactersInScene}
          planSummary={planSummary}
          storagePathPrefix="studio/qwen-edit"
          onEditApplied={url => replaceBase(url)}
          onAddNarrativeObject={({ objectName, editPrompt }) =>
            setNarrativeRequest({ objectName, editPrompt })}
        />

        {/* Modal narratif A/B/C — déclenchée après confirmation IA d'un
         *  add_object narratif (decision C 2026-05-13). Pour V1, les 3 options
         *  exécutent toutes Qwen Edit sur l'image courante. La différence est
         *  uniquement le toast feedback + side-effects (la persistance item
         *  arrivera en V2 avec extraction calque). */}
        <NarrativeChoiceModal
          open={narrativeRequest !== null}
          onClose={() => setNarrativeRequest(null)}
          suggestedObjectName={narrativeRequest?.objectName ?? ''}
          editPrompt={narrativeRequest?.editPrompt ?? ''}
          bankItems={(sectionItems ?? []).map<NarrativeBankItem>(i => ({
            id: i.id,
            name: i.name,
            thumbUrl: i.illustration_url ?? undefined,
          }))}
          onPick={async (choice: NarrativeChoiceResult) => {
            if (!narrativeRequest || !imageUrl) return
            const editPrompt = narrativeRequest.editPrompt
            // Toast initial selon le choix
            const label = choice.kind === 'create_new'
              ? `Création de "${choice.objectName}" + édition…`
              : choice.kind === 'attach_existing'
                ? 'Lien à l\'objet existant + édition…'
                : 'Édition visuelle en cours…'
            setToast({ message: label })
            try {
              const newUrl = await runQwenImageEdit({
                sourceUrl: imageUrl,
                prompt: editPrompt,
                storagePathPrefix: 'studio/qwen-edit',
                useLightning: true,
              })
              replaceBase(newUrl)
              const successLabel = choice.kind === 'create_new'
                ? `Édition appliquée. Création de "${choice.objectName}" → V2 (extraction calque).`
                : choice.kind === 'attach_existing'
                  ? 'Édition appliquée. Lien à l\'objet → V2 (extraction calque).'
                  : 'Édition visuelle appliquée.'
              setToast({ message: successLabel, kind: 'success' })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              setToast({ message: `Édition échouée : ${msg}`, kind: 'error' })
            }
          }}
        />

        {/* Drawer Personnages (refonte 2026-05-12). Ouvert via icône Users
         *  du rail. Section 1 = persos en calque/baked dans CE plan, section 2
         *  = persos déclarés section non encore posés. */}
        <DesignerCharactersDrawer
          open={activeCategory === 'characters'}
          onClose={() => setActiveCategory(null)}
          npcs={bookNpcs ?? []}
          inPlanCharacterIds={new Set(presentCharacterIds)}
          sectionCharacterIds={sectionCharacterIds ?? []}
          bookId={bookId ?? null}
        />

        {/* Phase A : bank panel slide-in juste après le rail */}
        {phase === 'creation' && bankPanel}

        {/* Phase B : catalog ouvre via clic rail. Animation width 0 ↔ 20rem
         * pour que le canvas reclaim/lose space en flex (jamais d'overlap
         * sur l'image, peu importe la taille d'écran). */}
        <AnimatePresence initial={false}>
          {phase === 'editing' && activeCategory && activeCategory !== 'characters' && (
            <motion.div
              key="dz-catalog-anim"
              className="dz-catalog-anim-wrapper"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '20rem', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              <DesignerCatalog
                category={activeCategory}
                onClose={() => setActiveCategory(null)}
                storagePathPrefix={storagePathPrefix}
                personnageMode={personnageMode}
                onAddCharacter={onAddCharacter}
                onNavigateToBanks={() => setActiveCategory('banks')}
                presentCharacterIds={presentCharacterIds}
                bankImages={bankImages}
                sectionItems={sectionItems}
                onCreateItem={onCreateItem}
                onEditItem={onEditItem}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <main className="dz-center">
          {/* Zone canvas : layerTabs (haut) + actions toolbar + children (canvas)
           * Le bouton Commencer flottant reste au-dessus du drawer (pas par-dessus
           * Générer du form) grâce à son ancrage absolu dans cette zone.
           * data-catalog-open : drive le mode mini de la toolbar (labels masqués)
           * quand un catalog drawer gauche est ouvert (cf C+ 2026-05-05). */}
          <div className="dz-canvas-zone" data-catalog-open={!!activeCategory}>
            {/* Bandeau choix de section (read-only) — rappel pour l'auteur
             *  des choix attachés à cette Section. Affiché si au moins
             *  1 choix existe, sur les 2 phases (creation + editing). */}
            {sectionChoices && sectionChoices.length > 0 && (
              <div className="dz-section-choices-banner" role="region" aria-label="Choix de la section">
                <span className="dz-section-choices-label">
                  Choix {sectionNumber != null ? `de §${sectionNumber}` : 'de la section'} :
                </span>
                <div className="dz-section-choices-chips">
                  {sectionChoices.map(c => (
                    <span key={c.id} className="dz-section-choices-chip" title={c.label}>
                      <span className="dz-section-choices-chip-num">{c.sort_order + 1}</span>
                      <span className="dz-section-choices-chip-text">{c.label}</span>
                      <span className="dz-section-choices-chip-target">
                        {c.target_section_number != null ? `→ §${c.target_section_number}` : '→ ?'}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {phase === 'editing' && layerTabs}
            {phase === 'editing' && actionsWithSecondary.length > 0 && (
              <DesignerActionsToolbar
                actions={actionsWithSecondary}
                activeCategory={activeCategory}
                onActionClick={(cat) => setActiveCategory(prev => prev === cat ? null : cat)}
                activeSubToolId={cutMode ? cutTool : null}
                activeLayerIdx={activeLayerIdx}
                // Quand une détection auto est sélectionnée (clic intérieur sur
                // image découpée), force le drawer ouvert + désactive les sub-tools
                // de découpe (créer une nouvelle découpe = hors-sujet quand on
                // opère sur une sélection existante).
                forceOpen={!!selectedDetectionId}
                subToolsDisabled={!!selectedDetectionId}
                onDrawerClose={() => {
                  // Drawer fermé entièrement (re-clic icône Découper, ESC,
                  // catalog fermé, switch de layer…) → abandon total de la
                  // session. Reset tout l'état d'extraction.
                  clearWand()
                  clearBrushStrokes()
                  clearCutResult()
                  setSelectedDetection(null)
                  setCutMode(false)
                  setLassoDraft(null)
                }}
                onSubToolDeselect={() => {
                  // Re-clic sub-tool actif = désactivation LÉGÈRE (refonte
                  // 2026-05-12). Le drawer reste ouvert, l'extraction déjà
                  // réalisée (cutResult, wandMasks, brushStrokes) reste visible
                  // dans le panneau gauche. On nettoie juste la loupe + le
                  // draft polygone en cours.
                  setCutMode(false)
                  setLassoDraft(null)
                }}
              />
            )}
            {/* Drop zone Objet (refonte Objet 2026-05-12 step 7).
             *  Capture les drops de tiles depuis CatalogObjects v2 → orchestre
             *  l'insertion via onDropItem (parent route Kontext/Qwen Edit + extract).
             *  dragOver autorise uniquement notre mime type custom pour ne pas
             *  intercepter les drops natifs (URL/file) qui ont leurs propres
             *  handlers ailleurs. */}
            <div
              className="dz-canvas-drop-zone"
              onDragOver={(e) => {
                if (!onDropItem) return
                if (e.dataTransfer.types.includes('application/x-hero-item-id')) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={(e) => {
                if (!onDropItem) return
                const itemId = e.dataTransfer.getData('application/x-hero-item-id')
                if (!itemId) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                if (rect.width === 0 || rect.height === 0) return
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
                void onDropItem(itemId, x, y)
              }}
            >
              {children}

              {/* Overlay markers Plan choix (refonte 2026-05-11 Step 3d).
               *  Self-gated via useChoicePlan().isPlanChoice — invisible si on
               *  n'est pas sur un Plan choix. Position absolute inset:0 → couvre
               *  toute la zone canvas, markers en % de cette zone. */}
              {phase === 'editing' && <ChoiceMarkersOverlay />}
            </div>

            {phase === 'creation' && (onCommencer || onCommencerAnimation) && (
              <div className="dz-commencer-row">
                {onCommencer && (
                  <button
                    type="button"
                    className="ie-btn ie-btn-primary dz-commencer-btn"
                    onClick={onCommencer}
                    disabled={!commencerEnabled}
                    title={commencerEnabled
                      ? 'Figer cette image comme base et passer à l\'édition'
                      : 'Choisis d\'abord une image dans la banque ou génère-en une'}
                  >
                    <span>{commencerLabel}</span>
                    <ArrowRight size={14} />
                  </button>
                )}
                {onCommencerAnimation && (
                  <button
                    type="button"
                    className="ie-btn ie-btn-primary dz-commencer-btn dz-commencer-btn-anim"
                    onClick={onCommencerAnimation}
                    disabled={!commencerAnimationEnabled}
                    title={commencerAnimationEnabled
                      ? 'Ouvrir le nouvel écran d\'animation (storyboard + shots + lipsync)'
                      : 'Choisis d\'abord une image base'}
                  >
                    <span>🎬 Commencer l&apos;animation</span>
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {phase === 'creation' && bottomDrawer}

          {/* Phase B — bottom area Animation : timeline + éditeur de pellicule.
           * Apparaît quand le drawer Personnage → Animer est ouvert. Cohabite
           * avec le canvas qui reste interactif au-dessus.
           * Hauteur : auto par défaut (max-height 38vh), surchargée si l'utilisateur
           * a redimensionné via le handle (= animBottomHeightPx en px). */}
          <AnimatePresence initial={false}>
            {isAnimationDrawerOpen && (
              <motion.div
                key="dz-anim-bottom"
                className={`dz-anim-bottom${
                  // Auto-expand quand au moins 1 perso sélectionné (= l'auteur
                  // est en train de configurer activement) → max-height passe
                  // de 45vh à 95vh pour quasi-cacher le canvas.
                  // Inactif si :
                  //   - resize manuel via handle (animBottomHeightPx)
                  //   - vidéo en lecture (isAnimationPlaying) → on rétracte
                  //     temporairement pour que le canvas redevienne visible
                  //     pendant la lecture. Remontera auto à la fin (onEnded).
                  //   - mode séquence (sequencePlayheadIdx !== null) → idem
                  //     mais persistant entre 2 pellicules consécutives :
                  //     évite le flicker haut/bas dû aux onPause des <video>
                  //     qui se re-mountent entre 2 pellicules de la séquence.
                  animationSelectedCharIds.length > 0
                    && !animBottomHeightPx
                    && !isAnimationPlaying
                    && sequencePlayheadIdx === null
                    ? ' dz-anim-bottom-expanded'
                    : ''
                }`}
                // Framer ne gère plus que opacity pour enter/exit. La hauteur
                // est 100% pilotée par CSS (flex grow + max-height + transitions
                // sur .dz-anim-bottom) pour éviter le bug de l'inline height en
                // pixels que framer pose quand on anime depuis/vers 'auto', qui
                // bloquait le 2e aller-retour vers le mode static.
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
                style={
                  animBottomHeightPx
                    ? { height: animBottomHeightPx, maxHeight: 'none' }
                    : undefined
                }
              >
                {/* Handle de resize : top edge, drag vertical pour ajuster */}
                <div
                  className="dz-anim-bottom-handle"
                  onMouseDown={handleAnimBottomResize}
                  title="Glisser vers le haut/bas pour redimensionner la zone"
                  role="separator"
                  aria-orientation="horizontal"
                >
                  <div className="dz-anim-bottom-handle-grip" />
                </div>

                <AnimationTimeline onPlayPellicule={handlePlayPellicule} />
                <AnimationEditor
                  onGenerate={handleGeneratePellicule}
                  generatingPelliculeId={generatingPelliculeId}
                  generatingProgressLabel={generatingProgressLabel}
                  storagePathPrefix={storagePathPrefix}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Phase B : inspecteur visible. Phase A : caché via CSS [data-phase].
         *  Refonte 2026-05-09 : également caché en mode extraction — le contenu
         *  (Image / Découpe) duplique ce qui est déjà accessible via les
         *  LayerTabs et la toolbar Découper. Inutile sur ce type de calque. */}
        {!isExtractionLayer && (
          <DesignerInspector
            collapsed={inspectorCollapsed}
            onToggleCollapsed={() => setInspectorCollapsed(c => !c)}
            title={inspectorTitle ?? <span className="dz-inspector-empty">Pas de calque sélectionné</span>}
          >
            {inspectorContent ?? (
              <div className="dz-inspector-empty-body">
                Sélectionne un calque dans les onglets pour voir ses paramètres.
              </div>
            )}
          </DesignerInspector>
        )}
      </div>

      <DesignerPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        imageUrl={previewImageUrl ?? null}
        videoUrl={previewVideoUrl ?? currentVideoUrl ?? null}
        sectionText={previewSectionText}
        choices={previewChoices}
      />

      {/* Popup demande analyse scène (opt-in) — affiché si pas de cache DB
       *  pour l'image courante. Cf usePreAnalyzeImage / SceneAnalysisPrompt. */}
      <SceneAnalysisPrompt
        open={sceneAnalyzePrompt.needsConfirmation}
        onConfirm={sceneAnalyzePrompt.confirm}
        onSkip={sceneAnalyzePrompt.skip}
      />

      {/* Toast feedback (refonte 2026-05-12). Apparaît en bas centre, fade
       *  in/out, auto-dismiss après 2.4s. */}
      <HeroToast toast={toast} onDismiss={() => setToast(null)} />

      {/* ItemAttachmentPickerModal — refonte 2026-05-12. Ouvert au clic
       *  sur l'action secondaire "Objet" du drawer Découper. Propose :
       *  créer un nouvel objet OU attacher à un existant. */}
      {itemPickerCutUrl && (() => {
        const sectionItemIds = new Set((sectionItems ?? []).map(i => i.id))
        const allItems = allBookItems ?? (sectionItems ?? []).map(i => ({
          id: i.id, name: i.name,
          illustration_url: i.illustration_url,
          sections_used: sectionItemIds.has(i.id) ? ['current'] : [],
        }))
        const items: BookItemBrief[] = allItems.map(i => ({
          id: i.id,
          name: i.name,
          illustration_url: i.illustration_url,
          belongsToCurrentSection: sectionItemIds.has(i.id),
        }))
        return (
          <ItemAttachmentPickerModal
            open
            onClose={() => setItemPickerCutUrl(null)}
            bookItems={items}
            cutImageUrl={itemPickerCutUrl}
            onCreateNew={(url) => {
              setItemPickerCutUrl(null)
              onCreateItemFromExtraction?.(url)
            }}
            onAttachToExisting={async (item, cutUrl) => {
              console.log('[item-attach] PATCH /api/items/' + item.id, { illustration_url: cutUrl })
              const res = await fetch(`/api/items/${item.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ illustration_url: cutUrl }),
              })
              const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
              console.log('[item-attach] response', res.status, data)
              if (!res.ok || data?.error) {
                throw new Error(data?.error ?? `HTTP ${res.status}`)
              }
              // Refresh state local côté parent (sinon la tile du panel
              // continue d'afficher l'ancienne image).
              onItemUpdatedAfterAttach?.(item.id, { illustration_url: cutUrl })
              setToast({ message: `Image attachée à "${item.name}"`, kind: 'success' })
            }}
          />
        )
      })()}
    </div>
    </AICutCommandProvider>
  )
}
