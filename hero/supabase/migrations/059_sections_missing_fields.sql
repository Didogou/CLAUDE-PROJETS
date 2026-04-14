-- Colonnes manquantes sur sections utilisées par generate-sections
ALTER TABLE sections ADD COLUMN IF NOT EXISTS tension_level integer DEFAULT 5 CHECK (tension_level >= 0 AND tension_level <= 10);
ALTER TABLE sections ADD COLUMN IF NOT EXISTS companion_npc_ids uuid[] DEFAULT '{}';
