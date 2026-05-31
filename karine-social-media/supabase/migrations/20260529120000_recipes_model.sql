-- ============================================================
-- Recettes : modèle "fiche" (cover + slides + métadonnées)
-- Remplace l'ancien modèle thématique (theme_title/variants).
-- ============================================================

drop table if exists public.recipes cascade;

create table public.recipes (
  id              bigserial primary key,
  slug            text not null unique,
  title           text not null,
  category        text not null check (category in ('entree', 'plat', 'dessert')),
  cover_image_url text,
  slides          text[] not null default array[]::text[],
  tags            text[] not null default array[]::text[],
  aliments        text[] not null default array[]::text[],
  calories        integer,
  status          text not null default 'draft' check (status in ('draft', 'scheduled', 'published')),
  scheduled_for   timestamptz,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null
);

create index recipes_status_published_idx on public.recipes(status, published_at desc);
create index recipes_category_idx on public.recipes(category);

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- RLS : admin = tout ; abonné actif = published only
alter table public.recipes enable row level security;

create policy "recipes_select_admin_or_subscriber" on public.recipes
  for select using (
    public.is_admin(auth.uid())
    or (public.has_active_subscription(auth.uid()) and status = 'published')
  );

create policy "recipes_admin_all" on public.recipes
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
