-- =============================================================
-- Ajout de la categorie de repas (petit-dejeuner / dejeuner /
-- gouter / diner) sur food_log_entries.
--
-- Decision Didier 2026-06-04 : 1 saisie = 1 categorie partagee
-- par tous les aliments du parse. L abonnee peut changer apres
-- coup. Pour les anciennes entrees (meal_category null), on
-- deduit cote front depuis l heure de logged_at.
-- =============================================================

alter table public.food_log_entries
  add column if not exists meal_category text
    check (meal_category in ('breakfast', 'lunch', 'snack', 'dinner'));

create index if not exists food_log_entries_user_meal_idx
  on public.food_log_entries(user_id, meal_category);

comment on column public.food_log_entries.meal_category is
  'Categorie de repas (breakfast/lunch/snack/dinner). Null sur entrees pre-migration -> deduite cote front depuis logged_at.';
