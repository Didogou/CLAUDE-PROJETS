-- =============================================================
-- Préparation (étapes) + Ustensiles (catalogue) sur les fiches.
-- =============================================================
-- Jusqu'ici l'extraction Vision des fiches (recipe_sheets &
-- menu_meal_sheets) ne sortait que les ingrédients. On ajoute :
--   - preparation_steps : étapes ordonnées (haut → bas de la fiche)
--   - utensils          : slugs d'ustensiles référençant un CATALOGUE
--
-- Les ustensiles sont une entité cataloguée (table `utensils`) pour
-- pouvoir leur associer une image plus tard. Le catalogue est
-- AUTO-ALIMENTÉ : à chaque extraction, l'ustensile (déduit du verbe
-- de cuisson : "enfourner" → four) est normalisé en slug puis upserté
-- ici. Karine peut ensuite ajouter l'image / fusionner / renommer.
-- =============================================================

-- 1. Catalogue des ustensiles -------------------------------------------------
create table if not exists public.utensils (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  label       text not null,
  image_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger utensils_set_updated_at
  before update on public.utensils
  for each row execute function public.set_updated_at();

alter table public.utensils enable row level security;

-- Lecture : donnée de référence non sensible (affichée avec les fiches
-- côté abonnée plus tard) → lisible par tout le monde.
drop policy if exists utensils_select_all on public.utensils;
create policy utensils_select_all on public.utensils
  for select using (true);

-- Écriture : admin uniquement.
drop policy if exists utensils_admin_all on public.utensils;
create policy utensils_admin_all on public.utensils
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

comment on table public.utensils is
  'Catalogue normalisé des ustensiles de cuisine (slug unique + image). Auto-alimenté par l''extraction Vision, curé par l''admin.';

-- 2. Nouvelles colonnes sur les deux tables de fiches -------------------------
alter table public.recipe_sheets
  add column if not exists preparation_steps text[] not null default array[]::text[],
  add column if not exists utensils text[] not null default array[]::text[];

alter table public.menu_meal_sheets
  add column if not exists preparation_steps text[] not null default array[]::text[],
  add column if not exists utensils text[] not null default array[]::text[];

comment on column public.recipe_sheets.preparation_steps is
  'Étapes de préparation ordonnées (haut → bas de la fiche), extraites par Vision.';
comment on column public.recipe_sheets.utensils is
  'Slugs d''ustensiles (références public.utensils.slug).';
comment on column public.menu_meal_sheets.preparation_steps is
  'Étapes de préparation ordonnées (haut → bas de la fiche), extraites par Vision.';
comment on column public.menu_meal_sheets.utensils is
  'Slugs d''ustensiles (références public.utensils.slug).';
