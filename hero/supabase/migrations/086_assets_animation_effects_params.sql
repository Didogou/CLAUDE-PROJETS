-- ────────────────────────────────────────────────────────────────────────────
-- 086_assets_animation_effects_params.sql (refonte 2026-05-15bp)
--
-- Ajoute une colonne JSONB `effects_params` sur assets_animation pour stocker
-- les paramètres WebGL d'étalonnage couleur + effets cinéma de la pellicule
-- (brightness, contrast, saturate, hue, vignette, filmGrain, bloom, chromatic
-- aberration, pixelate, glitch, preset).
--
-- Granularité = par pellicule (= par asset_animation). Tous les usages d'un
-- même asset partagent les effets. Si V2 besoin d'override par bloc timeline
-- → ajout futur d'`effects_override` sur section_timeline (jsonb merge over
-- celui de la pellicule).
--
-- Format attendu (validé côté code, pas de check DB) :
-- {
--   "brightness": 0, "contrast": 0, "saturate": 0, "hue": 0,
--   "vignette": 0, "filmGrain": 0, "bloom": 0, "chromaticAberration": 0,
--   "pixelate": 0, "glitch": "off" | "sporadic" | "constant",
--   "preset": null | "cinema_warm" | "cinema_cold" | "noir" | "retro_80s" | "cyberpunk"
-- }
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.assets_animation
  ADD COLUMN IF NOT EXISTS effects_params JSONB;

COMMENT ON COLUMN public.assets_animation.effects_params IS
  'WebGL effects params (color grading + cinéma) appliqués au preview. '
  'NULL = pas d''effets (= rendu natif). Format : voir migration 086.';
