-- =============================================================
-- Compteur d'eau (verres bus aujourd'hui).
--
-- L'objectif est déjà sur user_nutrition_targets.daily_water_ml
-- (migration 20260605100000). On ajoute :
--  - water_log_entries : 1 row par "+1 verre" cliqué
--  - user_water_settings : taille du verre par défaut (ml)
--
-- Pourquoi 2 tables séparées (et pas un total daily) :
--  - Permet annuler facilement le dernier verre (DELETE 1 row)
--  - Permet d'avoir l'historique pour stats futures
--  - Cohérent avec food_log_entries (même pattern logique)
-- =============================================================

create table if not exists public.user_water_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  glass_size_ml  int not null default 250 check (glass_size_ml > 0 and glass_size_ml <= 2000),
  updated_at     timestamptz not null default now()
);

alter table public.user_water_settings enable row level security;
create policy "water_settings_self" on public.user_water_settings
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.water_log_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  logged_at   timestamptz not null default now(),
  -- Taille de CE verre (snapshot au moment du log, pour que le
  -- changement de réglage ne réécrive pas le passé).
  ml          int not null check (ml > 0 and ml <= 2000),
  created_at  timestamptz not null default now()
);

create index if not exists water_log_user_day_idx
  on public.water_log_entries(user_id, logged_at desc);

alter table public.water_log_entries enable row level security;
create policy "water_log_self" on public.water_log_entries
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.water_log_entries is
  'Log des verres d eau bus. 1 row par +1 cliqué. ml snapshot au moment du log.';
