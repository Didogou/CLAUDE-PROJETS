export type AgeRange = '8-12' | '13-17' | '18+'
export type Difficulty = 'facile' | 'normal' | 'difficile' | 'expert'
export type Language = 'fr' | 'en'
export type BookStatus = 'draft' | 'published' | 'archived'
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

export interface Section {
  id: string
  book_id: string
  number: number
  content: string
  summary?: string
  content_en?: string
  image_url?: string
  animation_key?: string
  trial?: Trial
  is_ending: boolean
  ending_type?: EndingType
  status: SectionStatus
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
}

export interface Book {
  id: string
  title: string
  theme: string
  age_range: AgeRange
  context_type: ContextType
  language: Language
  status: BookStatus
  difficulty: Difficulty
  content_mix: ContentMix
  cover_image_url?: string
  description?: string
  created_at: string
  updated_at: string
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
  speech_style?: string       // façon de parler, accent, tics de langage
  dialogue_intro?: string     // texte narrateur avant le dialogue
  created_at: string
}

export interface ContentMix {
  combat: number
  chance: number
  enigme: number
  magie: number
}

export interface GenerateBookParams {
  title: string
  theme: string
  age_range: AgeRange
  context_type: ContextType
  language: Language
  difficulty: Difficulty
  num_sections: number
  content_mix: ContentMix
  description?: string
}
