-- =============================================================
-- Base alimentaire Ciqual (ANSES) — référence française.
--
-- Source : table de composition nutritionnelle des aliments
-- (ciqual.anses.fr). Données publiques téléchargeables en XLSX.
-- Karine upload le fichier en admin, on importe ~3000 aliments
-- dans cette table.
--
-- Utilisée pour :
--  - Compteur de calories côté abonné (saisie naturelle "j'ai
--    mangé un yaourt nature" → lookup → calories).
--  - Recherche fuzzy par nom (full-text français + trigram).
-- =============================================================

create extension if not exists pg_trgm;

create table if not exists public.ciqual_foods (
  id              bigserial primary key,
  alim_code       int unique not null,
  name            text not null,
  group_name      text,
  subgroup_name   text,
  -- Valeurs par 100g d'aliment
  kcal_per_100g   numeric,
  proteins_g      numeric,
  lipids_g        numeric,
  carbs_g         numeric,
  fibers_g        numeric,
  sugars_g        numeric,
  water_g         numeric,
  salt_g          numeric,
  sodium_mg       numeric,
  calcium_mg      numeric,
  iron_mg         numeric,
  imported_at     timestamptz not null default now()
);

-- Index full-text français (pondéré sur le nom)
create index if not exists ciqual_foods_name_fts_idx
  on public.ciqual_foods
  using gin(to_tsvector('french', name));

-- Index trigram pour fuzzy matching (similarité)
create index if not exists ciqual_foods_name_trgm_idx
  on public.ciqual_foods
  using gin(name gin_trgm_ops);

create index if not exists ciqual_foods_group_idx
  on public.ciqual_foods(group_name);

-- RLS : lecture publique (référence ouverte). Écriture admin only.
alter table public.ciqual_foods enable row level security;

create policy "ciqual_foods_select_all" on public.ciqual_foods
  for select using (true);

create policy "ciqual_foods_admin_write" on public.ciqual_foods
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

comment on table public.ciqual_foods is
  'Table Ciqual ANSES : composition nutritionnelle des aliments français. Importée par admin via XLSX.';
