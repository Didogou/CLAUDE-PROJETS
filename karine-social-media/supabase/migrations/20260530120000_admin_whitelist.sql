-- ============================================================
-- Whitelist d'emails admin + auto-promotion à la 1ère connexion
-- ============================================================

create table public.admin_emails (
  email      text primary key,
  added_by   uuid references public.profiles(id) on delete set null,
  added_at   timestamptz not null default now()
);

alter table public.admin_emails enable row level security;

-- Seul un admin existant peut lire / modifier la liste
create policy "admin_emails_select" on public.admin_emails
  for select using (public.is_admin(auth.uid()));

create policy "admin_emails_admin_write" on public.admin_emails
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Seed initial : Didier + Karine (à ajuster)
insert into public.admin_emails (email) values
  ('didier.chialva@gmail.com')
on conflict (email) do nothing;

-- Remplace le trigger d'insertion de profile : auto-attribue 'admin' si email whitelisté
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  resolved_role text;
begin
  if new.email is not null and exists (
    select 1 from public.admin_emails where lower(email) = lower(new.email)
  ) then
    resolved_role := 'admin';
  else
    resolved_role := 'visitor';
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, resolved_role);

  return new;
end;
$$;

-- Rétro-actif : si un profile visiteur existe déjà pour un email whitelisté, le passer en admin
update public.profiles
set role = 'admin'
where role <> 'admin'
  and lower(email) in (select lower(email) from public.admin_emails);
