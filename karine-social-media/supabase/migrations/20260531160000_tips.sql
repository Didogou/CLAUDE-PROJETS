-- ============================================================
-- Astuces : fiche photo unique (label + tags), rendu polaroid
-- Pas de check sur catégorie, pas de slides multiples.
-- Image stockée dans le bucket 'content-images', sous tips/{slug}/.
-- ============================================================

create table if not exists public.tips (
  id              bigserial primary key,
  slug            text not null unique,
  label           text not null,
  image_url       text,
  tags            text[] not null default array[]::text[],
  likes_count     integer not null default 0,
  status          text not null default 'draft' check (status in ('draft', 'published')),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null
);

create index if not exists tips_status_published_idx on public.tips(status, published_at desc);

drop trigger if exists tips_set_updated_at on public.tips;
create trigger tips_set_updated_at
  before update on public.tips
  for each row execute function public.set_updated_at();

-- RLS : admin = tout ; abonné actif = published only
alter table public.tips enable row level security;

drop policy if exists "tips_select_admin_or_subscriber" on public.tips;
create policy "tips_select_admin_or_subscriber" on public.tips
  for select using (
    public.is_admin(auth.uid())
    or (public.has_active_subscription(auth.uid()) and status = 'published')
  );

drop policy if exists "tips_admin_all" on public.tips;
create policy "tips_admin_all" on public.tips
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
