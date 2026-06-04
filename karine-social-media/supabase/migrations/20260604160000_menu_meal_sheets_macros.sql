-- =============================================================
-- Ajoute les macros (proteines, lipides, glucides) sur les fiches
-- repas des menus.
--
-- Vision Haiku 4.5 les extrait depuis l image fiche recette si
-- elles y sont mentionnees, sinon Karine peut les saisir
-- manuellement.
--
-- Permet aux anneaux macros du compteur calories cote abonnee de
-- prendre en compte les ajouts depuis les menus (et plus
-- seulement les aliments Ciqual).
-- =============================================================

alter table public.menu_meal_sheets
  add column if not exists proteins_g numeric(6,2)
    check (proteins_g >= 0 and proteins_g <= 1000);

alter table public.menu_meal_sheets
  add column if not exists lipids_g numeric(6,2)
    check (lipids_g >= 0 and lipids_g <= 1000);

alter table public.menu_meal_sheets
  add column if not exists carbs_g numeric(6,2)
    check (carbs_g >= 0 and carbs_g <= 2000);

comment on column public.menu_meal_sheets.proteins_g is
  'Proteines par portion (g). Extrait par Vision ou saisi admin.';
comment on column public.menu_meal_sheets.lipids_g is
  'Lipides par portion (g).';
comment on column public.menu_meal_sheets.carbs_g is
  'Glucides par portion (g).';
