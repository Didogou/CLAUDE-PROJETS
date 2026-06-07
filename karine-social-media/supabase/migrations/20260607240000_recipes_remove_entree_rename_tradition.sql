-- Refonte catégories de recettes (POC validé 2026-06-07) :
--
--   1. SUPPRESSION 'entree' : la catégorie ne sera plus proposée. Karine
--      a confirmé qu'aucune recette n'est actuellement dans cette
--      catégorie (vérifié avant migration). Si une recette y traîne,
--      elle sera migrée vers 'plat' par sécurité (fallback safe).
--
--   2. RENOMMAGE 'repas_famille' → 'tradition' : Karine préfère ce
--      label, plus évocateur du contenu (recettes traditionnelles
--      partagées en famille). Toutes les recettes existantes sont
--      migrées vers la nouvelle valeur.

-- Filet de sécurité : bascule toute recette qui serait encore en
-- 'entree' vers 'plat' avant de retirer la valeur du check.
update public.recipes set category = 'plat' where category = 'entree';

-- Renomme 'repas_famille' en 'tradition' sur toutes les recettes.
update public.recipes set category = 'tradition' where category = 'repas_famille';

-- Met à jour la check constraint : retire 'entree' et 'repas_famille',
-- ajoute 'tradition'. Les 11 catégories conservées sont celles de
-- /recettes-v2 (cf. RecettesOngletsView.tsx).
alter table public.recipes drop constraint if exists recipes_category_check;
alter table public.recipes
  add constraint recipes_category_check
  check (category in (
    'petit_dejeuner', 'salade', 'plat', 'sauce',
    'gouter', 'dessert', 'boisson', 'aperitif', 'repas_fete',
    'sur_le_pouce', 'tradition'
  ));
