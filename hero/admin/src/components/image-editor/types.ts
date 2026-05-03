/**
 * Types publics de l'ImageEditor — éditeur d'image unifié.
 *
 * L'éditeur est ouvert depuis 5 contextes d'entrée dans l'app :
 *   1. 'character'   — fiche personnage (Portrait / Plein Pied)
 *   2. 'object'      — fiche objet
 *   3. 'plan'        — plan d'une section (standard ou Panorama 360°)
 *   4. 'transition'  — image de transition d'un choix
 *   5. 'return'      — image accompagnant un texte de retour
 *
 * Chaque contexte détermine :
 *   - Le breadcrumb header (ce qui est affiché comme contexte)
 *   - Les types dispos dans le dropdown Type
 *   - Les folds actifs dans la sidebar gauche
 *   - Le callback de sauvegarde à appeler au Valider
 */

import type { Section, Npc, Item, Choice, Book } from '@/types'

// ── Contexte d'entrée ────────────────────────────────────────────────────

export type EditorContext =
  | 'character'
  | 'object'
  | 'plan'
  | 'transition'
  | 'return'

/** Type d'image concret que l'utilisateur veut produire, dépendant du contexte. */
export type EditorImageType =
  | 'portrait'
  | 'fullbody'
  | 'object'
  | 'plan_standard'
  | 'panorama_360'

/** Mapping contexte → types disponibles dans le dropdown. */
export const TYPES_BY_CONTEXT: Record<EditorContext, EditorImageType[]> = {
  character: ['portrait', 'fullbody'],
  object: ['object'],
  plan: ['plan_standard', 'panorama_360'],
  transition: ['plan_standard', 'panorama_360'],
  return: ['plan_standard', 'panorama_360'],
}

// ── Target (où va le résultat après Valider) ─────────────────────────────

/** Métadonnée qui identifie précisément ce qu'on édite — utilisé pour router
 *  la sauvegarde finale dans le bon champ DB et pour le breadcrumb. */
export type EditorTarget =
  | { context: 'character'; npcId: string }
  | { context: 'object'; itemId: string }
  | { context: 'plan'; sectionId: string; planIdx: number }
  | { context: 'transition'; sectionId: string; choiceId: string }
  | { context: 'return'; sectionId: string; choiceId: string }

// ── Paramètres d'ouverture ───────────────────────────────────────────────

export interface ImageEditorOpenParams {
  /** Contexte d'entrée — détermine folds, types, breadcrumb. */
  target: EditorTarget

  /** Livre courant (pour accéder à la banque d'images). */
  book: Book

  /** Section concernée (pour breadcrumb sur plan/transition/return). */
  section?: Section

  /** NPC concerné (pour breadcrumb sur 'character'). */
  npc?: Npc

  /** Item concerné (pour breadcrumb sur 'object'). */
  item?: Item

  /** Choix concerné (pour breadcrumb sur 'transition' / 'return'). */
  choice?: Choice

  /** Image existante à afficher au démarrage (si en édition d'une image déjà générée). */
  initialImageUrl?: string

  /** Prompt FR pré-rempli dans le panneau de génération au démarrage.
   *  Utilisé par le banc de test (/editor-test) pour lancer l'éditeur avec
   *  un prompt prêt à l'emploi. Ne force rien : l'utilisateur peut éditer
   *  librement avant de cliquer sur Générer. */
  initialPrompt?: string

  /** Negative prompt pré-rempli. Même logique que `initialPrompt`. */
  initialNegative?: string

  /** Stack de calques à hydrater au démarrage (si édition d'une image déjà sauvée).
   *  Pour plan : `sections.plan_layers[plan_idx]`.
   *  Pour transition : `choices.transition_layers`.
   *  Pour return : `choices.return_layers`.
   *  Si absent / vide → création d'un calque Base par défaut (comportement actuel). */
  initialLayers?: EditorLayer[]

  /** Préfixe Supabase pour les images générées. */
  storagePathPrefix: string

  /** NPCs du livre (pour les folds qui en référencent). */
  npcs?: Npc[]

  /** Items du livre. */
  items?: Item[]

  // ── Callbacks ──

  /** Appelé au clic ✕ Fermer — aucune donnée, juste un signal pour démonter la modale. */
  onClose: () => void

  /** Appelé au clic ✓ Valider final — c'est le moment où le résultat est committé en DB. */
  onValidate: (result: EditorValidationResult) => Promise<void> | void
}

// ── Résultat à la validation ─────────────────────────────────────────────

export interface EditorValidationResult {
  /** URL finale de l'image validée. */
  imageUrl: string

  /** Type effectivement produit (utile pour décider quel champ DB remplir). */
  imageType: EditorImageType

  /** Composition de scène (placements NPC / items / choix / conversations) si applicable. */
  composition?: EditorSceneComposition

  /** Stack complète des calques à persister (incluant la Base au [0]).
   *  À sauver en `sections.plan_layers[plan_idx]` / `choices.transition_layers` /
   *  `choices.return_layers` selon le contexte. */
  layers?: EditorLayer[]
}

// ── Composition de scène (étendue depuis l'existant) ─────────────────────

export interface EditorSceneComposition {
  npcs: EditorNpcPlacement[]
  items: EditorItemPlacement[]
  /** Placements de choix sur l'image (texte flottant cliquable). */
  choices?: EditorChoicePlacement[]
  /** Placements de conversations (attachées à un NPC placé). */
  conversations?: EditorConversationPlacement[]
}

export interface EditorNpcPlacement {
  /** Identifiant unique stable du placement (généré à la création). Permet
   *  à framer-motion Reorder de tracker correctement chaque ligne lors des
   *  réorganisations animées, même si plusieurs placements pointent vers
   *  le même npc_id (ex : 3× Travis sur la scène). */
  _uid: string
  npc_id: string
  theta: number
  phi: number
  scale: number
  flip?: boolean
  image_variant?: 'portrait' | 'portrait_scenic' | 'fullbody_gray' | 'fullbody_scenic'
  bake_prompt?: string
  bake_negative?: string
  /** Override du Z-order auto-calculé par phi. */
  zIndexOverride?: number
}

export interface EditorItemPlacement {
  /** Identifiant unique stable du placement (cf. EditorNpcPlacement._uid). */
  _uid: string
  item_id: string
  theta: number
  phi: number
  scale: number
  rotation?: number
  /** URL custom pour les objets générés à la volée (pas en DB). */
  custom_url?: string
  custom_name?: string
  /** Flag gameplay : la zone est cliquable par le joueur pour ramasser l'objet. */
  interactive?: boolean
  zIndexOverride?: number
}

export interface EditorChoicePlacement {
  choice_id: string
  theta: number
  phi: number
  /** Texte flottant affiché au joueur (override du texte du choix). */
  display_text?: string
}

export interface EditorConversationPlacement {
  /** Index du NPC dans composition.npcs auquel la conversation est attachée. */
  npc_placement_index: number
  conversation_id: string
}

// ── Calques (Photoshop-style layers) ─────────────────────────────────────

/**
 * Type de média porté par un calque.
 *  - 'composition' : le calque contient une scène (NPCs/items/choix) à baker
 *  - 'image' / 'video' / 'gif' : le calque est juste un média superposé
 *    (uploadé directement ou généré ailleurs)
 */
export type LayerMediaType = 'composition' | 'image' | 'video' | 'gif'

/**
 * Vue active de la sidebar pour un calque donné.
 *  - 'image'     : folds de composition (NPCs, objets, découpe, choix…)
 *  - 'animation' : folds d'animation (type, masque, params, bake)
 *
 * Chaque calque mémorise sa dernière vue (utile quand on bascule entre onglets
 * de calques). Défaut : 'image' à la création.
 */
export type MenuView = 'image' | 'animation'

/**
 * Types d'animation disponibles pour un calque.
 * Alignés sur les 6 kinds du travail animations unifié (session 2026-04-18) :
 *   - derivation   : dérive une image baked à partir d'un prompt + reference
 *   - travelling   : travelling caméra sur image statique (Ken Burns / pan)
 *   - wan_video    : WAN Animate — lip-sync / mouvement libre
 *   - wan_camera   : WAN Camera — trajectoire caméra 3D
 *   - latent_sync  : synchro latent + musique / TTS
 *   - motion_brush : flow painté par l'utilisateur → mouvement dirigé
 * + kind local :
 *   - effect_local : effet localisé sur une région (vent, pluie, lumière…)
 */
/** Aligné sur lib/animations.ts (AnimationKind) — kinds fonctionnels du projet.
 *  `cinemagraph` est spécifique à l'ImageEditor (pas de page.tsx pour l'instant) :
 *  port du workflow ltdrdata via Impact-Pack/Inspire-Pack, meilleure qualité que
 *  motion_brush pour préserver l'apparence du sujet. */
export type LayerAnimationKind =
  | 'derivation'
  | 'travelling'
  | 'video_wan'
  | 'wan_camera'
  | 'latent_sync'
  | 'motion_brush'
  | 'cinemagraph'

/** Labels courts affichés dans les onglets / headers. */
export const ANIMATION_KIND_LABELS: Record<LayerAnimationKind, string> = {
  derivation:   'Dérivation',
  travelling:   'Travelling',
  video_wan:    'WAN Video',
  wan_camera:   'WAN Caméra',
  latent_sync:  'LatentSync',
  motion_brush: 'Motion Brush',
  cinemagraph:  'Cinemagraph',
}

/** Descriptions courtes pour l'aide contextuelle (fold sélecteur). */
export const ANIMATION_KIND_HINTS: Record<LayerAnimationKind, string> = {
  derivation:   'Image baked dérivée d\'un prompt + référence',
  travelling:   'Ken Burns / pan caméra sur image statique',
  video_wan:    'Animation libre / lip-sync via WAN',
  wan_camera:   'Trajectoire caméra 3D via WAN Camera',
  latent_sync:  'Synchro avec TTS / musique',
  motion_brush: 'Animer une zone (simple, rapide)',
  cinemagraph:  'Zone animée, qualité supérieure (Impact/Inspire Pack, loop seamless)',
}

/**
 * Mode de fusion pour empiler le calque sur ceux du dessous.
 *  - 'normal' : alpha standard (défaut)
 *  - 'multiply' / 'screen' / etc. : modes Photoshop classiques (v2+)
 */
export type LayerBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'lighten' | 'darken'

/**
 * Référence d'asset depuis la bibliothèque (calque réutilisable cross-plan).
 * Si `asset_id` est renseigné, le calque est partagé : édition d'un côté
 * répercute partout. Si `asset_id` est null, le calque est inline (privé du plan).
 *
 * Le bouton "Détacher" dans l'UI permet de cloner un calque référencé en inline
 * pour le modifier sans impacter les autres usages.
 */
export interface EditorLayer {
  /** Identifiant stable du calque dans le plan (UUID local). */
  _uid: string
  /** Référence à un asset partagé en bibliothèque. Null = calque inline. */
  asset_id?: string | null
  /** Nom affiché dans l'onglet (éditable, override l'asset name si référencé). */
  name: string
  /** Type de média porté. */
  type: LayerMediaType
  /** Pour les calques composition : la scène à baker. */
  composition?: EditorSceneComposition
  /** Pour les calques média directs : URL du fichier (image/video/gif). */
  media_url?: string
  /** URL de l'image bakée du calque (sortie du baking IA pour type='composition'). */
  baked_url?: string
  /** Métadonnées de génération du bake (style/modèle/format) pour pouvoir re-baker. */
  bake_meta?: {
    style?: string
    format?: string
    checkpoint?: string
    prompt?: string
    negative?: string
  }
  /** Visibilité du calque dans le rendu final. */
  visible: boolean
  /** Opacité 0-1 appliquée au calque entier. */
  opacity: number
  /** Mode de fusion avec le calque du dessous. */
  blend?: LayerBlendMode
  /** Décalage de position (px) appliqué au calque (utile pour ajuster un asset sans le modifier). */
  position_offset?: { x: number; y: number }
  /** Dernière vue sidebar utilisée pour ce calque (image / animation).
   *  Permet de revenir dans le même état quand on bascule entre onglets de calques. */
  activeView?: MenuView
  /** Configuration de l'animation portée par le calque.
   *  Présente uniquement quand `activeView === 'animation'` a été utilisé au moins
   *  une fois. Le `baked_url` final (vidéo/gif) reste sur `EditorLayer.baked_url`. */
  animation?: {
    kind?: LayerAnimationKind
    /** Région affectée (masque ou rectangle normalisé 0-1). Null = plein calque. */
    mask?: { x1: number; y1: number; x2: number; y2: number } | null
    /** Paramètres spécifiques au kind (structure libre — validée côté bake). */
    params?: Record<string, unknown>
  }
  /** Si présent, ce calque est un overlay d'ambiance (pluie, neige, brouillard…)
   *  rendu en JS via un système de particules sur canvas. Pas d'asset externe,
   *  pas de GPU IA — juste du canvas 2D à 60 fps.
   *  Les paramètres sont ajustables en live via le fold Atmosphère. */
  weather?: WeatherParams
}

export type WeatherKind = 'rain' | 'snow' | 'fog' | 'cloud' | 'lightning'

/** Stroke du pinceau zone météo — même structure que le pinceau découpe.
 *  Points en coordonnées normalisées 0-1 (invariant au resize d'affichage). */
export interface WeatherBrushStroke {
  points: Array<{ x: number; y: number }>
  radius: number       // fraction de min(imgW, imgH)
  mode: 'paint' | 'erase'
}

/** Rectangle additif dans une zone météo. Plusieurs rects peuvent coexister
 *  (l'utilisateur dessine successivement plusieurs rects qui s'accumulent),
 *  comme les strokes pinceau. Mode paint = ajoute à la zone, erase = retire. */
export interface WeatherRectShape {
  x1: number; y1: number; x2: number; y2: number
  mode: 'paint' | 'erase'
}

/** Zone d'effet du calque météo :
 *   - 'full'  → pleine image (comportement par défaut)
 *   - 'rect'  → rectangle (coordonnées normalisées 0-1)
 *   - 'brush' → masque peint à la main (strokes)
 *  Le `ParticleLayer` utilise ce champ pour clipper le rendu. */
export interface WeatherZone {
  mode: 'full' | 'rect' | 'brush'
  /** Rectangle DRAFT : utilisé en transit pendant le drag du rectangle dans
   *  CanvasOverlay pour le preview live. Au mouseup il est poussé dans `rects[]`
   *  (committed) et `rect` est remis à undefined. Présent en data uniquement
   *  pendant le drag, ou en legacy (anciens calques pré-2026-04-25 où rect
   *  servait de stockage final — auto-migré côté lecture). */
  rect?: { x1: number; y1: number; x2: number; y2: number }
  /** Liste committed de rectangles additifs (paint) ou soustractifs (erase).
   *  Chaque rect dessiné par l'utilisateur s'ajoute ici, comme les strokes
   *  pinceau. Permet de combiner plusieurs rects + traits dans une seule zone. */
  rects?: WeatherRectShape[]
  strokes?: WeatherBrushStroke[]
  /** Taille du pinceau en fraction de min(w,h). Défaut 0.04 (4%).
   *  Range 0.005 – 0.12 dans l'UI (précis pour les trouées fines dans le feuillage). */
  brushSize?: number
  /** Paint ajoute au mask, erase retire. Défaut 'paint'. */
  brushMode?: 'paint' | 'erase'
}

export interface WeatherParams {
  /** Clé du preset qui a créé ce calque ('rain-heavy', 'snow-light'…) —
   *  permet de retrouver l'icône emoji et d'afficher un label visuel dans
   *  les tabs de calques et le header sidebar. Optionnel (fallback sur kind). */
  preset?: string
  kind: WeatherKind
  /** Nombre de particules simultanées (pluie 50-500, neige 30-300, brouillard 3-12). */
  density: number
  /** Multiplicateur de vitesse (0.25 – 2.0, défaut 1.0). */
  speed: number
  /** Angle du vent en degrés (-45 = vent gauche, 0 = vertical, +45 = vent droite).
   *  Ignoré pour le brouillard (toujours latéral). */
  angle: number
  /** Zone d'effet. Défaut : `{ mode: 'full' }`. */
  zone: WeatherZone
  /** Longueur du trait de pluie en pixels (4-40, défaut 14). Ignoré hors kind='rain'.
   *  Court = drizzle (gouttes quasi ponctuelles), long = pluie dramatique / motion blur cinéma. */
  trailLength?: number
  /** Active la perspective atmosphérique : les particules au HAUT de la zone
   *  sont plus petites / plus lentes / plus pâles (lointain), celles en BAS
   *  sont plus grosses / plus rapides / plus opaques (premier plan).
   *  Les multiplicateurs sont appliqués à la création de chaque particule. */
  depthEnabled?: boolean
  /** Intensité de la perspective 0-1. 0 = uniforme, 1 = contraste maximum
   *  (top : ×0.55 size, ×0.6 speed ; bottom : ×1.45 size, ×1.4 speed). Défaut 0.5. */
  depthStrength?: number
  /** Direction horizontale pour les kinds qui dérivent latéralement (cloud/fog).
   *  `false` (défaut) = vers la droite, `true` = vers la gauche. Ignoré pour rain/snow. */
  reverse?: boolean
  /** Opacité spécifique aux particules de cet effet (pluie/neige/brouillard/nuages),
   *  appliquée en CSS sur le canvas ParticleLayer. Multipliée avec `layer.opacity`
   *  (qui reste l'opacité globale du calque, applicable aussi aux calques glass).
   *  0-1, défaut 1. Permet de réduire la pluie sans toucher aux effets vitre. */
  particleOpacity?: number
  // ── Impacts au sol (rain uniquement) ───────────────────────────────────
  /** Active les anneaux d'impact quand une goutte touche le "sol". */
  impactEnabled?: boolean
  /** Hauteur du "sol" dans la zone, 0 (haut) → 1 (bas). Défaut 1.0.
   *  Passe à 0.6 pour simuler une flaque/pavé à mi-hauteur par exemple. */
  impactGroundY?: number
  /** Rayon max de l'anneau en pixels (5-50). Défaut 16. */
  impactSize?: number
  /** Multiplicateur global opacité + durée de vie des anneaux (0-1). Défaut 0.7. */
  impactIntensity?: number
  /** Bonus : éclaboussures (2-3 gouttelettes qui remontent brièvement). */
  impactSplash?: boolean
  /** Bonus : flash lumineux bref au moment de l'impact (scènes nocturnes). */
  impactFlash?: boolean
  /** Liste de zones d'impact. Chaque zone a son propre masque (zone) + type de
   *  surface (water/hard/soft). Une goutte qui entre dans une zone déclenche
   *  l'effet visuel correspondant à sa surface.
   *
   *  Vide ou absent → fallback sur `impactGroundY` (une seule ligne de sol, surface water).
   *
   *  Plusieurs zones = scène multi-surface (ex : flaque en eau + pavé en dur
   *  + herbe en absorbant — chacune avec son effet distinct). */
  impactZones?: ImpactZoneEntry[]
  /** @deprecated Remplacé par `impactZones` (liste). Lu en lecture seule pour
   *  migration des anciens calques — si présent et `impactZones` vide, on le
   *  convertit en `impactZones[0]` avec surface='water'. */
  impactZone?: WeatherZone
  // ── Lightning (kind='lightning' uniquement) ────────────────────────────
  // Modèle simplifié 2026-04-25 : 4 paramètres user (luminosité, halo,
  // fréquence, flash on/off) + 2 zones distinctes (zone bolt = éclair+halo,
  // zone flash = celle de l'effet écran). Les autres paramètres sont figés.
  /** Zone séparée pour le bolt (éclair vectoriel + halo). Si absente, utilise
   *  `zone` (le champ standard) en fallback. La `zone` standard sert au flash. */
  lightningBoltZone?: WeatherZone
  /** Active le flash global (illumination de la zone flash). Défaut true. */
  lightningFlashEnabled?: boolean
  /** Luminosité de l'éclair (0-1) — pilote intensité bolt + flash + halo. Défaut 0.7. */
  lightningBrightness?: number
  /** Intensité du halo autour du bolt (0-1). Défaut 0.6. */
  lightningHaloIntensity?: number
  /** Fréquence d'apparition (0-1). 0 = très rare (10s), 1 = très fréquent (1s). Défaut 0.4. */
  lightningFrequency?: number
}

/** Type de surface que la pluie frappe — influence le rendu de l'impact :
 *   - 'water' : anneau qui s'étend (flaque, mare) + éclaboussures
 *   - 'hard'  : éclat bref + éclaboussures dispersées (pavé, pierre, métal)
 *   - 'soft'  : gouttelettes qui se posent et s'évaporent (herbe, tissu, peau)
 *   - 'glass' : gouttes qui se forment et glissent verticalement (vitre, fenêtre) */
export type ImpactSurface = 'water' | 'hard' | 'soft' | 'glass'

export interface ImpactZoneEntry {
  /** Identifiant stable (uuid) pour React keys + ciblage édition. */
  id: string
  /** Type de surface → influence le rendu (anneau, éclat, rien). */
  surface: ImpactSurface
  /** Masque géométrique (pleine / rect / pinceau). */
  zone: WeatherZone
  /** Taille max de l'anneau/éclat en pixels (5-50). Si absent → fallback
   *  sur `WeatherParams.impactSize` (legacy) ou 16 par défaut. */
  size?: number
  /** Multiplicateur opacité + durée de vie (0.1-1). Si absent → fallback
   *  sur `WeatherParams.impactIntensity` ou 0.7 par défaut. */
  intensity?: number
  /** Éclaboussures actives. Si absent → fallback sur `impactSplash` (legacy).
   *  Par convention : true pour water/hard, false pour soft (ignoré au rendu). */
  splash?: boolean
  /** Flash lumineux bref. Si absent → fallback sur `impactFlash` (legacy). */
  flash?: boolean
  /** Spécifique surface 'glass' : multiplicateur de la vitesse de chute des
   *  gouttes (0.2-3, défaut 1). Plus haut = chutes rapides ; plus bas = gouttes
   *  qui glissent doucement. Ignoré pour les autres surfaces. */
  glassSpeed?: number
  /** @deprecated Renommé en `opacity`. Lu en fallback pour les anciens calques. */
  glassOpacity?: number
  /** Spécifique surface 'glass' : blur (flou de réfraction) appliqué par
   *  rainyday.js sur l'image background (0-50, défaut 20). Plus haut = vitre
   *  embuée / dépolie ; plus bas = vitre nette. */
  glassBlur?: number
  /** Opacité visuelle de l'effet de cette zone (0-1, défaut 1). Applicable
   *  à toutes surfaces :
   *   - 'glass' : CSS opacity sur le wrapper rainyday
   *   - 'water'/'hard' : multiplicateur d'alpha sur les anneaux/éclats
   *   - 'soft' : multiplicateur d'alpha sur les gouttelettes posées
   *  Permet de moduler la visibilité de chaque effet indépendamment. */
  opacity?: number
}

/**
 * Asset de calque persisté en DB (table `layer_assets`).
 * Permet la réutilisation cross-plan via `EditorLayer.asset_id`.
 */
export interface LayerAsset {
  id: string                  // UUID
  book_id: string
  name: string
  type: LayerMediaType
  composition?: EditorSceneComposition
  media_url?: string
  baked_url?: string
  bake_meta?: EditorLayer['bake_meta']
  created_at: string
  updated_at: string
}

// ── Theme (light/dark) ───────────────────────────────────────────────────

export type EditorTheme = 'light' | 'dark'

// ── Folds de la sidebar ──────────────────────────────────────────────────

export type FoldId =
  // ── Vue Image ──
  | 'on_scene_npcs'       // NPCs déjà placés sur la scène (édition + multi-drag)
  | 'on_scene_items'      // Objets déjà placés sur la scène (édition + multi-drag)
  | 'add_npc'
  | 'add_object'
  | 'generate_object'
  | 'cut'
  | 'atmosphere'
  | 'place_choice'
  | 'place_conversation'
  // ── Vue Animation ──
  | 'anim_kind'           // choix du type d'animation (parmi les 7 kinds)
  | 'anim_mask'           // zone/masque ciblée par l'animation (optionnel)
  | 'anim_params'         // paramètres dynamiques selon le kind choisi
  | 'anim_bake'           // bouton bake + statut + URL résultat

/** Quels folds sont actifs selon le contexte. Les folds `on_scene_*` sont
 *  globaux à tous les contextes mais n'apparaissent à l'écran que si des
 *  placements correspondants existent (filtrage à l'affichage dans Sidebar). */
export const FOLDS_BY_CONTEXT: Record<EditorContext, FoldId[]> = {
  character: ['cut'],
  object: ['cut'],
  plan: ['on_scene_npcs', 'on_scene_items', 'add_npc', 'add_object', 'generate_object', 'cut', 'atmosphere', 'place_choice', 'place_conversation'],
  transition: ['on_scene_npcs', 'on_scene_items', 'add_npc', 'add_object', 'generate_object', 'cut', 'atmosphere', 'place_choice', 'place_conversation'],
  return: ['on_scene_npcs', 'on_scene_items', 'add_npc', 'add_object', 'generate_object', 'cut', 'atmosphere', 'place_choice', 'place_conversation'],
}

/** Groupes visuels de folds pour la vue Image. "Sur la scène" apparaît en premier
 *  pour un accès immédiat aux éléments déjà placés (pattern Figma/Notion :
 *  état courant → actions).
 *  Le groupe LISTES a été retiré : "Liste d'objets de la section" faisait doublon
 *  avec "Ajouter un objet" et "Sur la scène > Objets". */
export const FOLD_GROUPS: { label: string; folds: FoldId[] }[] = [
  { label: 'SUR LA SCÈNE', folds: ['on_scene_npcs', 'on_scene_items'] },
  { label: 'AJOUT', folds: ['add_npc', 'add_object', 'generate_object'] },
  { label: 'ÉDITION', folds: ['cut'] },
  { label: 'AMBIANCE', folds: ['atmosphere'] },
  { label: 'ANNOTATIONS', folds: ['place_choice', 'place_conversation'] },
]

/** Presets météo / ambiance — rendu live via canvas 2D particules.
 *  Chaque entrée est un point de départ (kind + density/speed/angle par défaut).
 *  L'utilisateur ajuste les sliders en live après ajout du calque. */
export interface WeatherPreset {
  key: string
  kind: WeatherKind
  label: string
  icon: string
  /** Params de départ (density, speed, angle) — modifiables après création. */
  defaults: WeatherParams
  /** Opacité par défaut du calque (0-1). */
  defaultOpacity: number
  /** Description courte pour tooltip. */
  hint: string
}

const DEFAULT_ZONE: WeatherZone = { mode: 'full' }

/** Retourne l'emoji d'un calque météo.
 *  Priorité : (1) `preset` key → emoji exact du preset, (2) nom de calque
 *  matchant un label de preset (pour les vieux calques sans preset.key),
 *  (3) fallback par kind. Garantit que les calques créés avant le champ
 *  `preset` affichent quand même la bonne icône si leur nom n'a pas été renommé. */
export function getWeatherLayerIcon(
  w: { preset?: string; kind: WeatherKind },
  layerName?: string,
): string {
  if (w.preset) {
    const preset = WEATHER_PRESETS.find(p => p.key === w.preset)
    if (preset) return preset.icon
  }
  if (layerName) {
    const preset = WEATHER_PRESETS.find(p => p.label === layerName)
    if (preset) return preset.icon
  }
  if (w.kind === 'rain') return '🌧️'
  if (w.kind === 'snow') return '❄️'
  if (w.kind === 'fog') return '🌫️'
  if (w.kind === 'lightning') return '⚡'
  return '☁️'
}

export const WEATHER_PRESETS: WeatherPreset[] = [
  {
    key: 'rain-light', kind: 'rain', label: 'Pluie légère', icon: '🌧️',
    defaults: { kind: 'rain', density: 80,  speed: 0.65, angle: 5,  trailLength: 10, zone: DEFAULT_ZONE, depthEnabled: true, depthStrength: 0.4 },
    defaultOpacity: 0.7,
    hint: 'Pluie fine, ambiance mélancolique',
  },
  {
    key: 'rain-heavy', kind: 'rain', label: 'Pluie forte', icon: '⛈️',
    defaults: {
      kind: 'rain', density: 280, speed: 0.95, angle: 15, trailLength: 20, zone: DEFAULT_ZONE,
      depthEnabled: true, depthStrength: 0.6,
      impactEnabled: true, impactGroundY: 1.0, impactSize: 20, impactIntensity: 0.7,
      impactSplash: true, impactFlash: false,
    },
    defaultOpacity: 0.85,
    hint: 'Orage, pluie battante',
  },
  {
    key: 'snow-light', kind: 'snow', label: 'Neige lente', icon: '❄️',
    defaults: { kind: 'snow', density: 60,  speed: 0.5, angle: -5, zone: DEFAULT_ZONE, depthEnabled: true, depthStrength: 0.5 },
    defaultOpacity: 0.85,
    hint: 'Flocons qui tombent doucement',
  },
  {
    key: 'snow-heavy', kind: 'snow', label: 'Neige dense', icon: '🌨️',
    defaults: { kind: 'snow', density: 200, speed: 0.85, angle: -15, zone: DEFAULT_ZONE, depthEnabled: true, depthStrength: 0.6 },
    defaultOpacity: 0.95,
    hint: 'Tempête, blizzard',
  },
  {
    key: 'fog', kind: 'fog', label: 'Brouillard', icon: '🌫️',
    defaults: { kind: 'fog', density: 9, speed: 0.4, angle: 0, zone: DEFAULT_ZONE },
    defaultOpacity: 0.85,
    hint: 'Volutes qui dérivent lentement',
  },
  {
    key: 'lightning-rare', kind: 'lightning', label: 'Éclairs rares', icon: '⚡',
    // Rare : flashs espacés, luminosité modérée. Pour orages lointains.
    // Zones brush vides au départ → aucun éclair tant que l'auteur n'a pas
    // dessiné où l'effet doit apparaître (cohérent avec les autres calques).
    defaults: {
      kind: 'lightning', density: 0, speed: 1, angle: 0,
      zone: { mode: 'brush', strokes: [], brushSize: 0.04, brushMode: 'paint' },               // zone du flash
      lightningBoltZone: { mode: 'brush', strokes: [], brushSize: 0.04, brushMode: 'paint' },  // zone de l'éclair + halo
      lightningFlashEnabled: true,
      lightningBrightness: 0.55,
      lightningHaloIntensity: 0.4,
      lightningFrequency: 0.25,
    },
    defaultOpacity: 1,
    hint: 'Orage lointain, flashs espacés (peindre les zones)',
  },
  {
    key: 'lightning-storm', kind: 'lightning', label: 'Tempête', icon: '🌩️',
    // Storm : rapproché, intense, halo plus visible. Pour scène dramatique.
    defaults: {
      kind: 'lightning', density: 0, speed: 1, angle: 0,
      zone: { mode: 'brush', strokes: [], brushSize: 0.04, brushMode: 'paint' },
      lightningBoltZone: { mode: 'brush', strokes: [], brushSize: 0.04, brushMode: 'paint' },
      lightningFlashEnabled: true,
      lightningBrightness: 0.85,
      lightningHaloIntensity: 0.7,
      lightningFrequency: 0.6,
    },
    defaultOpacity: 1,
    hint: 'Orage violent, éclairs rapprochés (peindre les zones)',
  },
  {
    key: 'cloud', kind: 'cloud', label: 'Nuages', icon: '☁️',
    // Zone = brush avec strokes vides → aucun nuage au départ. L'utilisateur
    // peint la trouée de ciel souhaitée, les nuages apparaissent au fil de
    // ses coups de pinceau. Évite l'effet "8 nuages partout à la création"
    // qui est rarement ce qu'on veut pour un plan précis.
    defaults: { kind: 'cloud', density: 8, speed: 0.3, angle: 0, zone: { mode: 'brush', strokes: [], brushSize: 0.015, brushMode: 'paint' } },
    defaultOpacity: 0.45,
    hint: 'Gros amas cotonneux qui traversent lentement',
  },
]

/** Groupes visuels de folds pour la vue Animation (scaffolding — à remplir). */
export const ANIMATION_FOLD_GROUPS: { label: string; folds: FoldId[] }[] = [
  // `anim_mask` retiré : le mask vient directement de l'alpha du calque
  // extrait (pas besoin d'étape utilisateur pour le définir).
  { label: 'ANIMATION', folds: ['anim_kind', 'anim_params', 'anim_bake'] },
]
