-- Ajout de 5 nouvelles catégories de recettes :
-- - salade, sauce, aperitif, repas_fete, boisson
alter table public.recipes drop constraint if exists recipes_category_check;
alter table public.recipes
  add constraint recipes_category_check
  check (category in (
    'petit_dejeuner', 'entree', 'salade', 'plat', 'sauce',
    'gouter', 'dessert', 'boisson', 'aperitif', 'repas_fete'
  ));
