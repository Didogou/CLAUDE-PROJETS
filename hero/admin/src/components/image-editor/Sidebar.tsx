'use client'
/**
 * Sidebar gauche : conteneur des folds outils (Ajouter NPJ, Découpe, etc.).
 *
 * 2 modes :
 *   - Expanded (défaut) : pleine largeur avec folds actifs
 *   - Collapsed         : rail étroit 48px avec juste le bouton d'expansion
 */
import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { Npc, Item, Choice } from '@/types'
import {
  FOLDS_BY_CONTEXT,
  FOLD_GROUPS,
  ANIMATION_FOLD_GROUPS,
  ANIMATION_KIND_LABELS,
  type EditorContext,
  type FoldId,
  type MenuView,
} from './types'
import FoldNPC from './folds/FoldNPC'
import FoldCut from './folds/FoldCut'
import FoldItem from './folds/FoldItem'
import FoldGenerateObject from './folds/FoldGenerateObject'
import FoldChoice from './folds/FoldChoice'
import FoldConversation from './folds/FoldConversation'
import OnSceneNpcs from './folds/OnSceneNpcs'
import OnSceneItems from './folds/OnSceneItems'
import FoldAnimationKind from './folds/FoldAnimationKind'
import FoldAnimationMask from './folds/FoldAnimationMask'
import FoldAnimationParams from './folds/FoldAnimationParams'
import FoldAnimationBake from './folds/FoldAnimationBake'
import FoldAtmosphere from './folds/FoldAtmosphere'
import MenuViewTabs from './MenuViewTabs'
import { useEditorState } from './EditorStateContext'
import { getWeatherLayerIcon } from './types'

const FOLD_LABELS: Record<FoldId, string> = {
  on_scene_npcs: 'Personnages',
  on_scene_items: 'Objets',
  add_npc: 'Ajouter un NPJ',
  add_object: 'Ajouter un objet',
  generate_object: 'Générer un objet',
  cut: 'Découpe',
  atmosphere: 'Atmosphère',
  place_choice: 'Placer un choix',
  place_conversation: 'Placer une conversation',
  anim_kind: 'Type d\'animation',
  anim_mask: 'Zone / Masque',
  anim_params: 'Paramètres',
  anim_bake: 'Générer',
}

interface SidebarProps {
  context: EditorContext
  collapsed: boolean
  onToggleCollapsed: () => void
  npcs: Npc[]
  items: Item[]
  choices: Choice[]
  imageUrl: string | null
  storagePathPrefix: string
  onImageReplaced: (newUrl: string) => void
  /** Affiche la rangée d'onglets de vues du menu en haut (Image/Animation).
   *  Alignée à la même Y que les LayerTabs de la colonne canvas. */
  showViewTabs?: boolean
  /** Callback appelé quand l'utilisateur clique sur le header d'un fold (ouvre/ferme).
   *  Différent des ouvertures programmatiques (ex : auto-open sur sélection sprite).
   *  Utilisé par ImageEditor pour plier la gallery quand l'utilisateur passe en édition. */
  onUserFoldToggle?: () => void
}

export default function Sidebar({ context, collapsed, onToggleCollapsed, npcs, items, choices, imageUrl, storagePathPrefix, onImageReplaced, showViewTabs = false, onUserFoldToggle }: SidebarProps) {
  const { layers, activeLayerIdx } = useEditorState()
  // Calque météo : on masque aussi les view tabs (Image/Animation) — elles
  // n'ont pas de sens pour un overlay d'ambiance qui est un calque à part entière.
  const activeLayerIsWeather = !!layers[activeLayerIdx]?.weather
  if (collapsed) {
    return (
      <motion.aside
        className="ie-sidebar-rail"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <motion.button
          onClick={onToggleCollapsed}
          className="ie-btn ie-btn-icon"
          title="Déplier le menu"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
        >
          <PanelLeftOpen size={18} />
        </motion.button>
      </motion.aside>
    )
  }

  return (
    <motion.aside
      className="ie-sidebar-left"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <SidebarContent
        context={context}
        npcs={npcs}
        items={items}
        choices={choices}
        imageUrl={imageUrl}
        storagePathPrefix={storagePathPrefix}
        onImageReplaced={onImageReplaced}
        onToggleCollapsed={onToggleCollapsed}
        onUserFoldToggle={onUserFoldToggle}
        showViewTabs={showViewTabs && !activeLayerIsWeather}
      />
    </motion.aside>
  )
}

// ── Contenu principal (folds) ────────────────────────────────────────────

interface SidebarContentProps {
  context: EditorContext
  showViewTabs: boolean
  npcs: Npc[]
  items: Item[]
  choices: Choice[]
  imageUrl: string | null
  storagePathPrefix: string
  onImageReplaced: (url: string) => void
  onToggleCollapsed: () => void
  onUserFoldToggle?: () => void
}

// Exporté pour être réutilisé par le nouveau DesignerInspector (architecture
// 4 zones) sans dupliquer la logique d'accordéon des folds.
export function SidebarContent({ context, showViewTabs, npcs, items, choices, imageUrl, storagePathPrefix, onImageReplaced, onToggleCollapsed, onUserFoldToggle }: SidebarContentProps) {
  const { composition, selected, backgroundClickTick, layers, activeLayerIdx } = useEditorState()
  // La Base (index 0) est forcée en vue Image (statique — pas d'animation sur
  // la source). Les animations vivent uniquement sur les calques additionnels.
  const isBase = activeLayerIdx === 0
  const activeView: MenuView = isBase ? 'image' : (layers[activeLayerIdx]?.activeView ?? 'image')

  // Selon la vue active, on route vers les groupes image (composition) ou animation
  const groups = activeView === 'animation' ? ANIMATION_FOLD_GROUPS : FOLD_GROUPS

  // Pour la vue Image : filtrage contextuel comme avant
  const activeFolds = new Set<FoldId>(
    activeView === 'animation'
      ? ANIMATION_FOLD_GROUPS.flatMap(g => g.folds)
      : FOLDS_BY_CONTEXT[context],
  )

  // Filtre les folds "Sur la scène" si rien n'est placé (vue Image uniquement)
  if (activeView === 'image') {
    if (composition.npcs.length === 0) activeFolds.delete('on_scene_npcs')
    if (composition.items.length === 0) activeFolds.delete('on_scene_items')
  }

  // Calque météo actif → focalise sur le fold Atmosphère uniquement. Les autres
  // folds (Découpe, NPCs, choix…) n'ont pas de sens pour un overlay d'ambiance
  // et pollueraient la sidebar.
  const activeLayerIsWeather = !!layers[activeLayerIdx]?.weather
  if (activeLayerIsWeather) {
    activeFolds.clear()
    activeFolds.add('atmosphere')
  }

  // Folds "Sur la scène" ouverts par défaut quand des éléments sont placés
  // (l'utilisateur veut voir l'état courant en arrivant)
  const [openFolds, setOpenFolds] = useState<Set<FoldId>>(() => {
    const init = new Set<FoldId>()
    if (composition.npcs.length > 0) init.add('on_scene_npcs')
    if (composition.items.length > 0) init.add('on_scene_items')
    return init
  })

  // Mode accordion : un SEUL fold ouvert à la fois.
  //   - Clic sur un fold       → ferme tous les autres, ouvre celui-là
  //   - Re-clic sur ouvert     → ferme (rien d'ouvert)
  //   - Sélection sprite NPC   → ouvre on_scene_npcs (ferme tout le reste)
  //   - Sélection sprite item  → ouvre on_scene_items (ferme tout le reste)
  //   - Désélection complète   → ferme tout
  //
  // Effet collatéral utile : quand le fold "Découpe" est fermé (parce que
  // l'utilisateur clique sur un autre fold ou un sprite), FoldCut s'unmount
  // et son cleanup useEffect désactive automatiquement cutMode → plus de
  // rectangle de sélection sur le canvas.
  const prevSelLenRef = useRef(selected.length)
  useEffect(() => {
    if (selected.length === 0) {
      if (prevSelLenRef.current > 0) setOpenFolds(new Set())
    } else {
      // Ouvre le fold du DERNIER élément sélectionné (le plus récemment ajouté)
      const last = selected[selected.length - 1]
      const target: FoldId | null =
        last.kind === 'npc' ? 'on_scene_npcs' :
        last.kind === 'item' ? 'on_scene_items' :
        null
      if (target) setOpenFolds(new Set([target]))
    }
    prevSelLenRef.current = selected.length
  }, [selected])

  // Clic sur fond image (depuis Canvas) → ferme TOUS les folds, peu importe
  // l'état précédent de la sélection (couvre le cas où aucun élément n'était
  // sélectionné mais des folds étaient ouverts manuellement).
  const prevTickRef = useRef(backgroundClickTick)
  useEffect(() => {
    if (backgroundClickTick !== prevTickRef.current) {
      setOpenFolds(new Set())
      prevTickRef.current = backgroundClickTick
    }
  }, [backgroundClickTick])

  // Auto-open du fold Atmosphère quand on arrive sur un calque météo
  // (création via preset OU switch de calque). Évite l'écran vide quand la
  // sidebar est filtrée à ce seul fold.
  const prevLayerUidForWeatherRef = useRef(layers[activeLayerIdx]?._uid)
  useEffect(() => {
    const uid = layers[activeLayerIdx]?._uid
    const layerChanged = uid !== prevLayerUidForWeatherRef.current
    prevLayerUidForWeatherRef.current = uid
    if (activeLayerIsWeather && layerChanged) {
      setOpenFolds(new Set(['atmosphere']))
    }
  }, [activeLayerIdx, activeLayerIsWeather, layers])

  // ── Flow progressif vue Animation ─────────────────────────────────────
  //
  // Règles :
  //   1. Entrée dans la vue Animation + kind non défini → auto-ouvre anim_kind
  //   2. Choix du kind (undefined → défini) → auto-referme anim_kind (user
  //      peut ré-ouvrir manuellement s'il veut changer)
  //   3. Changement de vue / de calque → réinitialise conformément à 1/2
  const activeKind = layers[activeLayerIdx]?.animation?.kind
  const prevKindRef = useRef(activeKind)
  const prevViewRef = useRef<MenuView>(activeView)
  const prevLayerUidRef = useRef(layers[activeLayerIdx]?._uid)
  useEffect(() => {
    if (activeView !== 'animation') {
      prevKindRef.current = activeKind
      prevViewRef.current = activeView
      prevLayerUidRef.current = layers[activeLayerIdx]?._uid
      return
    }
    const layerChanged = prevLayerUidRef.current !== layers[activeLayerIdx]?._uid
    const viewChanged = prevViewRef.current !== activeView
    const kindJustSet = !prevKindRef.current && activeKind

    if (kindJustSet) {
      // Choix fraîchement fait → referme le sélecteur et ouvre les paramètres
      // (flow naturel : kind choisi → on enchaîne sur les params du kind)
      setOpenFolds(new Set(['anim_params']))
    } else if ((layerChanged || viewChanged) && !activeKind) {
      // Arrivée sur un calque sans kind → ouvre le sélecteur
      setOpenFolds(new Set(['anim_kind']))
    }

    prevKindRef.current = activeKind
    prevViewRef.current = activeView
    prevLayerUidRef.current = layers[activeLayerIdx]?._uid
  }, [activeView, activeKind, activeLayerIdx, layers])

  function toggle(id: FoldId) {
    // Mode accordion : ouvrir un fold ferme tous les autres.
    // Re-cliquer sur un fold déjà ouvert → ferme (rien d'ouvert).
    setOpenFolds(prev => prev.has(id) ? new Set() : new Set([id]))
    // Signal "l'utilisateur interagit avec un fold" (pas un auto-open programmatique).
    // ImageEditor l'utilise pour plier la gallery des variantes pendant l'édition.
    onUserFoldToggle?.()
  }

  const activeLayer = layers[activeLayerIdx]
  const weather = activeLayer?.weather

  // Calque météo : rendu simplifié — le header sticky suffit + FoldAtmosphere.
  if (activeLayerIsWeather) {
    return (
      <>
        <StickyLayerHeader
          icon={weather ? getWeatherLayerIcon(weather, activeLayer?.name) : undefined}
          name={activeLayer?.name ?? 'Ambiance'}
          onCollapse={onToggleCollapsed}
          /* Pas de tabs Image/Animation sur calque météo — pas de sens */
        />
        <FoldAtmosphere />
      </>
    )
  }

  return (
    <>
      {/* Header sticky identique pour TOUS les types de calques — donne le
          contexte visuel ("quel calque j'édite") même en scrollant. Contient
          le nom du calque + bouton replier menu. */}
      <StickyLayerHeader
        name={activeLayer?.name ?? 'Base'}
        onCollapse={onToggleCollapsed}
        showViewTabs={showViewTabs}
      />
      {groups.map((group) => {
        const visibleFolds = group.folds.filter(f => activeFolds.has(f))
        if (visibleFolds.length === 0) return null
        return (
          <div key={group.label} style={{ marginBottom: 'var(--ie-space-5)' }}>
            <div style={{
              fontSize: 'var(--ie-text-xs)',
              fontWeight: 600,
              letterSpacing: '0.05em',
              color: 'var(--ie-text-faint)',
              textTransform: 'uppercase',
              marginBottom: 'var(--ie-space-2)',
              padding: '0 var(--ie-space-2)',
            }}>
              {group.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ie-space-1)' }}>
              {visibleFolds.map(foldId => (
                <FoldContainer
                  key={foldId}
                  id={foldId}
                  label={
                    // Label dynamique pour anim_kind : une fois un kind choisi,
                    // le header reflète le choix courant plutôt que "Type d'animation".
                    foldId === 'anim_kind' && activeKind
                      ? `Type : ${ANIMATION_KIND_LABELS[activeKind]}`
                      : FOLD_LABELS[foldId]
                  }
                  open={openFolds.has(foldId)}
                  onToggle={() => toggle(foldId)}
                  npcs={npcs}
                  items={items}
                  choices={choices}
                  imageUrl={imageUrl}
                  storagePathPrefix={storagePathPrefix}
                  onImageReplaced={onImageReplaced}
                />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ── Fold individuel ──────────────────────────────────────────────────────

interface FoldContainerProps {
  id: FoldId
  label: string
  open: boolean
  onToggle: () => void
  npcs: Npc[]
  items: Item[]
  choices: Choice[]
  imageUrl: string | null
  storagePathPrefix: string
  onImageReplaced: (url: string) => void
}

function FoldContainer({ id, label, open, onToggle, npcs, items, choices, imageUrl, storagePathPrefix, onImageReplaced }: FoldContainerProps) {
  return (
    <div style={{
      background: open ? 'var(--ie-accent-faint)' : 'var(--ie-surface)',
      border: `1px solid ${open ? 'var(--ie-accent)' : 'var(--ie-border)'}`,
      borderRadius: 'var(--ie-radius-md)',
      overflow: 'hidden',
      transition: 'all var(--ie-transition)',
    }}>
      <motion.button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--ie-space-3) var(--ie-space-4)',
          fontSize: 'var(--ie-text-base)',
          fontWeight: 500,
          color: open ? 'var(--ie-accent-dark)' : 'var(--ie-text)',
          textAlign: 'left',
        }}
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.98 }}
      >
        <span>{label}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: 'flex', alignItems: 'center', color: 'var(--ie-text-faint)' }}
        >
          <ChevronDown size={16} />
        </motion.span>
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: 'var(--ie-space-3) var(--ie-space-4)',
              borderTop: '1px solid var(--ie-border)',
            }}>
              <FoldContent
                id={id}
                npcs={npcs}
                items={items}
                choices={choices}
                imageUrl={imageUrl}
                storagePathPrefix={storagePathPrefix}
                onImageReplaced={onImageReplaced}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Dispatch : routage selon le fold actif ───────────────────────────────

interface FoldContentProps {
  id: FoldId
  npcs: Npc[]
  items: Item[]
  choices: Choice[]
  imageUrl: string | null
  storagePathPrefix: string
  onImageReplaced: (url: string) => void
}

function FoldContent({ id, npcs, items, choices, imageUrl, storagePathPrefix, onImageReplaced }: FoldContentProps) {
  switch (id) {
    case 'on_scene_npcs':
      return <OnSceneNpcs npcs={npcs} imageUrl={imageUrl} />
    case 'on_scene_items':
      return <OnSceneItems items={items} />
    case 'add_npc':
      return <FoldNPC npcs={npcs} storagePathPrefix={storagePathPrefix} imageUrl={imageUrl} />
    case 'add_object':
      return <FoldItem items={items} mode="add" />
    case 'generate_object':
      return <FoldGenerateObject storagePathPrefix={storagePathPrefix} />
    case 'cut':
      return <FoldCut imageUrl={imageUrl} storagePathPrefix={storagePathPrefix} onImageReplaced={onImageReplaced} />
    case 'atmosphere':
      return <FoldAtmosphere />
    case 'place_choice':
      return <FoldChoice choices={choices} />
    case 'place_conversation':
      return <FoldConversation npcs={npcs} />
    case 'anim_kind':
      return <FoldAnimationKind />
    case 'anim_mask':
      return <FoldAnimationMask />
    case 'anim_params':
      return <FoldAnimationParams />
    case 'anim_bake':
      return <FoldAnimationBake />
    default:
      return (
        <div style={{ fontSize: 'var(--ie-text-sm)', color: 'var(--ie-text-muted)', fontStyle: 'italic' }}>
          (contenu à venir)
        </div>
      )
  }
}

// ── Header sticky du calque actif ────────────────────────────────────────
//
// Reste fixé en haut de la sidebar quand l'utilisateur scrolle les sections
// en dessous. Affiche le nom du calque (+ emoji si météo) et le bouton
// replier. Negative margins compensent le padding de .ie-sidebar-left pour
// que le header occupe toute la largeur jusqu'aux bords visibles.

interface StickyLayerHeaderProps {
  name: string
  icon?: string
  onCollapse: () => void
  /** Rendre les tabs Image/Animation DANS la zone sticky (au-dessus du nom).
   *  Permet de garder tabs + header fixés ensemble pendant le scroll. */
  showViewTabs?: boolean
}

function StickyLayerHeader({ name, icon, onCollapse, showViewTabs }: StickyLayerHeaderProps) {
  return (
    <div style={{
      position: 'sticky',
      top: 'calc(-1 * var(--ie-space-4))',
      zIndex: 10,
      // Extension aux bords de la sidebar (annule le padding horizontal)
      marginLeft: 'calc(-1 * var(--ie-space-4))',
      marginRight: 'calc(-1 * var(--ie-space-4))',
      marginTop: 'calc(-1 * var(--ie-space-4))',
      marginBottom: 'var(--ie-space-3)',
      background: 'var(--ie-surface-2)',
      borderBottom: '1px solid var(--ie-border)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
    }}>
      {showViewTabs && <MenuViewTabs embedded />}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--ie-space-2)',
        paddingLeft: 'var(--ie-space-4)',
        paddingRight: 'var(--ie-space-3)',
        paddingTop: 'var(--ie-space-3)',
        paddingBottom: 'var(--ie-space-3)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--ie-space-2)',
          fontSize: 'var(--ie-text-base)',
          fontWeight: 600,
          color: 'var(--ie-text)',
          overflow: 'hidden',
          minWidth: 0,
        }}>
          {icon && (
            <span style={{ fontSize: '1.4em', lineHeight: 1, flexShrink: 0 }}>
              {icon}
            </span>
          )}
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {name}
          </span>
        </div>
        <motion.button
          onClick={onCollapse}
          className="ie-btn ie-btn-icon"
          title="Replier le menu"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          style={{ width: '1.375rem', height: '1.375rem', flexShrink: 0 }}
        >
          <PanelLeftClose size={14} />
        </motion.button>
      </div>
    </div>
  )
}
