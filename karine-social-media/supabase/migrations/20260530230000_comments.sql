-- Table des avis abonnés sur les recettes.
-- V1 anonyme : on accepte les avis sans auth (rate-limit possible plus tard).
-- L'admin pourra supprimer ou masquer un avis depuis /admin/avis.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  recipe_slug text not null references public.recipes(slug) on delete cascade,
  author_name text not null default 'Anonyme',
  body text not null check (length(body) between 1 and 1000),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);

create index if not exists comments_recipe_slug_idx
  on public.comments(recipe_slug, created_at desc)
  where status = 'visible';

create index if not exists comments_status_created_idx
  on public.comments(status, created_at desc);

alter table public.comments enable row level security;

-- Lecture publique : tout le monde voit les avis visibles
drop policy if exists "comments_read_visible" on public.comments;
create policy "comments_read_visible" on public.comments
  for select using (status = 'visible');

-- Insertion publique : tout le monde peut poster un avis (V1 anonyme)
drop policy if exists "comments_insert_public" on public.comments;
create policy "comments_insert_public" on public.comments
  for insert with check (true);

-- Suppression / modification : réservées au service_role (admin via API)
