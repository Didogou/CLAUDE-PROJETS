-- Template visuel des écrans de combat V3 (CombatLayoutSettings)
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS combat_layout JSONB;
