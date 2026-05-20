ALTER TABLE npcs
  ADD COLUMN IF NOT EXISTS background_image_url text,
  ADD COLUMN IF NOT EXISTS portrait_url text;
