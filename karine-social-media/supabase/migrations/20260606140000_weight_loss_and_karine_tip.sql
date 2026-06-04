-- =============================================================
-- Refonte objectif + conseil Karine
--
-- 1) user_nutrition_targets : remplace le concept lose/maintain/gain
--    par un objectif precis "perdre X kg sur 3 mois".
--    On garde l'ancienne colonne goal (legacy) mais on l ignore
--    cote calcul des le moment ou weight_loss_kg est posee.
--
-- 2) daily_metrics : conseil Karine du jour. Genere par Mistral
--    apres chaque ajout de repas (1 conseil/jour, ecrasement).
--
-- Decision Didier 2026-06-04 : preset perte de poids 1-9 kg sur
-- 3 mois fixe. Deficit kcal/jour calcule silencieusement :
--   deficit = weight_loss_kg * 7700 / 90 (capped 800).
-- =============================================================

alter table public.user_nutrition_targets
  add column if not exists weight_loss_kg int
    check (weight_loss_kg >= 1 and weight_loss_kg <= 9);

comment on column public.user_nutrition_targets.weight_loss_kg is
  'Objectif de perte de poids en kg sur 3 mois. Le deficit calorique est calcule cote backend : kg * 7700 / 90 (cap 800 kcal/j). Null = pas d objectif (maintenance).';

alter table public.daily_metrics
  add column if not exists karine_tip text,
  add column if not exists karine_tip_at timestamptz;

comment on column public.daily_metrics.karine_tip is
  'Conseil bienveillant Karine du jour. Genere par Mistral apres chaque ajout d aliment. 1 conseil/jour, ecrase a chaque update.';
