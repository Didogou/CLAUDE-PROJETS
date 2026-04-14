-- Migration 060 : Ajout du champ has_branches sur books
-- Permet d'activer la génération à chemins parallèles sans avoir
-- à mettre "CHEMIN A/B" dans le synopsis

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS has_branches boolean NOT NULL DEFAULT false;
