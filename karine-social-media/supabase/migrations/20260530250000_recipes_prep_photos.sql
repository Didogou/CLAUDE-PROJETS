-- Photos réelles de la préparation par Karine (optionnelles).
-- Affichées en pellicule horizontale sous la barre d'actions de la recette.
alter table public.recipes
  add column if not exists prep_photos text[] not null default array[]::text[];
