-- =============================================================
-- Overrides de tags diététiques sur les fiches repas de menu —
-- PARITÉ avec recipe_sheets (is_vegetarian_override / gluten_free /
-- pork_free). null = auto-détection depuis les ingrédients ;
-- true/false = Karine force la valeur si l'auto se trompe.
-- =============================================================
alter table public.menu_meal_sheets
  add column if not exists is_vegetarian_override boolean,
  add column if not exists is_gluten_free_override boolean,
  add column if not exists is_pork_free_override boolean;

comment on column public.menu_meal_sheets.is_vegetarian_override is
  'null = auto (depuis ingrédients) ; true/false = forcé par Karine.';
comment on column public.menu_meal_sheets.is_gluten_free_override is
  'null = auto ; true/false = forcé.';
comment on column public.menu_meal_sheets.is_pork_free_override is
  'null = auto ; true/false = forcé.';
