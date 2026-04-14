-- Discussion system: relational tables replacing discussion_scene JSONB
-- discussion_scenes: metadata (npc, opening, outcome thought)
-- discussion_choices: recursive choice tree with proper FK constraints

CREATE TABLE discussion_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid UNIQUE NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  npc_id uuid REFERENCES npcs(id) ON DELETE SET NULL,
  npc_opening text,
  outcome_thought text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE discussion_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES discussion_scenes(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES discussion_choices(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  player_text text,
  emotion_label text,
  npc_response text,
  npc_capitulation text,
  target_section_id uuid REFERENCES sections(id) ON DELETE SET NULL,
  condition_item text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_discussion_scenes_section ON discussion_scenes(section_id);
CREATE INDEX idx_discussion_choices_scene ON discussion_choices(scene_id);
CREATE INDEX idx_discussion_choices_parent ON discussion_choices(parent_id);

-- starting_money range on books
ALTER TABLE books ADD COLUMN IF NOT EXISTS starting_money_min integer DEFAULT 10;
ALTER TABLE books ADD COLUMN IF NOT EXISTS starting_money_max integer DEFAULT 50;
