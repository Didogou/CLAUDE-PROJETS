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
export type ItemType = 'soin' | 'mana' | 'arme' | 'armure' | 'outil' | 'quete' | 'grimoire'
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

export interface Trial {
  type: TrialType
  stat: keyof StatModifiers
  success_section_id?: string
  failure_section_id?: string
  enemy?: Enemy
  npc_id?: string
  xp_reward?: number
  item_rewards?: string[]
  mana_cost?: number
  endurance_loss_on_failure?: number
  // Dialogue-specific
  dialogue_opening?: string   // première réplique du PNJ
  dialogue_goal?: string      // ce que le joueur doit obtenir/convaincre
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
  description?: string
  illustration_url?: string
  section_found_id?: string
  sections_used: string[]   // array of section IDs
  effect: Record<string, any>
  created_at: string
}

export interface SectionImage {
  url?: string
  description?: string
  style?: IllustrationStyle
}

export interface SectionDialogue {
  text: string
  speaker?: string   // nom du locuteur, "joueur" ou null si inconnu
  npc_id?: string    // id du PNJ si identifié
  source: 'content' | 'transition'
  image_index?: number  // 0-3 : plan sur lequel afficher la bulle
  voice_prompt?: string  // override du prompt de jeu d'acteur pour cette réplique
  audio_url?: string     // URL Supabase Storage du MP3 sauvegardé
}

export interface Section {
  id: string
  book_id: string
  number: number
  content: string
  summary?: string
  narrative_arc?: NarrativeArc | null
  music_url?: string
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
  dialogues?: SectionDialogue[]
  hint_text?: string
  player_questions?: string[]
  player_responses?: Record<string, Record<string, string>>
  conv_first_npc_id?: string | null
}

export interface Choice {
  id: string
  section_id: string
  label: string
  label_en?: string
  target_section_id?: string
  requires_trial: boolean
  condition?: { stat?: string; min?: number; item_id?: string }
  sort_order: number
  transition_text?: string
  transition_image_url?: string
  transition_image_index?: number  // 0-3, image de la section à afficher (défaut 3)
  return_text?: string
  return_image_index?: number
  is_back?: boolean
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
  vignette_style: 'circle' | 'card'
  vignette_border_color: string
  vignette_positions: { x: number; y: number }[]
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
  speech_style?: string       // façon de parler, accent, tics de langage
  dialogue_intro?: string     // texte narrateur avant le dialogue
  voice_id?: string           // ElevenLabs voice ID
  voice_settings?: { stability: number; style: number; speed: number; similarity_boost: number }
  voice_prompt?: string       // directive de jeu d'acteur ex: "tense, breathless"
  image_url?: string          // portrait généré par IA
  background_image_url?: string      // fond de la fiche personnage (jeu)
  portrait_url?: string              // illustration buste (protagoniste)
  character_illustrations?: string[] // 3 illustrations corps entier côte à côte
  name_image_url?: string            // image du nom stylisé (logo/graffiti)
  name_image_settings?: Record<string, unknown>
  portrait_emotions?: Record<string, string>  // emotion → url ex: { tendu: '...', souriant: '...' }
  created_at: string
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
  content_mix: ContentMix
  map_style?: MapStyle | null
  map_visibility: MapVisibility
  description?: string
  synopsis?: string
  ai_model?: AiModel
  address_form?: AddressForm
}
