ALTER TABLE sections ADD COLUMN IF NOT EXISTS items_on_scene jsonb DEFAULT '[]'::jsonb;
