-- Ajoute deux catégories : petit_dejeuner et gouter.
-- La check constraint existante (entree/plat/dessert) doit être remplacée.
alter table public.recipes drop constraint if exists recipes_category_check;
alter table public.recipes
  add constraint recipes_category_check
  check (category in ('petit_dejeuner', 'entree', 'plat', 'gouter', 'dessert'));
