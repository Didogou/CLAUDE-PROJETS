-- Ajout de l'URL d'image de combat sur les sections
ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS combat_image_url TEXT;
