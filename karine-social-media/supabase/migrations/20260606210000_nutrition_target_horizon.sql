-- ============================================================
-- Profil nutrition : horizon de l'objectif (3 / 6 / 12 mois)
-- ============================================================
-- Permet à la patiente de définir un objectif de perte sur
-- l'horizon de son choix (avant : fixé à 3 mois).
--
-- target_horizon_months ∈ {3, 6, 12}
-- weight_loss_kg :
--   - horizon 3  → 0..9  kg
--   - horizon 6  → 0..15 kg
--   - horizon 12 → 0..30 kg
-- Tout ça reste cohérent avec une perte saine ≈ 3 kg / mois.

alter table public.user_nutrition_targets
  add column if not exists target_horizon_months integer not null default 3
  check (target_horizon_months in (3, 6, 12));

comment on column public.user_nutrition_targets.target_horizon_months is
  'Horizon (en mois) sur lequel l''objectif de perte est planifié : 3, 6 ou 12. Default 3.';

-- Élargir le check de weight_loss_kg : avant max 9 (3 mois fixes),
-- maintenant max 30 (12 mois × 2.5 kg/mois). La cohérence
-- horizon ↔ valeur est gérée côté API + UI.
alter table public.user_nutrition_targets
  drop constraint if exists user_nutrition_targets_weight_loss_kg_check;
alter table public.user_nutrition_targets
  add constraint user_nutrition_targets_weight_loss_kg_check
  check (weight_loss_kg is null or (weight_loss_kg >= 1 and weight_loss_kg <= 30));
