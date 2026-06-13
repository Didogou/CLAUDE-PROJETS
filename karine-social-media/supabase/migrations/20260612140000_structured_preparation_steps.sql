-- =============================================================
-- Étapes de préparation STRUCTURÉES (option A).
-- =============================================================
-- preparation_steps passe de text[] (juste le texte) à jsonb :
--   [{ "text": "...", "ingredients": ["label", ...], "utensils": ["slug", ...] }]
--
-- La liste `ingredients` de la fiche reste INCHANGÉE (source de vérité
-- courses/macros/Nutri-Score). Les colonnes `utensils text[]` (union des
-- slugs) restent aussi inchangées. On n'ajoute qu'une liaison par étape.
--
-- Dépend de 20260612120000 (qui crée preparation_steps text[]).
--
-- ⚠️ Postgres interdit une sous-requête dans le USING d'un ALTER ... TYPE.
-- On procède donc en 2 temps :
--   1. ALTER TYPE jsonb via to_jsonb()  -> array de strings (scalaire, OK)
--   2. UPDATE pour transformer chaque string en objet { text, ingredients, utensils }

-- recipe_sheets ---------------------------------------------------------------
alter table public.recipe_sheets
  alter column preparation_steps drop default;

alter table public.recipe_sheets
  alter column preparation_steps type jsonb using to_jsonb(preparation_steps);

update public.recipe_sheets
  set preparation_steps = coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('text', e, 'ingredients', '[]'::jsonb, 'utensils', '[]'::jsonb)
      )
      from jsonb_array_elements_text(preparation_steps) as e
    ),
    '[]'::jsonb
  );

alter table public.recipe_sheets
  alter column preparation_steps set default '[]'::jsonb,
  alter column preparation_steps set not null;

-- menu_meal_sheets ------------------------------------------------------------
alter table public.menu_meal_sheets
  alter column preparation_steps drop default;

alter table public.menu_meal_sheets
  alter column preparation_steps type jsonb using to_jsonb(preparation_steps);

update public.menu_meal_sheets
  set preparation_steps = coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('text', e, 'ingredients', '[]'::jsonb, 'utensils', '[]'::jsonb)
      )
      from jsonb_array_elements_text(preparation_steps) as e
    ),
    '[]'::jsonb
  );

alter table public.menu_meal_sheets
  alter column preparation_steps set default '[]'::jsonb,
  alter column preparation_steps set not null;

comment on column public.recipe_sheets.preparation_steps is
  'Étapes structurées : [{ text, ingredients:[label], utensils:[slug] }].';
comment on column public.menu_meal_sheets.preparation_steps is
  'Étapes structurées : [{ text, ingredients:[label], utensils:[slug] }].';
