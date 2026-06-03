-- =============================================================
-- Compteur calories + objectif quotidien.
--
-- Deux tables :
--  1) user_nutrition_targets : objectif kcal/eau par utilisatrice
--     (1 row par user, upsert sur user_id).
--  2) food_log_entries : log des aliments consommés. 1 row par
--     entrée (yaourt, pomme, recette, menu…). Filtrable par jour.
--
-- Sources possibles d'une entrée (champ `source`) :
--  - 'ciqual'  : entrée résolue dans la base Ciqual (alim_code)
--  - 'recipe'  : ajout via icône +kcal sur une fiche recette
--  - 'menu'    : ajout via icône +kcal sur fiche menu (lunch/dinner)
--  - 'free'    : saisie libre sans match Ciqual (Mistral n'a pas
--                trouvé, ou utilisatrice tape un nom inconnu)
-- =============================================================

create table if not exists public.user_nutrition_targets (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  daily_kcal      int not null default 2000 check (daily_kcal > 0 and daily_kcal <= 10000),
  daily_water_ml  int not null default 1500 check (daily_water_ml > 0 and daily_water_ml <= 10000),
  updated_at      timestamptz not null default now()
);

alter table public.user_nutrition_targets enable row level security;

create policy "nutrition_targets_self" on public.user_nutrition_targets
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.food_log_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  logged_at       timestamptz not null default now(),
  source          text not null check (source in ('ciqual', 'recipe', 'menu', 'free')),
  source_ref_id  text,
  label           text not null,
  kcal            numeric not null check (kcal >= 0 and kcal < 10000),
  proteins_g      numeric,
  lipids_g        numeric,
  carbs_g         numeric,
  portions        numeric not null default 1 check (portions > 0 and portions <= 100),
  created_at      timestamptz not null default now()
);

create index if not exists food_log_entries_user_day_idx
  on public.food_log_entries(user_id, logged_at desc);

alter table public.food_log_entries enable row level security;

create policy "food_log_entries_self" on public.food_log_entries
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_nutrition_targets is
  'Objectifs nutritionnels quotidiens par utilisatrice (kcal + eau).';
comment on table public.food_log_entries is
  'Log d''aliments consommés. Source = ciqual/recipe/menu/free.';
