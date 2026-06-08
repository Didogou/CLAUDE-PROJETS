-- Persistance du Nutri-Score sur chaque fiche repas d'un menu hebdo.
-- Mêmes colonnes que recipe_sheets (cf. 20260608120000) : calcul fait
-- au save admin (PATCH ingredients) puis stocké. Pages publiques et
-- admin lisent directement les colonnes.
alter table public.menu_meal_sheets
  add column if not exists nutriscore_grade text
    check (nutriscore_grade is null or nutriscore_grade in ('A', 'B', 'C', 'D', 'E')),
  add column if not exists nutriscore_points integer,
  add column if not exists nutriscore_confidence numeric(4, 3)
    check (nutriscore_confidence is null or (nutriscore_confidence >= 0 and nutriscore_confidence <= 1)),
  add column if not exists nutriscore_computed_at timestamptz;

-- Index pour pouvoir filtrer / trier les meal sheets par grade plus tard.
create index if not exists menu_meal_sheets_nutriscore_grade_idx
  on public.menu_meal_sheets(nutriscore_grade)
  where nutriscore_grade is not null;
