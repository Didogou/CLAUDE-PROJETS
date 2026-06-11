-- =============================================================
-- Overrides admin pour les tags diététiques (végétarien / sans gluten).
--
-- Par défaut, les tags sont calculés en auto depuis la liste des
-- ingrédients (heuristique dans src/lib/dietary-tags.ts).
--
-- Ces 2 colonnes permettent à Karine de FORCER le tag :
--  - null  = utiliser l'auto-détection (défaut)
--  - true  = forcer le tag à OUI (l'auto-détection peut s'être trompée)
--  - false = forcer le tag à NON (exclusion manuelle)
-- =============================================================

alter table public.recipe_sheets
  add column if not exists is_vegetarian_override boolean,
  add column if not exists is_gluten_free_override boolean,
  add column if not exists is_pork_free_override boolean;

comment on column public.recipe_sheets.is_vegetarian_override is
  'Override admin du tag végétarien. NULL = auto, TRUE = forcé oui, FALSE = forcé non.';
comment on column public.recipe_sheets.is_gluten_free_override is
  'Override admin du tag sans gluten. NULL = auto, TRUE = forcé oui, FALSE = forcé non.';
comment on column public.recipe_sheets.is_pork_free_override is
  'Override admin du tag sans porc. NULL = auto, TRUE = forcé oui, FALSE = forcé non.';
