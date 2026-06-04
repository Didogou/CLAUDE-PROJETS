-- =============================================================
-- daily_metrics : tableau de bord jour par jour pour l abonnee.
--
-- Stocke pour chaque (user, date) :
--  - kcal_burned : depense energetique saisie manuellement
--  - weight_kg : poids du jour (optionnel)
--  - summary_text : bilan bienveillant genere par Mistral le soir
--  - summary_generated_at : timestamp generation
--
-- Le bilan Mistral est declenche par un cron Vercel (heure
-- reglable par user dans user_nutrition_targets.summary_hour).
-- =============================================================

create table if not exists public.daily_metrics (
  user_id              uuid not null references auth.users(id) on delete cascade,
  date                 date not null,
  kcal_burned          int not null default 0
                       check (kcal_burned >= 0 and kcal_burned <= 10000),
  weight_kg            numeric(5,2)
                       check (weight_kg > 0 and weight_kg <= 500),
  summary_text         text,
  summary_generated_at timestamptz,
  updated_at           timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists daily_metrics_user_date_idx
  on public.daily_metrics(user_id, date desc);

alter table public.daily_metrics enable row level security;

create policy "daily_metrics_self" on public.daily_metrics
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Heure du bilan quotidien (19-22h). Reglable dans le profil.
alter table public.user_nutrition_targets
  add column if not exists summary_hour int not null default 21
  check (summary_hour >= 0 and summary_hour <= 23);

comment on table public.daily_metrics is
  'Metriques quotidiennes (kcal brules, poids) + bilan Mistral.';
comment on column public.daily_metrics.kcal_burned is
  'Depense energetique du jour (saisie manuelle ou import HealthKit V2).';
comment on column public.daily_metrics.summary_text is
  'Bilan bienveillant genere par Mistral chaque soir vers summary_hour.';
