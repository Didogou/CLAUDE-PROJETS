-- =============================================================
-- FIX CRITICAL SECURITY (audit 2026-06-08)
--
-- 2 vulnérabilités exploitables à distance via la clé anon publique :
--
--   #1 Escalade de privilège visitor → admin via update sur profiles
--      (policy profiles_update_own sans WITH CHECK ni restriction
--      colonnes).
--
--   #2 IBAN/BIC lisibles publiquement via legal_settings (policy
--      read_public for select using (true) sur toute la table).
--
-- Fix :
--   #1 Trigger BEFORE UPDATE qui bloque toute modification des
--      colonnes sensibles (id, email, role, patient_access_expires_at)
--      sauf si l'appelant est service_role. Les endpoints admin
--      passent par service_role (createServiceClient), donc inchangé.
--
--   #2 Column-level REVOKE + GRANT explicite sur les colonnes non
--      bancaires uniquement. Toute lecture incluant bank_iban /
--      bank_bic / bank_holder_name / bank_name par anon ou
--      authenticated échouera désormais avec "permission denied".
--      Le service_role bypass les GRANTS → admin continue de lire
--      via createServiceClient sans changement de code.
-- =============================================================


-- ============================================================
-- FIX #1 : Empêcher l'escalade de privilège via update profiles
-- ============================================================

create or replace function public.guard_profiles_self_update()
returns trigger
language plpgsql
as $$
begin
  -- Bypass total pour service_role : les endpoints admin
  -- côté serveur (createServiceClient) doivent pouvoir promouvoir
  -- un user en patient / changer son patient_access_expires_at /
  -- corriger son email après changement auth, etc.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Pour tout autre rôle (authenticated / anon) :
  -- les colonnes ci-dessous sont en lecture seule du côté client.
  -- Pour les modifier, passer impérativement par une route admin
  -- server-side qui utilise createServiceClient.

  if new.id is distinct from old.id then
    raise exception 'profiles.id is immutable';
  end if;

  if new.email is distinct from old.email then
    raise exception 'profiles.email cannot be modified directly (use Supabase Auth flow)';
  end if;

  if new.role is distinct from old.role then
    raise exception 'profiles.role cannot be self-modified — admin promotion via /api/admin/* only';
  end if;

  if new.patient_access_expires_at is distinct from old.patient_access_expires_at then
    raise exception 'profiles.patient_access_expires_at cannot be self-modified — admin only';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.guard_profiles_self_update();

comment on function public.guard_profiles_self_update() is
  'Empêche un user authentifié de modifier son rôle, son patient_access_expires_at ou son email via la clé anon publique (escalade visitor->admin). Les endpoints admin contournent ce trigger via service_role.';


-- ============================================================
-- FIX #2 : Bloquer la lecture publique des colonnes bancaires
-- ============================================================

-- On garde la policy RLS de lecture publique (la table est toujours
-- "lisible" en théorie), mais on retire les permissions colonnes
-- bancaires au niveau GRANT — strictement plus fin que RLS.

revoke select on public.legal_settings from anon, authenticated;

-- Grant SELECT explicite sur les colonnes non sensibles uniquement.
-- Toute requête `select bank_iban from legal_settings` par anon ou
-- authenticated échouera désormais avec :
--   ERROR:  permission denied for table legal_settings
-- (ou "permission denied for column" selon la version Postgres).
grant select (
  id,
  company_name,
  legal_form,
  capital_social,
  siege_social,
  rcs_city,
  rcs_number,
  siret,
  vat_number,
  director_name,
  director_function,
  contact_email,
  mediator_name,
  mediator_url,
  court_jurisdiction,
  updated_at,
  updated_by
) on public.legal_settings to anon, authenticated;

-- PAS de grant sur :
--   bank_holder_name, bank_iban, bank_bic, bank_name
-- → ces colonnes restent accessibles UNIQUEMENT via service_role
--   (bypass des grants), c'est-à-dire depuis les routes server-side
--   admin (createServiceClient).

comment on table public.legal_settings is
  'Singleton informations légales et coordonnées bancaires. Lecture publique restreinte par GRANT colonne (IBAN/BIC/bank_name réservés service_role). Édité via /admin/informations-legales (service_role server-side).';
