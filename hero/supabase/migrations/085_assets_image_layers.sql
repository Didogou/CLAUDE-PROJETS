-- Migration 085 — assets_image : ajout colonne `layers` JSONB (refonte 2026-05-14)
--
-- Contexte : le Designer (new-layout) gère des "calques" superposés à l'image
-- de base (perso drag-drop, objets extraits, découpages SAM, etc.). En V2,
-- ces calques étaient PERDUS au refresh car savePlanToDb V2 ne persistait que
-- `url`. Audit V2 mentionnait cette perte silencieuse.
--
-- Choix : colonne JSONB pour stocker `Layer[]` runtime tel quel (= structure
-- libre, peut évoluer sans migration). Pas de FK ni de validation : trust the
-- client. Si on a besoin d'indexer un champ précis plus tard (ex: chercher
-- toutes les images contenant un calque persotype X), on créera un index
-- partiel GIN sur jsonb_path.

BEGIN;

ALTER TABLE public.assets_image
  ADD COLUMN IF NOT EXISTS layers jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.assets_image.layers IS
  'Calques runtime du Designer (perso, objets extraits, découpages SAM, …). '
  'Sérialisés tels quels depuis le state EditorState (Layer[]). Format libre.';

COMMIT;
