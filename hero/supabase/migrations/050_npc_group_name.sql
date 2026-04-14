-- Nom du gang / clan / équipe du personnage (utilisé dans l'intro de combat)
ALTER TABLE npcs ADD COLUMN IF NOT EXISTS group_name TEXT;
