-- Évolution du modèle "menu de la semaine" :
-- - Ajout d'une image dédiée pour la liste de courses (PNG global)
-- - Chaque jour a maintenant 2 repas : déjeuner + dîner
--   (le champ unique `dish_label` devient `lunch_label` + nouveau `dinner_label`)

-- 1) weekly_menus : image de liste de courses
alter table public.weekly_menus
  add column if not exists shopping_list_image_url text;

-- 2) weekly_menu_days : split déjeuner / dîner
-- Renomme les colonnes existantes pour préserver les données (s'il y en a)
alter table public.weekly_menu_days
  rename column dish_label to lunch_label;

alter table public.weekly_menu_days
  rename column recipe_slug to lunch_recipe_slug;

alter table public.weekly_menu_days
  add column if not exists lunch_image_url text,
  add column if not exists dinner_label text not null default '',
  add column if not exists dinner_recipe_slug text references public.recipes(slug) on delete set null,
  add column if not exists dinner_image_url text;
