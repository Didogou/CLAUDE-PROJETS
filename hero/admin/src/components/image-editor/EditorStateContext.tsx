'use client'
/**
 * EditorStateContext : état partagé de l'éditeur d'image.
 *
 * Responsabilités :
 *   - Composition de scène (NPCs + items + choix + conversations placés)
 *   - Sélection courante (single ou multi-select Shift+clic)
 *   - Historique pour Undo/Redo sur les placements
 *   - Mutations typées (addNpc, updateNpc, removeNpc, etc.)
 *
 * Permet à la Sidebar (folds), au Canvas (overlays), et au GenerationPanel
 * de partager l'état sans prop-drilling.
 */
import React, { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type {
  EditorSceneComposition,
  EditorNpcPlacement,
  EditorItemPlacement,
  EditorChoicePlacement,
  EditorConversationPlacement,
  EditorLayer,
  LayerMediaType,
} from './types'

// ── Types de sélection ───────────────────────────────────────────────────

export type SelectedPlacement =
  | { kind: 'npc'; index: number }
  | { kind: 'item'; index: number }
  | { kind: 'choice'; index: number }
  | { kind: 'conversation'; index: number }

/**
 * Zone de découpe rectangulaire sur l'image (coordonnées normalisées 0-1
 * par rapport à la taille naturelle de l'image). Utilisée par le Fold Découpe
 * pour LAMA erase, recolorer, remplacer par bg, etc.
 */
export interface CutSelection {
  x1: number   // coin haut-gauche x (0-1)
  y1: number
  x2: number   // coin bas-droit x (0-1)
  y2: number
}

/**
 * Un trait de pinceau — chaîne de points (coords normalisées 0-1) avec un
 * rayon uniforme (fraction de min(w,h) de l'image naturelle) et un mode
 * paint/erase. Stockage vectoriel pour permettre undo par trait + rerender
 * exact au resize d'affichage.
 */
export interface BrushStroke {
  points: Array<{ x: number; y: number }>
  radius: number
  mode: 'paint' | 'erase'
}

/** Outil actif dans le fold Découpe. 'wand' = baguette magique SAM,
 *  'brush' = pinceau manuel. Changer d'outil vide l'état de l'autre. */
/** Outils de découpe disponibles dans le Designer.
 *  - 'wand'         : SAM Auto (drag rectangle → multi-objets IA — déprécié UI)
 *  - 'brush'        : Pinceau manuel (peindre le mask au pixel)
 *  - 'magic_wand'   : Magic Wand classique (click pixel → flood fill par tolérance couleur)
 *  - 'grabcut'      : GrabCut OpenCV (drag rectangle → 1 objet propre)
 *  - 'sam_prompt'   : SAM 2 prompt-point (click pixel → 1 objet sémantique IA)
 *  - 'lasso_poly'   : Lasso polygonal (clics droits → polygone fermé)
 *  - 'lasso_free'   : Lasso libre (drag continu → polygone ferme à la libération)
 */
export type CutTool = 'wand' | 'brush' | 'magic_wand' | 'grabcut' | 'sam_prompt' | 'lasso_poly' | 'lasso_free'

/** State du tracé lasso en cours (polygonal ou libre).
 *  Vide = aucun lasso en cours. Une fois fermé, le polygon est converti en mask
 *  et ajouté à wandMasks par CatalogEdit (puis cleared). */
export interface LassoDraft {
  /** Points du polygone en coords normalisées 0-1 */
  points: Array<{ x: number; y: number }>
  /** Mode de tracé courant */
  mode: 'lasso_poly' | 'lasso_free'
  /** true quand le user a fermé le polygone (double-clic ou release pour free) */
  closed: boolean
}

/** Une entrée mask dans wandMasks. Les contours sont optionnels (set par Magic
 *  Wand uniquement, SAM ne les fournit pas). Quand présents, CanvasOverlay rend
 *  le mask en SVG marching ants au lieu du mask raster classique. */
export interface WandMaskEntry {
  url: string
  index: number
  /** Contours vectoriels en coords normalisées 0-1 (Magic Wand uniquement) */
  contours?: Array<{
    inner: boolean
    points: Array<{ x: number; y: number }>
  }>
}

/** Résultat d'une détection issue de la pré-analyse (scene-analyzer) :
 *  un objet identifié dans l'image avec son label + bbox normalisée + mask URL.
 *  Stocké dans le State global pour que les composants UI (panneau Découpe,
 *  CanvasOverlay) puissent rendre la liste + interactions hover/click.
 *
 *  Format aligné sur la réponse de /api/comfyui/analyze-scene. */
export interface SceneDetection {
  id: string
  label: string
  /** Bbox normalisée [x1, y1, x2, y2] dans [0,1] */
  bbox: [number, number, number, number]
  bbox_pixels: [number, number, number, number]
  mask_url: string | null
  source?: 'dense' | 'od'
  error?: string
}

/** État de la pré-analyse de l'image courante. `result` null tant que pas
 *  encore lancée ou si l'analyse a échoué. `busy` true pendant les ~80-100s
 *  d'analyse ComfyUI (Florence + Qwen + DINO + SAM 1 HQ). */
export interface SceneAnalysisState {
  /** Image URL pour laquelle on a le résultat. Permet de détecter qu'une
   *  nouvelle image a été chargée et qu'il faut relancer l'analyse. */
  imageUrl: string | null
  detections: SceneDetection[]
  busy: boolean
  error: string | null
  /** Timestamp du dernier run réussi (ms epoch) — pour debug et invalidation */
  analyzedAt: number | null
}


// ── State + Reducer ──────────────────────────────────────────────────────

/** Entrée d'historique — snapshot combiné des calques ET de l'URL image.
 *  Permet à Ctrl+Z d'annuler aussi bien une mutation de calque qu'un remplacement
 *  d'image (ex : erase LAMA, inpaint, sélection de variante). */
interface HistoryEntry {
  layers: EditorLayer[]
  imageUrl: string | null
}

interface State {
  /** Stack de calques. Index 0 = calque le plus en bas (background), dernier = top (foreground). */
  layers: EditorLayer[]
  /** URL de l'image de base affichée sur le Canvas. Incluse dans l'historique
   *  pour que les opérations destructives (erase, inpaint) soient annulables. */
  imageUrl: string | null
  /** Index du calque actuellement édité (sélection des sprites, mutations…). */
  activeLayerIdx: number
  selected: SelectedPlacement[]   // multi-selection via Shift+clic
  cutSelection: CutSelection | null  // rectangle tracé dans le fold Découpe (limite la zone de détection SAM)
  cutMode: boolean                // true quand le fold Découpe est ouvert
  /** True tant que l'utilisateur fait un drag-to-draw du rect. On attend
   *  `false` (= mouseup) avant de déclencher SAM — sinon SAM partirait au
   *  premier pixel de mouvement. */
  cutDragging: boolean
  /** Masks SAM auto détectés dans le rectangle (N objets). Utilisés par le
   *  CanvasOverlay pour le hover "baguette magique" — on charge les pixels
   *  localement et on détecte le plus petit mask sous le curseur.
   *  contours optionnels (set par Magic Wand) → utilisés par CanvasOverlay pour
   *  rendre les marching ants SVG (pas de contours = rendu mask classique). */
  wandMasks: WandMaskEntry[]
  /** URL du mask sélectionné via clic (après hover sur baguette magique).
   *  Les actions (erase/inpaint/calque animé) opèrent sur ce mask. */
  currentMaskUrl: string | null
  /** URLs des zones SAM actuellement SÉLECTIONNÉES via clic.
   *  Simple clic = toggle (ajoute si pas là, retire si présent).
   *  `currentMaskUrl` = union de ces URLs (calculée par FoldCut via effect). */
  selectedWandUrls: string[]
  /** Busy flag — SAM auto en cours (30-60s premier run, cache ensuite). */
  wandBusy: boolean
  /** Outil actif dans le fold Découpe. */
  cutTool: CutTool
  /** Dernier pixel cliqué sur le canvas en mode 'magic_wand' (coords normalisées 0-1).
   *  CatalogEdit écoute ce signal pour déclencher un floodFill MagicWand. ts = timestamp
   *  pour permettre 2 clics au même endroit (re-trigger). */
  pixelPick: { x: number; y: number; ts: number } | null
  /** Tracé lasso en cours (Polygonal ou Libre). null si aucun tracé en cours.
   *  Quand `closed: true`, CatalogEdit convertit le polygone en mask et clear. */
  lassoDraft: LassoDraft | null
  /** PNG transparent pleine taille = composite cumulatif des extractions.
   *  Chaque clic "Extraire" rajoute le contenu courant à cette image (overlay
   *  alpha sur l'existant) — UNE SEULE vignette dans le panneau gauche, qui
   *  s'enrichit. Cleared via clearCutResult (icône trash dans le panel). */
  cutResultUrl: string | null
  /** Traits de pinceau dessinés par l'utilisateur (outil 'brush').
   *  Vidés au switch d'outil ou au Reset. */
  brushStrokes: BrushStroke[]
  /** Rayon courant du pinceau, en fraction de min(imgW, imgH). 0.02 = ~2% */
  brushSize: number
  /** Mode courant : paint (ajoute au mask) ou erase (retire du mask). */
  brushMode: 'paint' | 'erase'
  /** Quelle zone du calque météo actif est en cours d'édition (rect/brush).
   *  'main'   = weather.zone (pluie/neige/brouillard/nuages — où l'effet apparaît)
   *  'impact' = une zone de weather.impactZones (ciblée par `activeImpactZoneId`)
   *  Permet au CanvasOverlay de savoir quelle zone patcher quand l'utilisateur
   *  dessine, et au rendu de colorier le preview différemment (teal vs orange). */
  editingWeatherZone: 'main' | 'impact'
  /** Si `editingWeatherZone === 'impact'`, id de la zone dans impactZones
   *  qui reçoit les mutations (clicks rect, strokes brush). */
  activeImpactZoneId: string | null
  /** L'utilisateur a explicitement activé le pinceau en cliquant sur le
   *  bouton "Pinceau" d'une zone. Sans ce flag, même si zone.mode === 'brush'
   *  (valeur persistée), le curseur rond ne s'affiche pas → évite qu'il
   *  apparaisse juste parce qu'on a ouvert un panel sans intention de peindre.
   *  Reset : tout changement d'éditing target, tout changement de calque,
   *  tout clic sur Pleine / Rectangle. */
  weatherBrushEngaged: boolean
  /** État du bake animation (motion_brush / cinemagraph) — null = pas de bake
   *  en cours. Lifté dans le context (vs state local de FoldAnimationBake)
   *  pour que le status survive aux re-render/unmount du fold et que le
   *  BakeProgressModal puisse s'afficher depuis la racine ImageEditor. */
  /** Pré-analyse de la scène : catalogue d'objets détectés au chargement
   *  de l'image. Alimenté par usePreAnalyzeImage qui appelle
   *  /api/comfyui/analyze-scene avec la stratégie validée (f_qwen_sam1hq). */
  sceneAnalysis: SceneAnalysisState
  /** Détection actuellement sélectionnée (clic sur l'intérieur de l'objet
   *  découpé). null = pas de sélection. Drive l'UI : drawer ciseau ouvert,
   *  sub-tools de découpe désactivés, action icons (Supprimer/Calque/...)
   *  activés, gomme on-image visible sur la détection sélectionnée. */
  selectedDetectionId: string | null
  /** ZoomLoupe activée manuellement par le bouton dédié (en plus des
   *  conditions auto liées aux sub-tools Lasso/Brush). True = afficher la
   *  loupe même hors session de découpe. ESC ou re-clic du bouton la ferme. */
  zoomLoupeManualOpen: boolean
  bakeStatus: {
    startedAt: number
    phase: string
    /** kind du processus en cours, drive l'icône + libellé du modal :
     *  - motion_brush / cinemagraph : bake d'animation Wan
     *  - sam_cut : analyse SAM pour découpe (étape de détection des objets)
     *  - grabcut : compute GrabCut (OpenCV) — éventuellement précédé du
     *    chargement initial de la lib OpenCV.js (~10 MB) */
    kind: 'motion_brush' | 'cinemagraph' | 'sam_cut' | 'grabcut'
    estimatedTotalSec: number
  } | null
  /** Compteur incrémenté à chaque clic sur le fond image — la Sidebar
   *  l'écoute pour fermer tous ses folds (même si rien n'était sélectionné). */
  backgroundClickTick: number
  /** Historique pour undo/redo. Chaque entrée = snapshot (layers + imageUrl). */
  history: HistoryEntry[]
  historyIndex: number
}

type Action =
  | { type: 'add_npc'; placement: EditorNpcPlacement }
  | { type: 'update_npc'; index: number; patch: Partial<EditorNpcPlacement> }
  | { type: 'remove_npc'; index: number }
  | { type: 'reorder_npcs'; from: number; to: number }
  | { type: 'set_npcs'; npcs: EditorNpcPlacement[] }    // remplace l'array entier (pour Reorder.Group)
  | { type: 'add_item'; placement: EditorItemPlacement }
  | { type: 'update_item'; index: number; patch: Partial<EditorItemPlacement> }
  | { type: 'remove_item'; index: number }
  | { type: 'reorder_items'; from: number; to: number }
  | { type: 'set_items'; items: EditorItemPlacement[] }
  | { type: 'add_choice'; placement: EditorChoicePlacement }
  | { type: 'update_choice'; index: number; patch: Partial<EditorChoicePlacement> }
  | { type: 'remove_choice'; index: number }
  | { type: 'add_conversation'; placement: EditorConversationPlacement }
  | { type: 'remove_conversation'; index: number }
  | { type: 'set_selected'; selected: SelectedPlacement[] }
  | { type: 'toggle_selected'; placement: SelectedPlacement }
  | { type: 'clear_selected' }
  | { type: 'set_cut_selection'; selection: CutSelection | null }
  | { type: 'set_cut_mode'; on: boolean }
  | { type: 'set_cut_dragging'; dragging: boolean }
  | { type: 'set_wand_masks'; masks: WandMaskEntry[] }
  | { type: 'push_wand_mask'; mask: Omit<WandMaskEntry, 'index'> }
  | { type: 'patch_wand_mask_url'; oldUrl: string; newUrl: string }
  | { type: 'set_cut_result'; url: string | null }
  | { type: 'set_current_mask'; url: string | null }
  | { type: 'toggle_wand_selection'; url: string }
  | { type: 'clear_wand_selection' }
  | { type: 'set_wand_selection'; urls: string[] }
  | { type: 'set_wand_busy'; busy: boolean }
  | { type: 'clear_wand' }
  | { type: 'set_cut_tool'; tool: CutTool }
  | { type: 'set_pixel_pick'; pick: { x: number; y: number; ts: number } | null }
  | { type: 'set_lasso_draft'; draft: LassoDraft | null }
  | { type: 'lasso_add_point'; point: { x: number; y: number } }
  | { type: 'lasso_close' }
  | { type: 'add_brush_stroke'; stroke: BrushStroke }
  | { type: 'undo_brush_stroke' }
  | { type: 'clear_brush_strokes' }
  | { type: 'set_brush_size'; size: number }
  | { type: 'set_brush_mode'; mode: 'paint' | 'erase' }
  | { type: 'set_editing_weather_zone'; target: 'main' | 'impact'; impactZoneId?: string | null }
  | { type: 'set_weather_brush_engaged'; engaged: boolean }
  | { type: 'set_bake_status'; status: State['bakeStatus'] }
  | { type: 'signal_background_click' }
  // ── Calques ──
  | { type: 'add_layer'; layer?: Partial<EditorLayer>; insertAt?: number }
  | { type: 'remove_layer'; index: number }
  | { type: 'set_active_layer'; index: number }
  | { type: 'update_layer'; index: number; patch: Partial<EditorLayer> }
  | { type: 'set_active_layer_view'; view: import('./types').MenuView }
  | { type: 'reorder_layers'; from: number; to: number }
  | { type: 'set_layers'; layers: EditorLayer[]; activeIdx?: number }
  | { type: 'set_image_url'; url: string | null }
  /** Remplace la base courante par une nouvelle (sélection d'une variante,
   *  pick depuis la banque, etc.). Distinct de `set_image_url` car cascade
   *  delete : on jette tous les calques + cut state + scene analysis liés
   *  à l'ancienne base, puisqu'ils ne s'appliquent plus. Atomique → undoable
   *  via Ctrl+Z (restore image + calques en une fois). */
  | { type: 'replace_base'; url: string | null }
  | { type: 'set_scene_analysis_busy'; busy: boolean; imageUrl: string | null }
  | { type: 'set_scene_analysis_result'; imageUrl: string; detections: SceneDetection[]; analyzedAt: number }
  | { type: 'set_scene_analysis_error'; error: string | null }
  | { type: 'clear_scene_analysis' }
  | { type: 'remove_scene_detection'; id: string }
  | { type: 'set_selected_detection'; id: string | null }
  | { type: 'set_zoom_loupe_manual_open'; open: boolean }
  | { type: 'undo' }
  | { type: 'redo' }

const MAX_HISTORY = 50

/** Génère un identifiant unique stable pour un placement.
 *  Utilisé pour que framer-motion Reorder puisse tracker chaque ligne
 *  même si plusieurs placements pointent vers le même npc_id/item_id. */
function genUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `uid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Garantit que tous les placements ont un _uid (back-compat avec données
 *  pré-existantes ou hydratées sans _uid). */
function ensureUids(comp: EditorSceneComposition): EditorSceneComposition {
  return {
    ...comp,
    npcs: comp.npcs.map(p => p._uid ? p : { ...p, _uid: genUid() }),
    items: comp.items.map(p => p._uid ? p : { ...p, _uid: genUid() }),
  }
}

function pushHistory(state: State, nextLayers: EditorLayer[], nextImageUrl?: string | null): State {
  const imageUrl = nextImageUrl !== undefined ? nextImageUrl : state.imageUrl
  const nextHistory = [
    ...state.history.slice(0, state.historyIndex + 1),
    { layers: nextLayers, imageUrl },
  ].slice(-MAX_HISTORY)
  return {
    ...state,
    layers: nextLayers,
    imageUrl,
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
  }
}

/** Helper : récupère la composition du calque actif (objet vide safe si calque média). */
function activeComp(state: State): EditorSceneComposition {
  return state.layers[state.activeLayerIdx]?.composition ?? { npcs: [], items: [] }
}

/** Helper : applique un mutator à la composition du calque actif et renvoie le nouvel array de calques. */
function withActiveComp(
  state: State,
  mutator: (comp: EditorSceneComposition) => EditorSceneComposition,
): EditorLayer[] {
  return state.layers.map((l, i) => {
    if (i !== state.activeLayerIdx) return l
    const current = l.composition ?? { npcs: [], items: [] }
    return { ...l, composition: mutator(current) }
  })
}

/** Crée un calque vide de type 'composition' (utilisé pour le calque par défaut + nouveau calque). */
function makeEmptyLayer(name: string): EditorLayer {
  return {
    _uid: genUid(),
    asset_id: null,
    name,
    type: 'composition',
    composition: { npcs: [], items: [] },
    visible: true,
    opacity: 1,
    blend: 'normal',
  }
}

function reducer(state: State, action: Action): State {
  const comp = activeComp(state)
  switch (action.type) {
    case 'add_npc':
      return pushHistory(state, withActiveComp(state, c => ({ ...c, npcs: [...c.npcs, action.placement] })))
    case 'update_npc':
      return pushHistory(state, withActiveComp(state, c => ({
        ...c,
        npcs: c.npcs.map((p, i) => i === action.index ? { ...p, ...action.patch } : p),
      })))
    case 'remove_npc': {
      const newLayers = withActiveComp(state, c => ({
        ...c, npcs: c.npcs.filter((_, i) => i !== action.index),
      }))
      const nextSelected = state.selected.filter(s => !(s.kind === 'npc' && s.index === action.index))
      return { ...pushHistory(state, newLayers), selected: nextSelected }
    }
    case 'reorder_npcs': {
      const arr = [...comp.npcs]
      const [moved] = arr.splice(action.from, 1)
      arr.splice(action.to, 0, moved)
      const nextSelected = state.selected.map(s => {
        if (s.kind !== 'npc') return s
        if (s.index === action.from) return { ...s, index: action.to }
        if (action.from < action.to && s.index > action.from && s.index <= action.to) return { ...s, index: s.index - 1 }
        if (action.from > action.to && s.index >= action.to && s.index < action.from) return { ...s, index: s.index + 1 }
        return s
      })
      return { ...pushHistory(state, withActiveComp(state, c => ({ ...c, npcs: arr }))), selected: nextSelected }
    }
    case 'set_npcs': {
      const oldUids = comp.npcs.map(p => p._uid)
      const nextSelected = state.selected.map(s => {
        if (s.kind !== 'npc') return s
        const uid = oldUids[s.index]
        const newIdx = action.npcs.findIndex(p => p._uid === uid)
        return newIdx >= 0 ? { ...s, index: newIdx } : s
      })
      return { ...pushHistory(state, withActiveComp(state, c => ({ ...c, npcs: action.npcs }))), selected: nextSelected }
    }
    case 'add_item':
      return pushHistory(state, withActiveComp(state, c => ({ ...c, items: [...c.items, action.placement] })))
    case 'update_item':
      return pushHistory(state, withActiveComp(state, c => ({
        ...c,
        items: c.items.map((p, i) => i === action.index ? { ...p, ...action.patch } : p),
      })))
    case 'remove_item': {
      const newLayers = withActiveComp(state, c => ({ ...c, items: c.items.filter((_, i) => i !== action.index) }))
      const nextSelected = state.selected.filter(s => !(s.kind === 'item' && s.index === action.index))
      return { ...pushHistory(state, newLayers), selected: nextSelected }
    }
    case 'reorder_items': {
      const arr = [...comp.items]
      const [moved] = arr.splice(action.from, 1)
      arr.splice(action.to, 0, moved)
      const nextSelected = state.selected.map(s => {
        if (s.kind !== 'item') return s
        if (s.index === action.from) return { ...s, index: action.to }
        if (action.from < action.to && s.index > action.from && s.index <= action.to) return { ...s, index: s.index - 1 }
        if (action.from > action.to && s.index >= action.to && s.index < action.from) return { ...s, index: s.index + 1 }
        return s
      })
      return { ...pushHistory(state, withActiveComp(state, c => ({ ...c, items: arr }))), selected: nextSelected }
    }
    case 'set_items': {
      const oldUids = comp.items.map(p => p._uid)
      const nextSelected = state.selected.map(s => {
        if (s.kind !== 'item') return s
        const uid = oldUids[s.index]
        const newIdx = action.items.findIndex(p => p._uid === uid)
        return newIdx >= 0 ? { ...s, index: newIdx } : s
      })
      return { ...pushHistory(state, withActiveComp(state, c => ({ ...c, items: action.items }))), selected: nextSelected }
    }
    case 'add_choice':
      return pushHistory(state, withActiveComp(state, c => ({ ...c, choices: [...(c.choices ?? []), action.placement] })))
    case 'update_choice':
      return pushHistory(state, withActiveComp(state, c => ({
        ...c,
        choices: (c.choices ?? []).map((p, i) => i === action.index ? { ...p, ...action.patch } : p),
      })))
    case 'remove_choice':
      return pushHistory(state, withActiveComp(state, c => ({
        ...c, choices: (c.choices ?? []).filter((_, i) => i !== action.index),
      })))
    case 'add_conversation':
      return pushHistory(state, withActiveComp(state, c => ({ ...c, conversations: [...(c.conversations ?? []), action.placement] })))
    case 'remove_conversation':
      return pushHistory(state, withActiveComp(state, c => ({
        ...c, conversations: (c.conversations ?? []).filter((_, i) => i !== action.index),
      })))

    case 'set_selected':     return { ...state, selected: action.selected }
    case 'toggle_selected': {
      const exists = state.selected.some(s => s.kind === action.placement.kind && s.index === action.placement.index)
      const nextSel = exists
        ? state.selected.filter(s => !(s.kind === action.placement.kind && s.index === action.placement.index))
        : [...state.selected, action.placement]
      return { ...state, selected: nextSel }
    }
    case 'clear_selected':   return { ...state, selected: [] }
    case 'set_cut_selection':
      // Changer le rect invalide les masks baguette magique (nouvelle zone à détecter)
      return {
        ...state,
        cutSelection: action.selection,
        wandMasks: [],
        currentMaskUrl: null,
      }
    case 'set_cut_mode': {
      // Idempotence : retourne la même ref si pas de changement (évite re-renders inutiles)
      if (state.cutMode === action.on) return state
      return {
        ...state,
        cutMode: action.on,
        cutSelection: action.on ? state.cutSelection : null,
        // Sortir du mode cut vide tout le state baguette magique
        wandMasks: action.on ? state.wandMasks : [],
        currentMaskUrl: action.on ? state.currentMaskUrl : null,
        wandBusy: action.on ? state.wandBusy : false,
      }
    }
    case 'set_cut_dragging':
      if (state.cutDragging === action.dragging) return state
      return { ...state, cutDragging: action.dragging }
    case 'set_wand_masks':
      return { ...state, wandMasks: action.masks, currentMaskUrl: null, selectedWandUrls: [] }
    case 'push_wand_mask': {
      // Append + auto-sélection. Évite le stale-closure des callers qui
      // feraient `setWandMasks([...wandMasks, newMask])` (l'array capturé
      // peut être obsolète si plusieurs ajouts en vol).
      const nextIndex = state.wandMasks.length
      const newMask: WandMaskEntry = { ...action.mask, index: nextIndex }
      return {
        ...state,
        wandMasks: [...state.wandMasks, newMask],
        selectedWandUrls: [...state.selectedWandUrls, newMask.url],
      }
    }
    case 'patch_wand_mask_url': {
      // Patch URL d'un mask + sync selectedWandUrls (Magic Wand : placeholder → réelle)
      const { oldUrl, newUrl } = action
      return {
        ...state,
        wandMasks: state.wandMasks.map(m =>
          m.url === oldUrl ? { ...m, url: newUrl } : m
        ),
        selectedWandUrls: state.selectedWandUrls.map(u =>
          u === oldUrl ? newUrl : u
        ),
      }
    }
    case 'set_current_mask':
      return { ...state, currentMaskUrl: action.url }
    case 'toggle_wand_selection': {
      const idx = state.selectedWandUrls.indexOf(action.url)
      return {
        ...state,
        selectedWandUrls: idx >= 0
          ? state.selectedWandUrls.filter((_, i) => i !== idx)
          : [...state.selectedWandUrls, action.url],
      }
    }
    case 'clear_wand_selection':
      return { ...state, selectedWandUrls: [], currentMaskUrl: null }

    case 'set_wand_selection':
      // Set explicite (utilisé par CatalogEdit pour auto-fill all après SAM
      // dans le nouveau workflow multi-select).
      return { ...state, selectedWandUrls: action.urls }
    case 'set_wand_busy':
      return { ...state, wandBusy: action.busy }
    case 'clear_wand':
      return { ...state, wandMasks: [], currentMaskUrl: null, selectedWandUrls: [], wandBusy: false }
    case 'set_cut_result':
      return state.cutResultUrl === action.url ? state : { ...state, cutResultUrl: action.url }
    case 'set_cut_tool': {
      if (state.cutTool === action.tool) return state
      // Switch d'outil → CONSERVE wandMasks / brushStrokes / selectedWandUrls
      // pour permettre le mix d'outils dans une même session de découpe (ex:
      // SAM Prompt sur 2 objets, puis Lasso libre sur un 3e — tout reste
      // dans la même découpe composite). On ne nettoie que les états
      // INACHEVÉS (pixel pick non consommé, lasso draft non fermé).
      return {
        ...state,
        cutTool: action.tool,
        pixelPick: null,
        lassoDraft: null,
      }
    }
    case 'set_pixel_pick':
      return { ...state, pixelPick: action.pick }
    case 'set_lasso_draft':
      return { ...state, lassoDraft: action.draft }
    case 'lasso_add_point': {
      // Si pas de draft → init avec le tool courant
      const prev = state.lassoDraft
      if (!prev) {
        const mode = state.cutTool === 'lasso_free' ? 'lasso_free' : 'lasso_poly'
        return {
          ...state,
          lassoDraft: { points: [action.point], mode, closed: false },
        }
      }
      // Sinon append
      return { ...state, lassoDraft: { ...prev, points: [...prev.points, action.point] } }
    }
    case 'lasso_close':
      if (!state.lassoDraft) return state
      return { ...state, lassoDraft: { ...state.lassoDraft, closed: true } }
    case 'add_brush_stroke':
      return { ...state, brushStrokes: [...state.brushStrokes, action.stroke] }
    case 'undo_brush_stroke':
      return state.brushStrokes.length === 0
        ? state
        : { ...state, brushStrokes: state.brushStrokes.slice(0, -1) }
    case 'clear_brush_strokes':
      return state.brushStrokes.length === 0 ? state : { ...state, brushStrokes: [] }
    case 'set_brush_size':
      return state.brushSize === action.size ? state : { ...state, brushSize: action.size }
    case 'set_brush_mode':
      return state.brushMode === action.mode ? state : { ...state, brushMode: action.mode }
    case 'set_editing_weather_zone': {
      const nextId = action.impactZoneId ?? null
      if (state.editingWeatherZone === action.target && state.activeImpactZoneId === nextId) return state
      // Tout changement de cible d'édition → on désengage le pinceau.
      // L'utilisateur devra re-cliquer explicitement sur Pinceau sur la
      // nouvelle zone pour réactiver le curseur rond.
      return {
        ...state,
        editingWeatherZone: action.target,
        activeImpactZoneId: action.target === 'impact' ? nextId : null,
        weatherBrushEngaged: false,
      }
    }
    case 'set_weather_brush_engaged':
      if (state.weatherBrushEngaged === action.engaged) return state
      return { ...state, weatherBrushEngaged: action.engaged }
    case 'set_bake_status':
      return { ...state, bakeStatus: action.status }
    case 'signal_background_click':
      // Incrémente le tick. La Sidebar s'abonne via useEffect pour fermer tous ses folds.
      return { ...state, backgroundClickTick: state.backgroundClickTick + 1, selected: [] }

    case 'undo': {
      if (state.historyIndex <= 0) return state
      const prev = state.history[state.historyIndex - 1]
      return { ...state, layers: prev.layers, imageUrl: prev.imageUrl, historyIndex: state.historyIndex - 1 }
    }
    case 'redo': {
      if (state.historyIndex >= state.history.length - 1) return state
      const next = state.history[state.historyIndex + 1]
      return { ...state, layers: next.layers, imageUrl: next.imageUrl, historyIndex: state.historyIndex + 1 }
    }
    case 'set_image_url': {
      if (state.imageUrl === action.url) return state
      return pushHistory(state, state.layers, action.url)
    }

    case 'replace_base': {
      // Cascade delete : nouvelle base → on jette tout ce qui était lié à
      // l'ancienne (calques, sélections, masks, scene analysis…). Atomique
      // dans l'historique : un seul Ctrl+Z restore image + calques.
      const freshLayers: EditorLayer[] = [makeEmptyLayer('Base')]
      const next = pushHistory(state, freshLayers, action.url)
      return {
        ...next,
        activeLayerIdx: 0,
        selected: [],
        cutSelection: null,
        cutMode: false,
        cutDragging: false,
        wandMasks: [],
        currentMaskUrl: null,
        selectedWandUrls: [],
        wandBusy: false,
        pixelPick: null,
        lassoDraft: null,
        cutResultUrl: null,
        brushStrokes: [],
        editingWeatherZone: 'main',
        activeImpactZoneId: null,
        weatherBrushEngaged: false,
        sceneAnalysis: { imageUrl: null, detections: [], busy: false, error: null, analyzedAt: null },
        selectedDetectionId: null,
      }
    }

    case 'set_scene_analysis_busy': {
      return {
        ...state,
        sceneAnalysis: {
          ...state.sceneAnalysis,
          busy: action.busy,
          imageUrl: action.imageUrl,
          // Si on lance une nouvelle analyse, on clear l'erreur précédente
          error: action.busy ? null : state.sceneAnalysis.error,
        },
      }
    }
    case 'set_scene_analysis_result': {
      return {
        ...state,
        sceneAnalysis: {
          imageUrl: action.imageUrl,
          detections: action.detections,
          busy: false,
          error: null,
          analyzedAt: action.analyzedAt,
        },
      }
    }
    case 'set_scene_analysis_error': {
      return {
        ...state,
        sceneAnalysis: { ...state.sceneAnalysis, busy: false, error: action.error },
      }
    }
    case 'clear_scene_analysis': {
      return {
        ...state,
        sceneAnalysis: { imageUrl: null, detections: [], busy: false, error: null, analyzedAt: null },
      }
    }
    case 'remove_scene_detection': {
      const nextSelected = state.selectedDetectionId === action.id ? null : state.selectedDetectionId
      return {
        ...state,
        sceneAnalysis: {
          ...state.sceneAnalysis,
          detections: state.sceneAnalysis.detections.filter(d => d.id !== action.id),
        },
        selectedDetectionId: nextSelected,
      }
    }
    case 'set_selected_detection': {
      if (state.selectedDetectionId === action.id) return state
      return { ...state, selectedDetectionId: action.id }
    }
    case 'set_zoom_loupe_manual_open': {
      if (state.zoomLoupeManualOpen === action.open) return state
      return { ...state, zoomLoupeManualOpen: action.open }
    }

    // ── Calques ──────────────────────────────────────────────────────────
    case 'add_layer': {
      const newLayer: EditorLayer = {
        ...makeEmptyLayer(action.layer?.name ?? `Calque ${state.layers.length + 1}`),
        ...action.layer,
        _uid: action.layer?._uid ?? genUid(),
      }
      const insertAt = action.insertAt ?? state.layers.length
      const nextLayers = [...state.layers]
      nextLayers.splice(insertAt, 0, newLayer)
      // L'utilisateur s'attend à éditer le nouveau calque immédiatement
      return { ...pushHistory(state, nextLayers), activeLayerIdx: insertAt, selected: [] }
    }
    case 'remove_layer': {
      if (state.layers.length <= 1) return state  // garde au moins 1 calque
      const nextLayers = state.layers.filter((_, i) => i !== action.index)
      const nextActive = action.index < state.activeLayerIdx
        ? state.activeLayerIdx - 1
        : action.index === state.activeLayerIdx
          ? Math.max(0, action.index - 1)
          : state.activeLayerIdx
      return { ...pushHistory(state, nextLayers), activeLayerIdx: nextActive, selected: [] }
    }
    case 'set_active_layer': {
      const idx = Math.max(0, Math.min(state.layers.length - 1, action.index))
      if (idx === state.activeLayerIdx) return state
      // Changement de calque → reset du contexte d'édition de zone météo
      // (évite de garder un zone id orphelin + curseur brush fantôme).
      return {
        ...state,
        activeLayerIdx: idx,
        selected: [],
        editingWeatherZone: 'main',
        activeImpactZoneId: null,
        weatherBrushEngaged: false,
      }
    }
    case 'update_layer': {
      const nextLayers = state.layers.map((l, i) =>
        i === action.index ? { ...l, ...action.patch } : l,
      )
      return pushHistory(state, nextLayers)
    }
    case 'set_active_layer_view': {
      // État UI pur — pas de push dans l'historique (l'utilisateur ne doit pas
      // pouvoir "undo" un changement de vue menu).
      if (state.layers[state.activeLayerIdx]?.activeView === action.view) return state
      const nextLayers = state.layers.map((l, i) =>
        i === state.activeLayerIdx ? { ...l, activeView: action.view } : l,
      )
      return { ...state, layers: nextLayers }
    }
    case 'reorder_layers': {
      const arr = [...state.layers]
      const [moved] = arr.splice(action.from, 1)
      arr.splice(action.to, 0, moved)
      // Remap activeLayerIdx pour suivre le calque déplacé
      let nextActive = state.activeLayerIdx
      if (state.activeLayerIdx === action.from) nextActive = action.to
      else if (action.from < action.to && state.activeLayerIdx > action.from && state.activeLayerIdx <= action.to) nextActive--
      else if (action.from > action.to && state.activeLayerIdx >= action.to && state.activeLayerIdx < action.from) nextActive++
      return { ...pushHistory(state, arr), activeLayerIdx: nextActive }
    }
    case 'set_layers': {
      const idx = action.activeIdx ?? Math.min(state.activeLayerIdx, action.layers.length - 1)
      return { ...pushHistory(state, action.layers), activeLayerIdx: Math.max(0, idx), selected: [] }
    }
  }
}

// ── Context ──────────────────────────────────────────────────────────────

interface EditorStateContextValue {
  /** Composition du calque actif (proxy transparent — les consumers existants
   *  voient leur composition habituelle sans connaître le système de calques). */
  composition: EditorSceneComposition
  /** Tous les calques de la stack (ordre : index 0 = bottom, dernier = top). */
  layers: EditorLayer[]
  /** Index du calque actuellement édité. */
  activeLayerIdx: number
  /** URL de l'image de base affichée — source de vérité pour le Canvas. */
  imageUrl: string | null
  /** Change l'image de base IN-PLACE (erase LAMA, inpaint Flux Fill, character
   *  swap output…) — les calques sont CONSERVÉS car ce sont des édits
   *  de la même base. Push dans l'historique (undoable). */
  setImageUrl: (url: string | null) => void
  /** Remplace la base par une NOUVELLE (sélection variante, pick banque, etc.).
   *  Cascade delete des calques + cut + scene analysis car ils ne s'appliquent
   *  plus à la nouvelle image. Atomique dans l'historique. */
  replaceBase: (url: string | null) => void
  selected: SelectedPlacement[]
  cutSelection: CutSelection | null
  cutMode: boolean
  cutDragging: boolean
  wandMasks: WandMaskEntry[]
  currentMaskUrl: string | null
  selectedWandUrls: string[]
  wandBusy: boolean
  cutTool: CutTool
  pixelPick: { x: number; y: number; ts: number } | null
  lassoDraft: LassoDraft | null
  cutResultUrl: string | null
  brushStrokes: BrushStroke[]
  brushSize: number
  brushMode: 'paint' | 'erase'
  editingWeatherZone: 'main' | 'impact'
  activeImpactZoneId: string | null
  weatherBrushEngaged: boolean
  /** Catalogue des objets détectés par la pré-analyse (scene-analyzer F).
   *  Source de vérité pour la liste cliquable du panneau Découpe + overlays canvas. */
  sceneAnalysis: SceneAnalysisState
  /** Détection actuellement sélectionnée (clic dans l'intérieur d'une découpe).
   *  null = pas de sélection. Voir doc ci-dessus dans State. */
  selectedDetectionId: string | null
  /** ZoomLoupe ouverte manuellement par le bouton dédié. */
  zoomLoupeManualOpen: boolean
  bakeStatus: State['bakeStatus']
  /** Compteur — incrémenté à chaque clic sur fond image, écouté par Sidebar. */
  backgroundClickTick: number
  canUndo: boolean
  canRedo: boolean
  // Mutations NPC
  addNpc: (p: Omit<EditorNpcPlacement, '_uid'>) => void
  updateNpc: (index: number, patch: Partial<EditorNpcPlacement>) => void
  removeNpc: (index: number) => void
  reorderNpcs: (from: number, to: number) => void
  setNpcs: (npcs: EditorNpcPlacement[]) => void
  // Mutations item
  addItem: (p: Omit<EditorItemPlacement, '_uid'>) => void
  updateItem: (index: number, patch: Partial<EditorItemPlacement>) => void
  removeItem: (index: number) => void
  reorderItems: (from: number, to: number) => void
  setItems: (items: EditorItemPlacement[]) => void
  // Mutations choice
  addChoice: (p: EditorChoicePlacement) => void
  updateChoice: (index: number, patch: Partial<EditorChoicePlacement>) => void
  removeChoice: (index: number) => void
  // Mutations conversation
  addConversation: (p: EditorConversationPlacement) => void
  removeConversation: (index: number) => void
  // Sélection
  setSelected: (sel: SelectedPlacement[]) => void
  toggleSelected: (p: SelectedPlacement) => void
  clearSelected: () => void
  // Zone de découpe
  setCutSelection: (sel: CutSelection | null) => void
  setCutMode: (on: boolean) => void
  setCutDragging: (dragging: boolean) => void
  setWandMasks: (masks: WandMaskEntry[]) => void
  /** Append un mask à wandMasks + auto-select. Atomique côté reducer →
   *  évite le stale-closure quand plusieurs ajouts asynchrones se chevauchent.
   *  L'index est calculé automatiquement (= length au moment du push). */
  pushWandMask: (mask: Omit<WandMaskEntry, 'index'>) => void
  /** Patch l'URL d'un mask existant (cas Magic Wand : url placeholder
   *  → url réelle après upload background). Identifie par oldUrl. */
  patchWandMaskUrl: (oldUrl: string, newUrl: string) => void
  setCurrentMask: (url: string | null) => void
  toggleWandSelection: (url: string) => void
  clearWandSelection: () => void
  /** Set explicite de la selection (ex: auto-fill all après SAM dans le nouveau
   * workflow multi-select de CatalogEdit). */
  setSelectedWandUrls: (urls: string[]) => void
  setWandBusy: (busy: boolean) => void
  clearWand: () => void
  setCutTool: (tool: CutTool) => void
  /** Set le dernier pixel cliqué en mode magic_wand (déclenche un floodFill côté CatalogEdit). */
  setPixelPick: (pick: { x: number; y: number; ts: number } | null) => void
  /** Lasso : remplace tout le draft (utilisé pour clear ou init avec mode explicite) */
  setLassoDraft: (draft: LassoDraft | null) => void
  /** Lasso : ajoute un point au draft courant (initialise si null) */
  lassoAddPoint: (point: { x: number; y: number }) => void
  /** Lasso : marque le polygone fermé (CatalogEdit consomme et le convertit en mask) */
  lassoClose: () => void
  /** Set l'URL du composite d'extraction (ou null pour reset). Appelé par
   *  DesignerLayout.handleExtract après chaque "Extraire" (URL du nouveau
   *  composite cumulatif). */
  setCutResult: (url: string | null) => void
  /** Reset l'extraction composite (icône trash dans le panneau gauche).
   *  N'efface PAS les sélections (marching ants) qui restent actives. */
  clearCutResult: () => void
  addBrushStroke: (stroke: BrushStroke) => void
  undoBrushStroke: () => void
  clearBrushStrokes: () => void
  setBrushSize: (size: number) => void
  setBrushMode: (mode: 'paint' | 'erase') => void
  setEditingWeatherZone: (target: 'main' | 'impact', impactZoneId?: string | null) => void
  setWeatherBrushEngaged: (engaged: boolean) => void
  setBakeStatus: (status: State['bakeStatus']) => void
  /** Marque l'analyse comme en cours pour une image donnée (busy=true).
   *  Le hook usePreAnalyzeImage l'appelle au début de l'API call. */
  setSceneAnalysisBusy: (busy: boolean, imageUrl: string | null) => void
  /** Set le résultat complet de la pré-analyse (succès). */
  setSceneAnalysisResult: (imageUrl: string, detections: SceneDetection[], analyzedAt: number) => void
  /** Marque l'analyse en erreur (avec message). */
  setSceneAnalysisError: (error: string | null) => void
  /** Reset complet (ex: avant de charger une nouvelle image). */
  clearSceneAnalysis: () => void
  /** Retire UNE détection du catalogue (gomme on-image). Non destructif sur
   *  l'image source — seulement filtre la liste de candidats à l'extraction. */
  removeSceneDetection: (id: string) => void
  /** Sélectionne une détection (= un clic intérieur dans son contour) ou clear
   *  si null. Drive l'ouverture du drawer + activation/désactivation des outils. */
  setSelectedDetection: (id: string | null) => void
  /** Ouvre/ferme la ZoomLoupe manuellement. Utilisé par le bouton dédié au
   *  coin de la canvas-zone (en dehors de l'image). */
  setZoomLoupeManualOpen: (open: boolean) => void
  /** Signal pour fermer tous les folds Sidebar + désélectionner — appelé par
   *  Canvas au clic sur le fond image. */
  signalBackgroundClick: () => void
  // Calques
  addLayer: (init?: Partial<EditorLayer>, insertAt?: number) => void
  removeLayer: (index: number) => void
  setActiveLayer: (index: number) => void
  updateLayer: (index: number, patch: Partial<EditorLayer>) => void
  /** Change la vue sidebar (image/animation) du calque actif — sans push
   *  dans l'historique (état UI pur, pas undoable). */
  setActiveLayerView: (view: import('./types').MenuView) => void
  reorderLayers: (from: number, to: number) => void
  setLayers: (layers: EditorLayer[], activeIdx?: number) => void
  // Historique
  undo: () => void
  redo: () => void
  // Helpers de sélection
  isSelected: (p: SelectedPlacement) => boolean
  getFirstSelected: () => SelectedPlacement | null
}

const EditorStateContext = createContext<EditorStateContextValue | null>(null)

export function EditorStateProvider({
  children,
  initialComposition,
  initialImageUrl = null,
  initialLayers: hydratedLayers,
}: {
  children: ReactNode
  initialComposition?: EditorSceneComposition
  /** URL de l'image d'entrée à hydrater comme base de l'éditeur. */
  initialImageUrl?: string | null
  /** Stack de calques à hydrater depuis la DB (depuis la dernière sauvegarde).
   *  Si fourni et non vide, remplace le calque Base par défaut — reprend le
   *  travail du user là où il en était. */
  initialLayers?: EditorLayer[]
}) {
  // Si des calques persistés sont fournis (reprise de session), on les hydrate
  // tels quels. Sinon on crée le calque Base par défaut à partir de la
  // composition initiale. L'éditeur a TOUJOURS au moins un calque.
  const initialLayers: EditorLayer[] = hydratedLayers && hydratedLayers.length > 0
    ? hydratedLayers.map(l => ({
        ...l,
        // Garantit un _uid sur les calques chargés (back-compat si absent)
        _uid: l._uid ?? genUid(),
        // Ensure composition placements ont leurs _uid (back-compat)
        composition: l.composition ? ensureUids(l.composition) : l.composition,
      }))
    : [{
        ...makeEmptyLayer('Base'),
        composition: ensureUids(initialComposition ?? { npcs: [], items: [] }),
      }]
  const [state, dispatch] = useReducer(reducer, {
    layers: initialLayers,
    imageUrl: initialImageUrl,
    activeLayerIdx: 0,
    selected: [],
    cutSelection: null,
    cutMode: false,
    cutDragging: false,
    wandMasks: [],
    currentMaskUrl: null,
    selectedWandUrls: [],
    wandBusy: false,
    cutTool: 'wand',
    pixelPick: null,
    lassoDraft: null,
    cutResultUrl: null,
    brushStrokes: [],
    brushSize: 0.015, // ~1.5% min(w,h) — pointe fine par défaut, retouches précises (user peut grossir)
    brushMode: 'paint',
    editingWeatherZone: 'main',
    activeImpactZoneId: null,
    weatherBrushEngaged: false,
    sceneAnalysis: { imageUrl: null, detections: [], busy: false, error: null, analyzedAt: null },
    selectedDetectionId: null,
    zoomLoupeManualOpen: false,
    bakeStatus: null,
    backgroundClickTick: 0,
    history: [{ layers: initialLayers, imageUrl: initialImageUrl }],
    historyIndex: 0,
  })

  const isSelected = useCallback(
    (p: SelectedPlacement) => state.selected.some(s => s.kind === p.kind && s.index === p.index),
    [state.selected],
  )

  const getFirstSelected = useCallback(
    () => (state.selected.length > 0 ? state.selected[0] : null),
    [state.selected],
  )

  // ── Dispatchers stabilisés (useCallback empty deps — `dispatch` est déjà stable)
  // Sans ça, chaque re-render créait de nouvelles fonctions, ce qui faisait
  // boucler les useEffect ayant ces fonctions dans leurs deps (cf FoldCut).
  const addNpc = useCallback((p: Omit<EditorNpcPlacement, '_uid'>) => dispatch({ type: 'add_npc', placement: { ...p, _uid: genUid() } }), [])
  const updateNpc = useCallback((index: number, patch: Partial<EditorNpcPlacement>) => dispatch({ type: 'update_npc', index, patch }), [])
  const removeNpc = useCallback((index: number) => dispatch({ type: 'remove_npc', index }), [])
  const reorderNpcs = useCallback((from: number, to: number) => dispatch({ type: 'reorder_npcs', from, to }), [])
  const setNpcs = useCallback((npcs: EditorNpcPlacement[]) => dispatch({ type: 'set_npcs', npcs }), [])
  const addItem = useCallback((p: Omit<EditorItemPlacement, '_uid'>) => dispatch({ type: 'add_item', placement: { ...p, _uid: genUid() } }), [])
  const updateItem = useCallback((index: number, patch: Partial<EditorItemPlacement>) => dispatch({ type: 'update_item', index, patch }), [])
  const removeItem = useCallback((index: number) => dispatch({ type: 'remove_item', index }), [])
  const reorderItems = useCallback((from: number, to: number) => dispatch({ type: 'reorder_items', from, to }), [])
  const setItems = useCallback((items: EditorItemPlacement[]) => dispatch({ type: 'set_items', items }), [])
  const addChoice = useCallback((p: EditorChoicePlacement) => dispatch({ type: 'add_choice', placement: p }), [])
  const updateChoice = useCallback((index: number, patch: Partial<EditorChoicePlacement>) => dispatch({ type: 'update_choice', index, patch }), [])
  const removeChoice = useCallback((index: number) => dispatch({ type: 'remove_choice', index }), [])
  const addConversation = useCallback((p: EditorConversationPlacement) => dispatch({ type: 'add_conversation', placement: p }), [])
  const removeConversation = useCallback((index: number) => dispatch({ type: 'remove_conversation', index }), [])
  const setSelected = useCallback((sel: SelectedPlacement[]) => dispatch({ type: 'set_selected', selected: sel }), [])
  const toggleSelected = useCallback((p: SelectedPlacement) => dispatch({ type: 'toggle_selected', placement: p }), [])
  const clearSelected = useCallback(() => dispatch({ type: 'clear_selected' }), [])
  const setCutSelection = useCallback((sel: CutSelection | null) => dispatch({ type: 'set_cut_selection', selection: sel }), [])
  const setCutMode = useCallback((on: boolean) => dispatch({ type: 'set_cut_mode', on }), [])
  const setCutDragging = useCallback((dragging: boolean) => dispatch({ type: 'set_cut_dragging', dragging }), [])
  const setWandMasks = useCallback((masks: WandMaskEntry[]) => dispatch({ type: 'set_wand_masks', masks }), [])
  const pushWandMask = useCallback((mask: Omit<WandMaskEntry, 'index'>) => dispatch({ type: 'push_wand_mask', mask }), [])
  const patchWandMaskUrl = useCallback((oldUrl: string, newUrl: string) => dispatch({ type: 'patch_wand_mask_url', oldUrl, newUrl }), [])
  const setCurrentMask = useCallback((url: string | null) => dispatch({ type: 'set_current_mask', url }), [])
  const toggleWandSelection = useCallback((url: string) => dispatch({ type: 'toggle_wand_selection', url }), [])
  const clearWandSelection = useCallback(() => dispatch({ type: 'clear_wand_selection' }), [])
  const setSelectedWandUrls = useCallback((urls: string[]) => dispatch({ type: 'set_wand_selection', urls }), [])
  const setWandBusy = useCallback((busy: boolean) => dispatch({ type: 'set_wand_busy', busy }), [])
  const clearWand = useCallback(() => dispatch({ type: 'clear_wand' }), [])
  const setCutTool = useCallback((tool: CutTool) => dispatch({ type: 'set_cut_tool', tool }), [])
  const setPixelPick = useCallback((pick: { x: number; y: number; ts: number } | null) => dispatch({ type: 'set_pixel_pick', pick }), [])
  const setLassoDraft = useCallback((draft: LassoDraft | null) => dispatch({ type: 'set_lasso_draft', draft }), [])
  const lassoAddPoint = useCallback((point: { x: number; y: number }) => dispatch({ type: 'lasso_add_point', point }), [])
  const lassoClose = useCallback(() => dispatch({ type: 'lasso_close' }), [])
  const setCutResult = useCallback((url: string | null) => dispatch({ type: 'set_cut_result', url }), [])
  const clearCutResult = useCallback(() => dispatch({ type: 'set_cut_result', url: null }), [])
  const addBrushStroke = useCallback((stroke: BrushStroke) => dispatch({ type: 'add_brush_stroke', stroke }), [])
  const undoBrushStroke = useCallback(() => dispatch({ type: 'undo_brush_stroke' }), [])
  const clearBrushStrokes = useCallback(() => dispatch({ type: 'clear_brush_strokes' }), [])
  const setBrushSize = useCallback((size: number) => dispatch({ type: 'set_brush_size', size }), [])
  const setBrushMode = useCallback((mode: 'paint' | 'erase') => dispatch({ type: 'set_brush_mode', mode }), [])
  const setEditingWeatherZone = useCallback(
    (target: 'main' | 'impact', impactZoneId?: string | null) =>
      dispatch({ type: 'set_editing_weather_zone', target, impactZoneId }),
    [],
  )
  const setWeatherBrushEngaged = useCallback(
    (engaged: boolean) => dispatch({ type: 'set_weather_brush_engaged', engaged }),
    [],
  )
  const setBakeStatus = useCallback((status: State['bakeStatus']) => dispatch({ type: 'set_bake_status', status }), [])
  const setSceneAnalysisBusy = useCallback(
    (busy: boolean, imageUrl: string | null) => dispatch({ type: 'set_scene_analysis_busy', busy, imageUrl }), [])
  const setSceneAnalysisResult = useCallback(
    (imageUrl: string, detections: SceneDetection[], analyzedAt: number) =>
      dispatch({ type: 'set_scene_analysis_result', imageUrl, detections, analyzedAt }), [])
  const setSceneAnalysisError = useCallback(
    (error: string | null) => dispatch({ type: 'set_scene_analysis_error', error }), [])
  const clearSceneAnalysis = useCallback(() => dispatch({ type: 'clear_scene_analysis' }), [])
  const removeSceneDetection = useCallback((id: string) => dispatch({ type: 'remove_scene_detection', id }), [])
  const setSelectedDetection = useCallback((id: string | null) => dispatch({ type: 'set_selected_detection', id }), [])
  const setZoomLoupeManualOpen = useCallback((open: boolean) => dispatch({ type: 'set_zoom_loupe_manual_open', open }), [])
  const signalBackgroundClick = useCallback(() => dispatch({ type: 'signal_background_click' }), [])
  // Calques
  const addLayer = useCallback((init?: Partial<EditorLayer>, insertAt?: number) =>
    dispatch({ type: 'add_layer', layer: init, insertAt }), [])
  const removeLayer = useCallback((index: number) =>
    dispatch({ type: 'remove_layer', index }), [])
  const setActiveLayer = useCallback((index: number) =>
    dispatch({ type: 'set_active_layer', index }), [])
  const updateLayer = useCallback((index: number, patch: Partial<EditorLayer>) =>
    dispatch({ type: 'update_layer', index, patch }), [])
  const setActiveLayerView = useCallback((view: import('./types').MenuView) =>
    dispatch({ type: 'set_active_layer_view', view }), [])
  const setImageUrl = useCallback((url: string | null) =>
    dispatch({ type: 'set_image_url', url }), [])
  const replaceBase = useCallback((url: string | null) =>
    dispatch({ type: 'replace_base', url }), [])
  const reorderLayers = useCallback((from: number, to: number) =>
    dispatch({ type: 'reorder_layers', from, to }), [])
  const setLayers = useCallback((layers: EditorLayer[], activeIdx?: number) =>
    dispatch({ type: 'set_layers', layers, activeIdx }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])

  const value = useMemo<EditorStateContextValue>(() => ({
    // Composition exposée = celle du calque actif (proxy transparent)
    composition: activeComp(state),
    layers: state.layers,
    activeLayerIdx: state.activeLayerIdx,
    imageUrl: state.imageUrl,
    setImageUrl,
    replaceBase,
    selected: state.selected,
    cutSelection: state.cutSelection,
    cutMode: state.cutMode,
    cutDragging: state.cutDragging,
    setCutDragging,
    wandMasks: state.wandMasks,
    currentMaskUrl: state.currentMaskUrl,
    selectedWandUrls: state.selectedWandUrls,
    wandBusy: state.wandBusy,
    cutTool: state.cutTool,
    pixelPick: state.pixelPick,
    lassoDraft: state.lassoDraft,
    cutResultUrl: state.cutResultUrl,
    brushStrokes: state.brushStrokes,
    brushSize: state.brushSize,
    brushMode: state.brushMode,
    editingWeatherZone: state.editingWeatherZone,
    activeImpactZoneId: state.activeImpactZoneId,
    weatherBrushEngaged: state.weatherBrushEngaged,
    sceneAnalysis: state.sceneAnalysis,
    selectedDetectionId: state.selectedDetectionId,
    zoomLoupeManualOpen: state.zoomLoupeManualOpen,
    bakeStatus: state.bakeStatus,
    setWandMasks,
    pushWandMask,
    patchWandMaskUrl,
    setCurrentMask,
    toggleWandSelection,
    clearWandSelection,
    setSelectedWandUrls,
    setWandBusy,
    clearWand,
    setCutTool,
    setPixelPick,
    setLassoDraft,
    lassoAddPoint,
    lassoClose,
    setCutResult,
    clearCutResult,
    addBrushStroke,
    undoBrushStroke,
    clearBrushStrokes,
    setBrushSize,
    setBrushMode,
    setEditingWeatherZone,
    setWeatherBrushEngaged,
    setBakeStatus,
    setSceneAnalysisBusy,
    setSceneAnalysisResult,
    setSceneAnalysisError,
    clearSceneAnalysis,
    removeSceneDetection,
    setSelectedDetection,
    setZoomLoupeManualOpen,
    backgroundClickTick: state.backgroundClickTick,
    canUndo: state.historyIndex > 0,
    canRedo: state.historyIndex < state.history.length - 1,
    addNpc, updateNpc, removeNpc, reorderNpcs, setNpcs,
    addItem, updateItem, removeItem, reorderItems, setItems,
    addChoice, updateChoice, removeChoice,
    addConversation, removeConversation,
    setSelected, toggleSelected, clearSelected,
    setCutSelection, setCutMode, signalBackgroundClick,
    addLayer, removeLayer, setActiveLayer, updateLayer, setActiveLayerView, reorderLayers, setLayers,
    undo, redo,
    isSelected, getFirstSelected,
  }), [
    state, isSelected, getFirstSelected, setImageUrl, replaceBase, setCutDragging,
    setWandMasks, pushWandMask, patchWandMaskUrl, setCurrentMask, toggleWandSelection, clearWandSelection, setSelectedWandUrls, setWandBusy, clearWand,
    setCutTool,
    setPixelPick,
    setLassoDraft,
    lassoAddPoint,
    lassoClose, setCutResult, clearCutResult,
    addBrushStroke, undoBrushStroke, clearBrushStrokes, setBrushSize, setBrushMode,
    setEditingWeatherZone, setWeatherBrushEngaged,
    setBakeStatus,
    setSceneAnalysisBusy, setSceneAnalysisResult, setSceneAnalysisError, clearSceneAnalysis, removeSceneDetection, setSelectedDetection, setZoomLoupeManualOpen,
    addNpc, updateNpc, removeNpc, reorderNpcs, setNpcs,
    addItem, updateItem, removeItem, reorderItems, setItems,
    addChoice, updateChoice, removeChoice,
    addConversation, removeConversation,
    setSelected, toggleSelected, clearSelected,
    setCutSelection, setCutMode, signalBackgroundClick,
    addLayer, removeLayer, setActiveLayer, updateLayer, setActiveLayerView, reorderLayers, setLayers,
    undo, redo,
  ])

  return (
    <EditorStateContext.Provider value={value}>
      {children}
    </EditorStateContext.Provider>
  )
}

export function useEditorState(): EditorStateContextValue {
  const ctx = useContext(EditorStateContext)
  if (!ctx) throw new Error('useEditorState doit être utilisé dans un <EditorStateProvider>')
  return ctx
}
