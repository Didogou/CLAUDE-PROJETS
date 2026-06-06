-- ============================================================
-- Conseils santé : flag "Tout le monde" sur la BONNE table.
-- ============================================================
-- La migration 20260606200000 avait ajouté is_public à la table legacy
-- `advice` par erreur — alors que la feature Conseils santé utilise
-- `health_advice` (cf. lib/advice.ts, routes /api/admin/advice). Résultat :
-- health_advice n'avait pas la colonne is_public et la route is-public
-- ciblait `advice` (table sans colonne slug) → "column advice.slug does not exist".
-- On ajoute ici la colonne sur la bonne table.

alter table public.health_advice
  add column if not exists is_public boolean not null default false;
create index if not exists health_advice_is_public_idx
  on public.health_advice (is_public)
  where is_public = true;
comment on column public.health_advice.is_public is
  'true = conseil santé accessible aux visiteuses non abonnées (mode découverte). false = réservé aux abonnées / patientes.';
