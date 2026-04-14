-- Migration 061 : Cache du squelette pour la génération en 2 passes
-- Stocke temporairement les squelettes générés en passe 1
-- avant l'enrichissement en passe 2

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS skeleton_cache jsonb;
