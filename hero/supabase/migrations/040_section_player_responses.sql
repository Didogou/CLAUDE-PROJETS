ALTER TABLE sections ADD COLUMN IF NOT EXISTS player_responses jsonb DEFAULT '{}'::jsonb;
