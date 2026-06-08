-- Persistance du Nutri-Score sur chaque fiche détaillée.
--
-- Le score (grade A–E, points et confiance) est calculé à chaque
-- save admin d'une recette (PATCH /api/admin/recipes/[slug]/sheets/
-- [sheetId]) puis stocké ici. Pages publiques et liste admin lisent
-- ces colonnes directement, plus de calcul à la volée.
--
-- Champs :
--   nutriscore_grade        : 'A' | 'B' | 'C' | 'D' | 'E' | null
--   nutriscore_points       : score brut Nutri-Score (utile pour
--                             calculer des moyennes par catégorie)
--   nutriscore_confidence   : 0–1, ratio du poids matché Ciqual sur
--                             le poids total des ingrédients qty-renseignés
--   nutriscore_computed_at  : timestamp du dernier calcul (debug)
--
-- Toutes les colonnes sont nullables : une recette qui n'a pas
-- d'ingrédients ou qui n'a pas encore été passée par la page admin
-- Nutri-Score reste avec NULL → l'UI affiche rien.
alter table public.recipe_sheets
  add column if not exists nutriscore_grade text
    check (nutriscore_grade is null or nutriscore_grade in ('A', 'B', 'C', 'D', 'E')),
  add column if not exists nutriscore_points integer,
  add column if not exists nutriscore_confidence numeric(4, 3)
    check (nutriscore_confidence is null or (nutriscore_confidence >= 0 and nutriscore_confidence <= 1)),
  add column if not exists nutriscore_computed_at timestamptz;

-- Index sur le grade pour pouvoir filtrer / trier les recettes par
-- Nutri-Score dans des features futures ("recettes A et B").
create index if not exists recipe_sheets_nutriscore_grade_idx
  on public.recipe_sheets(nutriscore_grade)
  where nutriscore_grade is not null;
