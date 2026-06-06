-- ============================================================
-- Astuces (tips) + Conseils (advice) : flag "Tout le monde"
-- ============================================================
-- Même logique que recipes.is_public et weekly_menus.is_public :
-- permet à Karine de marquer certaines astuces / certains conseils
-- comme accessibles aux visiteuses non abonnées (mode "découverte").
-- Par défaut, tout reste réservé aux abonnées / patientes.
--
-- Côté UX (identique aux recettes) :
--   - Admin liste : toggle icône Globe/Cadenas dans la liste.
--     (Pas dans la page édition — granularité par la liste.)
--   - Front /astuces, /conseils : toutes visibles ; les is_public ont
--     un badge "Aperçu gratuit" ; les autres ont un voile + cadenas
--     + clic redirige vers /mon-plan.
--   - Front détail : gate côté server component (redirect si non
--     accessible).

alter table public.tips
  add column if not exists is_public boolean not null default false;
create index if not exists tips_is_public_idx
  on public.tips (is_public)
  where is_public = true;
comment on column public.tips.is_public is
  'true = astuce accessible aux visiteuses non abonnées (mode découverte). false = réservée aux abonnées / patientes.';

alter table public.advice
  add column if not exists is_public boolean not null default false;
create index if not exists advice_is_public_idx
  on public.advice (is_public)
  where is_public = true;
comment on column public.advice.is_public is
  'true = conseil accessible aux visiteuses non abonnées (mode découverte). false = réservé aux abonnées / patientes.';
