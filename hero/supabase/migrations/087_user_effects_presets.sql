-- 087_user_effects_presets.sql
-- Refonte 2026-05-15ca — Presets perso d'effets vidéo de l'auteur.
--
-- L'auteur règle un look composite (base + modules + sliders fins) dans la
-- modale Effets et clique "Sauver". Le preset est stocké ici, scopé par
-- user_id, et apparaît dans la catégorie "Mes looks" de la sidebar partout
-- où l'auteur ouvre la modale (cross-books).
--
-- Pas de nommage côté auteur (V0) : la thumbnail (bake offscreen côté client)
-- suffit à identifier. Champ `label` réservé pour V1+.
--
-- Schema effects_params (assets_animation.effects_params JSONB, déjà existant
-- depuis migration 086) — étendu en V2 :
-- {
--   look_id: 'cinema_warm' | ... | null,             -- preset de base exclusif
--   modules: ['polaroid', 'sniper', ...],            -- empilables
--   overrides: { brightness: 0.1, contrast: 0.2 },   -- sliders fins
--   mouse_track: [{ tMs, x, y }] | null,             -- pour module 'sniper'
--   sniper_color: 'red' | 'green' | 'black',         -- option de module
--   scope_size: 0.22,                                -- option de module
--   custom_preset_id: uuid | null,                   -- ref preset perso si appliqué
-- }
-- Backward-compat : si les champs ci-dessus absents → fallback Phase B
-- (lecture directe des sliders shaders).

CREATE TABLE IF NOT EXISTS public.user_effects_presets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  label        TEXT,                       -- V1+ : nommage optionnel
  look_id      TEXT,                       -- look de base (cinema_warm, vhs_80s…)
  modules      JSONB NOT NULL DEFAULT '[]'::jsonb,    -- string[] modules empilés
  overrides    JSONB NOT NULL DEFAULT '{}'::jsonb,    -- sliders fins
  extras       JSONB NOT NULL DEFAULT '{}'::jsonb,    -- mouse_track / scope_size / sniper_color
  thumbnail_url TEXT,                       -- baked offscreen + upload Supabase
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour lookup rapide « tous les presets de l'auteur »
CREATE INDEX IF NOT EXISTS user_effects_presets_user_idx
  ON public.user_effects_presets (user_id, created_at DESC);

-- Trigger updated_at (pattern Hero standard)
CREATE OR REPLACE FUNCTION public.touch_user_effects_presets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_effects_presets_updated_at ON public.user_effects_presets;
CREATE TRIGGER trg_user_effects_presets_updated_at
  BEFORE UPDATE ON public.user_effects_presets
  FOR EACH ROW EXECUTE FUNCTION public.touch_user_effects_presets_updated_at();
