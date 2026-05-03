export type ProjectStatus = 'draft' | 'bible_generated' | 'bible_validated' | 'in_progress' | 'completed'
export type BookPhase = 'draft' | 'structure_generated' | 'structure_validated' | 'writing' | 'done'

export interface NarrativeArc {
  need: string
  desire: string
  stake: string
  emotional_arc: { entry: string; exit: string }
}

export interface Project {
  id: string
  title: string
  theme: string
  num_books: number
  description?: string
  series_bible?: string | null
  series_analysis?: string | null
  status: ProjectStatus
  created_at: string
  updated_at: string
  books_count?: number
}

export type AgeRange = '8-12' | '13-17' | '18+'
export type Difficulty = 'facile' | 'normal' | 'difficile' | 'expert'
export type Language = 'fr' | 'en'
export type BookStatus = 'draft' | 'published' | 'archived'
export type MapStyle = 'subway' | 'city' | 'dungeon' | 'forest' | 'sea'
export type MapVisibility = 'full' | 'found' | 'fog'
/** @deprecated use MapStyle + MapVisibility */
export type MapType = 'none' | 'fog' | 'found' | 'known'
export type SectionStatus = 'draft' | 'in_progress' | 'validated'
export type ContextType = 'Aventure' | 'Intrigue' | 'Suspense' | 'Enquête' | 'Horreur' | 'Fantasy' | 'Science-Fiction'
export type ItemType = 'soin' | 'mana' | 'arme' | 'armure' | 'outil' | 'quete' | 'grimoire' | 'plan'
export type ItemCategory = 'persistant' | 'consommable' | 'arme'

export interface RadioBroadcast {
  act: number          // numéro d'acte (1-based)
  text: string         // texte lu par la DJ
  audio_url?: string   // URL ElevenLabs généré
}

export interface SceneItem {
  item_id: string
  x?: number           // fraction horizontale sur l'image (0–1)
  y?: number           // fraction verticale sur l'image (0–1)
  scale?: number       // multiplicateur de taille (1 = 56px)
}
export type TrialType = 'combat' | 'agilite' | 'intelligence' | 'magie' | 'chance' | 'crochetage' | 'dialogue'
export type EndingType = 'victory' | 'death'

export interface StatModifiers {
  force?: number
  agilite?: number
  intelligence?: number
  magie?: number
  endurance?: number
  chance?: number
}

export interface ItemEffect {
  hp_restore?: number
  mana_restore?: number
  stat?: string
  bonus?: number
  spell?: string
}

export interface StartingItem {
  id: string
  name: string
  type: ItemType
  effect: ItemEffect
}

export interface Job {
  id: string
  book_id: string
  name: string
  name_en?: string
  description?: string
  description_en?: string
  stat_modifiers: StatModifiers
  starting_items: StartingItem[]
}

export interface Enemy {
  name: string
  force: number
  endurance: number
  description?: string
}

export interface CombatParticipant {
  npc_id?: string
  npc_name: string
  force: number
  endurance: number
  enemy_weapon_type?: string
}

export interface Trial {
  type: TrialType
  stat: keyof StatModifiers
  success_section_id?: string
  failure_section_id?: string
  // Combat simple (rétrocompatible)
  enemy?: Enemy
  npc_id?: string
  enemy_weapon_type?: string
  // Combat multiple (N adversaires)
  enemies?: CombatParticipant[]   // si renseigné, remplace enemy + npc_id
  xp_reward?: number
  mana_cost?: number
  endurance_loss_on_failure?: number
  // Combat-specific
  combat_intro_thought?: string
  // Dialogue-specific
  dialogue_opening?: string
  dialogue_goal?: string
}

export interface DialogueMessage {
  role: 'player' | 'npc'
  text: string
}

export interface Item {
  id: string
  book_id: string
  name: string
  item_type: ItemType
  category: ItemCategory          // persistant | consommable | arme
  weapon_type?: string | null     // ex: 'couteau', 'batte', 'pistolet' (si item_type === 'arme')
  description?: string
  illustration_url?: string       // miniature de l'objet (icône sur la scène)
  detail_url?: string             // image agrandie affichée quand le joueur clique sur l'objet
  fold_sound_url?: string         // son joué au dépliage/pliage (type plan)
  cinematique_url?: string        // vidéo courte jouée au ramassage
  npc_id?: string | null          // PNJ qui porte/possède cet item
  section_found_id?: string
  sections_used: string[]         // sections où l'item est à positionner (pickup)
  use_section_ids?: string[]      // sections où l'item est requis (usage/déverrou)
  radio_broadcasts?: RadioBroadcast[]  // pour items radio persistants
  effect: Record<string, any>
  created_at: string
}

// ── Séquence narrative par image ─────────────────────────────────────────────

export interface TextSequenceItem {
  type: 'narrative' | 'thought'
  text: string
}

/** Tags d'un plan — auto-dérivés du data model par défaut, éditables par l'auteur.
 *  Voir `project_plan_tags_strategy.md` pour la stratégie hybride.
 *  V1 : `objects` peut être vide tant que Florence-2/Qwen VL n'a pas tourné. */
export interface PlanTags {
  /** Type du plan, miroir de SectionImage.kind. Auto. */
  kind?: 'image' | 'animation'
  /** IDs des sections où ce plan apparaît (parent + transitions où réutilisé). Auto. */
  sections?: string[]
  /** ID Location de la section parente. Auto. */
  location?: string | null
  /** IDs/noms des personnages détectés ou assignés au plan. Auto si calques perso, sinon Qwen VL. */
  characters?: string[]
  /** Effets posés sur le plan (`pluie`, `brouillard`, etc.). Auto via plan.layers. */
  effects?: string[]
  /** Objets identifiés dans l'image (Florence-2/Qwen VL). Souvent vide V1. */
  objects?: string[]
  /** Champs taggés manuellement par l'auteur — ne pas écraser au re-tagging auto.
   *  Format : ['characters', 'objects', ...] = catégories où l'auteur a fait des modifs */
  manual_overrides?: Array<keyof Omit<PlanTags, 'manual_overrides'>>
}

export interface SectionImage {
  url?: string
  description?: string
  style?: IllustrationStyle
  prompt_fr?: string
  prompt_en?: string
  thought?: string                  // legacy — fallback si text_sequence absent
  text_sequence?: TextSequenceItem[] // narratif + pensées alternés
  bubble_positions?: Record<string, { x: number; y: number }> // speaker → position % sur l'image

  // ── Plan kind & animation (décision 2026-05-03, cf project_plan_kind_data_model.md) ──
  /** Type du plan. `'image'` (défaut, rétro-compat : si absent → image) ou `'animation'` (vidéo LTX/Wan).
   *  Drive l'UX (bouton "Animer la scène" masqué si 'animation') et le runtime (compositing video vs img). */
  kind?: 'image' | 'animation'
  /** URL Supabase du MP4 — UNIQUEMENT si kind='animation'. La base joue 1× puis fige sur dernière frame. */
  base_video_url?: string
  /** URL Supabase de la 1ère frame du MP4 (capturée à la gen) — UNIQUEMENT si kind='animation'.
   *  Utilisée par la banque (mini-galerie vignette) et la modale "Image début" lors de la copie. */
  first_frame_url?: string
  /** URL Supabase de la dernière frame du MP4 (capturée à la gen) — UNIQUEMENT si kind='animation'.
   *  Utilisée par la banque (mini-galerie vignette) et la modale "Image fin" lors de la copie. */
  last_frame_url?: string
  /** Tags du plan (auto + manuel). Voir PlanTags. Indispensable pour la banque (recherche, filtre, ordre). */
  tags?: PlanTags

  // ComfyUI generation settings
  comfyui_settings?: {
    negative?: string
    background_url?: string          // URL du décor pour ControlNet Depth
    characters?: Array<{
      npc_id: string
      mask: 'left' | 'right' | 'left_third' | 'center_third' | 'right_third' | 'full'
      weight: number
    }>
    steps?: number
    cfg?: number
    seed?: number
    checkpoint?: string
    aspect_ratio?: string
  }
  /** Override des prefs de rendu par plan — fallback sur les prefs globales (simPrefs) si undefined.
   *  Source unique consommée par : simulateur, mini-tel preview, timeline, transitions.
   *  Toutes optionnelles ; champs vides = utilise le défaut global. */
  plan_prefs?: {
    wpm?: 120 | 180 | 240
    word_interval_ms?: 120 | 200 | 280 | 400
    caption_style?: 1 | 2 | 3
    text_font_size?: 13 | 15 | 17 | 19
    thought_style?: 1 | 2 | 3
    /** Pause (ms) entre 2 phrases atomiques. Défaut 4000. */
    phrase_gap_ms?: number
  }
  /** Mots à colorier en rouge sur ce plan, en plus des PNJ + lieux auto (additif). */
  red_words?: string[]
  /** [LEGACY] ancien nom de plan_prefs — gardé pour compat lecture seule, ne plus écrire. */
  reading_settings?: {
    wpm?: 120 | 180 | 240
    word_interval_ms?: 120 | 200 | 280 | 400
  }
}

// ── Scène de discussion (dernière image) ──────────────────────────────────────

export interface DiscussionItemExchange {
  direction: 'npc_gives' | 'player_gives'
  item_id: string
  accept_text: string
  refuse_text: string
  accept_sub_choices?: DiscussionSubChoice[]
  refuse_sub_choices?: DiscussionSubChoice[]
}

export interface DiscussionSubChoice {
  id: string
  player_text: string
  emotion_label: string
  npc_response: string              // réponse du PNJ à ce niveau (remplace npc_capitulation)
  npc_response_audio_url?: string
  target_section_id?: string        // UUID section cible (navigation si fin de conversation)
  item_exchange?: DiscussionItemExchange
  sub_choices?: DiscussionSubChoice[]
}

export interface DiscussionChoice {
  id: string
  player_text: string               // ce que dit le joueur
  emotion_label: string             // ex: "Prudent" "Courageux" "Discret"
  npc_response: string              // réaction du PNJ
  npc_capitulation?: string         // texte si le PNJ cède (dernier sous-choix)
  npc_response_audio_url?: string
  target_section_id?: string        // UUID section cible (FK réelle en DB)
  condition_item?: string           // ex: "paquet_de_cigarettes"
  item_exchange?: DiscussionItemExchange
  sub_choices?: DiscussionChoice[]
}

export interface DiscussionScene {
  scene_id?: string                 // UUID de discussion_scenes (source de vérité)
  npc_id: string                    // PNJ qui parle
  npc_opening: string               // première réplique du PNJ
  npc_opening_audio_url?: string    // audio ElevenLabs pré-généré
  choices: DiscussionChoice[]
  outcome_thought?: string          // pensée du protagoniste après la discussion
}

export interface Section {
  id: string
  book_id: string
  number: number
  content: string
  summary?: string
  narrative_arc?: NarrativeArc | null
  music_url?: string
  music_start_time?: number   // offset en secondes pour démarrer la piste
  content_en?: string
  image_url?: string
  images?: SectionImage[]
  animation_key?: string
  trial?: Trial
  is_ending: boolean
  ending_type?: EndingType
  status: SectionStatus
  location_id?: string
  reading_time?: number | null
  decision_time?: number | null
  initiative_text?: string | null
  companion_npc_ids?: string[]
  companion_npc_excluded?: string[]
  tension_level?: number
  npc_question_used?: Record<string, boolean>  // npcId → true si question déjà utilisée
  continues_timer?: boolean
  hint_text?: string
  items_on_scene?: SceneItem[]    // items ramassables sur la dernière image
  phrase_distribution?: string[][]  // phrases assignées par image [[img0phrases], [img1phrases], [img2phrases]]
  combat_type_id?: string | null
  combat_props?: string[]
  combat_image_url?: string | null
  discussion_scene?: DiscussionScene | null
  money_loot?: number | null        // argent récupérable sur cette section (ennemi battu, etc.)
}

export interface Choice {
  id: string
  section_id: string
  label: string
  label_en?: string
  target_section_id?: string
  requires_trial: boolean
  condition?: { stat?: string; min?: number; item_id?: string }
  locked_label?: string           // label affiché si condition item non remplie
  sort_order: number
  transition_text?: string
  transition_image_url?: string
  transition_image_index?: number  // 0-2, image de la section à afficher (défaut 2)
  return_text?: string
  return_image_index?: number
  is_back?: boolean
  archetype?: string              // ex: "Passage en force", "Discrétion", "Prise de risque"
  money_cost?: number | null      // montant déduit si le joueur choisit cette option
  is_default?: boolean            // sélectionné automatiquement quand le countdown atteint 0
  transition_img_settings?: { model: string; style: string; aspect_ratio: string; section_ref_idx: number | null; description?: string; prompt_fr?: string }
}

export interface Location {
  id: string
  book_id: string
  name: string
  x: number
  y: number
  icon: string
}

export interface BookAct {
  title: string
  synopsis: string
  from_section: number
  to_section: number
}

// ── Structure à chemins parallèles ──────────────────────────────────────────

export interface JunctionSection {
  id: string           // identifiant court ex: "start", "faye", "end"
  name: string         // nom narratif ex: "Van Cortlandt Park"
  paths: string[]      // chemins qui convergent ici ex: ["A","B","C","D"]
  sections_count: number
  synopsis: string
  from_section?: number  // assigné après allocation
  to_section?: number
}

export interface PathSegment {
  from_junction: string  // id de la jonction d'entrée
  to_junction: string    // id de la jonction de sortie
  sections_count: number
  synopsis: string
  from_section?: number  // assigné après allocation
  to_section?: number
}

export interface NarrativePath {
  id: string             // ex: "A", "B", "C", "D"
  label: string          // ex: "Métro → Rues → Métro"
  segments: PathSegment[]
}

export interface ParallelBookStructure {
  junctions: JunctionSection[]
  paths: NarrativePath[]
}

export interface IntroStep {
  id: 'animatic' | 'fbi' | 'fiche' | 'settings'
  label: string
  icon: string
  enabled: boolean
  delay_before: number  // secondes d'attente avant d'afficher cet écran
  exit_volume?: number  // volume de sortie 0-100 (0 = silence, 100 = maintien du volume)
  // Settings step — textes configurables
  settings_title?: string
  settings_sound_label?: string
  settings_sound_desc?: string
  settings_voice_label?: string
  settings_voice_desc?: string
  settings_mode1_label?: string
  settings_mode1_desc?: string
  settings_mode2_label?: string
  settings_mode2_desc?: string
}

export type IntroDuration = 'flash' | 'court' | 'normal' | 'long' | 'pause'
export type IntroFraming = 'plan_large' | 'plan_moyen' | 'gros_plan' | 'detail'
export type IntroTransition = 'cut' | 'fondu' | 'fondu_noir'

export interface IntroFrame {
  id: string
  order: number
  framing: IntroFraming
  perspective?: string
  prompt_fr: string
  prompt_en: string
  duration: IntroDuration
  narrative_text?: string
  transition: IntroTransition
  image_url?: string
  video_url?: string
  ref_frame_id?: string   // ID de la frame utilisée comme référence visuelle (img2img)
}

export interface SectionLayoutSettings {
  // Illustration unique (canvas libre 390×845)
  el_photo:     { x: number; y: number; w: number; h: number }
  photo_border: boolean
  photo_shadow: boolean
  photo_border_width: number
  photo_bg: string              // couleur de fond (#0d0d0d…)
  // Texte narratif (panneau séparé des choix)
  el_text:      { x: number; y: number; w: number; h: number }
  text_bg_opacity: number
  text_bg_color: string
  text_font_size: number
  text_gradient: boolean
  text_padding: number
  // Boutons de choix (panneau séparé)
  el_choices:            { x: number; y: number; w: number; h: number }
  choices_font_size?:    number
  choices_font_family?:  'serif' | 'sans' | 'mono'
  choices_italic?:       boolean
  choices_bold?:         boolean
  choices_text_color?:   string   // couleur texte choix normal
  choices_active_color?: string   // couleur texte choix actif/surligné
  choices_bg?:           string   // fond choix normal (hex, opacity via overlay_opacity)
  choices_active_bg?:    string   // fond choix actif
  choices_border_color?: string   // bordure choix normal
  choices_active_border?:string   // bordure choix actif
  choices_border_radius?:number   // px
  // Opacité globale des overlays HUD (0-100)
  overlay_opacity: number
  // Vignettes personnages
  vignettes_show: boolean
  vignette_size: number
  vignette_style: 'circle' | 'card' | 'tile'
  vignette_border_color: string
  vignette_positions: { x: number; y: number }[]
  vignette_tile_name_size: number       // taille police du nom dans tuile
  vignette_tile_text_color: string      // couleur texte dans tuile
  vignette_tile_bg_opacity: number      // opacité du fond côté nom (0-100)
  vignette_tile_show_hp: boolean        // barre HP sous le nom (NPCs uniquement)
  vignette_tile_name_x: number          // décalage X du nom dans tuile
  vignette_tile_name_y: number          // décalage Y du nom dans tuile
  // HUD (canvas libre)
  el_health:    { x: number; y: number; w: number }
  el_stats:     { x: number; y: number }
  el_inventory: { x: number; y: number }
  health_show: boolean
  health_mode: 'bar' | 'text'
  health_font_size: number
  health_text_color: string
  stats_show: boolean
  inventory_show: boolean
  inventory_icon_size: number
  settings_show: boolean
  el_settings: { x: number; y: number }
  clock_show: boolean
  clock_color: string
  clock_font_size: number
  el_clock: { x: number; y: number }
  // Dialogue manga RPG
  manga_dialog_show: boolean
  el_manga_dialog: { x: number; y: number; w: number; h: number }
  // Ratios de mise en page dialogue manga
  manga_npc_zone_ratio?: number      // largeur zone NPC / largeur totale (défaut 0.55)
  manga_active_panel_ratio?: number  // hauteur panneau actif / hauteur totale (défaut 0.62)
  // Positions individuelles des éléments (coordonnées 390-space, relatives à el_manga_dialog)
  manga_player_portrait_rect?: { x: number; y: number; w: number; h: number }
  // Images de structure de la boite de dialogue
  manga_panel_image_1?: string   // Gauche 1 — panneau NPC actif
  manga_panel_image_2?: string   // Gauche 2
  manga_panel_image_3?: string   // Gauche 3
  manga_panel_image_4?: string   // Gauche 4
  manga_player_panel_image?: string  // Droite Joueur
  // Nouvelles propriétés dialogue manga v2
  manga_dialog_bg_color?: string
  manga_npc_panel_rect_0?: { x: number; y: number; w: number; h: number }
  manga_npc_panel_rect_1?: { x: number; y: number; w: number; h: number }
  manga_npc_panel_rect_2?: { x: number; y: number; w: number; h: number }
  manga_npc_panel_rect_3?: { x: number; y: number; w: number; h: number }
  manga_player_panel_rect?: { x: number; y: number; w: number; h: number }
  // Couleur nom PNJ
  manga_npc_name_color?: string
  // Fond des panneaux
  manga_panel_bg_color?: string
  manga_player_panel_bg_color?: string
  // Blend mode du calque PNG frame
  manga_panel_blend_mode?: 'normal' | 'multiply' | 'screen' | 'overlay'
  manga_player_blend_mode?: 'normal' | 'multiply' | 'screen' | 'overlay'
  // Inset portrait par slot (px en 390-space)
  manga_panel_portrait_inset_0?: number
  manga_panel_portrait_inset_1?: number
  manga_panel_portrait_inset_2?: number
  manga_panel_portrait_inset_3?: number
  manga_player_portrait_inset?: number
  // Rotation portrait par slot (degrés, -180 à 180)
  manga_panel_portrait_rotate_0?: number
  manga_panel_portrait_rotate_1?: number
  manga_panel_portrait_rotate_2?: number
  manga_panel_portrait_rotate_3?: number
  manga_player_portrait_rotate?: number
  // Position portrait par slot (0-100%)
  manga_panel_portrait_pos_x_0?: number
  manga_panel_portrait_pos_x_1?: number
  manga_panel_portrait_pos_x_2?: number
  manga_panel_portrait_pos_x_3?: number
  manga_panel_portrait_pos_y_0?: number
  manga_panel_portrait_pos_y_1?: number
  manga_panel_portrait_pos_y_2?: number
  manga_panel_portrait_pos_y_3?: number
  manga_player_portrait_pos_x?: number
  manga_player_portrait_pos_y?: number
  // Z-index (ordre avant-plan) des panneaux NPC (1 = fond, 4 = avant)
  manga_npc_panel_zindex_0?: number
  manga_npc_panel_zindex_1?: number
  manga_npc_panel_zindex_2?: number
  manga_npc_panel_zindex_3?: number
  // Ombre portée du conteneur dialogue
  manga_dialog_shadow?: boolean
  manga_dialog_shadow_blur?: number    // px, défaut 32
  manga_dialog_shadow_color?: string   // hex
  manga_dialog_shadow_opacity?: number // 0-100
  // Bordure du container dialogue
  manga_dialog_border?: boolean
  manga_dialog_border_width?: number   // px, défaut 2
  manga_dialog_border_color?: string   // hex, défaut #d4a84c
  manga_dialog_border_radius?: number  // px, défaut 0
}

export type SectionLayoutDevice = { phone?: Partial<SectionLayoutSettings>; tablet?: Partial<SectionLayoutSettings> }

export interface PathSynopses {
  trunk_start?: string        // synopsis du tronc commun de départ
  paths: Record<string, string>  // { A: "...", B: "...", C: "..." }
  trunk_end?: string          // synopsis du tronc commun de victoire (optionnel)
}

export interface Book {
  id: string
  title: string
  theme: string
  project_id?: string | null
  order_in_series?: number
  book_summary?: string | null
  phase?: BookPhase | null
  illustration_style?: IllustrationStyle
  age_range: AgeRange
  context_type: ContextType
  language: Language
  status: BookStatus
  difficulty: Difficulty
  content_mix: ContentMix
  intro_text?: string | null
  story_analysis?: string | null
  lang_analysis?: string | null
  map_style?: MapStyle | null
  map_visibility: MapVisibility
  map_svg?: string | null
  map_image_url?: string | null
  address_form?: AddressForm
  synopsis?: string | null
  acts?: BookAct[] | null
  cover_image_url?: string
  protagonist_description?: string
  protagonist_npc_id?: string | null
  illustration_bible?: string | null
  music_url?: string
  intro_sequence?: IntroFrame[] | null
  intro_audio_url?: string | null
  intro_order?: IntroStep[] | null
  section_layout?: SectionLayoutDevice | null
  player_prefs?: { sound: boolean; voice: boolean; text_mode: 1 | 2 } | null
  weapon_types?: string[]          // liste des types d'armes du livre
  combat_layout?: CombatLayoutSettings | null  // template visuel des écrans de combat
  has_branches?: boolean           // activer la génération à chemins parallèles
  path_synopses?: PathSynopses | null  // synopsis par segment narratif (tronc + chemins + victoire)
  skeleton_cache?: any             // cache temporaire du squelette (passe 1 du mode 2 passes)
  description?: string
  created_at: string
  updated_at: string
  num_sections?: number   // enrichi par /api/books (count depuis sections)
}

export type NpcType = 'ennemi' | 'boss' | 'allié' | 'neutre' | 'marchand'

export interface Npc {
  id: string
  book_id: string
  name: string
  type: NpcType
  description?: string
  force: number
  agilite: number
  intelligence: number
  magie: number
  endurance: number
  chance: number
  special_ability?: string
  resistances?: string
  loot?: string
  appearance?: string         // description physique : morphologie, traits, vêtements
  origin?: string             // origine et background du personnage
  group_name?: string         // nom du gang / clan / équipe du personnage
  speech_style?: string       // façon de parler, accent, tics de langage
  dialogue_intro?: string     // texte narrateur avant le dialogue
  voice_id?: string           // ElevenLabs voice ID
  voice_settings?: { stability: number; style: number; speed: number; similarity_boost: number }
  voice_prompt?: string       // directive de jeu d'acteur ex: "tense, breathless"
  image_url?: string          // portrait généré par IA
  background_image_url?: string      // fond de la fiche personnage (jeu)
  portrait_url?: string              // illustration buste fond gris (référence IPAdapter + fiche compacte)
  portrait_scenic_url?: string       // portrait avec décor (carte joueur immersive) — migration 071
  fullbody_gray_url?: string         // plein-pied fond gris (réf forte + fiche complète) — migration 071
  fullbody_scenic_url?: string       // plein-pied avec décor (image directe pour un plan) — migration 071
  character_illustrations?: string[] // 3 illustrations corps entier côte à côte
  name_image_url?: string            // image du nom stylisé (logo/graffiti)
  name_image_settings?: Record<string, unknown>
  portrait_emotions?: Record<string, string>  // emotion → url ex: { tendu: '...', souriant: '...' }
  combat_v3?: NpcCombatV3                     // images de combat QCM cinématique
  portrait_settings?: {                       // paramètres de génération ComfyUI
    prompt_fr?: string                        // description FR originale
    prompt_en?: string                        // prompt SDXL traduit (envoyé à ComfyUI)
    negative?: string                         // negative prompt
    steps?: number
    cfg?: number
    seed?: number
    checkpoint?: string
    style?: string
  }
  created_at: string
}

// ── Images de combat V3 (QCM cinématique) ─────────────────────────────────────
export interface NpcCombatV3 {
  neutral_url?: string                    // en garde — fond pendant le tour du joueur
  hit_url?: string                        // encaisse un coup — après attaque réussie du joueur
  dodge_url?: string                      // esquive — après attaque ratée du joueur
  ko_url?: string                         // KO / à terre — affiché à la victoire
  attack_urls?: Record<string, string>    // { "Coup haut": "url…" } — une par move ennemi (indice visuel QTE)
  // Portraits blessés (protagoniste) — utilisés selon le % de PV restants
  portrait_75_url?: string | null         // portrait affiché à ≤75% PV
  portrait_50_url?: string | null         // portrait affiché à ≤50% PV
  portrait_25_url?: string | null         // portrait affiché à ≤25% PV
}

// ── Layout visuel des écrans de combat (éditeur modèle) ───────────────────────
export interface CombatLayoutSettings {
  v3?: {
    bg: {
      vignette_opacity: number            // 0-1 — assombrir les bords pour lisibilité
      filter: 'none' | 'desaturate' | 'contrast' | 'dark'
      subject_position: 'center' | 'left' | 'right'
    }
    narrative: {
      position_y: number                  // % depuis le haut (0-100)
      bg_opacity: number                  // 0-1
      bg_color: string
      font_size: number                   // px
      font_color: string
      padding: number                     // px
      style: 'roman' | 'manuscrit' | 'sobre'
    }
    choices: {
      position_y: number                  // % depuis le bas (0-100)
      style: 'card' | 'filled' | 'outlined' | 'text_only'
      accent_color: string
      font_size: number
      gap: number                         // px entre boutons
      appear: 'cascade' | 'fade' | 'flash_cascade' | 'typewriter'
      appear_delay_ms: number             // délai avant apparition des choix
      cascade_stagger_ms: number          // décalage entre chaque bouton
    }
    hp: {
      height: number                      // px
      player_color: string
      enemy_color: string
      player_name_color: string           // couleur du nom du joueur
      enemy_name_color: string            // couleur du nom de l'ennemi
      show_numbers: boolean
      show_names: boolean
      player_x: number                    // px depuis la gauche
      player_y: number                    // px depuis le haut
      enemy_x: number
      enemy_y: number
      bar_width: number                   // px largeur de chaque barre
    }
    transition: {
      type: 'cut' | 'flash_white' | 'flash_red' | 'fade' | 'zoom_fade'
      duration_ms: number
    }
    impact: {
      screen_shake: boolean
      damage_font_size: number
      damage_color: string
      flash_on_hit: boolean
    }
    timing: {
      image_hold_ms: number               // silence après changement d'image
      narrative_hold_ms: number           // silence après texte, avant apparition des choix
      action_hold_ms: number              // durée affichage "Tu frappes / Il frappe"
      result_hold_ms: number              // durée affichage "Touché / Raté / Aïe / Esquivé"
    }
    player_turn: {
      text: string                        // "Que fais-tu ?" — affiché quand c'est le tour joueur
      position_y: number                  // px depuis le bas
      bg_color: string                    // couleur fond derrière le texte
      bg_opacity: number                  // 0-1
    }
    action_text: {
      position_y: number                  // % depuis le haut — "Tu frappes / Il frappe"
      font_size: number                   // px
      color: string                       // couleur
    }
    phase_texts: {
      player_hit:  { action: string; result: string }   // joueur frappe et touche
      player_miss: { action: string; result: string }   // joueur frappe et rate
      enemy_hit:   { action: string; result: string }   // ennemi frappe et touche
      enemy_miss:  { action: string; result: string }   // ennemi frappe et rate
    }
    end_screens: {
      victory_text: string          // ex: "Tu as gagné !"
      defeat_text: string           // ex: "Tu es KO."
    }
    player_label: {
      show: boolean
      position_x: number
      position_y: number
      font_size: number
      color: string
      bold: boolean
    }
    npc_label: {
      show: boolean
      position_x: number                  // px depuis la gauche
      position_y: number                  // px depuis le haut
      font_size: number
      color: string
      bold: boolean
    }
    dice?: {
      mode: 'simple' | 'interactive'      // simple = auto-roule animé | interactive = le joueur tape pour arrêter
      timeout_ms: number                  // ms avant arrêt auto (0 = jamais)
      show_enemy_score: boolean           // révéler le score ennemi pendant la parade
    }
  }
}

export interface ContentMix {
  combat: number
  chance: number
  enigme: number
  magie: number
}

export type AiModel = 'claude' | 'mistral' | 'mixed'
export type IllustrationStyle = 'realistic' | 'manga' | 'bnw' | 'watercolor' | 'comic' | 'dark_fantasy' | 'pixel'
export type AddressForm = 'tu' | 'vous'

export interface GenerateBookParams {
  title: string
  theme: string
  illustration_style?: IllustrationStyle
  age_range: AgeRange
  context_type: ContextType
  language: Language
  difficulty: Difficulty
  num_sections: number
  num_victory_endings?: number   // nombre de fins victoire — défaut 2. Mettre 1 pour une série où chaque tome a une fin unique.
  num_death_endings?: number     // nombre de fins mort — défaut calculé selon difficulté si absent
  content_mix: ContentMix
  map_style?: MapStyle | null
  map_visibility: MapVisibility
  description?: string
  synopsis?: string
  ai_model?: AiModel
  address_form?: AddressForm
}

export type CombatantState =
  | 'normal'
  | 'stunned'       // sonné, tête touchée
  | 'bent_low'      // plié en deux (ventre, parties)
  | 'off_balance'   // déséquilibré (balayage, poussée)
  | 'backed_up'     // acculé, reculé
  | 'grounded'      // au sol — force un tour de récupération
  | 'fleeing'       // tentative de fuite

export type CombatMoveType = 'attack' | 'recovery' | 'contextual' | 'tactical'

export interface CombatMove {
  id: string
  combat_type_id: string
  name: string
  narrative_text: string
  narrative_text_npc?: string        // version ennemi ex: "Il fonce sur toi et te percute"
  bonus_malus: number
  damage: number
  is_parry: boolean
  paired_move_id?: string | null
  is_contextual: boolean
  prop_required?: string | null
  weapon_type?: string | null        // null = universel (main nue + toute arme)
  hint_text?: string | null          // texte hint affiché au joueur dans le bouton de choix
  icon_url?: string | null           // icône custom (image) pour le move, fallback sur emoji
  sort_order: number
  created_at: string
  // Combat V4 — états contextuels
  move_type?: CombatMoveType        // défaut: 'attack'
  creates_state?: CombatantState | null   // état créé sur la cible si coup réussi
  required_state?: CombatantState | null  // état requis sur la cible pour afficher ce move
  required_self_state?: CombatantState | null // état requis sur soi (recovery quand grounded)
  narrative_on_hit?: string | null    // "Touché, il se baisse..."
  narrative_on_miss?: string | null   // texte si raté
  // Champ virtuel peuplé côté client
  paired_move?: CombatMove | null
}

export interface CombatType {
  id: string
  book_id: string
  name: string
  type: 'rue' | 'coup_de_feu' | 'surprise'
  description?: string
  created_at: string
  // Champ virtuel peuplé côté client
  moves?: CombatMove[]
}

// Stats joueur avec valeur courante + max
export interface PlayerStats {
  force_current: number
  force_max: number
  agilite_current: number
  agilite_max: number
  intelligence_current: number
  intelligence_max: number
  magie_current: number
  magie_max: number
  endurance_current: number
  endurance_max: number
  chance_current: number
  chance_max: number
  volonte_current: number
  volonte_max: number
}
