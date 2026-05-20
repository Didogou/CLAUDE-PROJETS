ALTER TABLE npcs ADD COLUMN IF NOT EXISTS voice_settings jsonb DEFAULT '{"stability":0.5,"style":0,"speed":1,"similarity_boost":0.75}'::jsonb;
ALTER TABLE npcs ADD COLUMN IF NOT EXISTS voice_prompt text;
