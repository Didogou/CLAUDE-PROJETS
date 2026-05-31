-- Compteur de likes anonyme V1 (sans table de relations).
-- Quand les abonnés auront un compte, on basculera vers une table `recipe_likes`
-- pour empêcher les doubles likes et compter par utilisateur.
alter table public.recipes
  add column if not exists likes_count integer not null default 0;

create index if not exists recipes_likes_count_idx on public.recipes(likes_count desc);
