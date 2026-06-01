-- Table singleton de paramètres globaux app, éditable depuis /admin/parametres.
-- Une seule ligne (id = 1) garantit qu'on n'a qu'un seul jeu de paramètres.
-- Ajouter une colonne ici quand on veut un nouveau paramètre éditable.

create table if not exists public.app_settings (
  id                              integer primary key default 1
                                  check (id = 1),
  patient_relance_cooldown_days   integer not null default 3
                                  check (patient_relance_cooldown_days >= 0
                                         and patient_relance_cooldown_days <= 365),
  updated_by                      uuid references public.profiles(id) on delete set null,
  updated_at                      timestamptz not null default now()
);

-- Insère la ligne singleton avec valeurs par défaut si pas déjà créée
insert into public.app_settings (id) values (1) on conflict do nothing;

-- RLS : lecture publique (le front a besoin de connaître le cooldown pour
-- afficher le bouton désactivé sur /profil même côté client). Écriture admin only.
alter table public.app_settings enable row level security;

drop policy if exists "app_settings_read_public" on public.app_settings;
create policy "app_settings_read_public" on public.app_settings
  for select using (true);

drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write" on public.app_settings
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();
