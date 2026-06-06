-- ============================================================
-- Menus de la semaine : flag "Tout le monde" (is_public)
-- ============================================================
-- Même logique que recipes.is_public : permet à Karine de marquer
-- certains menus comme accessibles aux visiteuses non abonnées
-- (mode "découverte"). Par défaut, un menu reste réservé aux
-- abonnées/patientes.
--
-- Côté UX :
--   - Admin liste : un toggle icône Globe/Cadenas dans la liste.
--     Aucun toggle dans la page d'édition/création (granularité
--     uniquement par la liste, plus simple à gérer).
--   - Front /menus : tous les menus visibles. Badge "★ Aperçu
--     gratuit" sur les is_public ; cadenas sur les autres + clic
--     redirige vers /mon-plan.
--   - Front /menus/[id]/jour : si is_public OU abonnée → page
--     complète. Sinon → redirect /mon-plan.

alter table public.weekly_menus
  add column if not exists is_public boolean not null default false;

create index if not exists weekly_menus_is_public_idx
  on public.weekly_menus (is_public)
  where is_public = true;

comment on column public.weekly_menus.is_public is
  'true = menu accessible aux visiteuses non abonnées (mode découverte). false = réservé aux abonnées et patientes.';
