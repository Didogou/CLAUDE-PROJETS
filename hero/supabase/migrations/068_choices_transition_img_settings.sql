-- Paramètres de génération d'image pour les transitions (modèle, style, format, réf. section)
ALTER TABLE choices ADD COLUMN IF NOT EXISTS transition_img_settings JSONB;
