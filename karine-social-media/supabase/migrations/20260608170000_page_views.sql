-- =============================================================
-- Tracking maison des vues utilisateur. Pas de service externe : on
-- garde les données chez nous (RGPD-friendly + croisement possible
-- avec la base utilisateurs).
--
-- Granularité : 1 row par vue de page. user_id = null pour les
-- visiteurs non-connectés (on garde quand même pour les comptages
-- "trafic total"). target_type + target_id permettent d'agréger par
-- recette / menu / conseil etc. sans rejointure complexe.
--
-- Rétention : pas de purge auto. Si la table grossit trop (> 500k
-- rows), on ajoutera un cron de purge des vues > 6 mois.
-- =============================================================

create table if not exists public.page_views (
  id               bigserial primary key,
  user_id          uuid references auth.users(id) on delete set null,
  path             text not null,
  -- Type de la cible si applicable. Permet d'agréger "vues recettes"
  -- vs "vues menus" sans regex sur path. Utiliser le SLUG ou l'ID
  -- comme `target_id`. null pour les pages génériques (accueil, etc.).
  target_type      text check (target_type in ('recipe', 'menu', 'tip', 'advice', 'page')),
  target_id        text,
  -- Snapshot du rôle au moment de la vue, pour ratio abonné/anonyme
  -- en analytics sans avoir à joindre profiles (lent quand >100k rows).
  role_snapshot    text check (role_snapshot in ('admin', 'patient', 'subscriber', 'visitor', 'anonymous')),
  referrer         text,
  viewed_at        timestamptz not null default now()
);

create index if not exists page_views_target_idx
  on public.page_views(target_type, target_id);

create index if not exists page_views_viewed_at_idx
  on public.page_views(viewed_at desc);

create index if not exists page_views_user_idx
  on public.page_views(user_id, viewed_at desc)
  where user_id is not null;

alter table public.page_views enable row level security;

-- Lecture admin uniquement (rapport interne)
create policy "page_views_read_admin" on public.page_views
  for select using (public.is_admin(auth.uid()));

-- Écriture libre (utilisé par l'endpoint POST /api/track-view avec
-- service role côté serveur, donc cette policy n'est pas critique mais
-- on la met pour les tests directs via supabase client).
create policy "page_views_insert_any" on public.page_views
  for insert with check (true);

comment on table public.page_views is
  'Log des vues utilisateur (interne, RGPD-friendly). 1 row par vue. Anonymes trackés avec user_id=null.';
