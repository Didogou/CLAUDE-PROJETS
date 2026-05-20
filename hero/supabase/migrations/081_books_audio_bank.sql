-- Migration 081 : banque audio par-livre (SFX + musique)
--
-- Phase 2 timeline multi-pistes (refonte 2026-05-12).
--
-- Le MultiTrackEditor avait une banque SFX/musique local-session qui se
-- perdait au refresh. Cette migration ajoute une colonne `audio_bank` jsonb
-- sur `books` qui persiste tous les sons générés/importés réutilisables
-- entre toutes les pellicules de toutes les sections du livre.
--
-- Format jsonb :
-- {
--   "sfx": [
--     { "id": "sfx-...", "label": "Sonnette appartement Duke",
--       "url": "https://.../audio/books/X/sfx/123.mp3",
--       "durationSec": 2.5, "createdAt": 1715600000000 }
--   ],
--   "music": [ ... même shape ... ]
-- }
--
-- Pas de table dédiée ni de FK : la banque est éphémère côté book et un
-- delete book cascade naturellement (jsonb dans la même row).

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS audio_bank jsonb DEFAULT '{"sfx": [], "music": []}'::jsonb;

COMMENT ON COLUMN books.audio_bank IS
  'Banque audio par-livre (Phase 2 timeline 2026-05-12). Format : { sfx: [...], music: [...] }. Chaque entrée : { id, label, url, durationSec, createdAt }';
