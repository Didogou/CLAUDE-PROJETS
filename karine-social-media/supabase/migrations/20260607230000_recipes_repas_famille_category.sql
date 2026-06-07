-- Ajout de la catégorie de recettes 'repas_famille' (recettes du
-- quotidien à partager en famille, plats généreux multi-portions).
-- Distincte de 'repas_fete' (occasions spéciales) et 'plat' (tous
-- types de plats principaux).
alter table public.recipes drop constraint if exists recipes_category_check;
alter table public.recipes
  add constraint recipes_category_check
  check (category in (
    'petit_dejeuner', 'entree', 'salade', 'plat', 'sauce',
    'gouter', 'dessert', 'boisson', 'aperitif', 'repas_fete',
    'sur_le_pouce', 'repas_famille'
  ));
