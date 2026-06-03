-- =============================================================
-- Profil nutritionnel : sexe, age, poids, taille, activite, objectif
--
-- Ajoute des colonnes sur user_nutrition_targets pour calculer
-- automatiquement daily_kcal via Mifflin-St Jeor + facteur
-- d activite + ajustement objectif.
--
-- Formule :
--   BMR (Mifflin-St Jeor) :
--     homme  : 10*P + 6.25*T - 5*A + 5
--     femme  : 10*P + 6.25*T - 5*A - 161
--   TDEE = BMR * facteur activite (1.2 .. 1.9)
--   daily_kcal = TDEE * (1 + ajustement objectif)
--     perte = -15%, maintien = 0%, prise = +10%
-- =============================================================

alter table public.user_nutrition_targets
  add column if not exists sex text
    check (sex in ('male', 'female'));

alter table public.user_nutrition_targets
  add column if not exists age_years int
    check (age_years > 0 and age_years <= 120);

alter table public.user_nutrition_targets
  add column if not exists weight_kg numeric(5,2)
    check (weight_kg > 0 and weight_kg <= 500);

alter table public.user_nutrition_targets
  add column if not exists height_cm int
    check (height_cm > 0 and height_cm <= 300);

alter table public.user_nutrition_targets
  add column if not exists activity_level text
    check (activity_level in (
      'sedentary', 'light', 'moderate', 'active', 'very_active'
    ));

alter table public.user_nutrition_targets
  add column if not exists goal text
    check (goal in ('lose', 'maintain', 'gain'));

-- Macros cibles : recalcules a chaque update du profil.
alter table public.user_nutrition_targets
  add column if not exists daily_proteins_g int
    check (daily_proteins_g >= 0 and daily_proteins_g <= 1000);

alter table public.user_nutrition_targets
  add column if not exists daily_lipids_g int
    check (daily_lipids_g >= 0 and daily_lipids_g <= 1000);

alter table public.user_nutrition_targets
  add column if not exists daily_carbs_g int
    check (daily_carbs_g >= 0 and daily_carbs_g <= 2000);

comment on column public.user_nutrition_targets.sex is
  'Sexe biologique pour le calcul du metabolisme de base.';
comment on column public.user_nutrition_targets.activity_level is
  'sedentary=1.2, light=1.375, moderate=1.55, active=1.725, very_active=1.9';
comment on column public.user_nutrition_targets.goal is
  'lose=-15%, maintain=0%, gain=+10% du TDEE';
