// Types partagés avec l'admin (version allégée côté jeu)

export interface Book {
  id: string
  title: string
  theme: string
  age_range: string
  cover_image_url?: string
  intro_text?: string
  intro_sequence?: IntroFrame[]
  illustration_style?: string
  protagonist_description?: string
  protagonist_npc_id?: string
  map_svg?: string
  map_image_url?: string
  music_url?: string
}

export interface Section {
  id: string
  book_id: string
  number: number
  content: string
  summary?: string
  images?: SectionImage[]
  music_url?: string
  trial?: Trial
  is_ending: boolean
  ending_type?: 'victory' | 'death'
  tension_level: number
  companion_npc_ids?: string[]
  reading_time?: number
  decision_time?: number
  continues_timer?: boolean
  hint_text?: string
}

export interface SectionImage {
  url?: string
  description: string
  style: string
}

export interface Choice {
  id: string
  section_id: string
  label: string
  target_section_id?: string
  requires_trial: boolean
  sort_order: number
  is_back?: boolean
  transition_text?: string
  return_text?: string
  transition_image_url?: string
}

export interface Trial {
  type: string
  npc_id?: string
  success_section_id?: string
  failure_section_id?: string
  endurance_loss_on_failure?: number
  dialogue_goal?: string
}

export interface NPC {
  id: string
  name: string
  type: 'allié' | 'boss' | 'ennemi' | 'neutre' | 'marchand'
  description?: string
  appearance?: string
  speech_style?: string
  intelligence: number
  force: number
  endurance: number
  image_url?: string
  background_image_url?: string
  portrait_url?: string
  character_illustrations?: string[]
  name_image_url?: string
  name_image_settings?: { width?: number; bottom?: number; left?: number; rotation?: number }
  voice_id?: string
  voice_settings?: VoiceSettings
}

export interface VoiceSettings {
  stability: number
  similarity_boost: number
  style: number
  speed: number
}

export interface IntroFrame {
  id: string
  order: number
  framing: string
  prompt_fr?: string
  narrative_text?: string
  image_url?: string
  video_url?: string
  duration: number
}

export interface PlayerState {
  book_id: string
  current_section_id: string
  character: CharacterStats
  visited_sections: string[]
  npc_memories: Record<string, NpcMemory[]>
  tension_overrides: Record<string, number>  // section_id → tension modifié par ignorance PNJ
}

export interface CharacterStats {
  name?: string
  endurance: number
  max_endurance: number
  force: number
  agilite: number
  intelligence: number
  magie: number
  chance: number
  job?: string
  inventory: InventoryItem[]
}

export interface InventoryItem {
  id: string
  name: string
  type: string
  effect: Record<string, number>
  quantity: number
}

export interface NpcMemory {
  section_number: number
  outcome: 'success' | 'failure' | 'abandoned'
  memory_summary: string
  timestamp: string
}

export interface DialogueResult {
  npc_reply: string
  suggested_choice_index: number | null
  test_result: 'success' | 'partial' | 'failure'
  is_resolved: boolean
}

export interface PostChoiceReaction {
  reaction_type: 'confirm' | 'contradict' | 'none'
  npc_reply: string | null
  alternative_choice_index: number | null
  test_result: 'success' | 'partial' | 'failure'
}
