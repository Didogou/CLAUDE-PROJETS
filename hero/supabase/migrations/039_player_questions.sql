-- Ajout des questions contextuelles du joueur par section
ALTER TABLE sections ADD COLUMN IF NOT EXISTS player_questions text[] DEFAULT '{}';
