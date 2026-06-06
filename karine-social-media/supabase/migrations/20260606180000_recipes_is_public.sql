-- ============================================================
-- Recettes : flag "Tout le monde" (is_public)
-- ============================================================
-- Permet à Karine de marquer certaines recettes comme accessibles
-- aux visiteurs non abonnés (mode "découverte / aperçu gratuit").
-- La majorité reste en is_public = false (réservée aux abonnées).
--
-- Côté UX :
--   - Admin : un toggle "Tout le monde" dans la liste et la fiche
--     d'édition, change directement cette colonne.
--   - Front recettes (liste) : tout est visible. Les is_public sont
--     marquées d'un badge "★ Aperçu gratuit", les autres affichent
--     un cadenas et redirigent vers /mon-plan au clic.
--   - Front recettes (détail) : si is_public = true OU utilisatrice
--     abonnée → page complète. Sinon → redirect /mon-plan.

alter table public.recipes
  add column if not exists is_public boolean not null default false;

-- Index partiel pour accélérer le filtre "recettes accessibles aux
-- visiteurs" qui sera utilisé par le proxy auth + la liste publique.
create index if not exists recipes_is_public_idx
  on public.recipes (is_public)
  where is_public = true;

comment on column public.recipes.is_public is
  'true = visible et lisible par tout le monde (visiteur non abonné inclus). false = réservée aux abonnées / patientes.';
