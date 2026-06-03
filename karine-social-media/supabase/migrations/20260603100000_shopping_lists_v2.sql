-- =============================================================
-- Liste de courses V2 : utilisateur-scopée, persistée, agrégée
--
-- Refonte : la "liste de courses" devient une feature à part entière
-- côté user, distincte de la liste statique attachée à un menu.
--
-- Nouveautés :
--   - profiles.household_size : nb de pers du foyer (default 4)
--   - recipes.servings : nb de pers pour lequel les quantités sont
--     écrites (default 4)
--   - recipes.ingredients : liste structurée [{ category, label,
--     quantity, unit, note }] extraite à l upload par Claude.
--   - shopping_lists : 1 ligne par liste (active OU archivée),
--     scoped user_id. Une seule "active" par user (index unique
--     partiel).
--
-- Modèle items shopping_lists :
--   [
--     { key, category, label, unit, note,
--       checked: bool,
--       totalQuantity: number | null,   -- null si sans qté
--       contributions: [
--         { source: { type: 'recipe'|'menu'|'manual', ...metadata },
--           quantity: number | null }
--       ]
--     }
--   ]
-- Modèle linked_recipes :
--   [{ recipeId, recipeTitle, recipeCoverUrl, addedAt }]
-- =============================================================

-- 1. profiles.household_size
alter table public.profiles
  add column if not exists household_size int not null default 4
  check (household_size > 0 and household_size <= 20);

comment on column public.profiles.household_size is
  'Nombre de personnes du foyer (sert à dimensionner la liste de courses)';

-- 2. recipes.servings + recipes.ingredients
alter table public.recipes
  add column if not exists servings int not null default 4
  check (servings > 0 and servings <= 20);

alter table public.recipes
  add column if not exists ingredients jsonb not null default '[]'::jsonb;

alter table public.recipes
  add column if not exists ingredients_text text;

comment on column public.recipes.servings is
  'Nombre de personnes pour lequel les quantités sont écrites';
comment on column public.recipes.ingredients is
  'Liste structurée [{ category, label, quantity, unit, note }] extraite à l upload';
comment on column public.recipes.ingredients_text is
  'Texte brut saisi par Karine, source de vérité pour la ré-édition (re-extrait au save)';

-- 3. Table shopping_lists
create table if not exists public.shopping_lists (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  status          text not null default 'active'
                  check (status in ('active', 'archived')),
  linked_menu_id  uuid references public.weekly_menus(id) on delete set null,
  linked_recipes  jsonb not null default '[]'::jsonb,
  items           jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  updated_at      timestamptz not null default now()
);

-- Une seule liste active par user (sinon on aurait du désambiguïsé)
create unique index if not exists shopping_lists_user_active_unique
  on public.shopping_lists(user_id)
  where status = 'active';

create index if not exists shopping_lists_user_status_idx
  on public.shopping_lists(user_id, status, created_at desc);

create trigger shopping_lists_set_updated_at
  before update on public.shopping_lists
  for each row execute function public.set_updated_at();

-- RLS : user voit + modifie seulement ses propres listes
alter table public.shopping_lists enable row level security;

create policy "shopping_lists_select_own" on public.shopping_lists
  for select using (auth.uid() = user_id);

create policy "shopping_lists_insert_own" on public.shopping_lists
  for insert with check (auth.uid() = user_id);

create policy "shopping_lists_update_own" on public.shopping_lists
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "shopping_lists_delete_own" on public.shopping_lists
  for delete using (auth.uid() = user_id);
