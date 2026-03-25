-- Reading time, decision time, and initiative text per section
ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS reading_time  integer DEFAULT NULL, -- secondes
  ADD COLUMN IF NOT EXISTS decision_time integer DEFAULT NULL, -- secondes
  ADD COLUMN IF NOT EXISTS initiative_text text    DEFAULT NULL; -- texte si joueur trop lent → combat
