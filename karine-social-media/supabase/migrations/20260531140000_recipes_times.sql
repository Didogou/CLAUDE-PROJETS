-- Temps de préparation et de cuisson (en minutes), optionnels.
alter table public.recipes
  add column if not exists prep_time_min integer,
  add column if not exists cook_time_min integer;
