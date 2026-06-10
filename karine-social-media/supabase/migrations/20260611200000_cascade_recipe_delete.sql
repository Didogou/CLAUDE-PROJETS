-- =============================================================
-- Cascade automatique à la suppression d'une recette.
--
-- Avant : supprimer une recette laissait des orphelins dans :
--   - public.favorites (target_type='recipe', target_id=slug)
--   - public.shopping_lists.linked_recipes (JSONB array de {sheetId, recipeSlug, ...})
--
-- Après : un trigger AFTER DELETE ON public.recipes :
--   1. Supprime les favoris pointant vers la recette (par slug)
--   2. Filtre le JSONB linked_recipes de toutes les shopping_lists
--      pour retirer les entrées dont le recipeSlug correspond
--      (les fiches sheet_id sont déjà CASCADE via recipe_sheets)
--
-- Note : les commentaires (recipe_slug FK CASCADE) et recipe_sheets
-- (recipe_id FK CASCADE) sont déjà gérés par les FK existantes.
-- =============================================================

create or replace function public.cascade_purge_recipe_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. Purge favorites (target_type='recipe' + target_id = slug)
  delete from public.favorites
  where target_type = 'recipe'
    and target_id = old.slug;

  -- 2. Filtre shopping_lists.linked_recipes pour retirer les entries
  --    dont recipeSlug = old.slug. On utilise jsonb_path_query_array
  --    pour filtrer en place.
  update public.shopping_lists
  set linked_recipes = coalesce(
    (
      select jsonb_agg(elem)
      from jsonb_array_elements(linked_recipes) elem
      where elem->>'recipeSlug' is distinct from old.slug
    ),
    '[]'::jsonb
  )
  where linked_recipes @> jsonb_build_array(
    jsonb_build_object('recipeSlug', old.slug)
  );

  return old;
end;
$$;

comment on function public.cascade_purge_recipe_refs() is
  'Trigger function: à la suppression d''une recette, purge favorites et linked_recipes JSONB des shopping_lists. Le service_role bypasse les RLS.';

drop trigger if exists trg_cascade_purge_recipe_refs on public.recipes;
create trigger trg_cascade_purge_recipe_refs
  after delete on public.recipes
  for each row
  execute function public.cascade_purge_recipe_refs();

comment on trigger trg_cascade_purge_recipe_refs on public.recipes is
  'Purge automatique des références recettes dans favorites + shopping_lists à chaque DELETE.';
