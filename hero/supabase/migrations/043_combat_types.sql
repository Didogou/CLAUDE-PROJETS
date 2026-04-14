-- Table des types de combat
CREATE TABLE IF NOT EXISTS combat_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rue', 'coup_de_feu', 'surprise')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des mouvements (attaques + parades)
CREATE TABLE IF NOT EXISTS combat_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combat_type_id UUID NOT NULL REFERENCES combat_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  narrative_text TEXT NOT NULL,
  bonus_malus INTEGER NOT NULL DEFAULT 0,
  damage INTEGER NOT NULL DEFAULT 1,
  is_parry BOOLEAN NOT NULL DEFAULT FALSE,
  paired_move_id UUID REFERENCES combat_moves(id) ON DELETE SET NULL,
  is_contextual BOOLEAN NOT NULL DEFAULT FALSE,
  prop_required TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ajout sur sections
ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS combat_type_id UUID REFERENCES combat_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS combat_props JSONB DEFAULT '[]'::jsonb;
