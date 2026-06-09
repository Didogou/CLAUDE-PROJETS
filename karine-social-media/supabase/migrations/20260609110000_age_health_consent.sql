-- =============================================================
-- Conformite RGPD : verification d'age + consentement Art. 9 sante
--
-- ART. 8 RGPD — majorite numerique : France a fixe a 15 ans pour
-- la collecte de donnees personnelles sans consentement parental.
-- L'app traite explicitement la perte de poids (sujet hautement
-- sensible TCA pour les mineures) → on bloque < 15 ans au signup
-- ET on conserve la date de naissance pour preuve "effort raisonnable".
--
-- ART. 9 RGPD — donnees sensibles sante : poids, taille, sexe,
-- objectif perte font partie de la categorie speciale Art. 9.
-- Necessitent un consentement EXPLICITE et DEDIE (distinct du
-- consentement CGU general). Tracable + retirable.
-- =============================================================

alter table public.profiles
  add column if not exists birth_date date
    check (
      birth_date is null
      or (birth_date <= current_date and birth_date >= '1900-01-01')
    ),
  add column if not exists age_verified_at timestamptz,
  add column if not exists consent_health_at timestamptz,
  add column if not exists consent_health_version int;

comment on column public.profiles.birth_date is
  'Date de naissance utilisatrice (Art. 8 RGPD majorite numerique 15 ans + besoins nutritionnels). Saisie obligatoire au signup. Modifiable via /profil.';

comment on column public.profiles.age_verified_at is
  'Timestamp de la verification d age >= 15 ans. Preuve d effort raisonnable en cas de plainte CNIL.';

comment on column public.profiles.consent_health_at is
  'Timestamp du consentement explicite Art. 9 RGPD pour le traitement des donnees de sante (poids/taille/objectif). NULL = pas encore consenti = aucune saisie autorisee. Retrait via /profil supprime les donnees.';

comment on column public.profiles.consent_health_version is
  'Version du texte de consentement signe (incrementer a chaque modification importante de la politique de confidentialite santé).';

-- Mise a jour du trigger guard pour autoriser le user a saisir SA date
-- de naissance et SES consentements (mais pas a falsifier age_verified_at
-- ou consent_health_at directement — ces 2 doivent venir des endpoints
-- serveur qui valident les regles).
create or replace function public.guard_profiles_self_update()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

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

  -- birth_date : modifiable par le user (sa propre date de naissance).
  --
  -- age_verified_at, consent_health_at, consent_health_version :
  -- doivent provenir d un endpoint serveur qui a VALIDE les conditions.
  -- On bloque la modification self-side pour empecher un user de
  -- forger un consent_health_at=now() sans avoir vu la modale.
  if new.age_verified_at is distinct from old.age_verified_at then
    raise exception 'profiles.age_verified_at cannot be self-modified — use /api/profile/age-verify';
  end if;
  if new.consent_health_at is distinct from old.consent_health_at then
    raise exception 'profiles.consent_health_at cannot be self-modified — use /api/profile/consent-health';
  end if;
  if new.consent_health_version is distinct from old.consent_health_version then
    raise exception 'profiles.consent_health_version cannot be self-modified';
  end if;

  return new;
end;
$$;
