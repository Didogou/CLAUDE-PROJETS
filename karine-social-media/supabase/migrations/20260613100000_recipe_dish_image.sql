-- =============================================================
-- Image détourée du PLAT, extraite de la carte composite
-- `cover_image_url` (photo + titre + calories + déco).
--
-- But : pouvoir réafficher le plat SEUL en natif/responsive (le titre
-- et les calories restent en data, on les replace par-dessus côté app).
-- Renseignée par l'outil admin hero /editor-test/recipe-dish-extract
-- (rembg / Grounded-SAM → WebP transparent dans le bucket
-- `recipe-dish-images`).
-- =============================================================
alter table public.recipe_sheets
  add column if not exists dish_image_url text;

comment on column public.recipe_sheets.dish_image_url is
  'Vignette transparente du plat seul, détourée de cover_image_url. Null = pas encore extraite.';
