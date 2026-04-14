-- Migration 062 : Synopsis par segment narratif
-- Stocke les synopsis individuels pour le tronc commun de départ,
-- chaque chemin parallèle (A, B, C…) et le tronc commun de victoire.

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS path_synopses jsonb;

-- Structure attendue :
-- {
--   "trunk_start": "Synopsis du tronc commun de départ…",
--   "paths": {
--     "A": "Synopsis du chemin A…",
--     "B": "Synopsis du chemin B…",
--     "C": "Synopsis du chemin C…"
--   },
--   "trunk_end": "Synopsis du tronc commun de victoire… (optionnel)"
-- }
