-- Combat V4 : états contextuels et combos

ALTER TABLE combat_moves
  ADD COLUMN IF NOT EXISTS move_type TEXT NOT NULL DEFAULT 'attack'
    CHECK (move_type IN ('attack', 'recovery', 'contextual', 'tactical')),
  ADD COLUMN IF NOT EXISTS creates_state TEXT
    CHECK (creates_state IN ('stunned', 'bent_low', 'off_balance', 'backed_up', 'grounded', 'fleeing')),
  ADD COLUMN IF NOT EXISTS required_state TEXT
    CHECK (required_state IN ('normal', 'stunned', 'bent_low', 'off_balance', 'backed_up', 'grounded', 'fleeing')),
  ADD COLUMN IF NOT EXISTS required_self_state TEXT
    CHECK (required_self_state IN ('normal', 'stunned', 'bent_low', 'off_balance', 'backed_up', 'grounded', 'fleeing')),
  ADD COLUMN IF NOT EXISTS narrative_on_hit TEXT,
  ADD COLUMN IF NOT EXISTS narrative_on_miss TEXT;

-- narrative_text_npc déjà ajouté dans 046, weapon_type dans 049
-- is_contextual existant = base pour les nouveaux move_type contextual/recovery
