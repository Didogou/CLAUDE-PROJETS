-- Migration 090 — Timing in/out par calque (2026-05-18)
--
-- Phase A bis du chantier keyframes : refonte UX layers en track timeline.
-- Avant : un calque était toujours visible pendant toute la durée de sa
-- pellicule parente (pas de start/end propre).
-- Après : chaque calque a son propre timing in/out RELATIF au début de la
-- pellicule parente, permettant ex : "perso entre à T=2s, sort à T=6s" dans
-- une pellicule de 8s.
--
-- Champs ajoutés :
--   - start_ms_rel : début du calque en ms relatif au début de la pellicule.
--     default 0 = visible dès le début. Doit être >= 0.
--   - duration_ms  : durée d'affichage en ms. null = visible jusqu'à la fin
--     de la pellicule parente. Doit être > 0 si fourni.
--
-- Runtime PelliculeRenderer gate le rendu :
--   cursorRelMs ∈ [start_ms_rel, start_ms_rel + (duration_ms ?? parentDur)]

BEGIN;

ALTER TABLE public.pellicule_layers
  ADD COLUMN IF NOT EXISTS start_ms_rel INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms  INTEGER;

ALTER TABLE public.pellicule_layers
  ADD CONSTRAINT pellicule_layers_start_ms_rel_check CHECK (start_ms_rel >= 0),
  ADD CONSTRAINT pellicule_layers_duration_ms_check CHECK (duration_ms IS NULL OR duration_ms > 0);

COMMENT ON COLUMN public.pellicule_layers.start_ms_rel IS
  'Phase A bis 2026-05-18 — Début du calque en ms relatif au début de la pellicule parente. '
  '0 = visible dès le début.';
COMMENT ON COLUMN public.pellicule_layers.duration_ms IS
  'Phase A bis 2026-05-18 — Durée d''affichage du calque en ms. NULL = visible jusqu''à la '
  'fin de la pellicule parente.';

COMMIT;
