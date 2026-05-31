-- Champ "à la une" : Karine peut épingler une recette par catégorie.
-- Côté lecture : on prend la épinglée la plus récente s'il y en a, sinon la dernière publiée.
alter table public.recipes
  add column if not exists is_featured boolean not null default false;

create index if not exists recipes_is_featured_idx
  on public.recipes(category, is_featured, published_at desc)
  where is_featured;
