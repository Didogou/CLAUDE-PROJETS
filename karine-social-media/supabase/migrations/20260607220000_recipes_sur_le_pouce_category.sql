-- Ajout de la catégorie de recettes 'sur_le_pouce' (recettes rapides
-- à emporter, sandwichs, wraps, finger food, déjeuners express).
-- Demandée par Karine pour distinguer ces recettes des 'gouter' et
-- 'aperitif' qui ont une connotation différente.
alter table public.recipes drop constraint if exists recipes_category_check;
alter table public.recipes
  add constraint recipes_category_check
  check (category in (
    'petit_dejeuner', 'entree', 'salade', 'plat', 'sauce',
    'gouter', 'dessert', 'boisson', 'aperitif', 'repas_fete',
    'sur_le_pouce'
  ));
