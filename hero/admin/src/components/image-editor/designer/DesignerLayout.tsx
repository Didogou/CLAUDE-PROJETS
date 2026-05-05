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
import { buildVantagePrompt } from '@/lib/ltx-vantage-prompt'
import { runLtx23Dual } from '@/lib/comfyui-ltx-dual'
import { flattenLayersToImage } from '@/lib/flatten-layers'
import { useCharacterStore } from '@/lib/character-store'
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
  previewSectionText?: string
  previewChoices?: Array<{ id: string; label: string }>

  /** Phase B — Mode actif sur l'action Personnage (drive le contenu rendu
   *  dans le catalog 'generate'). null = pas d'action Personnage active. */
  personnageMode?: PersonnageMode
  /** Phase B — Callback "Ajouter ce perso à la scène" depuis CatalogCharacters. */
  onAddCharacter?: (character: Character, placementPrompt: string, asLayer: boolean) => Promise<void> | void
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
  previewSectionText,
  previewChoices,
  personnageMode = null,
  onAddCharacter,
}: DesignerLayoutProps) {
  const [activeCategory, setActiveCategory] = useState<RailCategory | null>(null)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Calque actif (0 = Base, 1+ = overlays). Sert au data-active-layer
  // qui pilote la teinte du fond center (rose pour Base, indigo pour Calques).
  const {
    activeLayerIdx,
    imageUrl,
    layers,
    cutTool,
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
    setBakeStatus,
    setCurrentVideo,
    isAnimationPlaying,  // pour rétracter la bande basse pendant lecture
    sequencePlayheadIdx,  // Phase C : rétracte aussi pendant lecture séquence
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
   *  pell.firstFrameUrl (re-gen) || prev.lastFrameUrl (continuité) || flatten(base+layers).
   *  Skip si type !== 'animation' (image_static n'a pas de gen, conversation pas implémentée). */
  async function handleGeneratePellicule(pelliculeId: string) {
    const pell = animationPellicules.find(p => p.id === pelliculeId)
    if (!pell) return
    if (pell.type !== 'animation') {
      console.warn('[DesignerLayout] gen ignoré : pellicule type =', pell.type)
      return
    }
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

      const positivePrompt = buildVantagePrompt(pell, selectedChars)
      console.log('[DesignerLayout] LTX prompt:', positivePrompt)

      const result = await runLtx23Dual({
        imageUrl: sourceImage,
        positivePrompt,
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
  const secondaryActions = useMemo<DesignerSecondaryAction[]>(() => [
    { id: 'copy',     label: 'Copier la découpe',         icon: <Copy size={16} />,    disabled: !actionsEnabled },
    { id: 'delete',   label: 'Supprimer la découpe',      icon: <Trash2 size={16} />,  disabled: !actionsEnabled },
    { id: 'layer',    label: 'Ajouter comme calque',      icon: <Layers size={16} />,  disabled: !actionsEnabled },
    { id: 'npc',      label: 'Créer un personnage',       icon: <User size={16} />,    disabled: !actionsEnabled },
    { id: 'item',     label: 'Créer un objet',            icon: <Package size={16} />, disabled: !actionsEnabled },
  ], [actionsEnabled])

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
      />

      <div className="dz-body">
        <DesignerLeftRail
          activeCategory={activeCategory}
          onToggleCategory={toggleCategory}
          // En Phase A, seule la banque (1ère icône) est cliquable.
          // Les autres apparaîtront en Phase B.
          phase={phase}
        />

        {/* Phase A : bank panel slide-in juste après le rail */}
        {phase === 'creation' && bankPanel}

        {/* Phase B : catalog ouvre via clic rail. Animation width 0 ↔ 20rem
         * pour que le canvas reclaim/lose space en flex (jamais d'overlap
         * sur l'image, peu importe la taille d'écran). */}
        <AnimatePresence initial={false}>
          {phase === 'editing' && activeCategory && (
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
            {phase === 'editing' && layerTabs}
            {phase === 'editing' && actionsWithSecondary.length > 0 && (
              <DesignerActionsToolbar
                actions={actionsWithSecondary}
                activeCategory={activeCategory}
                onActionClick={(cat) => setActiveCategory(prev => prev === cat ? null : cat)}
                activeSubToolId={cutTool}
                activeLayerIdx={activeLayerIdx}
                // Quand une détection auto est sélectionnée (clic intérieur sur
                // image découpée), force le drawer ouvert + désactive les sub-tools
                // de découpe (créer une nouvelle découpe = hors-sujet quand on
                // opère sur une sélection existante).
                forceOpen={!!selectedDetectionId}
                subToolsDisabled={!!selectedDetectionId}
                onDrawerClose={() => {
                  // Le user a fermé le drawer = abandon de la session de
                  // découpe. On reset tout l'état d'extraction (sélections
                  // + composite) ET la sélection de détection auto.
                  clearWand()
                  clearBrushStrokes()
                  clearCutResult()
                  setSelectedDetection(null)
                }}
              />
            )}
            {children}

            {phase === 'creation' && onCommencer && (
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
                initial={{ height: 0, opacity: 0 }}
                animate={{
                  height: animBottomHeightPx ?? 'auto',
                  opacity: 1,
                }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.65, ease: [0.22, 0.61, 0.36, 1] }}
                style={animBottomHeightPx ? { maxHeight: 'none' } : undefined}
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

        {/* Phase B : inspecteur visible. Phase A : caché via CSS [data-phase] */}
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
      </div>

      <DesignerPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        imageUrl={previewImageUrl ?? null}
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
    </div>
    </AICutCommandProvider>
  )
}
