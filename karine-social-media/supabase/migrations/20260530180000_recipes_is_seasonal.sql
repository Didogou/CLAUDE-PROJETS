-- Ajout du flag "de saison" sur les recettes
-- (true = recette préparée à partir d'ingrédients de saison)

alter table public.recipes
  add column is_seasonal boolean not null default false;

create index recipes_is_seasonal_idx on public.recipes(is_seasonal) where is_seasonal;
