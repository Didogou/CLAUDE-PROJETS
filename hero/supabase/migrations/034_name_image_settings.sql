ALTER TABLE npcs ADD COLUMN IF NOT EXISTS name_image_settings jsonb DEFAULT '{}'::jsonb;
