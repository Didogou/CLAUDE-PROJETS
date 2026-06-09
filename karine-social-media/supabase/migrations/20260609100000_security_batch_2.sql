-- =============================================================
-- Suite audit securite 2026-06-08 — batch 2 :
--
-- 1. RGPD page_views : purge auto > 13 mois + anonymisation
--    progressive du referrer (apres 30 jours).
-- 2. Stripe webhook : dedup par event.id pour empecher les replays
--    et les out-of-order qui surchargent les subscriptions.
-- =============================================================


-- ============================================================
-- 1. RGPD page_views — purge + anonymisation
-- ============================================================

-- Fonction de purge appelee par cron Vercel (1x/jour).
create or replace function public.purge_old_page_views()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Suppression des vues > 13 mois (recommandation CNIL pour
  -- analytics first-party non anonymise).
  delete from public.page_views
  where viewed_at < now() - interval '13 months';

  -- Anonymisation progressive du referrer apres 30 jours (le path
  -- complet peut reveler des recherches privees a partir des params
  -- type Google ?q=). On garde juste le host pour la stat.
  update public.page_views
  set referrer = (
    case
      when referrer is null then null
      when referrer = '' then null
      else regexp_replace(referrer, '^(https?://[^/]+).*', '\1')
    end
  )
  where viewed_at < now() - interval '30 days'
    and referrer is not null
    and referrer ~ '^https?://[^/]+/';
end;
$$;

comment on function public.purge_old_page_views() is
  'Purge automatique des vues > 13 mois + anonymisation du referrer apres 30 jours. Appelee par cron Vercel /api/cron/purge-page-views.';


-- ============================================================
-- 2. Stripe webhook dedup
-- ============================================================

create table if not exists public.stripe_webhook_events (
  -- event.id Stripe (ex: "evt_1234abcd...") — primary key garantit
  -- l'unicite. Tentative de replay → INSERT plante avec 23505 →
  -- on skip silencieusement le traitement.
  event_id     text primary key,
  event_type   text not null,
  -- event.created Stripe : permet de detecter les out-of-order
  -- (un webhook ancien arrivant apres un recent ne doit pas ecraser).
  stripe_created_at timestamptz not null,
  -- Quand on a recu et traite le webhook
  processed_at timestamptz not null default now()
);

create index if not exists stripe_webhook_events_type_idx
  on public.stripe_webhook_events(event_type, stripe_created_at desc);

alter table public.stripe_webhook_events enable row level security;

-- Lecture admin only (debug / audit)
create policy stripe_webhook_events_read_admin on public.stripe_webhook_events
  for select using (public.is_admin(auth.uid()));

-- INSERT/UPDATE/DELETE : service_role only (le webhook ecrit, personne
-- d'autre). Pas de policy → bloque par defaut RLS.

comment on table public.stripe_webhook_events is
  'Log des webhooks Stripe traites. Empeche les replays et out-of-order. Cle = event.id Stripe.';
