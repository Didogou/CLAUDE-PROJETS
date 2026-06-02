-- ============================================================
-- V1 espace utilisateur :
--   1. Favoris polymorphiques (recipes / menus / tips / advice)
--   2. Mute admin (suspension du droit de like/comment/post)
--   3. Photo de profil (avatar_url sur profiles)
-- ============================================================

-- ----- 1. Favoris -------------------------------------------

create table if not exists public.favorites (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  target_type  text not null check (target_type in ('recipe', 'menu', 'tip', 'advice')),
  target_id    text not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index if not exists favorites_user_idx
  on public.favorites (user_id, created_at desc);
create index if not exists favorites_user_type_idx
  on public.favorites (user_id, target_type, created_at desc);

alter table public.favorites enable row level security;

drop policy if exists favorites_select_self on public.favorites;
create policy favorites_select_self on public.favorites
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists favorites_insert_self on public.favorites;
create policy favorites_insert_self on public.favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists favorites_delete_self on public.favorites;
create policy favorites_delete_self on public.favorites
  for delete using (auth.uid() = user_id);

comment on table public.favorites is 'Favoris polymorphiques par utilisatrice. target_id = slug pour recipes/tips/advice, id pour menus.';

-- ----- 2. Mute (suspension droits sociaux) -----------------

create table if not exists public.user_mutes (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  muted_by     uuid references public.profiles(id) on delete set null,
  reason       text,
  until        timestamptz,  -- null = permanent
  created_at   timestamptz not null default now()
);

alter table public.user_mutes enable row level security;

-- Admin voit tout
drop policy if exists user_mutes_select_admin on public.user_mutes;
create policy user_mutes_select_admin on public.user_mutes
  for select using (public.is_admin(auth.uid()));

-- L'utilisatrice peut lire son propre mute (pour afficher un message
-- "Tu es actuellement modérée — contacte Karine")
drop policy if exists user_mutes_select_self on public.user_mutes;
create policy user_mutes_select_self on public.user_mutes
  for select using (auth.uid() = user_id);

drop policy if exists user_mutes_admin_all on public.user_mutes;
create policy user_mutes_admin_all on public.user_mutes
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Helper : l'utilisatrice est-elle actuellement mute ?
create or replace function public.is_user_muted(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_mutes
    where user_id = uid
      and (until is null or until > now())
  );
$$;

comment on table public.user_mutes is 'Suspension du droit de like / comment / post idée. Vérifiée par les API correspondantes.';

-- ----- 3. Photo de profil ----------------------------------

alter table public.profiles
  add column if not exists avatar_url text;

-- Storage bucket pour les avatars (public en lecture)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Public read avatars" on storage.objects;
create policy "Public read avatars" on storage.objects
  for select using (bucket_id = 'avatars');
