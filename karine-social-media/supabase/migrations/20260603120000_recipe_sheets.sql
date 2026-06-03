-- =============================================================
-- Recette = fiche principale + N fiches détaillées.
--
-- Une recette (table `recipes`) regroupe N "fiches détaillées"
-- (table `recipe_sheets`). Chaque fiche détaillée EST une recette
-- à part entière : son image, ses ingrédients, ses temps, ses
-- calories. La fiche principale affiche la première fiche
-- détaillée par défaut, l'user peut naviguer entre elles.
--
-- Si Karine n'upload pas de fiche détaillée, on en crée
-- automatiquement une à partir de la cover principale (Vision
-- extrait tout depuis l'image main).
--
-- Champs sur recipes encore utilisés : id, slug, title, category,
-- cover_image_url, status, scheduled_for, published_at, tags,
-- aliments, slides, prep_photos, is_seasonal, is_featured,
-- likes_count, created_by, timestamps.
--
-- Champs déprécies (gardés pour ne pas casser le code mais ne
-- seront plus mis à jour) : calories, prep_time_min,
-- cook_time_min, servings, ingredients, ingredients_text.
-- Ces valeurs vivent désormais sur la sheet 0.
-- =============================================================

create table if not exists public.recipe_sheets (
  id                uuid primary key default gen_random_uuid(),
  recipe_id         bigint not null references public.recipes(id) on delete cascade,
  sheet_index       int not null,
  title             text,
  cover_image_url   text not null,
  servings          int not null default 4 check (servings > 0 and servings <= 20),
  calories          int,
  prep_time_min     int,
  cook_time_min     int,
  tags              text[] not null default array[]::text[],
  aliments          text[] not null default array[]::text[],
  ingredients       jsonb not null default '[]'::jsonb,
  ingredients_text  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists recipe_sheets_recipe_index_unique
  on public.recipe_sheets(recipe_id, sheet_index);

create index if not exists recipe_sheets_recipe_idx
  on public.recipe_sheets(recipe_id, sheet_index);

create trigger recipe_sheets_set_updated_at
  before update on public.recipe_sheets
  for each row execute function public.set_updated_at();

-- RLS : même règles que recipes (admin tout / abonné published)
alter table public.recipe_sheets enable row level security;

create policy "recipe_sheets_select_admin_or_subscriber" on public.recipe_sheets
  for select using (
    public.is_admin(auth.uid())
    or (
      public.has_active_subscription(auth.uid())
      and exists (
        select 1 from public.recipes r
        where r.id = recipe_sheets.recipe_id and r.status = 'published'
      )
    )
  );

create policy "recipe_sheets_admin_all" on public.recipe_sheets
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

comment on table public.recipe_sheets is
  'Fiches détaillées d''une recette. 1 recipe = 1..N sheets.';
comment on column public.recipe_sheets.sheet_index is
  'Ordre d''affichage dans la pellicule (0 = par défaut).';
comment on column public.recipe_sheets.ingredients is
  'Liste structurée [{ category, label, quantity, unit, note }] extraite par Vision';
