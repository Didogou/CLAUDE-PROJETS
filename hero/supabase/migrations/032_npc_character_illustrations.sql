ALTER TABLE npcs ADD COLUMN IF NOT EXISTS character_illustrations jsonb DEFAULT '[]'::jsonb;
