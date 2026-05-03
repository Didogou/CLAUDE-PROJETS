'use client'
/**
 * Overlay qui dessine les placements (NPCs, items, choix, conversations) sur
 * l'image du Canvas. Gère drag-to-reposition et scroll-to-resize par sprite.
 *
 * Le rendu utilise une couche `position: absolute` par-dessus l'image dont la
 * taille réelle d'affichage est mesurée via ResizeObserver (la taille change
 * quand l'utilisateur redimensionne les panneaux).
 *
 * Les coordonnées internes sont sphériques (theta/phi) : on convertit en
 * pixels à l'affichage, pour que les placements restent corrects si la taille
 * de l'image change.
 */
import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Npc, Item, Choice } from '@/types'
import { resolveNpcImageUrl } from '@/components/wizard/helpers/npcImageVariant'
import { sphericalToPx, pxToSpherical, spritePxSize } from './helpers/coords'
import { useEditorState, type SelectedPlacement, type BrushStroke } from './EditorStateContext'
import { useAICutCommandOptional } from './AICutCommandContext'
import type { WeatherBrushStroke, WeatherRectShape, WeatherZone } from './types'
// ZOOM_LOUPE_START — module isolé, supprimer ce bloc + le JSX en bas pour désactiver
import ZoomLoupe from './ZoomLoupe'
// ZOOM_LOUPE_END

interface CanvasOverlayProps {
  /** Ref de l'élément <img> à surcouchir. */
  imgRef: React.RefObject<HTMLImageElement | null>
  /** NPCs du livre pour résoudre les portraits. */
  npcs: Npc[]
  /** Items du livre pour résoudre illustrations (items placés avec item_id DB). */
  items: Item[]
  /** Choix de la section pour récupérer les labels (texte affiché côté joueur). */
  choices: Choice[]
  /** Callback désélectionner — appelé au clic dans le vide. */
  onClickEmpty?: () => void
}

interface Rect { w: number; h: number; left: number; top: number }

export default function CanvasOverlay({ imgRef, npcs, items, choices, onClickEmpty }: CanvasOverlayProps) {
  const {
    composition, selected, setSelected, toggleSelected, isSelected,
    updateNpc, removeNpc, updateItem, removeItem, updateChoice, removeChoice,
    cutMode, cutSelection, setCutSelection, setCutDragging,
    wandMasks, currentMaskUrl, selectedWandUrls, toggleWandSelection,
    cutTool, brushStrokes, brushSize, brushMode, addBrushStroke,
    setPixelPick,
    lassoDraft, lassoAddPoint, lassoClose, setLassoDraft,
    layers, activeLayerIdx, updateLayer, editingWeatherZone, activeImpactZoneId,
    weatherBrushEngaged, setWeatherBrushEngaged,
    imageUrl, // ZOOM_LOUPE — needed by <ZoomLoupe />, can be removed if loupe is removed
    zoomLoupeManualOpen, setZoomLoupeManualOpen,
  } = useEditorState()

  // AI Cut Command preview state — utilisé pour rendre les marching ants
  // de la découpe IA AVANT validation (différent visuel des wandMasks
  // committés). Optional : null si pas dans un AICutCommandProvider.
  const aiCut = useAICutCommandOptional()
  const aiCutPreview = aiCut?.status.phase === 'preview' ? aiCut.status : null

  // Position souris en coords normalisées 0-1 — utile pour rendre la ligne
  // "live" entre le dernier point lasso et le curseur (lasso polygonal).
  const [lassoCursor, setLassoCursor] = React.useState<{ x: number; y: number } | null>(null)

  // Calque météo actif : on dérive la zone cible (main ou impact) selon le
  // flag `editingWeatherZone` + `activeImpactZoneId` du context. Plusieurs
  // zones d'impact peuvent coexister → on route vers celle identifiée par id.
  const activeLayer = layers[activeLayerIdx]
  const weather = activeLayer?.weather
  const activeImpactEntry = weather && editingWeatherZone === 'impact' && activeImpactZoneId
    ? (weather.impactZones ?? []).find(z => z.id === activeImpactZoneId)
    : undefined
  const targetZone = weather
    ? (editingWeatherZone === 'impact'
        ? (activeImpactEntry?.zone ?? { mode: 'full' as const })
        : weather.zone)
    : undefined
  const weatherZoneMode = targetZone?.mode
  // Pinceau ET Rectangle nécessitent maintenant l'engagement explicite
  // (clic sur le bouton tool). Sans ça, le preview canvas resterait visible
  // en permanence dès qu'un calque est en mode rect/brush, masquant l'image
  // quand l'utilisateur navigue dans d'autres folds.
  const weatherRectActive = !cutMode && !!weather && weatherZoneMode === 'rect' && weatherBrushEngaged
  const weatherBrushActive = !cutMode && !!weather && weatherZoneMode === 'brush' && weatherBrushEngaged
  // Couleur du preview selon la zone en édition — teal pour la zone principale,
  // orange pour la zone des impacts. Propagée dans les styles du rectangle,
  // du cercle curseur et du canvas brush preview.
  const weatherAccent = editingWeatherZone === 'impact' ? '#F59E0B' : '#4ed5d5'

  // ESC ferme la ZoomLoupe ouverte manuellement (via le bouton dédié).
  // Ne ferme QUE le manual open — les autres triggers (Lasso, Brush, weather)
  // gèrent leur propre cycle de vie indépendamment.
  useEffect(() => {
    if (!zoomLoupeManualOpen) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setZoomLoupeManualOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [zoomLoupeManualOpen, setZoomLoupeManualOpen])

  // Helper local : hex #RRGGBB → rgba(r,g,b,a) pour les styles inline.
  // (La fonction hexToRgba en bas du fichier est pour les ctx canvas.)
  function hexToRgbaStyle(hex: string, alpha: number): string {
    const clean = hex.replace('#', '')
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  /** Cache pixels des masks SAM pour détection de hover (foreground check).
   *  Clés = URL du mask. Chargé en parallèle quand wandMasks change. */
  const wandPixelsRef = useRef<Map<string, { width: number; height: number; pixels: Uint8ClampedArray; area: number }>>(new Map())
  const [hoveredMaskUrl, setHoveredMaskUrl] = useState<string | null>(null)
  const [rect, setRect] = useState<Rect>({ w: 0, h: 0, left: 0, top: 0 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  /** Multi-drag : on enregistre les positions de départ de TOUS les sélectionnés
   *  pour pouvoir leur appliquer le même delta (déplacement groupé). */
  const dragRef = useRef<{
    startX: number
    startY: number
    starts: { kind: SelectedPlacement['kind']; index: number; theta: number; phi: number }[]
  } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; startScale: number; anchorX: number; anchorY: number; startDist: number; index: number; kind: 'npc' | 'item' } | null>(null)
  const cutDragRef = useRef<{ startX: number; startY: number } | null>(null)
  // Brush : canvas de rendu (résolution naturelle image) + stroke en cours +
  // position curseur (pour afficher le cercle de la pointe du pinceau).
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null)
  /** Stroke en cours de construction (mousedown → mousemove → mouseup).
   *  Stocké dans un ref pour éviter les re-render par frame de drag. */
  const currentStrokeRef = useRef<BrushStroke | null>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  // Météo — zone rectangle : drag en cours
  const weatherRectDragRef = useRef<{ startX: number; startY: number } | null>(null)
  // Météo — zone pinceau : stroke en cours + canvas de preview
  const weatherBrushCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const weatherStrokeRef = useRef<WeatherBrushStroke | null>(null)

  // Observe la taille ET la position d'affichage de l'image. Quand les panneaux
  // sont redimensionnés, la taille change → ResizeObserver met à jour. Pour la
  // position (offsetLeft/offsetTop), on met aussi à jour à chaque resize de
  // l'image elle-même.
  // Auto-désengagement du tool de zone (pinceau/rectangle) quand l'utilisateur
  // change de calque actif ou de zone d'impact ciblée — sinon le preview canvas
  // (rose/orange) resterait visible et masquerait l'image quand on navigue
  // dans Base ou un autre fold.
  useEffect(() => {
    setWeatherBrushEngaged(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayerIdx, activeImpactZoneId, editingWeatherZone])

  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    function measure() {
      if (!el) return
      setRect({
        w: el.clientWidth,
        h: el.clientHeight,
        left: el.offsetLeft,
        top: el.offsetTop,
      })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Aussi observer le parent (quand on redimensionne le canvas lui-même)
    if (el.parentElement) ro.observe(el.parentElement)
    measure()
    // Fallback : au cas où le layout bouge sans resize observable (rare)
    const raf = requestAnimationFrame(measure)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [imgRef])

  const size = { w: rect.w, h: rect.h }

  function getPlacementCoords(sel: SelectedPlacement): { theta: number; phi: number } | null {
    if (sel.kind === 'npc') {
      const p = composition.npcs[sel.index]
      return p ? { theta: p.theta, phi: p.phi } : null
    }
    if (sel.kind === 'item') {
      const p = composition.items[sel.index]
      return p ? { theta: p.theta, phi: p.phi } : null
    }
    if (sel.kind === 'choice') {
      const p = (composition.choices ?? [])[sel.index]
      return p ? { theta: p.theta, phi: p.phi } : null
    }
    return null
  }

  function onMouseDownPlacement(e: React.MouseEvent, sel: SelectedPlacement) {
    e.stopPropagation()

    // Détermine la sélection finale après ce clic
    let finalSelected: SelectedPlacement[]
    if (e.shiftKey) {
      // Shift+clic : toggle dans la multi-sélection
      const exists = isSelected(sel)
      finalSelected = exists
        ? selected.filter(s => !(s.kind === sel.kind && s.index === sel.index))
        : [...selected, sel]
      setSelected(finalSelected)
    } else {
      // Clic simple :
      //  - si déjà dans une multi-sélection → garde la multi (pour drag groupé)
      //  - sinon → remplace par sélection unique
      if (isSelected(sel) && selected.length > 1) {
        finalSelected = selected
      } else {
        finalSelected = [sel]
        setSelected([sel])
      }
    }

    // Démarre le drag avec les positions de départ de TOUS les sélectionnés finaux
    const starts = finalSelected
      .map(s => {
        const c = getPlacementCoords(s)
        return c ? { kind: s.kind, index: s.index, theta: c.theta, phi: c.phi } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (starts.length === 0) return

    dragRef.current = { startX: e.clientX, startY: e.clientY, starts }
  }

  function onMouseMove(e: React.MouseEvent) {
    // Cut mode : drag pour créer/étendre un rectangle de sélection
    if (cutDragRef.current && containerRef.current && rect.w > 0) {
      const box = containerRef.current.getBoundingClientRect()
      const curX = e.clientX - box.left
      const curY = e.clientY - box.top
      const x1 = Math.max(0, Math.min(rect.w, Math.min(cutDragRef.current.startX, curX))) / rect.w
      const y1 = Math.max(0, Math.min(rect.h, Math.min(cutDragRef.current.startY, curY))) / rect.h
      const x2 = Math.max(0, Math.min(rect.w, Math.max(cutDragRef.current.startX, curX))) / rect.w
      const y2 = Math.max(0, Math.min(rect.h, Math.max(cutDragRef.current.startY, curY))) / rect.h
      setCutSelection({ x1, y1, x2, y2 })
      return
    }

    // Resize en priorité si une poignée est active (NPC ou item)
    if (resizeRef.current && containerRef.current) {
      const r = resizeRef.current
      const rect = containerRef.current.getBoundingClientRect()
      const curX = e.clientX - rect.left
      const curY = e.clientY - rect.top
      const curDist = Math.hypot(curX - r.anchorX, curY - r.anchorY)
      if (r.startDist > 0) {
        const ratio = curDist / r.startDist
        const newScale = Math.max(0.1, Math.min(3, r.startScale * ratio))
        if (r.kind === 'npc') updateNpc(r.index, { scale: newScale })
        else if (r.kind === 'item') updateItem(r.index, { scale: newScale })
      }
      return
    }
    if (!dragRef.current || !containerRef.current || size.w === 0) return

    // Delta global appliqué à TOUS les éléments du groupe sélectionné
    const dx = (e.clientX - dragRef.current.startX) / size.w
    const dy = (e.clientY - dragRef.current.startY) / size.h

    for (const start of dragRef.current.starts) {
      const rawTheta = start.theta + dx * 360
      const rawPhi = start.phi - dy * 180
      const { x: rawX, y: rawY } = sphericalToPx(rawTheta, rawPhi, size.w, size.h)

      // Margin par type pour clamp dans l'image
      let marginX = 0, marginTop = 0, marginBottom = 0
      if (start.kind === 'npc') {
        const p = composition.npcs[start.index]
        if (!p) continue
        const sSize = spritePxSize(p.scale, size.h)
        marginX = sSize * 0.3; marginTop = sSize * 0.8; marginBottom = sSize * 0.2
      } else if (start.kind === 'item') {
        const p = composition.items[start.index]
        if (!p) continue
        const sSize = spritePxSize(p.scale, size.h)
        marginX = sSize * 0.4; marginTop = sSize * 0.4; marginBottom = sSize * 0.4
      }

      const clampedX = Math.max(marginX, Math.min(size.w - marginX, rawX))
      const clampedY = Math.max(marginTop, Math.min(size.h - marginBottom, rawY))
      const { theta, phi } = pxToSpherical(clampedX, clampedY, size.w, size.h)

      if (start.kind === 'npc') updateNpc(start.index, { theta, phi })
      else if (start.kind === 'item') updateItem(start.index, { theta, phi })
      else if (start.kind === 'choice') updateChoice(start.index, { theta, phi })
    }
  }

  function onMouseUp() {
    dragRef.current = null
    resizeRef.current = null
    if (cutDragRef.current) {
      // Release du drag-to-rect → signale au FoldCut de lancer SAM
      cutDragRef.current = null
      setCutDragging(false)
    }
  }

  /**
   * Démarre un drag-to-select en mode cut : clic sur la zone vide de l'image
   * quand le fold Découpe est actif. Coordonnées stockées en pixels (relatives
   * au containerRef) pendant le drag, converties en normalisées (0-1) pour
   * le state cutSelection.
   */
  /**
   * Magic Wand : un simple click sur l'image — pas de drag.
   * On stocke les coords normalisées 0-1 dans pixelPick (CatalogEdit écoute
   * et déclenche le floodFill via la lib magic-wand-tool).
   */
  function onClickMagicWand(e: React.MouseEvent) {
    if (!containerRef.current) return
    const box = containerRef.current.getBoundingClientRect()
    const x01 = (e.clientX - box.left) / rect.w
    const y01 = (e.clientY - box.top) / rect.h
    if (x01 < 0 || x01 > 1 || y01 < 0 || y01 > 1) return
    setPixelPick({ x: x01, y: y01, ts: Date.now() })
  }

  /** Distance² seuil (coords normalisées 0-1) pour considérer le curseur "près
   *  du point de départ" et auto-fermer le lasso. 0.025² ≈ 2.5% de la diagonale. */
  const LASSO_CLOSE_DIST_SQ = 0.025 * 0.025

  /**
   * Lasso polygonal — chaque click ajoute un point. Le polygone se ferme :
   *   • soit par double-clic (n'importe où, ≥3 points)
   *   • soit par clic sur le 1er point (≤2.5% de distance, ≥3 points)
   *
   * Le 2e click pendant un dblclick ne doit PAS ajouter un point dupliqué (Fix
   * react : onClick fire 2x avant onDoubleClick — on detecte via detail).
   */
  function onClickLassoPoly(e: React.MouseEvent) {
    if (!containerRef.current) return
    const box = containerRef.current.getBoundingClientRect()
    const x01 = (e.clientX - box.left) / rect.w
    const y01 = (e.clientY - box.top) / rect.h
    if (x01 < 0 || x01 > 1 || y01 < 0 || y01 > 1) return
    if (e.detail >= 2) {
      // Double-click → ferme le polygone (si au moins 3 points)
      if (lassoDraft && lassoDraft.points.length >= 3) {
        lassoClose()
      }
      return
    }
    // Clic près du 1er point (≥3 points existants) → ferme aussi
    if (lassoDraft && lassoDraft.points.length >= 3) {
      const first = lassoDraft.points[0]
      const dx = x01 - first.x
      const dy = y01 - first.y
      if (dx * dx + dy * dy < LASSO_CLOSE_DIST_SQ) {
        lassoClose()
        return
      }
    }
    lassoAddPoint({ x: x01, y: y01 })
  }

  /**
   * Lasso libre — drag continu = ajout de points pendant le mousemove.
   * Le polygone se ferme :
   *   • soit en relâchant la souris (mouseup)
   *   • soit en revenant près du point de départ pendant le drag (≥10 points)
   */
  function onMouseDownLassoFree(e: React.MouseEvent) {
    if (!containerRef.current) return
    const box = containerRef.current.getBoundingClientRect()
    const x01 = (e.clientX - box.left) / rect.w
    const y01 = (e.clientY - box.top) / rect.h
    if (x01 < 0 || x01 > 1 || y01 < 0 || y01 > 1) return
    // Reset draft + premier point
    setLassoDraft({ points: [{ x: x01, y: y01 }], mode: 'lasso_free', closed: false })
    setCutDragging(true)

    // Capture locale du point de départ pour la détection auto-close + counter
    // local (les useState sont stale dans cette closure).
    const startX = x01
    const startY = y01
    let pointCount = 1
    let closed = false

    function finish() {
      if (closed) return
      closed = true
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setCutDragging(false)
      lassoClose()
    }

    function onMove(ev: MouseEvent) {
      if (!containerRef.current || closed) return
      const b = containerRef.current.getBoundingClientRect()
      const nx = (ev.clientX - b.left) / rect.w
      const ny = (ev.clientY - b.top) / rect.h
      const cx = Math.max(0, Math.min(1, nx))
      const cy = Math.max(0, Math.min(1, ny))
      // Auto-close si retour près du point de départ (≥10 points pour éviter
      // de fermer immédiatement sur les premiers pixels de mouvement).
      if (pointCount >= 10) {
        const dx = cx - startX
        const dy = cy - startY
        if (dx * dx + dy * dy < LASSO_CLOSE_DIST_SQ) {
          finish()
          return
        }
      }
      lassoAddPoint({ x: cx, y: cy })
      pointCount++
    }
    function onUp() { finish() }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function onMouseDownCutCreate(e: React.MouseEvent) {
    if (!cutMode || !containerRef.current) return
    const box = containerRef.current.getBoundingClientRect()
    cutDragRef.current = {
      startX: e.clientX - box.left,
      startY: e.clientY - box.top,
    }
    // Signale le début du drag — le FoldCut attend `cutDragging === false`
    // avant de déclencher SAM (évite de partir après chaque pixel de mouvement).
    setCutDragging(true)
    setCutSelection({
      x1: (e.clientX - box.left) / rect.w,
      y1: (e.clientY - box.top) / rect.h,
      x2: (e.clientX - box.left) / rect.w,
      y2: (e.clientY - box.top) / rect.h,
    })
    // Listener window pour finaliser le drag même si le release se fait hors
    // du canvas (le user tire vers le bord et relâche à côté).
    const handleWindowUp = () => {
      if (cutDragRef.current) {
        cutDragRef.current = null
        setCutDragging(false)
      }
      window.removeEventListener('mouseup', handleWindowUp)
    }
    window.addEventListener('mouseup', handleWindowUp)
  }

  /**
   * Démarre un resize par poignée : on enregistre la distance initiale
   * cursor→anchor, puis on applique la ratio de changement comme facteur
   * multiplicatif sur le scale. Indépendant du coin choisi.
   */
  function onMouseDownResizeHandle(e: React.MouseEvent, index: number, kind: 'npc' | 'item' = 'npc') {
    e.stopPropagation()
    e.preventDefault()
    if (!containerRef.current) return
    const p = kind === 'npc' ? composition.npcs[index] : composition.items[index]
    if (!p) return
    const rect = containerRef.current.getBoundingClientRect()
    const anchor = sphericalToPx(p.theta, p.phi, size.w || 1, size.h || 1)
    const curX = e.clientX - rect.left
    const curY = e.clientY - rect.top
    const startDist = Math.hypot(curX - anchor.x, curY - anchor.y)
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScale: p.scale,
      anchorX: anchor.x,
      anchorY: anchor.y,
      startDist,
      index,
      kind,
    }
  }

  function onWheelPlacement(e: React.WheelEvent, sel: SelectedPlacement) {
    e.preventDefault()
    e.stopPropagation()
    if (sel.kind !== 'npc') return
    const p = composition.npcs[sel.index]
    if (!p) return
    const delta = e.deltaY < 0 ? 1.08 : 1 / 1.08
    updateNpc(sel.index, { scale: Math.max(0.1, Math.min(3, p.scale * delta)) })
  }

  function onContextMenuPlacement(e: React.MouseEvent, sel: SelectedPlacement) {
    e.preventDefault()
    e.stopPropagation()
    if (sel.kind === 'npc') removeNpc(sel.index)
    else if (sel.kind === 'item') removeItem(sel.index)
    else if (sel.kind === 'choice') removeChoice(sel.index)
  }

  function onClickEmptyInternal(e: React.MouseEvent) {
    // En mode cut avec wandMasks → clic = sélection de l'objet hover
    if (cutMode && wandMasks.length > 0) {
      onClickWand(e)
      return
    }
    // En édition de zone météo (rect ou brush) : le mouseup final déclenche
    // ce onClick — on NE veut PAS fermer les folds sidebar après avoir tracé
    // une zone (sinon le menu Atmosphère se replie et l'utilisateur doit le
    // rouvrir pour ajuster les sliders).
    if (weatherRectActive || weatherBrushActive) return
    // Clic sur le container mais pas sur un sprite → désélection (hors mode cut)
    if (e.target === e.currentTarget && !cutMode) {
      onClickEmpty?.()
    }
  }

  function onMouseDownContainer(e: React.MouseEvent) {
    if (e.target !== e.currentTarget || e.button !== 0) return
    // Priorité 1 : mode Découpe (SAM/Pinceau/Magic Wand/GrabCut) si actif
    if (cutMode) {
      if (cutTool === 'brush') {
        onMouseDownBrush(e)
        return
      }
      if (cutTool === 'magic_wand' || cutTool === 'sam_prompt') {
        // Magic Wand & SAM Prompt-point : pas de drag, juste un clic-pixel
        // → CatalogEdit dispatch sur le bon helper (floodFill ou samPrompt)
        onClickMagicWand(e)
        return
      }
      if (cutTool === 'lasso_poly') {
        onClickLassoPoly(e)
        return
      }
      if (cutTool === 'lasso_free') {
        onMouseDownLassoFree(e)
        return
      }
      // 'wand' (SAM Auto) et 'grabcut' partagent le même drag-rectangle
      if (wandMasks.length === 0 && !currentMaskUrl) onMouseDownCutCreate(e)
      return
    }
    // Priorité 2 : édition de zone d'un calque météo
    if (weatherRectActive) { onMouseDownWeatherRect(e); return }
    if (weatherBrushActive) { onMouseDownWeatherBrush(e); return }
  }

  // ── Baguette magique : chargement des pixels des masks + hover detect ──

  useEffect(() => {
    // Quand la liste de masks change, on (re)charge tous les pixels en parallèle.
    wandPixelsRef.current.clear()
    setHoveredMaskUrl(null)
    if (wandMasks.length === 0) return
    let cancelled = false
    ;(async () => {
      await Promise.all(wandMasks.map(async (m) => {
        // Skip les URLs placeholder de Magic Wand (`pending:...`) — l'upload
        // Supabase est en cours, l'URL réelle arrivera via patchWandMaskUrl
        // qui re-déclenche cet effet. Les marching ants sont déjà rendus
        // depuis les contours embarqués (pas besoin du PNG pour le visuel).
        if (m.url.startsWith('pending:')) return
        try {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.src = m.url
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error(`mask ${m.index} load failed`))
          })
          if (cancelled) return
          const c = document.createElement('canvas')
          c.width = img.naturalWidth; c.height = img.naturalHeight
          const ctx = c.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          const data = ctx.getImageData(0, 0, c.width, c.height).data
          let area = 0
          for (let i = 0; i < data.length; i += 4) if (data[i] > 127) area++
          wandPixelsRef.current.set(m.url, { width: c.width, height: c.height, pixels: data, area })
        } catch (err) {
          console.warn('[wand] mask load failed:', m.index, err)
        }
      }))
    })()
    return () => { cancelled = true }
  }, [wandMasks])

  // ── Brush : rendu du canvas à chaque changement de strokes ───────────────
  // Le canvas est à la résolution naturelle de l'image (pour pixel-perfect
  // sur export mask). CSS le scale à l'affichage. On re-rend tous les strokes
  // du state + éventuellement le stroke en cours (mis à jour en direct dans
  // onMouseMoveBrush sans toucher à l'état React).
  useEffect(() => {
    const canvas = brushCanvasRef.current
    const imgEl = imgRef.current
    if (!canvas || !imgEl) return
    const w = imgEl.naturalWidth
    const h = imgEl.naturalHeight
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    // On dessine en rose semi-transparent (pas en B&W) pour l'affichage live.
    // Le mask B&W n'est généré qu'au moment de l'action (brushStrokesToMaskUrl).
    drawStrokesAsPreview(ctx, w, h, brushStrokes)
    // Stroke en cours (visuel uniquement — ajouté au state seulement on mouseup)
    if (currentStrokeRef.current && currentStrokeRef.current.points.length > 0) {
      drawStrokesAsPreview(ctx, w, h, [currentStrokeRef.current])
    }
  }, [brushStrokes, cutTool, imgRef, rect])

  /** Cherche le plus PETIT mask foreground au pixel (natX, natY) — priorité
   *  au plus précis (comme AutoSelector). Renvoie l'URL du mask hover, sinon null. */
  function findHoveredMask(natX: number, natY: number): string | null {
    // Tri par aire croissante à chaque appel — cheap car N petit (~5-20 masks)
    const entries = Array.from(wandPixelsRef.current.entries())
      .sort((a, b) => a[1].area - b[1].area)
    for (const [url, m] of entries) {
      if (natX < 0 || natY < 0 || natX >= m.width || natY >= m.height) continue
      const idx = (Math.floor(natY) * m.width + Math.floor(natX)) * 4
      if (m.pixels[idx] > 127) return url
    }
    return null
  }

  function onMouseMoveWand(e: React.MouseEvent) {
    if (!cutMode || wandMasks.length === 0 || !imgRef.current || !containerRef.current) return
    // On garde le hover actif même quand currentMaskUrl existe — pour permettre
    // shift+clic (union) / alt+clic (subtract) sur les autres clusters.
    const natEl = imgRef.current
    const ratioX = natEl.naturalWidth / natEl.clientWidth
    const ratioY = natEl.naturalHeight / natEl.clientHeight
    const rect = containerRef.current.getBoundingClientRect()
    const natX = (e.clientX - rect.left) * ratioX
    const natY = (e.clientY - rect.top) * ratioY
    const url = findHoveredMask(natX, natY)
    // On affiche toujours le hover (même sur une zone déjà sélectionnée) pour
    // signaler à l'utilisateur qu'il peut la DÉsélectionner en cliquant.
    if (url !== hoveredMaskUrl) setHoveredMaskUrl(url)
  }

  function onClickWand(e: React.MouseEvent) {
    if (!cutMode || wandMasks.length === 0 || !hoveredMaskUrl) return
    e.stopPropagation()
    // Simple clic = toggle : ajoute à la sélection si pas dedans, retire sinon.
    // Les actions (Supprimer, Créer calque animé) opèrent sur l'UNION de
    // toutes les zones sélectionnées (recalculée par FoldCut via useEffect).
    toggleWandSelection(hoveredMaskUrl)
  }

  // ── Météo : mousedown/move/up handlers (rect + brush) ────────────────
  //
  // Les handlers écrivent vers la zone **cible** : si `editingWeatherZone`
  // vaut 'impact' on patche `weather.impactZone`, sinon `weather.zone`.
  // Helper local pour construire le patch correct selon la cible.
  //
  // CRUCIAL : patchTargetZone lit l'état via REFS (rafraîchies à chaque render
  // ci-dessous). Sans ça, le handler mouseup attaché à window au mousedown
  // closurait l'état du render initial et écraserait les patches faits par
  // mousemove pendant le drag — résultat : le rect dessiné disparaît au release.
  const weatherRef = useRef(weather)
  weatherRef.current = weather
  const targetZoneRef = useRef(targetZone)
  targetZoneRef.current = targetZone
  const editingWeatherZoneRef = useRef(editingWeatherZone)
  editingWeatherZoneRef.current = editingWeatherZone
  const activeImpactZoneIdRef = useRef(activeImpactZoneId)
  activeImpactZoneIdRef.current = activeImpactZoneId
  const activeLayerIdxRef = useRef(activeLayerIdx)
  activeLayerIdxRef.current = activeLayerIdx

  function patchTargetZone(mutator: (z: WeatherZone) => WeatherZone) {
    const w = weatherRef.current
    if (!w) return
    const current = targetZoneRef.current ?? { mode: 'full' as const }
    const next = mutator(current)
    if (editingWeatherZoneRef.current === 'impact' && activeImpactZoneIdRef.current) {
      // Met à jour la zone d'impact ciblée (par id) dans la liste impactZones.
      const updatedZones = (w.impactZones ?? []).map(z =>
        z.id === activeImpactZoneIdRef.current ? { ...z, zone: next } : z,
      )
      updateLayer(activeLayerIdxRef.current, { weather: { ...w, impactZones: updatedZones } })
    } else {
      updateLayer(activeLayerIdxRef.current, { weather: { ...w, zone: next } })
    }
  }

  function onMouseDownWeatherRect(e: React.MouseEvent) {
    if (!weatherRectActive || !containerRef.current || !weather) return
    if (e.button !== 0) return
    e.stopPropagation()
    const box = containerRef.current.getBoundingClientRect()
    const sx = e.clientX - box.left
    const sy = e.clientY - box.top
    weatherRectDragRef.current = { startX: sx, startY: sy }
    // Pendant le drag, on stocke le rect transit dans `rect` (draft) pour le
    // preview live. Au mouseup on le COMMIT dans `rects[]` (additif) et on
    // efface `rect`, comme un stroke pinceau qui devient permanent au release.
    patchTargetZone(z => ({ ...z, rect: { x1: sx / rect.w, y1: sy / rect.h, x2: sx / rect.w, y2: sy / rect.h } }))
    // Capture le brushMode courant pour figer paint vs erase au commit
    const startBrushMode = (targetZone?.brushMode ?? 'paint') as 'paint' | 'erase'
    const up = () => {
      weatherRectDragRef.current = null
      window.removeEventListener('mouseup', up)
      // Commit du rect draft → rects[] additif, puis clear le draft
      patchTargetZone(z => {
        if (!z.rect) return z
        const draft = z.rect
        // Filtre les rects dégénérés (clic sans drag → x1≈x2 ou y1≈y2)
        if (Math.abs(draft.x2 - draft.x1) < 0.001 || Math.abs(draft.y2 - draft.y1) < 0.001) {
          // pas de drag réel : on ne commit rien, on clear quand même le draft
          return { ...z, rect: undefined }
        }
        const committed: import('./types').WeatherRectShape = { ...draft, mode: startBrushMode }
        return { ...z, rect: undefined, rects: [...(z.rects ?? []), committed] }
      })
    }
    window.addEventListener('mouseup', up)
  }

  function onMouseMoveWeatherRect(e: React.MouseEvent) {
    if (!weatherRectDragRef.current || !containerRef.current || !weather || rect.w === 0) return
    const box = containerRef.current.getBoundingClientRect()
    const cx = e.clientX - box.left
    const cy = e.clientY - box.top
    const { startX, startY } = weatherRectDragRef.current
    const x1 = Math.max(0, Math.min(rect.w, Math.min(startX, cx))) / rect.w
    const y1 = Math.max(0, Math.min(rect.h, Math.min(startY, cy))) / rect.h
    const x2 = Math.max(0, Math.min(rect.w, Math.max(startX, cx))) / rect.w
    const y2 = Math.max(0, Math.min(rect.h, Math.max(startY, cy))) / rect.h
    patchTargetZone(z => ({ ...z, rect: { x1, y1, x2, y2 } }))
  }

  function onMouseDownWeatherBrush(e: React.MouseEvent) {
    if (!weatherBrushActive || !imgRef.current || !containerRef.current || !weather || !targetZone) return
    if (e.button !== 0) return
    e.stopPropagation()
    const box = containerRef.current.getBoundingClientRect()
    const xN = (e.clientX - box.left) / rect.w
    const yN = (e.clientY - box.top) / rect.h
    weatherStrokeRef.current = {
      points: [{ x: xN, y: yN }],
      radius: targetZone.brushSize ?? 0.015,
      mode: targetZone.brushMode ?? 'paint',
    }
    // Capture du layer index au mousedown : on compare au mouseup avec la valeur
    // courante (via activeLayerIdxRef) pour ne pas commiter sur un autre layer
    // si l'utilisateur a switché entre temps.
    const startLayerIdx = activeLayerIdx
    drawWeatherBrushPreview()
    const up = () => {
      const stroke = weatherStrokeRef.current
      weatherStrokeRef.current = null
      window.removeEventListener('mouseup', up)
      if (!stroke) return
      // Vérifie que le calque actif est toujours le même (sinon on jette).
      if (activeLayerIdxRef.current !== startLayerIdx) return
      if (!weatherRef.current) return
      patchTargetZone(z => ({ ...z, strokes: [...(z.strokes ?? []), stroke] }))
    }
    window.addEventListener('mouseup', up)
  }

  function onMouseMoveWeatherBrush(e: React.MouseEvent) {
    if (!weatherBrushActive || !containerRef.current) return
    const box = containerRef.current.getBoundingClientRect()
    setCursorPos({ x: e.clientX - box.left, y: e.clientY - box.top })
    if (weatherStrokeRef.current) {
      const xN = (e.clientX - box.left) / rect.w
      const yN = (e.clientY - box.top) / rect.h
      weatherStrokeRef.current.points.push({ x: xN, y: yN })
      drawWeatherBrushPreview()
    }
  }

  function drawWeatherBrushPreview() {
    const canvas = weatherBrushCanvasRef.current
    const imgEl = imgRef.current
    if (!canvas || !imgEl) return
    const w = imgEl.naturalWidth
    const h = imgEl.naturalHeight
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    // Lit la zone en cours d'édition (main ou impact). Compose rects + strokes
    // dans le preview unifié — l'utilisateur voit UNE seule zone peinte, peu
    // importe la nature des outils utilisés (rect ou pinceau).
    const allStrokes = [...(targetZone?.strokes ?? [])]
    if (weatherStrokeRef.current) allStrokes.push(weatherStrokeRef.current)
    const allRects = [...(targetZone?.rects ?? [])]
    if (targetZone?.rect && Math.abs(targetZone.rect.x2 - targetZone.rect.x1) > 0.001 && Math.abs(targetZone.rect.y2 - targetZone.rect.y1) > 0.001) {
      // Draft transit du drag — on l'inclut pour que le preview montre la
      // zone EN COURS d'être peinte au rectangle (live during drag).
      allRects.push({ ...targetZone.rect, mode: (targetZone.brushMode ?? 'paint') as 'paint' | 'erase' })
    }
    // Alpha plus élevé pour les zones d'impact (orange) afin qu'elles soient
    // plus visibles sur le canvas — contraste important pour distinguer du
    // teal de la zone principale et repérer plusieurs zones empilées.
    const fillAlpha = editingWeatherZone === 'impact' ? 0.6 : 0.45
    drawWeatherZonePreview(ctx, w, h, allRects, allStrokes, weatherAccent, fillAlpha)
  }

  // Redessine le preview quand les strokes/rects OU la zone cible changent.
  // weatherRectActive ajouté car le preview doit aussi être visible en mode
  // rect (ne plus être conditionné au mode brush — la peinture est unifiée).
  useEffect(() => {
    if (weatherBrushActive || weatherRectActive) drawWeatherBrushPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetZone?.strokes, targetZone?.rects, targetZone?.rect, weatherBrushActive, weatherRectActive, editingWeatherZone])

  // ── Brush : mousedown/move/up handlers ──────────────────────────────────
  // Le stroke est construit dans un ref (pas du state) pendant le drag :
  // chaque move redessine directement sur le canvas sans déclencher un
  // re-render React par frame. Au mouseup, on commit le stroke dans le
  // state → le useEffect dessine la version finale proprement.
  function onMouseDownBrush(e: React.MouseEvent) {
    if (!cutMode || cutTool !== 'brush' || !imgRef.current || !containerRef.current) return
    if (e.button !== 0) return
    e.stopPropagation()
    const natEl = imgRef.current
    const ratioX = natEl.naturalWidth / natEl.clientWidth
    const ratioY = natEl.naturalHeight / natEl.clientHeight
    const box = containerRef.current.getBoundingClientRect()
    const xPx = (e.clientX - box.left) * ratioX
    const yPx = (e.clientY - box.top) * ratioY
    const xN = xPx / natEl.naturalWidth
    const yN = yPx / natEl.naturalHeight
    // Radius stocké en fraction de min(w,h) — invariant au resize affichage.
    currentStrokeRef.current = {
      points: [{ x: xN, y: yN }],
      radius: brushSize,
      mode: brushMode,
    }
    // Draw immédiat (un tap sans drag reste visible)
    drawCurrentStrokePreview()
    // Window-level mouseup pour finaliser même si le release est hors canvas
    const handleWindowUp = () => {
      if (currentStrokeRef.current) {
        addBrushStroke(currentStrokeRef.current)
        currentStrokeRef.current = null
      }
      window.removeEventListener('mouseup', handleWindowUp)
    }
    window.addEventListener('mouseup', handleWindowUp)
  }

  function onMouseMoveBrush(e: React.MouseEvent) {
    if (cutTool !== 'brush' || !imgRef.current || !containerRef.current) return
    const box = containerRef.current.getBoundingClientRect()
    // Cursor position en coords du container (pixels d'affichage) — pour
    // le rendu du cercle qui suit le curseur.
    setCursorPos({ x: e.clientX - box.left, y: e.clientY - box.top })
    // Si on est en train de dessiner, on ajoute un point au stroke courant
    if (currentStrokeRef.current) {
      const natEl = imgRef.current
      const ratioX = natEl.naturalWidth / natEl.clientWidth
      const ratioY = natEl.naturalHeight / natEl.clientHeight
      const xPx = (e.clientX - box.left) * ratioX
      const yPx = (e.clientY - box.top) * ratioY
      const xN = xPx / natEl.naturalWidth
      const yN = yPx / natEl.naturalHeight
      currentStrokeRef.current.points.push({ x: xN, y: yN })
      drawCurrentStrokePreview()
    }
  }

  /** Redessine le canvas avec les strokes committés + le stroke en cours. */
  function drawCurrentStrokePreview() {
    const canvas = brushCanvasRef.current
    const imgEl = imgRef.current
    if (!canvas || !imgEl || !currentStrokeRef.current) return
    const w = imgEl.naturalWidth
    const h = imgEl.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    drawStrokesAsPreview(ctx, w, h, brushStrokes)
    drawStrokesAsPreview(ctx, w, h, [currentStrokeRef.current])
  }

  function onMouseMoveCombined(e: React.MouseEvent) {
    onMouseMove(e)    // drag/resize/cut-rect existants
    if (cutMode) {
      if (cutTool === 'wand') onMouseMoveWand(e)
      else if (cutTool === 'brush') onMouseMoveBrush(e)
      else if (cutTool === 'lasso_poly' || cutTool === 'lasso_free') {
        // Track la position pour le rendu de la ligne live (polygonal)
        if (containerRef.current) {
          const box = containerRef.current.getBoundingClientRect()
          const x01 = (e.clientX - box.left) / rect.w
          const y01 = (e.clientY - box.top) / rect.h
          setLassoCursor({ x: x01, y: y01 })
        }
      }
      return
    }
    if (weatherRectActive) onMouseMoveWeatherRect(e)
    else if (weatherBrushActive) onMouseMoveWeatherBrush(e)
  }
  function onMouseLeaveCombined() {
    // On NE termine PAS le drag ici : si l'utilisateur sort brièvement du
    // canvas en tirant son rect, SAM ne doit pas partir avec un rect
    // incomplet. Le drag finit sur mouseup (n'importe où dans la page).
    // On termine juste les drags de sprites (dragRef/resizeRef) qui eux
    // ne bénéficient pas des listeners window.
    if (!cutDragRef.current) onMouseUp()
    setHoveredMaskUrl(null)
    setCursorPos(null)
    // Sortie de la zone canvas → désengage le pinceau météo SAUF si un
    // stroke est en cours (dans ce cas l'utilisateur pourrait revenir pour
    // finir son trait, on laisse le window mouseup committer proprement).
    if (weatherBrushEngaged && !weatherStrokeRef.current) {
      setWeatherBrushEngaged(false)
    }
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDownContainer}
      onMouseMove={onMouseMoveCombined}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeaveCombined}
      onClick={onClickEmptyInternal}
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.w,
        height: rect.h,
        pointerEvents: rect.w > 0 ? 'auto' : 'none',
        // cursor contextuel — en priorité : édition zone météo, puis découpe.
        cursor: weatherBrushActive
          ? 'none'
          : weatherRectActive
            ? 'crosshair'
            : !cutMode
              ? 'default'
              : cutTool === 'brush'
                ? 'none'
                : (cutTool === 'magic_wand' || cutTool === 'sam_prompt')
                  ? 'cell'  // click-pixel tools : cursor "+" précis
                  : (cutTool === 'lasso_poly' || cutTool === 'lasso_free')
                    ? 'crosshair'  // lasso : croix de précision
                    : wandMasks.length > 0 ? 'pointer' : 'crosshair',
      }}
    >
      {/* Rectangle de sélection Découpe — visible pendant le drag ET après
           le release tant que SAM n'a pas retourné de masks. Retiré automa-
           tiquement une fois les masks affichés (overlay de hover prend le
           relais). Trait dashed rose + ombrage du reste du canvas.
           Uniquement en mode wand — le pinceau n'utilise pas de rectangle. */}
      {/* Rectangle de sélection : visible pour SAM Auto (wand) ET GrabCut
       * (les deux outils partagent le drag-rect comme interaction). */}
      {cutMode && (cutTool === 'wand' || cutTool === 'grabcut') && cutSelection && size.w > 0 && wandMasks.length === 0 && (
        <div
          style={{
            position: 'absolute',
            left: cutSelection.x1 * size.w,
            top: cutSelection.y1 * size.h,
            width: (cutSelection.x2 - cutSelection.x1) * size.w,
            height: (cutSelection.y2 - cutSelection.y1) * size.h,
            background: 'rgba(236, 72, 153, 0.12)',
            border: '2px dashed var(--ie-accent)',
            borderRadius: 'var(--ie-radius-sm)',
            pointerEvents: 'none',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.25)',
            zIndex: 3,
          }}
        />
      )}

      {/* SVG marching ants — pour les masks Magic Wand qui ont des contours
       * vectoriels. Coords normalisées 0-1 via viewBox. Animation CSS sur
       * stroke-dashoffset pour l'effet "ants" qui défilent. */}
      {cutMode && size.w > 0 && wandMasks.some(m => m.contours && m.contours.length > 0) && (
        <svg
          className="dz-marching-ants-overlay"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size.w,
            height: size.h,
            pointerEvents: 'none',
            zIndex: 4,
          }}
        >
          {wandMasks.map((mask) => {
            if (!mask.contours || mask.contours.length === 0) return null
            const isSelected = selectedWandUrls.includes(mask.url)
            return mask.contours.map((contour, ci) => {
              if (contour.points.length < 3) return null
              // Construit un path SVG fermé depuis les points
              const pts = contour.points
              let d = `M${pts[0].x.toFixed(5)},${pts[0].y.toFixed(5)}`
              for (let i = 1; i < pts.length; i++) {
                d += `L${pts[i].x.toFixed(5)},${pts[i].y.toFixed(5)}`
              }
              d += 'Z'
              return (
                <path
                  key={`${mask.url}-${ci}`}
                  d={d}
                  fill={contour.inner ? 'none' : (isSelected ? 'rgba(236, 72, 153, 0.10)' : 'transparent')}
                  stroke="var(--ie-accent)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="6 4"
                  className="dz-marching-ants-path"
                  style={{ fillRule: 'evenodd' }}
                />
              )
            })
          })}
        </svg>
      )}

      {/* AI Cut Command — preview marching ants violets pour différencier de
       * la sélection committée (rose). Affiché tant que l'utilisateur n'a pas
       * validé / annulé la découpe IA depuis le panneau gauche. */}
      {aiCutPreview && size.w > 0 && aiCutPreview.contours.length > 0 && (
        <svg
          className="dz-marching-ants-overlay"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            left: 0, top: 0,
            width: size.w, height: size.h,
            pointerEvents: 'none',
            zIndex: 6,
          }}
        >
          {aiCutPreview.contours.map((contour, ci) => {
            if (contour.points.length < 3) return null
            const pts = contour.points
            let d = `M${pts[0].x.toFixed(5)},${pts[0].y.toFixed(5)}`
            for (let i = 1; i < pts.length; i++) {
              d += `L${pts[i].x.toFixed(5)},${pts[i].y.toFixed(5)}`
            }
            d += 'Z'
            return (
              <path
                key={`aicut-${ci}`}
                d={d}
                fill={contour.inner ? 'none' : 'rgba(168, 85, 247, 0.12)'}
                stroke="#a855f7"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="6 4"
                className="dz-marching-ants-path"
                style={{ fillRule: 'evenodd' }}
              />
            )
          })}
        </svg>
      )}

      {/* Lasso en cours de tracé — polygone live + ligne entre dernier point et curseur */}
      {cutMode && (cutTool === 'lasso_poly' || cutTool === 'lasso_free') && lassoDraft && lassoDraft.points.length > 0 && size.w > 0 && (
        <svg
          className="dz-lasso-overlay"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            left: 0, top: 0,
            width: size.w,
            height: size.h,
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          {/* Path du polygone tracé jusqu'ici. Si closed=true, on ferme le path
           * avec un Z et on applique les marching ants (visuel identique à wandMasks).
           * Tant qu'on est en cours de tracé (closed=false) :
           *   • poly : pointillés statiques + ligne live vers le curseur
           *   • free : trait plein (drag continu, pas besoin de cursor line) */}
          {lassoDraft.points.length >= 2 && (() => {
            const pts = lassoDraft.points
            const closed = lassoDraft.closed
            let d = `M${pts[0].x.toFixed(5)},${pts[0].y.toFixed(5)}`
            for (let i = 1; i < pts.length; i++) {
              d += `L${pts[i].x.toFixed(5)},${pts[i].y.toFixed(5)}`
            }
            // Ligne live vers le curseur (poly seulement, et seulement si pas encore closed)
            if (!closed && cutTool === 'lasso_poly' && lassoCursor) {
              d += `L${lassoCursor.x.toFixed(5)},${lassoCursor.y.toFixed(5)}`
            }
            if (closed) d += 'Z'
            const useMarchingAnts = closed || cutTool === 'lasso_poly'
            return (
              <path
                d={d}
                fill={closed ? 'rgba(236, 72, 153, 0.18)' : 'rgba(236, 72, 153, 0.08)'}
                stroke="var(--ie-accent)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={useMarchingAnts ? '6 4' : '0'}
                className={useMarchingAnts ? 'dz-marching-ants-path' : ''}
              />
            )
          })()}

          {/* Anchors lasso_poly : cercle à chaque clic. Le 1er grossit quand
           * le curseur est proche (≥3 points) → indicateur "clique pour fermer". */}
          {!lassoDraft.closed && cutTool === 'lasso_poly' && lassoDraft.points.map((p: { x: number; y: number }, i: number) => {
            const isFirst = i === 0
            let canClose = false
            if (isFirst && lassoCursor && lassoDraft && lassoDraft.points.length >= 3) {
              const dx = lassoCursor.x - p.x
              const dy = lassoCursor.y - p.y
              canClose = (dx * dx + dy * dy) < LASSO_CLOSE_DIST_SQ
            }
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={canClose ? 0.012 : 0.005}
                fill={canClose ? 'var(--ie-accent)' : (isFirst ? 'white' : 'var(--ie-accent)')}
                stroke="var(--ie-accent)"
                strokeWidth={canClose ? 3 : 2}
                vectorEffect="non-scaling-stroke"
                style={{ transition: 'r 120ms, fill 120ms, stroke-width 120ms' }}
              />
            )
          })}

          {/* Indicateur 1er point lasso_free pendant le drag. Grossit quand le
           * curseur revient à proximité (≥10 points pour éviter d'apparaître
           * déclenché immédiatement) → "relâche pour fermer". */}
          {!lassoDraft.closed && cutTool === 'lasso_free' && lassoCursor && lassoDraft.points.length >= 1 && (() => {
            const p = lassoDraft.points[0]
            const dx = lassoCursor.x - p.x
            const dy = lassoCursor.y - p.y
            const canClose = lassoDraft.points.length >= 10 && (dx * dx + dy * dy) < LASSO_CLOSE_DIST_SQ
            return (
              <circle
                cx={p.x}
                cy={p.y}
                r={canClose ? 0.014 : 0.006}
                fill={canClose ? 'var(--ie-accent)' : 'white'}
                stroke="var(--ie-accent)"
                strokeWidth={canClose ? 3 : 2}
                vectorEffect="non-scaling-stroke"
                style={{ transition: 'r 120ms, fill 120ms, stroke-width 120ms' }}
              />
            )
          })()}
        </svg>
      )}

      {/* Baguette magique : rendu des zones sélectionnées + hover.
           - selectedWandUrls[] : toutes les zones cliquées → rendues en rose
             (accent, statique, superposées)
           - hoveredMaskUrl     : zone sous le curseur → teal (marching ants).
             Si elle est déjà sélectionnée, l'overlay rose prime visuellement
             mais on affiche quand même un léger pulse pour signaler l'action
             (clic = désélectionner).
           Technique SVG filters reprise de AutoSelector du wizard. */}
      {cutMode && cutTool === 'wand' && size.w > 0 && (selectedWandUrls.length > 0 || hoveredMaskUrl) && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            <defs>
              <filter id="ie-wand-fill-rose">
                <feColorMatrix type="matrix" values={'0 0 0 0 0.925  0 0 0 0 0.282  0 0 0 0 0.6  0.45 0 0 0 0'} />
              </filter>
              <filter id="ie-wand-fill-teal">
                <feColorMatrix type="matrix" values={'0 0 0 0 0.31  0 0 0 0 0.84  0 0 0 0 0.83  0.45 0 0 0 0'} />
              </filter>
              <filter id="ie-wand-outline">
                <feColorMatrix type="matrix" values={'0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0'} result="mask" />
                <feMorphology in="mask" operator="dilate" radius="2" result="dilated" />
                <feComposite in="dilated" in2="mask" operator="out" result="outline" />
                <feColorMatrix in="outline" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
              </filter>
            </defs>
          </svg>

          {/* Sélections validées (rose) — une image par zone sélectionnée,
               superposées en screen blend → l'union est visuellement correcte
               sans attendre le calcul async du currentMaskUrl. */}
          {selectedWandUrls.map(url => (
            <React.Fragment key={`sel-${url}`}>
              <img src={url} alt="" style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                filter: 'url(#ie-wand-fill-rose)', mixBlendMode: 'screen',
              }} />
              <img src={url} alt="" style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                filter: 'url(#ie-wand-outline) drop-shadow(0 0 2px #EC4899) drop-shadow(0 0 4px #EC4899)',
                mixBlendMode: 'screen',
              }} />
            </React.Fragment>
          ))}

          {/* Hover (teal) — par-dessus, avec pulse */}
          {hoveredMaskUrl && (
            <>
              <img src={hoveredMaskUrl} alt="" style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                filter: 'url(#ie-wand-fill-teal)', mixBlendMode: 'screen',
              }} />
              <img src={hoveredMaskUrl} alt="" style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                filter: 'url(#ie-wand-outline) drop-shadow(0 0 2px #4ed5d5) drop-shadow(0 0 4px #4ed5d5)',
                mixBlendMode: 'screen',
                animation: 'heroAntsPulse 0.8s ease-in-out infinite',
              }} />
            </>
          )}

          <style>{`
            @keyframes heroAntsPulse {
              0%, 100% { opacity: 0.9; }
              50%      { opacity: 0.55; }
            }
          `}</style>
        </div>
      )}

      {/* Pinceau — canvas overlay en résolution naturelle image, CSS-scaled.
           Rendu live en rose translucide (preview) ; le mask B&W réel est
           généré au moment de l'action via brushStrokesToMaskUrl. */}
      {cutMode && cutTool === 'brush' && size.w > 0 && (
        <canvas
          ref={brushCanvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 4,
            // rendering crisp sur le scale CSS
            imageRendering: 'auto',
          }}
        />
      )}

      {/* Curseur pinceau — cercle rose qui suit la souris, dimensionné au
           rayon courant. Affiche si paint/erase via couleur. */}
      {cutMode && cutTool === 'brush' && cursorPos && size.w > 0 && (() => {
        // Rayon affiché = brushSize × min(displayW, displayH)
        const displayRadius = brushSize * Math.min(size.w, size.h)
        return (
          <div
            style={{
              position: 'absolute',
              left: cursorPos.x - displayRadius,
              top: cursorPos.y - displayRadius,
              width: displayRadius * 2,
              height: displayRadius * 2,
              border: brushMode === 'paint'
                ? '1.5px solid rgba(236, 72, 153, 0.95)'
                : '1.5px dashed rgba(255, 255, 255, 0.9)',
              borderRadius: '50%',
              background: brushMode === 'paint'
                ? 'rgba(236, 72, 153, 0.08)'
                : 'rgba(0, 0, 0, 0.15)',
              pointerEvents: 'none',
              zIndex: 6,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
              transition: 'width 120ms, height 120ms, left 120ms, top 120ms',
            }}
          />
        )
      })()}

      {/* Météo — outline du draft transit pendant le drag du rectangle.
           Une fois la souris relâchée, le rect est committed dans rects[] et
           le draft (zone.rect) est cleared → l'outline disparaît, et la
           zone peinte est visible via le canvas preview pinceau (qui rend
           rects+strokes de manière unifiée). Pas d'outline persistant des
           rects committed : pour l'utilisateur, c'est juste de la peinture. */}
      {weatherRectActive && targetZone?.rect && size.w > 0 && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(targetZone.rect.x1, targetZone.rect.x2) * size.w,
            top: Math.min(targetZone.rect.y1, targetZone.rect.y2) * size.h,
            width: Math.abs(targetZone.rect.x2 - targetZone.rect.x1) * size.w,
            height: Math.abs(targetZone.rect.y2 - targetZone.rect.y1) * size.h,
            background: hexToRgbaStyle(weatherAccent, editingWeatherZone === 'impact' ? 0.20 : 0.12),
            border: `2px dashed ${weatherAccent}`,
            borderRadius: 'var(--ie-radius-sm)',
            pointerEvents: 'none',
            zIndex: 6,
          }}
        />
      )}

      {/* Météo — canvas preview de la zone peinte (rects + strokes unifiés).
           Affiché en mode brush ET en mode rect : la zone visualisée est la
           même peu importe l'outil utilisé pour la peindre. */}
      {(weatherBrushActive || weatherRectActive) && size.w > 0 && (
        <canvas
          ref={weatherBrushCanvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
      )}

      {/* Météo — curseur pinceau (cercle qui suit la souris), couleur selon zone. */}
      {weatherBrushActive && cursorPos && size.w > 0 && (() => {
        const bs = targetZone?.brushSize ?? 0.015
        const bm = targetZone?.brushMode ?? 'paint'
        const displayRadius = bs * Math.min(size.w, size.h)
        return (
          <div
            style={{
              position: 'absolute',
              left: cursorPos.x - displayRadius,
              top: cursorPos.y - displayRadius,
              width: displayRadius * 2,
              height: displayRadius * 2,
              border: bm === 'paint'
                ? `1.5px solid ${hexToRgbaStyle(weatherAccent, 0.95)}`
                : '1.5px dashed rgba(255, 255, 255, 0.9)',
              borderRadius: '50%',
              background: bm === 'paint'
                ? hexToRgbaStyle(weatherAccent, 0.10)
                : 'rgba(0, 0, 0, 0.15)',
              pointerEvents: 'none',
              zIndex: 6,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
              transition: 'width 120ms, height 120ms',
            }}
          />
        )
      })()}

      {/* NPCs — rendu inversé : index 0 (top de la liste sidebar) doit être DEVANT
           sur le canvas. Le DOM dessine les éléments dans l'ordre, donc le dernier
           rendu = au-dessus. On reverse pour mettre l'index 0 en dernier. */}
      {composition.npcs.map((_, originalI) => composition.npcs.length - 1 - originalI).map(i => {
        const p = composition.npcs[i]
        const pos = sphericalToPx(p.theta, p.phi, size.w || 1, size.h || 1)
        const spriteSize = spritePxSize(p.scale, size.h || 1)
        const npc = npcs.find(n => n.id === p.npc_id)
        const spriteUrl = npc ? resolveNpcImageUrl(npc, p.image_variant) : undefined
        const sel: SelectedPlacement = { kind: 'npc', index: i }
        const isSel = isSelected(sel)
        const left = pos.x - spriteSize * 0.3
        const top = pos.y - spriteSize * 0.8
        const width = spriteSize * 0.6
        const height = spriteSize
        return (
          <React.Fragment key={`npc-${i}`}>
            <div
              onMouseDown={e => onMouseDownPlacement(e, sel)}
              onWheel={e => onWheelPlacement(e, sel)}
              onContextMenu={e => onContextMenuPlacement(e, sel)}
              title={`${npc?.name ?? 'NPC'} — glisse un coin pour redimensionner, clic droit pour retirer`}
              style={{
                position: 'absolute',
                left, top, width, height,
                cursor: 'move',
                border: isSel
                  ? '2px solid var(--ie-accent)'
                  : '1px dashed rgba(255, 255, 255, 0.55)',
                background: spriteUrl
                  ? `center/cover no-repeat url(${spriteUrl})`
                  : 'var(--ie-text-faint)',
                transform: p.flip ? 'scaleX(-1)' : undefined,
                borderRadius: 'var(--ie-radius-sm)',
                boxShadow: isSel ? 'var(--ie-shadow)' : undefined,
                transition: 'border-color 150ms, box-shadow 150ms',
              }}
            />
            {/* Poignées de redimensionnement aux 4 coins — visibles uniquement quand sélectionné */}
            {isSel && (
              <>
                <ResizeCorner left={left}         top={top}          index={i} onMouseDown={onMouseDownResizeHandle} cursor="nwse-resize" />
                <ResizeCorner left={left + width} top={top}          index={i} onMouseDown={onMouseDownResizeHandle} cursor="nesw-resize" />
                <ResizeCorner left={left}         top={top + height} index={i} onMouseDown={onMouseDownResizeHandle} cursor="nesw-resize" />
                <ResizeCorner left={left + width} top={top + height} index={i} onMouseDown={onMouseDownResizeHandle} cursor="nwse-resize" />
              </>
            )}
          </React.Fragment>
        )
      })}

      {/* Items — même logique d'inversion (top liste = devant) */}
      {composition.items.map((_, originalI) => composition.items.length - 1 - originalI).map(i => {
        const p = composition.items[i]
        const pos = sphericalToPx(p.theta, p.phi, size.w || 1, size.h || 1)
        const iconSize = spritePxSize(p.scale, size.h || 1) * 0.8
        const itemUrl = p.custom_url ?? items.find(it => it.id === p.item_id)?.illustration_url
        const itemName = p.custom_name ?? items.find(it => it.id === p.item_id)?.name ?? '?'
        const sel: SelectedPlacement = { kind: 'item', index: i }
        const isSel = isSelected(sel)
        const itemLeft = pos.x - iconSize / 2
        const itemTop = pos.y - iconSize / 2
        return (
          <React.Fragment key={`item-${i}`}>
            <div
              onMouseDown={e => onMouseDownPlacement(e, sel)}
              onContextMenu={e => onContextMenuPlacement(e, sel)}
              title={`${itemName}${p.interactive ? ' (ramassable)' : ''} — glisse un coin pour redimensionner`}
              style={{
                position: 'absolute',
                left: itemLeft,
                top: itemTop,
                width: iconSize, height: iconSize,
                cursor: 'move',
                border: isSel
                  ? '2px solid var(--ie-accent)'
                  : p.interactive
                    ? '2px solid rgba(16, 185, 129, 0.65)'  // halo vert si ramassable
                    : '1px dashed rgba(255, 255, 255, 0.55)',
                background: itemUrl
                  ? `center/contain no-repeat url(${itemUrl})`
                  : 'var(--ie-text-faint)',
                borderRadius: 'var(--ie-radius-sm)',
                transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined,
                boxShadow: isSel ? 'var(--ie-shadow)' : undefined,
                transition: 'border-color 150ms, box-shadow 150ms',
              }}
            />
            {/* Poignées de redimensionnement aux 4 coins (comme NPCs) */}
            {isSel && (
              <>
                <ResizeCorner left={itemLeft}            top={itemTop}            index={i} kind="item" onMouseDown={onMouseDownResizeHandle} cursor="nwse-resize" />
                <ResizeCorner left={itemLeft + iconSize} top={itemTop}            index={i} kind="item" onMouseDown={onMouseDownResizeHandle} cursor="nesw-resize" />
                <ResizeCorner left={itemLeft}            top={itemTop + iconSize} index={i} kind="item" onMouseDown={onMouseDownResizeHandle} cursor="nesw-resize" />
                <ResizeCorner left={itemLeft + iconSize} top={itemTop + iconSize} index={i} kind="item" onMouseDown={onMouseDownResizeHandle} cursor="nwse-resize" />
              </>
            )}
          </React.Fragment>
        )
      })}

      {/* Choix placés (texte flottant cliquable côté joueur) */}
      {(composition.choices ?? []).map((p, i) => {
        const pos = sphericalToPx(p.theta, p.phi, size.w || 1, size.h || 1)
        const choice = choices.find(c => c.id === p.choice_id)
        const text = p.display_text || choice?.label || 'Choix'
        const sel: SelectedPlacement = { kind: 'choice', index: i }
        const isSel = isSelected(sel)
        return (
          <div
            key={`choice-${i}`}
            onMouseDown={e => onMouseDownPlacement(e, sel)}
            onContextMenu={e => onContextMenuPlacement(e, sel)}
            title={`Choix : ${text}`}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              transform: 'translate(-50%, -50%)',
              padding: '6px 12px',
              background: isSel ? 'var(--ie-accent)' : 'rgba(0, 0, 0, 0.75)',
              color: isSel ? 'var(--ie-accent-text-on)' : 'white',
              border: isSel ? '2px solid var(--ie-accent)' : '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: 999,
              fontSize: 'var(--ie-text-sm)',
              fontWeight: 500,
              cursor: 'move',
              whiteSpace: 'nowrap',
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              boxShadow: isSel ? 'var(--ie-shadow-lg)' : '0 2px 6px rgba(0, 0, 0, 0.3)',
              backdropFilter: 'blur(4px)',
              transition: 'all 150ms ease-out',
            }}
          >
            {text}
          </div>
        )
      })}

      {/* ZOOM_LOUPE_START — module isolé. Supprimer ce bloc + l'import en haut
       * pour désactiver complètement la loupe. Aucune autre modif nécessaire.
       *
       * S'active dans 2 contextes :
       *   1. Cut mode (lasso poly, lasso libre, pinceau) — overlays cut
       *   2. Weather mode (rect ou pinceau pour zone pluie/neige/brouillard)
       *      — overlays weather + accent color teal/orange selon la zone éditée */}
      <ZoomLoupe
        imageUrl={imageUrl}
        containerRef={containerRef}
        enabled={
          (cutMode && (cutTool === 'lasso_poly' || cutTool === 'lasso_free' || cutTool === 'brush'))
          || weatherBrushActive
          || weatherRectActive
          || zoomLoupeManualOpen
        }
        accentColor={(weatherBrushActive || weatherRectActive) ? weatherAccent : '#ec4899'}
        centerBrushRadius={
          cutMode && cutTool === 'brush'
            ? brushSize
            : weatherBrushActive
              ? (targetZone?.brushSize ?? 0.015)
              : undefined
        }
        wandMasks={cutMode ? wandMasks : undefined}
        lassoDraft={cutMode ? lassoDraft : undefined}
        // Inclut le stroke EN COURS de tracé (currentStrokeRef.current) en
        // plus des committed. setCursorPos est appelé à chaque mousemove brush
        // → CanvasOverlay re-render → cette JSX ré-évalue le .current frais →
        // la loupe voit le tracé live, pas seulement après mouseup.
        brushStrokes={
          cutMode && cutTool === 'brush'
            ? (currentStrokeRef.current
                ? [...brushStrokes, currentStrokeRef.current]
                : brushStrokes)
            : weatherBrushActive
              ? (weatherStrokeRef.current
                  ? [...(targetZone?.strokes ?? []), weatherStrokeRef.current]
                  : targetZone?.strokes)
              : undefined
        }
        rectDraft={weatherRectActive ? targetZone?.rect : undefined}
        rects={weatherRectActive ? targetZone?.rects : undefined}
      />
      {/* ZOOM_LOUPE_END */}
    </div>
  )
}

// ── Preview visuelle des strokes (rose translucide, PAS le mask B&W export) ─
//
// Ré-implémente la logique de renderStrokesToCanvas mais en rose — le mask
// B&W réel est généré au moment de l'action via brushStrokesToMaskUrl pour
// upload. Cette fonction-ci est purement cosmétique (feedback utilisateur).
function drawStrokesAsPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: BrushStroke[],
) {
  const scale = Math.min(width, height)
  for (const stroke of strokes) {
    const radiusPx = Math.max(1, stroke.radius * scale)
    ctx.lineWidth = radiusPx * 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (stroke.mode === 'paint') {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.50)'  // rose accent semi-transparent
      ctx.fillStyle = 'rgba(236, 72, 153, 0.50)'
    } else {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = '#000'
      ctx.fillStyle = '#000'
    }
    if (stroke.points.length === 0) continue
    if (stroke.points.length === 1) {
      const p = stroke.points[0]
      ctx.beginPath()
      ctx.arc(p.x * width, p.y * height, radiusPx, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    const first = stroke.points[0]
    ctx.moveTo(first.x * width, first.y * height)
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i]
      ctx.lineTo(p.x * width, p.y * height)
    }
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
}

// ── Preview visuelle des strokes du pinceau zone météo ────────────────────
// On dessine d'abord un MASQUE binaire (blanc opaque / effacé) sur un canvas
// offscreen, puis on compose une couche de couleur teal avec alpha uniforme
// via `destination-in`. Avantage : même si l'utilisateur repasse 10 fois au
// même endroit, l'opacité finale reste constante (pas d'accumulation Porter-
// Duff). L'œil perçoit une zone colorée à opacité régulière.
let weatherPreviewMask: HTMLCanvasElement | null = null
function getWeatherPreviewMask(w: number, h: number): HTMLCanvasElement {
  if (!weatherPreviewMask) weatherPreviewMask = document.createElement('canvas')
  if (weatherPreviewMask.width !== w) weatherPreviewMask.width = w
  if (weatherPreviewMask.height !== h) weatherPreviewMask.height = h
  return weatherPreviewMask
}

function drawWeatherStrokesPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: WeatherBrushStroke[],
  accentColor: string,
  fillAlpha = 0.45,
) {
  // Étape 1 : construire le masque B&W sur un canvas offscreen
  const mask = getWeatherPreviewMask(width, height)
  const mctx = mask.getContext('2d')!
  mctx.clearRect(0, 0, width, height)
  const scale = Math.min(width, height)
  for (const stroke of strokes) {
    const radiusPx = Math.max(1, stroke.radius * scale)
    mctx.lineWidth = radiusPx * 2
    mctx.lineCap = 'round'
    mctx.lineJoin = 'round'
    if (stroke.mode === 'paint') {
      mctx.globalCompositeOperation = 'source-over'
      mctx.strokeStyle = '#FFFFFF'
      mctx.fillStyle = '#FFFFFF'
    } else {
      // Erase retire du masque → destination-out
      mctx.globalCompositeOperation = 'destination-out'
      mctx.strokeStyle = '#000'
      mctx.fillStyle = '#000'
    }
    if (stroke.points.length === 0) continue
    if (stroke.points.length === 1) {
      const pt = stroke.points[0]
      mctx.beginPath()
      mctx.arc(pt.x * width, pt.y * height, radiusPx, 0, Math.PI * 2)
      mctx.fill()
      continue
    }
    mctx.beginPath()
    const first = stroke.points[0]
    mctx.moveTo(first.x * width, first.y * height)
    for (let i = 1; i < stroke.points.length; i++) {
      const pt = stroke.points[i]
      mctx.lineTo(pt.x * width, pt.y * height)
    }
    mctx.stroke()
  }
  mctx.globalCompositeOperation = 'source-over'

  // Étape 2 : teinter le masque avec la couleur d'accent. L'alpha est passé
  // en paramètre — 0.45 par défaut pour la zone principale, plus élevé
  // (0.6+) pour les zones d'impact afin qu'elles soient plus visibles.
  const maxRadius = strokes.reduce((m, s) => Math.max(m, s.radius), 0)
  const featherPx = Math.max(4, Math.min(80, maxRadius * scale * 0.35))
  const rgba = hexToRgba(accentColor, fillAlpha)

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = rgba
  ctx.fillRect(0, 0, width, height)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.filter = `blur(${featherPx}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.restore()
}

/**
 * Variante unifiée qui peint la zone composée de rects[] + strokes[].
 * Mental model : c'est UNE seule zone peinte, peu importe l'outil utilisé.
 * Les rects[] paint remplissent en blanc dans le mask (= peinture nette aux
 * arêtes droites), les strokes paint déposent des disques (= peinture diffuse
 * arrondie). Les erase de l'un ou l'autre carve dans le mask.
 *
 * Une fois le mask construit, on le teinte de la couleur d'accent comme pour
 * le preview pinceau classique. Les rectangles ont des arêtes nettes (pas de
 * feather sur les bords du rect), seul le contour des strokes est légèrement
 * adouci par le feather global.
 */
function drawWeatherZonePreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rects: WeatherRectShape[],
  strokes: WeatherBrushStroke[],
  accentColor: string,
  fillAlpha = 0.45,
) {
  const mask = getWeatherPreviewMask(width, height)
  const mctx = mask.getContext('2d')!
  mctx.clearRect(0, 0, width, height)
  const scale = Math.min(width, height)

  // Passe 1 : rectangles (paint additif blanc, erase soustractif)
  for (const r of rects) {
    const rx = Math.min(r.x1, r.x2) * width
    const ry = Math.min(r.y1, r.y2) * height
    const rw = Math.abs(r.x2 - r.x1) * width
    const rh = Math.abs(r.y2 - r.y1) * height
    if (r.mode === 'erase') {
      mctx.globalCompositeOperation = 'destination-out'
      mctx.fillStyle = '#000'
    } else {
      mctx.globalCompositeOperation = 'source-over'
      mctx.fillStyle = '#FFFFFF'
    }
    mctx.fillRect(rx, ry, rw, rh)
  }

  // Passe 2 : strokes pinceau (disques le long du tracé)
  for (const stroke of strokes) {
    const radiusPx = Math.max(1, stroke.radius * scale)
    mctx.lineWidth = radiusPx * 2
    mctx.lineCap = 'round'
    mctx.lineJoin = 'round'
    if (stroke.mode === 'paint') {
      mctx.globalCompositeOperation = 'source-over'
      mctx.strokeStyle = '#FFFFFF'
      mctx.fillStyle = '#FFFFFF'
    } else {
      mctx.globalCompositeOperation = 'destination-out'
      mctx.strokeStyle = '#000'
      mctx.fillStyle = '#000'
    }
    if (stroke.points.length === 0) continue
    if (stroke.points.length === 1) {
      const pt = stroke.points[0]
      mctx.beginPath()
      mctx.arc(pt.x * width, pt.y * height, radiusPx, 0, Math.PI * 2)
      mctx.fill()
      continue
    }
    mctx.beginPath()
    const first = stroke.points[0]
    mctx.moveTo(first.x * width, first.y * height)
    for (let i = 1; i < stroke.points.length; i++) {
      const pt = stroke.points[i]
      mctx.lineTo(pt.x * width, pt.y * height)
    }
    mctx.stroke()
  }
  mctx.globalCompositeOperation = 'source-over'

  // Étape 2 : teinter le masque avec la couleur d'accent (sans feather pour
  // garder les bords nets des rectangles). On utilise un feather modéré
  // uniquement si on a des strokes (radius brush > 0).
  const maxStrokeRadius = strokes.reduce((m, s) => Math.max(m, s.radius), 0)
  const featherPx = maxStrokeRadius > 0 ? Math.max(2, Math.min(20, maxStrokeRadius * scale * 0.15)) : 0
  const rgba = hexToRgba(accentColor, fillAlpha)

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = rgba
  ctx.fillRect(0, 0, width, height)
  ctx.globalCompositeOperation = 'destination-in'
  if (featherPx > 0) ctx.filter = `blur(${featherPx}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.restore()
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ── Poignée de coin pour le resize du sprite sélectionné ────────────────

function ResizeCorner({
  left, top, index, kind = 'npc', onMouseDown, cursor,
}: {
  left: number
  top: number
  index: number
  kind?: 'npc' | 'item'
  onMouseDown: (e: React.MouseEvent, index: number, kind?: 'npc' | 'item') => void
  cursor: 'nwse-resize' | 'nesw-resize'
}) {
  return (
    <div
      onMouseDown={e => onMouseDown(e, index, kind)}
      style={{
        position: 'absolute',
        left: left - 5,
        top: top - 5,
        width: 10,
        height: 10,
        background: 'white',
        border: '1.5px solid var(--ie-accent)',
        borderRadius: 2,
        cursor,
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        zIndex: 2,
      }}
    />
  )
}
