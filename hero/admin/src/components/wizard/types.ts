/**
 * Types partagés du PlanWizard — un wizard multi-étapes qui guide l'utilisateur
 * à travers la construction d'un plan (image + variantes + dérivations + animations).
 *
 * Architecture :
 *   Step 1 "image"      → comparer modèles, sélectionner 1 image (existant)
 *   Step 2 "dashboard"  → hub avec boutons vers sous-wizards (nouveau)
 *   Sous-wizards :
 *     - "variants"      → 6 images alternatives, multi-sélection
 *     - "derivations"   → sequence frames (plus tard)
 *     - "travelling"    → mouvement caméra Qwen (plus tard)
 *     - "video_wan"     → vidéo générée (plus tard)
 *     - "wan_camera"    → pan/zoom cinéma (plus tard)
 *     - "motion_brush"  → animation zone masquée (plus tard)
 *     - "tooncrafter"   → interpolation cartoon (plus tard)
 *     - "extra_image"   → image variante IPAdapter (plus tard)
 *
 * Chaque étape modale REMPLACE la précédente (pas de dépliement).
 * Transitions CSS simples entre les étapes.
 */

import type { Section, Npc, Item } from '@/types'

/**
 * Composition d'une scène 360° : placement d'acteurs (NPCs) et d'objets (Items)
 * sur un panorama équirectangulaire. Coordonnées sphériques :
 *   - theta : angle horizontal (0-360°, 0 = centre du pano, clockwise)
 *   - phi   : angle vertical (-90 = bas, 0 = horizon, +90 = haut)
 *   - scale : facteur de taille du sprite (0.2 à 3, 1 = taille native)
 *
 * Rendu player : pano mappé sur sphère inversée + billboard sprites 2D
 * aux positions spécifiées. Les sprites regardent toujours la caméra.
 */
export interface SceneComposition {
  npcs: SceneNpcPlacement[]
  items: SceneItemPlacement[]
}
/** Quel champ image du NPC utiliser pour ce placement. */
export type NpcImageVariant = 'portrait' | 'portrait_scenic' | 'fullbody_gray' | 'fullbody_scenic'

export interface SceneNpcPlacement {
  npc_id: string
  theta: number
  phi: number
  scale: number
  /** Flip horizontal du sprite (pour alterner persos tournés gauche/droite). */
  flip?: boolean
  /** Variante d'image du NPC à afficher. Défaut : 'portrait' (portrait_url). */
  image_variant?: NpcImageVariant
  /** Prompt custom pour le baking (inpaint SDXL). Override le défaut générique.
   *  Ex : "Cypress standing on a pedestal, addressing the crowd, arm raised".
   *  Si vide, fallback sur un prompt auto généré depuis npc.appearance + sceneContext. */
  bake_prompt?: string
  /** Prompt négatif custom pour le baking. Ajouté au prompt négatif par défaut.
   *  Utile pour éviter les doubles persos : "two men, duplicate figures, multiple protagonists". */
  bake_negative?: string
}
export interface SceneItemPlacement {
  /** Id de l'Item en DB si l'objet vient de la bibliothèque. Si c'est un objet
   *  "one-shot" généré à la volée dans le compositeur, peut être un id synthétique
   *  (ex: `temp_${ts}`) et le rendu s'appuie alors sur `custom_url`. */
  item_id: string
  theta: number
  phi: number
  scale: number
  /** Rotation Z du sprite en degrés (pour inclinaison légère de l'objet). */
  rotation?: number
  /** URL d'illustration custom — utilisée quand l'objet n'existe pas en DB
   *  (prop générée directement dans le compositeur). Prioritaire sur le lookup
   *  dans `items` si présente. */
  custom_url?: string
  /** Nom affichable pour un objet custom (pas en DB). */
  custom_name?: string
}

export type WizardStep =
  | 'image'
  | 'dashboard'
  | 'variants'
  | 'derivations'
  | 'travelling'
  | 'video_wan'
  | 'wan_camera'
  | 'motion_brush'
  | 'tooncrafter'
  | 'extra_image'
  | 'extract_character'
  | 'panorama_360'

export type WizardReferenceType = 'plan' | 'transition' | 'cover'

export interface WizardReference {
  type: WizardReferenceType
  /** Id stable selon le type (planIdx string, choiceId, sectionId, etc.) */
  id: string
}

/**
 * Mode du wizard :
 *   - 'image-only'  → uniquement Step 1, sélection → close (transitions, covers)
 *   - 'full-plan'   → Step 1 → Dashboard → sous-wizards (plans d'une section)
 */
export type WizardMode = 'image-only' | 'full-plan'

/** Params au démarrage du wizard (entrée de la fonction open()). */
export interface PlanWizardOpenParams {
  mode: WizardMode
  section: Section
  reference: WizardReference

  // Prompt éditable
  prompt: string
  promptNegative: string
  style: string
  aspectRatio: string
  steps?: number
  cfg?: number

  /** Image déjà existante (affichée comme "référence" dans Step 1). Optionnel. */
  existingImage?: { url: string; checkpointKey?: string }

  /** Liste des NPCs du livre pour les sous-wizards qui peuvent les référencer
   *  (ex : panorama 360° scène avec FaceID des persos). Le wizard filtre
   *  ceux qui ont un portrait_url. */
  npcs?: Npc[]
  /** Liste des Items du livre pour le compositeur 360° (placer des objets). */
  items?: Item[]

  /** Chemin Supabase pour les images générées (sans trailing slash). Ex: "plans/sectionId/0" */
  storagePathPrefix: string

  // ── Callbacks ──
  /** Appelé quand l'utilisateur valide l'image Step 1. */
  onImageSelected: (url: string, checkpointKey: string) => Promise<void> | void
  /** Appelé quand l'utilisateur valide les variantes d'un sous-wizard. Array vide = aucune. */
  onVariantsSelected?: (urls: string[]) => Promise<void> | void
  /** Appelé quand l'utilisateur a extrait (ou régénéré) une image de fiche.
   *  L'URL pointe vers un PNG détouré/composité (fond gris #808080) prêt à
   *  servir de fiche perso ou d'illustration d'objet. Le caller ouvre sa
   *  propre modale pour router vers NPC / Objet / autre. */
  onCharacterExtracted?: (url: string) => Promise<void> | void
  /** Appelé quand l'utilisateur a validé une séquence de dérivations
   *  (frame-by-frame animation). URLs dans l'ordre de lecture. */
  onDerivationsGenerated?: (orderedUrls: string[]) => Promise<void> | void
  /** Appelé quand l'utilisateur a validé un panorama 360° équirectangulaire.
   *  Le mode indique où stocker :
   *    - 'scene'  → panorama_360_scene_url (plan cinématique 3ème pers, perso visible)
   *    - 'choice' → panorama_360_choice_url (POV immersive 1ère pers, moment de choix) */
  onPanorama360Generated?: (mode: 'scene' | 'choice', panoramaUrl: string) => Promise<void> | void
  /** Appelé quand l'utilisateur a composé une scène 360° (pano vide + placements
   *  d'acteurs/objets). Stocke pano dans panorama_360_choice_url + composition
   *  dans scene_composition. */
  onPanorama360Composed?: (panoramaUrl: string, composition: SceneComposition) => Promise<void> | void
  /** Appelé quand l'utilisateur a "baké" la scène 360° : persos intégrés par IA
   *  (inpaint SDXL + FaceID) dans une version finale du pano. Stockée dans
   *  panorama_360_baked_url, utilisée par le player à la place de la version
   *  empty + sprites quand présente. */
  onPanorama360Baked?: (bakedPanoramaUrl: string, composition: SceneComposition) => Promise<void> | void
  /** Appelé à fermeture du wizard (terminer / annuler). */
  onClose?: () => void
}

/**
 * État interne du wizard (porté par le hook).
 */
export interface PlanWizardState {
  params: PlanWizardOpenParams
  step: WizardStep
  /** Image figée après Step 1. Null tant que non sélectionnée. */
  selectedImage: { url: string; checkpointKey: string } | null
  /** Variantes conservées (URLs). */
  keptVariants: string[]
  /** URLs à supprimer à la fermeture du wizard (images générées non sélectionnées). */
  pendingCleanup: Set<string>
}
