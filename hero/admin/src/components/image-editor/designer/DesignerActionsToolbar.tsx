'use client'
/**
 * DesignerActionsToolbar — barre au-dessus du canvas (Phase B).
 *
 * UX 2026-04-27 (drawer horizontal) :
 *   - État FERMÉ : icône "Découper" centrée au-dessus du canvas, bouton
 *     "Extraire" en pill juste dessous (ou caché si rien à extraire).
 *   - État OUVERT (clic sur l'icône) : l'icône slide vers la GAUCHE et
 *     s'aligne avec le bord gauche de l'image. Les sub-tools (Smart visu,
 *     Baguette magique, Polygone, Lasso, Pinceau) "sortent" de l'icône et
 *     s'étalent en ligne à sa droite, avec stagger animation.
 *   - L'utilisateur peut switcher d'outil sans perdre les sélections en
 *     cours (l'état du reducer est conservé) — il peut combiner SAM + Lasso
 *     + Pinceau dans une même session de découpe.
 */

import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import { Check } from 'lucide-react'
import type { RailCategory } from './DesignerLeftRail'
import ZoomLoupeToggleButton from '../ZoomLoupeToggleButton'

export interface DesignerActionSubTool {
  id: string
  label: string
  icon: React.ReactNode
  hint?: string
  /** Couleur signature du sub-tool (CSS color). Utilisée pour distinguer
   *  visuellement les outils entre eux. Le bouton actif utilise cette couleur
   *  en fond plein, l'inactif en teinte claire. */
  color?: string
}

/** Actions secondaires affichées dans le drawer d'une action principale, à droite
 *  des sub-tools. Désactivées tant qu'il n'y a rien à exploiter (ex: aucune
 *  extraction en cours). Cas d'usage : opérations sur le résultat extrait
 *  (Copier, Supprimer, Calque, Personnage, Objet…). Spécifique à l'action qui
 *  les déclare — chaque action a ses propres secondary actions (ou aucune). */
export interface DesignerSecondaryAction {
  id: string
  label: string
  icon: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}

export interface DesignerAction {
  id: string
  label: string
  icon: React.ReactNode
  opensCategory: RailCategory
  title?: string
  disabled?: boolean
  subTools?: DesignerActionSubTool[]
  onSubToolPick?: (subToolId: string) => void
  onActivate?: () => void
  /** Actions secondaires propres à CETTE action (rendues à droite de ses
   *  sub-tools dans le drawer). Ex: Découper expose "Copier / Supprimer /
   *  Calque / Personnage / Objet" sur son résultat. Personnage n'en expose
   *  pas. Tableau vide ou undefined → pas de séparateur ni d'icônes. */
  secondaryActions?: DesignerSecondaryAction[]
}

interface DesignerActionsToolbarProps {
  actions: DesignerAction[]
  activeCategory: RailCategory | null
  onActionClick: (category: RailCategory) => void
  /** ID du sub-tool actuellement actif (highlight + Check icon) */
  activeSubToolId?: string | null

  /** Callback déclenché quand le drawer se ferme (re-clic icône, escape,
   *  catalog fermé, layer change). Permet au parent de reset l'état d'extraction
   *  (sélections + composite) — l'utilisateur abandonne la session. */
  onDrawerClose?: () => void

  /** Force le drawer ouvert depuis le parent (ex: sélection d'une détection
   *  via clic sur le canvas → on ouvre le drawer auto pour exposer les actions
   *  disponibles sur la sélection). Défaut false. */
  forceOpen?: boolean

  /** Désactive tous les sub-tools (Smart visu / Baguette / etc.) — utilisé
   *  quand une détection est sélectionnée : ces outils créent de nouvelles
   *  découpes, hors-sujet quand on opère sur une sélection existante. */
  subToolsDisabled?: boolean
}

// Variants framer-motion pour l'animation drawer.
//
// CLOSE = pas de stagger, fade out rapide synchronisé. Combiné avec
// AnimatePresence mode="popLayout", les sub-tools sont retirés du flux DOM
// dès que leur exit commence → la row peut rétrécir d'un coup et l'icône
// glisser au centre sans pause "haché".
//
// OPEN = stagger naturel pour effet drawer qui s'ouvre et révèle ses items.
const subToolsContainerVariants: Variants = {
  closed: {
    opacity: 0,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  },
  open: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.08, // attend que l'icône principale ait commencé à slide
      when: 'beforeChildren',
    },
  },
}

const subToolItemVariants: Variants = {
  closed: { opacity: 0, x: -16, scale: 0.85, transition: { duration: 0.12 } },
  open:   { opacity: 1, x: 0,   scale: 1,   transition: { type: 'spring', stiffness: 380, damping: 28 } },
}

interface DesignerActionsToolbarPropsWithLayer extends DesignerActionsToolbarProps {
  /** Index du calque actif. À chaque changement, le drawer se ferme (la
   *  session de découpe est liée au calque courant). */
  activeLayerIdx?: number
}

export default function DesignerActionsToolbar({
  actions, activeCategory, onActionClick, activeSubToolId,
  onDrawerClose,
  activeLayerIdx,
  forceOpen = false,
  subToolsDisabled = false,
}: DesignerActionsToolbarPropsWithLayer) {
  const [openId, setOpenId] = useState<string | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  // ⚠ PAS de click-outside-to-close : l'utilisateur clique sur le canvas
  // pour tracer ses sélections après avoir pické un tool — fermer le drawer
  // à ce moment-là l'empêcherait de switcher de tool entre 2 sélections.
  // Le drawer est sticky : ferme via re-clic sur l'icône principale, Escape,
  // ou automatiquement quand le catalog gauche se ferme / on change de calque.
  useEffect(() => {
    if (!openId) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [openId])

  // Ferme le drawer si l'utilisateur navigue vers une AUTRE catégorie du rail
  // (Audio, Banques, etc.). Si activeCategory est null, on laisse le drawer
  // ouvert — depuis 2026-04-28 le ciseau n'ouvre plus le panneau gauche par
  // défaut, donc null est un état normal pendant une session de découpe.
  useEffect(() => {
    if (!openId) return
    const action = actions.find(a => a.id === openId)
    if (!action) return
    if (activeCategory !== null && activeCategory !== action.opensCategory) {
      setOpenId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, openId])

  // Ferme le drawer au changement de calque actif. Chaque calque a sa propre
  // session de découpe — on repart à zéro visuellement.
  useEffect(() => {
    setOpenId(null)
  }, [activeLayerIdx])

  // Quand la sélection (forceOpen) passe true → false (clic hors image découpée),
  // ferme aussi le drawer manuel s'il était ouvert. Spec : la désélection
  // referme le drawer même si le user l'avait ouvert manuellement avant.
  const prevForceOpenRef = useRef(forceOpen)
  useEffect(() => {
    if (prevForceOpenRef.current && !forceOpen) {
      setOpenId(null)
    }
    prevForceOpenRef.current = forceOpen
  }, [forceOpen])

  // Détecte tout changement de drawer (close OU switch vers une autre action) :
  //   1. Ferme le catalog gauche du PRÉCÉDENT s'il était ouvert
  //   2. Notifie onDrawerClose → reset état d'extraction du précédent
  // Couvre 2 cas :
  //   - openId → null (re-clic icône, Escape, layer change, catalog mismatch)
  //   - openId 'decoupe' → 'personnage' (switch entre actions, mutual exclusion)
  const prevOpenIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevOpenIdRef.current
    if (prev && prev !== openId) {
      const prevAction = actions.find(a => a.id === prev)
      if (prevAction && activeCategory === prevAction.opensCategory) {
        onActionClick(prevAction.opensCategory)
      }
      onDrawerClose?.()
    }
    prevOpenIdRef.current = openId
    // actions est stable (référence peut changer mais contenu peu) → omis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, onDrawerClose, activeCategory])

  if (actions.length === 0) return null

  function handleMainClick(action: DesignerAction) {
    if (action.disabled) return
    if (action.subTools && action.subTools.length > 0) {
      // Toggle drawer uniquement. Le panneau gauche reste fermé : l'utilisateur
      // doit choisir un sub-tool pour démarrer une session.
      // Mutual exclusion : si un AUTRE drawer est ouvert, on bascule vers ce
      // nouveau directement (le précédent se ferme via openId qui change).
      const willOpen = openId !== action.id
      setOpenId(willOpen ? action.id : null)
    } else {
      action.onActivate?.()
      onActionClick(action.opensCategory)
    }
  }

  function handleSubToolPick(action: DesignerAction, subTool: DesignerActionSubTool) {
    action.onSubToolPick?.(subTool.id)
    // Spec : clic icône principale = panneau fermé, clic sub-tool = panneau
    // s'ouvre (les tools event-driven ont besoin du catalog monté pour
    // fonctionner — Magic Wand, Lasso, Pinceau, SAM prompt côté Découper).
    if (activeCategory !== action.opensCategory) {
      onActionClick(action.opensCategory)
    }
    // On NE FERME PAS le drawer après pick → permet de switcher rapidement
    // entre tools sans avoir à re-cliquer sur l'icône principale.
  }

  // Action dont le drawer est actuellement ouvert (forceOpen prend l'action[0]
  // par défaut pour back-compat avec le cas "détection auto-ouvre Découper").
  const activeAction = forceOpen
    ? actions.find(a => a.opensCategory === activeCategory) ?? actions[0]
    : actions.find(a => a.id === openId) ?? null
  const drawerOpen = !!activeAction && (forceOpen || openId === activeAction.id)
  const drawerSecondaryActions = activeAction?.secondaryActions ?? []

  return (
    <div
      ref={toolbarRef}
      className={`dz-actions-toolbar ${drawerOpen ? 'is-open' : ''}`}
      role="toolbar"
      aria-label="Actions sur l'image"
    >
      {/* Bouton Loupe — position absolue à droite de la toolbar. Reste
       *  accessible quel que soit l'état du drawer. */}
      <ZoomLoupeToggleButton />

      <motion.div
        className="dz-actions-row"
        layout
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        {/* Toutes les icônes principales rendues côte à côte. La mutual
         * exclusion vit dans openId (un seul drawer ouvert). */}
        {actions.map(action => {
          const isThisActive = !!activeAction && activeAction.id === action.id && (
            activeCategory === action.opensCategory || drawerOpen
          )
          return (
            <motion.div key={action.id} layout className="dz-actions-stack">
              <button
                type="button"
                className={`dz-actions-btn ${isThisActive ? 'active' : ''}`}
                onClick={() => handleMainClick(action)}
                disabled={action.disabled}
                title={action.title ?? action.label}
                aria-pressed={isThisActive}
                aria-haspopup={action.subTools ? 'menu' : undefined}
                aria-expanded={isThisActive && drawerOpen}
              >
                {action.icon}
              </button>
            </motion.div>
          )
        })}

        {/* Drawer content : sub-tools + (optionnel) séparateur + secondary
         * actions de l'action active, révélés en cascade. Un seul drawer à la
         * fois — switch entre actions = drawer précédent fade out, nouveau
         * fade in (key change = AnimatePresence remount). */}
        <AnimatePresence mode="popLayout">
          {drawerOpen && activeAction?.subTools && (
            <motion.div
              key={`dz-drawer-${activeAction.id}`}
              className="dz-actions-drawer"
              variants={subToolsContainerVariants}
              initial="closed"
              animate="open"
              exit="closed"
              role="menu"
            >
              {activeAction.subTools.map(sub => {
                const isActive = activeSubToolId === sub.id && !subToolsDisabled
                const colorStyle = sub.color
                  ? ({ ['--dz-tool-color' as never]: sub.color } as React.CSSProperties)
                  : undefined
                return (
                  <motion.button
                    key={sub.id}
                    type="button"
                    role="menuitem"
                    className={`dz-actions-subtool ${isActive ? 'active' : ''}`}
                    style={colorStyle}
                    variants={subToolItemVariants}
                    onClick={() => !subToolsDisabled && handleSubToolPick(activeAction, sub)}
                    disabled={subToolsDisabled}
                    title={sub.hint ? `${sub.label} — ${sub.hint}` : sub.label}
                    whileHover={!subToolsDisabled ? { y: -2 } : undefined}
                    whileTap={!subToolsDisabled ? { scale: 0.94 } : undefined}
                  >
                    <span className="dz-actions-subtool-icon">{sub.icon}</span>
                    <span className="dz-actions-subtool-label">{sub.label}</span>
                    {isActive && (
                      <span className="dz-actions-subtool-check" aria-hidden>
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                  </motion.button>
                )
              })}

              {drawerSecondaryActions.length > 0 && (
                <>
                  <motion.div
                    className="dz-actions-vsep"
                    variants={subToolItemVariants}
                    aria-hidden
                  />
                  {drawerSecondaryActions.map(act => (
                    <motion.button
                      key={act.id}
                      type="button"
                      className="dz-actions-secondary-btn"
                      variants={subToolItemVariants}
                      onClick={act.onClick}
                      disabled={act.disabled}
                      title={act.label}
                      aria-label={act.label}
                      whileHover={!act.disabled ? { y: -2 } : undefined}
                      whileTap={!act.disabled ? { scale: 0.94 } : undefined}
                    >
                      {act.icon}
                    </motion.button>
                  ))}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
