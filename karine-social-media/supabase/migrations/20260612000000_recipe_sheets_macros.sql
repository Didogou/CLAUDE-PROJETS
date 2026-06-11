-- Ajoute les colonnes macros (par PORTION) sur recipe_sheets.
-- Calculées automatiquement à la sauvegarde d'une fiche, à partir des
-- ingrédients × portions × Ciqual.
--
-- Pourquoi PAR PORTION et pas par 100g :
--   - C'est la valeur qui est ajoutée dans food_log_entries quand
--     l'utilisatrice clique "Ajouter au repas" depuis SheetCarousel.
--   - Aligné sur recipe_sheets.calories (kcal par portion, déjà comme ça).
--
-- Macros stockées en NUMERIC pour matcher ciqual_foods (précision décimale).
-- Nullables : si le calcul échoue (ingrédients non mappés Ciqual), null.

alter table public.recipe_sheets
  add column if not exists proteins_g numeric,
  add column if not exists lipids_g   numeric,
  add column if not exists carbs_g    numeric;

comment on column public.recipe_sheets.proteins_g is
  'Protéines (g) PAR PORTION. Calculé depuis ingredients × Ciqual à la sauvegarde. Null si calcul impossible.';
comment on column public.recipe_sheets.lipids_g is
  'Lipides (g) PAR PORTION. Calculé depuis ingredients × Ciqual à la sauvegarde.';
comment on column public.recipe_sheets.carbs_g is
  'Glucides (g) PAR PORTION. Calculé depuis ingredients × Ciqual à la sauvegarde.';
