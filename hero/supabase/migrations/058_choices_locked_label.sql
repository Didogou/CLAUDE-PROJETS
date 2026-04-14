-- Colonne locked_label sur choices (texte affiché quand le choix est verrouillé par condition)
ALTER TABLE choices ADD COLUMN IF NOT EXISTS locked_label text;
