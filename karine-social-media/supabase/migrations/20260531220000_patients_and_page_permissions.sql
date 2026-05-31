-- ============================================================
-- Phase A — Comptes utilisateurs
-- 1. Rôle 'patient' (accès gratuit à durée déterminée, 6 semaines)
-- 2. Demandes d'accès patient (Karine valide manuellement)
-- 3. Permissions par page (CMS-style, paramétrable depuis /admin)
-- ============================================================

-- ----- 1. Rôle patient + date d'expiration -----------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'subscriber', 'patient', 'visitor'));

alter table public.profiles
  add column if not exists patient_access_expires_at timestamptz;

create index if not exists profiles_patient_expiry_idx
  on public.profiles(patient_access_expires_at)
  where role = 'patient';

-- Helper : accès patient encore valide ?
create or replace function public.has_active_patient_access(uid uuid)
returns boolean
language sql
stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role = 'patient'
      and patient_access_expires_at is not null
      and patient_access_expires_at > now()
  );
$$;

-- ----- 2. Demandes d'accès patient -------------------------

create table if not exists public.patient_requests (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  message      text not null default '',
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- une seule demande active par utilisateur
  unique (user_id, status)
);

create index if not exists patient_requests_status_idx
  on public.patient_requests(status, created_at desc);

alter table public.patient_requests enable row level security;

-- L'utilisateur voit ses propres demandes ; admin voit tout
drop policy if exists "patient_requests_select" on public.patient_requests;
create policy "patient_requests_select" on public.patient_requests
  for select using (
    auth.uid() = user_id or public.is_admin(auth.uid())
  );

-- L'utilisateur peut créer sa propre demande
drop policy if exists "patient_requests_insert_own" on public.patient_requests;
create policy "patient_requests_insert_own" on public.patient_requests
  for insert with check (auth.uid() = user_id);

-- Admin peut tout faire
drop policy if exists "patient_requests_admin_all" on public.patient_requests;
create policy "patient_requests_admin_all" on public.patient_requests
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ----- 3. Permissions par page ------------------------------
-- Une entrée = un chemin (ex. "/recettes", "/mon-plan").
-- allowed_roles = sous-ensemble de {visitor, patient, subscriber, admin}.
-- Si une page n'est PAS dans cette table → accès libre (defaut ouvert).
-- Si elle y est → seul un user avec un de ces rôles peut accéder.
--    (cas spécial : visitor = anonyme OR profil sans rôle privilégié)

create table if not exists public.page_permissions (
  path           text primary key,
  allowed_roles  text[] not null default array['visitor','patient','subscriber','admin']::text[],
  description    text,
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);

create index if not exists page_permissions_path_idx on public.page_permissions(path);

alter table public.page_permissions enable row level security;

-- Lecture publique (le middleware côté serveur doit pouvoir lire pour TOUS)
drop policy if exists "page_permissions_read_public" on public.page_permissions;
create policy "page_permissions_read_public" on public.page_permissions
  for select using (true);

-- Écriture admin uniquement
drop policy if exists "page_permissions_admin_write" on public.page_permissions;
create policy "page_permissions_admin_write" on public.page_permissions
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Trigger maj updated_at
drop trigger if exists page_permissions_set_updated_at on public.page_permissions;
create trigger page_permissions_set_updated_at
  before update on public.page_permissions
  for each row execute function public.set_updated_at();
