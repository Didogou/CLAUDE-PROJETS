-- =============================================================
-- Fiches de menu (menu_meal_sheets) : favoris + likes
--
-- 1. Ajoute le type 'meal_sheet' à la check constraint de favorites
-- 2. Ajoute la colonne likes_count à menu_meal_sheets (V1 anonyme,
--    compteur publique non-personnel)
-- =============================================================

-- ----- 1. Favoris meal_sheet -----------------------------------
alter table public.favorites
  drop constraint if exists favorites_target_type_check;

alter table public.favorites
  add constraint favorites_target_type_check
  check (
    target_type in (
      'recipe',
      'menu',
      'tip',
      'advice',
      'featured',
      'meal_sheet'
    )
  );

-- ----- 2. Likes sur menu_meal_sheets ---------------------------
alter table public.menu_meal_sheets
  add column if not exists likes_count integer not null default 0;

create index if not exists menu_meal_sheets_likes_count_idx
  on public.menu_meal_sheets(likes_count desc);

comment on column public.menu_meal_sheets.likes_count is
  'Compteur de likes anonymes V1. Incrémenté par POST /api/meals/[id]/like.';
