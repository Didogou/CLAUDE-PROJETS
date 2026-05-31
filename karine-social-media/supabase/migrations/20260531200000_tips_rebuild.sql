-- Le schema cache PostgREST refuse de reload malgré NOTIFY + COMMENT.
-- Drop+recreate de la table (vide) avec son schéma cible final.
-- Le CREATE TABLE est un DDL "fort" qui force toujours le reload.

drop table if exists public.tips cascade;

create table public.tips (
  id              bigserial primary key,
  slug            text not null unique,
  label           text not null,
  slides          text[] not null default array[]::text[],
  tags            text[] not null default array[]::text[],
  likes_count     integer not null default 0,
  status          text not null default 'draft' check (status in ('draft', 'published')),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null
);

create index tips_status_published_idx on public.tips(status, published_at desc);

create trigger tips_set_updated_at
  before update on public.tips
  for each row execute function public.set_updated_at();

alter table public.tips enable row level security;

create policy "tips_select_admin_or_subscriber" on public.tips
  for select using (
    public.is_admin(auth.uid())
    or (public.has_active_subscription(auth.uid()) and status = 'published')
  );

create policy "tips_admin_all" on public.tips
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
