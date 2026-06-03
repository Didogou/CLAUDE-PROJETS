-- =============================================================
-- Fiches recettes des repas dans un menu hebdomadaire.
--
-- Chaque jour du menu a un déjeuner et un dîner. Karine upload une
-- image de fiche recette pour chaque repas → Vision Haiku 4.5 extrait
-- titre + ingrédients + temps + calories.
--
-- Les utilisateurs peuvent ensuite ajouter chaque repas (ou TOUS les
-- repas du menu) à leur liste de courses, et naviguer dans les fiches
-- comme pour les recettes.
--
-- Index unique (menu_id, day_index, meal_kind) garantit max 1 sheet
-- par slot et accélère les UPSERTs au moment des modifications admin.
-- =============================================================

create table if not exists public.menu_meal_sheets (
  id               uuid primary key default gen_random_uuid(),
  menu_id          uuid not null references public.weekly_menus(id) on delete cascade,
  day_index        int not null check (day_index >= 0 and day_index <= 6),
  meal_kind        text not null check (meal_kind in ('lunch', 'dinner')),
  title            text,
  cover_image_url  text not null,
  servings         int not null default 4 check (servings > 0 and servings <= 20),
  calories         int,
  prep_time_min    int,
  cook_time_min    int,
  tags             text[] not null default array[]::text[],
  aliments         text[] not null default array[]::text[],
  ingredients      jsonb not null default '[]'::jsonb,
  likes_count      int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Index unique : max 1 sheet par (menu, jour, repas)
create unique index if not exists menu_meal_sheets_unique_slot
  on public.menu_meal_sheets(menu_id, day_index, meal_kind);

-- Index de chargement complet d'un menu (page jour)
create index if not exists menu_meal_sheets_menu_idx
  on public.menu_meal_sheets(menu_id, day_index, meal_kind);

create trigger menu_meal_sheets_set_updated_at
  before update on public.menu_meal_sheets
  for each row execute function public.set_updated_at();

-- RLS : admin = tout. Abonné actif = lecture seule sur menus publiés.
alter table public.menu_meal_sheets enable row level security;

create policy "menu_meal_sheets_select_admin_or_subscriber" on public.menu_meal_sheets
  for select using (
    public.is_admin(auth.uid())
    or (
      public.has_active_subscription(auth.uid())
      and exists (
        select 1 from public.weekly_menus m
        where m.id = menu_meal_sheets.menu_id and m.status = 'published'
      )
    )
  );

create policy "menu_meal_sheets_admin_all" on public.menu_meal_sheets
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

comment on table public.menu_meal_sheets is
  'Fiches recettes par jour x repas d''un menu hebdomadaire. Extraites par Vision Haiku.';
