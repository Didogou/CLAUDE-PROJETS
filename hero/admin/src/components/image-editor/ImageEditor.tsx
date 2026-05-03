'use client'
/**
 * ImageEditor — éditeur d'image unifié pour tous les contextes du projet.
 *
 * Remplace l'ancien PlanWizard et centralise toutes les éditions d'images.
 *
 * Layout : flex container avec largeurs/hauteurs contrôlées par état React.
 * Les poignées `ResizeHandle` permettent à l'utilisateur de glisser les
 * frontières pour ajuster finement l'espace alloué à chaque panneau, ou de
 * double-cliquer pour basculer replier/étendre avec animation.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import './editor.css'
import Header from './Header'
import Sidebar from './Sidebar'
import Canvas from './Canvas'
import GenerationPanel from './GenerationPanel'
import VariantsGallery, { GalleryRail } from './VariantsGallery'
import ResizeHandle from './ResizeHandle'
import LayerTabs from './LayerTabs'
import BakeProgressModal from './BakeProgressModal'
import { useEditorTheme } from './hooks/useEditorTheme'
import { useImageGeneration, type GenerationRequest } from './hooks/useImageGeneration'
import { EditorStateProvider, useEditorState } from './EditorStateContext'
import type { ImageEditorOpenParams } from './types'

interface ImageEditorProps {
  params: ImageEditorOpenParams | null
}

// Bornes de redimensionnement
const SIDEBAR_MIN = 48
const SIDEBAR_COLLAPSED = 48
const SIDEBAR_DEFAULT = 280
const SIDEBAR_MAX = 480
const SIDEBAR_SNAP_THRESHOLD = 130  // en dessous → snap au rail

const GEN_PANEL_MIN = 48
const GEN_PANEL_COLLAPSED = 48
const GEN_PANEL_DEFAULT = 180
const GEN_PANEL_MAX = 320
const GEN_PANEL_SNAP_THRESHOLD = 100

const GALLERY_WIDTH = 240
const GALLERY_COLLAPSED_WIDTH = 44

export default function ImageEditor({ params }: ImageEditorProps) {
  return (
    <AnimatePresence>
      {params && (
        <EditorStateProvider
          key="editor-state"
          initialImageUrl={params.initialImageUrl ?? null}
          initialLayers={params.initialLayers}
        >
          <ImageEditorInner key="editor" params={params} />
        </EditorStateProvider>
      )}
    </AnimatePresence>
  )
}

// ── Implémentation interne ───────────────────────────────────────────────

function ImageEditorInner({ params }: { params: ImageEditorOpenParams }) {
  const { theme, toggle: toggleTheme } = useEditorTheme()
  const {
    composition, selected, activeLayerIdx, layers,
    imageUrl: currentImageUrl, setImageUrl: setCurrentImageUrl,
    removeNpc, removeItem, removeChoice, removeConversation,
    clearSelected, undo, redo,
  } = useEditorState()

  // Calques Atmosphère : pas de génération IA, donc pas de footer (STYLE /
  // FORMAT / PROMPT / Générer n'ont aucun sens pour un overlay de particules).
  // On cache le panel ET sa poignée de resize → place supplémentaire pour
  // l'image + la sidebar des paramètres.
  const activeLayerIsWeather = !!layers[activeLayerIdx]?.weather
  const [validating, setValidating] = useState(false)

  /** Format sélectionné dans le GenerationPanel (lift au parent pour que
   *  le Canvas adapte le placeholder). */
  const [format, setFormat] = useState<string>('16:9')

  /** Largeur actuelle de la sidebar (en pixels). SIDEBAR_COLLAPSED = rail replié. */
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT)
  /** Hauteur actuelle du panneau de génération (en pixels). */
  const [genPanelHeight, setGenPanelHeight] = useState<number>(GEN_PANEL_DEFAULT)
  /** Gallery variantes repliée en rail (48px) pour laisser plus de place au canvas.
   *  Auto-repliée quand l'utilisateur clique sur un fold sidebar (il a choisi
   *  de passer à l'édition → la génération est en pause). */
  const [galleryCollapsed, setGalleryCollapsed] = useState<boolean>(false)

  const { statuses, isRunning, start: startGeneration } = useImageGeneration()

  // Auto-sélection du 1er 'done' si aucune image
  useEffect(() => {
    if (!currentImageUrl) {
      const firstDone = statuses.find(s => s.stage === 'done' && s.url)
      if (firstDone?.url) setCurrentImageUrl(firstDone.url)
    }
  }, [statuses, currentImageUrl, setCurrentImageUrl])

  // Raccourcis clavier globaux
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignorer quand un input/textarea a le focus (évite conflit avec la saisie)
      const target = e.target as HTMLElement
      const inField = target.matches('input, textarea, select, [contenteditable="true"]')

      // Échap : ferme l'éditeur (sauf pendant génération)
      if (e.key === 'Escape' && !isRunning) {
        e.stopPropagation()
        if (selected.length > 0) { clearSelected(); return }
        params.onClose()
        return
      }

      // Suppr/Backspace : retire le placement sélectionné
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && selected.length > 0) {
        e.preventDefault()
        // On supprime en ordre décroissant pour éviter de casser les index
        const sorted = [...selected].sort((a, b) => b.index - a.index)
        for (const s of sorted) {
          if (s.kind === 'npc') removeNpc(s.index)
          else if (s.kind === 'item') removeItem(s.index)
          else if (s.kind === 'choice') removeChoice(s.index)
          else if (s.kind === 'conversation') removeConversation(s.index)
        }
        clearSelected()
        return
      }

      // Ctrl+Z / Ctrl+Shift+Z : undo / redo
      if ((e.ctrlKey || e.metaKey) && !inField && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }

      // Ctrl+S : Valider (même quand un input a le focus — comportement attendu)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleValidate()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // handleValidate capture currentImageUrl/composition/validating à chaque render,
    // on doit donc re-register le listener quand ces valeurs changent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, isRunning, selected, removeNpc, removeItem, removeChoice, removeConversation, clearSelected, undo, redo, currentImageUrl, composition, validating])

  // ── Callbacks de redimensionnement ─────────────────────────────────────
  //
  // Pendant le drag → on clamp juste [MIN, MAX] sans snap (sinon on ne peut
  // plus déplier depuis le mode replié car le moindre petit delta est
  // écrasé sous le seuil). Au relâchement → on applique le snap si besoin.

  const onResizeSidebar = useCallback((delta: number) => {
    setSidebarWidth(w => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w + delta)))
  }, [])

  const onResizeSidebarEnd = useCallback(() => {
    setSidebarWidth(w => w < SIDEBAR_SNAP_THRESHOLD ? SIDEBAR_COLLAPSED : w)
  }, [])

  const onResizeGenPanel = useCallback((deltaY: number) => {
    // Glisser vers le bas (deltaY > 0) = rétrécir la hauteur (soustraction)
    setGenPanelHeight(h => Math.max(GEN_PANEL_MIN, Math.min(GEN_PANEL_MAX, h - deltaY)))
  }, [])

  const onResizeGenPanelEnd = useCallback(() => {
    setGenPanelHeight(h => h < GEN_PANEL_SNAP_THRESHOLD ? GEN_PANEL_COLLAPSED : h)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarWidth(w => w <= SIDEBAR_COLLAPSED ? SIDEBAR_DEFAULT : SIDEBAR_COLLAPSED)
  }, [])

  const toggleGenPanel = useCallback(() => {
    setGenPanelHeight(h => h <= GEN_PANEL_COLLAPSED ? GEN_PANEL_DEFAULT : GEN_PANEL_COLLAPSED)
  }, [])

  // ── État dérivé ────────────────────────────────────────────────────────

  // On affiche la version "repliée" (rail / bande fine) en dessous du seuil
  // d'affichage. Au-dessus, on montre la version complète — mais pendant un
  // drag, le seuil est plus bas pour éviter le "saut" entre les 2 versions.
  const sidebarCollapsed = sidebarWidth < SIDEBAR_SNAP_THRESHOLD
  const genPanelCollapsed = genPanelHeight < GEN_PANEL_SNAP_THRESHOLD
  const showGallery = statuses.length > 0
  const hasLayerTabs =
    params.target.context === 'plan' ||
    params.target.context === 'transition' ||
    params.target.context === 'return'

  async function handleGenerate(req: GenerationRequest) {
    await startGeneration(req)
  }

  /**
   * Valider : commit final vers le contexte appelant avec l'URL finale et
   * la composition complète. Ferme l'éditeur au succès.
   */
  async function handleValidate() {
    if (!currentImageUrl || validating) return
    setValidating(true)
    try {
      await params.onValidate({
        imageUrl: currentImageUrl,
        imageType: 'plan_standard',   // à étendre selon le Type dropdown de GenerationPanel
        composition,
        layers,
      })
      params.onClose()
    } catch (err) {
      console.error('[ImageEditor] validation failed:', err)
      setValidating(false)
    }
  }

  return (
    <motion.div
      className="image-editor-root"
      data-theme={theme}
      // data-active-layer : 'base' (index 0) ou 'layer' (autres) — CSS teinte
      // le fond de la sidebar légèrement différemment pour signaler le mode
      data-active-layer={activeLayerIdx === 0 ? 'base' : 'layer'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="ie-layout">
        <Header
          params={params}
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={params.onClose}
          onValidate={handleValidate}
          validating={validating}
          canValidate={!!currentImageUrl}
        />

        <div className="ie-body">
          {/* Sidebar avec animation de largeur + double-clic handle = toggle */}
          <motion.div
            animate={{ width: sidebarWidth }}
            transition={{
              type: 'spring',
              stiffness: 280,
              damping: 34,
              mass: 0.9,
            }}
            style={{ flex: '0 0 auto', minWidth: 0 }}
          >
            <Sidebar
              context={params.target.context}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={toggleSidebar}
              npcs={params.npcs ?? []}
              items={params.items ?? []}
              choices={params.choice ? [params.choice] : []}
              imageUrl={currentImageUrl}
              storagePathPrefix={params.storagePathPrefix}
              onImageReplaced={setCurrentImageUrl}
              showViewTabs={hasLayerTabs}
              // Clic utilisateur sur un fold → plier la gallery des variantes
              // pour laisser plus de place au canvas pendant l'édition.
              onUserFoldToggle={() => {
                if (showGallery) setGalleryCollapsed(true)
              }}
            />
          </motion.div>

          <ResizeHandle
            axis="x"
            onResize={onResizeSidebar}
            onResizeEnd={onResizeSidebarEnd}
            onDoubleClick={toggleSidebar}
            ariaLabel="Redimensionner le menu de gauche"
          />

          <div className="ie-center">
            {/* Onglets de calques — alignés au bord du séparateur sidebar/canvas */}
            {(params.target.context === 'plan' || params.target.context === 'transition' || params.target.context === 'return') && (
              <LayerTabs />
            )}

            <Canvas
              imageUrl={currentImageUrl}
              npcs={params.npcs ?? []}
              items={params.items ?? []}
              choices={params.choice ? [params.choice] : []}
              format={format}
            />

            {!activeLayerIsWeather && (
              <ResizeHandle
                axis="y"
                onResize={onResizeGenPanel}
                onResizeEnd={onResizeGenPanelEnd}
                onDoubleClick={toggleGenPanel}
                ariaLabel="Redimensionner le panneau de génération"
              />
            )}

            {/* Panneau génération avec hauteur animée. Masqué sur calque météo
                (pas de sens pour un overlay de particules rendu en JS). */}
            <motion.div
              animate={{ height: activeLayerIsWeather ? 0 : genPanelHeight }}
              transition={{
                type: 'spring',
                stiffness: 280,
                damping: 34,
                mass: 0.9,
              }}
              style={{ flex: '0 0 auto', minHeight: 0, overflow: 'hidden' }}
            >
              <GenerationPanel
                context={params.target.context}
                storagePathPrefix={params.storagePathPrefix}
                onGenerate={handleGenerate}
                isRunning={isRunning}
                initialPrompt={params.initialPrompt}
                initialNegative={params.initialNegative}
                collapsed={genPanelCollapsed}
                onToggleCollapsed={toggleGenPanel}
                format={format}
                onFormatChange={setFormat}
              />
            </motion.div>
          </div>

          {/* Gallery à droite (apparaît quand il y a des variantes).
              Deux états :
                - étendue (GALLERY_WIDTH) : tuiles visibles, sélection directe
                - repliée (GALLERY_COLLAPSED_WIDTH) : rail vertical avec
                  bouton expand + badge du nombre de variantes */}
          {showGallery && (
            <>
              <ResizeHandle
                axis="x"
                onResize={() => {}}       /* pas de resize pour la gallery en v1 */
                ariaLabel="Séparateur gallery"
              />
              <motion.div
                animate={{ width: galleryCollapsed ? GALLERY_COLLAPSED_WIDTH : GALLERY_WIDTH }}
                transition={{ type: 'spring', stiffness: 280, damping: 34, mass: 0.9 }}
                style={{ flex: '0 0 auto', minWidth: 0, overflow: 'hidden' }}
              >
                {galleryCollapsed ? (
                  <GalleryRail
                    count={statuses.filter(s => s.stage === 'done').length}
                    onExpand={() => setGalleryCollapsed(false)}
                  />
                ) : (
                  <VariantsGallery
                    variants={statuses}
                    selectedUrl={currentImageUrl}
                    onSelect={url => {
                      setCurrentImageUrl(url)
                      // Sélection → collapse le panneau génération pour maximiser
                      // la surface canvas (l'utilisateur a choisi sa variante,
                      // la génération est en pause). Double-clic sur la poignée
                      // ou le chevron du panneau pour le ré-étendre.
                      setGenPanelHeight(GEN_PANEL_COLLAPSED)
                    }}
                    onCollapse={() => setGalleryCollapsed(true)}
                  />
                )}
              </motion.div>
            </>
          )}
        </div>
      </div>

      {/* Modal plein-écran pendant un bake animation — bloque tous les clics
          pour éviter que l'utilisateur change de fold/calque et perde le state
          local du bouton Générer pendant que le GPU tourne. */}
      <BakeProgressModal />
    </motion.div>
  )
}
