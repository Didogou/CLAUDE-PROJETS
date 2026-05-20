-- Migration 089 — Keyframes runtime sur pellicule entière (2026-05-18)
--
-- Phase B du chantier keyframes. Permet d'animer la pellicule dans le temps :
-- zoom progressif (Ken Burns), fade in/out global, slide, rotation.
--
-- Stockage : colonne JSONB `keyframes` sur section_timeline. Format :
--   [
--     { "t": 0,    "props": { "scale": 1.0, "opacity": 1.0 }, "easing": "ease-in-out" },
--     { "t": 4000, "props": { "scale": 1.3, "opacity": 1.0 }, "easing": "ease-out" }
--   ]
-- Avec :
--   - t : timestamp en ms relatif au début de la pellicule (0 = start)
--   - props : valeurs cible des propriétés (position_x/y en %, scale, opacity, rotation deg)
--   - easing : interpolation entre CE keyframe et le SUIVANT
--
-- Le runtime (PelliculeRenderer) interpole entre 2 keyframes adjacents selon
-- le cursorMs courant, et applique le résultat en CSS transform/opacity.
--
-- null ou [] = pas d'animation, comportement par défaut (rendu statique).

BEGIN;

ALTER TABLE public.section_timeline
  ADD COLUMN IF NOT EXISTS keyframes JSONB;

COMMENT ON COLUMN public.section_timeline.keyframes IS
  'Phase B keyframes 2026-05-18 — animation runtime de la pellicule entière. '
  'Format : Array<{t, props, easing}> avec t en ms relatif au début. '
  'null/[] = pas d''animation (rendu statique).';

COMMIT;
