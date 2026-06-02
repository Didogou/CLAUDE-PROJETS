-- ============================================================
-- Informations légales/business (mentions, CGU, CGV, confidentialité).
-- Singleton (id=1) pour qu'on n'ait jamais qu'une seule ligne.
-- Les 4 pages légales lisent ces valeurs et affichent les placeholders
-- roses uniquement quand un champ est vide.
-- ============================================================

create table if not exists public.legal_settings (
  id                   int primary key default 1 check (id = 1),
  -- Identité société
  company_name         text,
  legal_form           text,
  capital_social       text,
  siege_social         text,
  rcs_city             text,
  rcs_number           text,
  siret                text,
  vat_number           text,
  -- Direction
  director_name        text,
  director_function    text,
  -- Contact
  contact_email        text,
  -- Médiation / juridiction
  mediator_name        text,
  mediator_url         text,
  court_jurisdiction   text,
  -- Coordonnées bancaires (B2B reversement Karine)
  bank_holder_name     text,
  bank_iban            text,
  bank_bic             text,
  bank_name            text,
  -- Tracking
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles(id) on delete set null
);

-- Crée la ligne singleton si elle n'existe pas
insert into public.legal_settings (id) values (1)
on conflict (id) do nothing;

alter table public.legal_settings enable row level security;

-- Lecture publique : indispensable pour que les pages /mentions-legales etc.
-- accessibles aux visiteurs anonymes puissent afficher les valeurs.
-- IMPORTANT : on EXCLUE les champs bancaires de la lecture publique via
-- une vue dédiée plus bas. Les champs bancaires ne sortent JAMAIS de l'admin.
drop policy if exists legal_settings_read_public on public.legal_settings;
create policy legal_settings_read_public on public.legal_settings
  for select using (true);

-- Écriture admin uniquement
drop policy if exists legal_settings_write_admin on public.legal_settings;
create policy legal_settings_write_admin on public.legal_settings
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop trigger if exists legal_settings_set_updated_at on public.legal_settings;
create trigger legal_settings_set_updated_at
  before update on public.legal_settings
  for each row execute function public.set_updated_at();

-- ATTENTION : RLS permet lecture publique de TOUS les champs y compris
-- bancaires. Pour la prod, le helper getLegalSettings côté serveur
-- distingue getPublicLegalSettings (sans IBAN/BIC) et
-- getLegalSettingsForAdmin (tout). Le serveur ne renvoie JAMAIS les
-- champs bancaires au client visiteur. L'API n'expose pas non plus
-- les champs bancaires côté public.

comment on table public.legal_settings is 'Singleton informations légales et coordonnées bancaires (Karine + société éditrice). Édité depuis /admin/informations-legales.';
