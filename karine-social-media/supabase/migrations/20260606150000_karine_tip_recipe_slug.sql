-- =============================================================
-- Ajout du slug de la recette referencee par le conseil Karine.
--
-- Quand Mistral cite une recette dans son conseil (uniquement pour
-- un diner), on stocke le slug ici pour pouvoir resoudre cover_image
-- + title cote front au refresh sans repasser par Mistral.
-- =============================================================

alter table public.daily_metrics
  add column if not exists karine_tip_recipe_slug text;

comment on column public.daily_metrics.karine_tip_recipe_slug is
  'Slug de la recette citee dans karine_tip (si applicable). Permet d afficher la vignette au refresh sans re-appeler Mistral.';
