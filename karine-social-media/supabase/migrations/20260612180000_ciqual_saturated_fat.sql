-- Ajoute saturated_fat_g sur ciqual_foods pour le calcul Nutri-Score précis.
--
-- Pourquoi : nutriscore-aggregate.ts:520 estimait les AGS à 30% des lipides
-- totaux (constante magique). Sous-estime drastiquement les recettes
-- riches en beurre (65% AGS), fromage (50-60%), crème (50%), etc.
-- → Quiches/gratins/fondues affichaient A-B alors qu'ils devraient
-- être C-D voire E.
--
-- Source : Table Ciqual ANSES 2024 — colonne "AG saturés (g/100 g)".
-- Audit triple 2026-06-12 — agent C bug critique #2.

alter table public.ciqual_foods
  add column if not exists saturated_fat_g numeric;

comment on column public.ciqual_foods.saturated_fat_g is
  'Acides gras saturés (g/100g). Source : colonne AG saturés Ciqual ANSES. Utilisé pour le calcul Nutri-Score (remplace l''estimation 30% des lipides). Null si non disponible.';
