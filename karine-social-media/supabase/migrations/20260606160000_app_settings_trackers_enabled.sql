-- =============================================================
-- Toggles globaux d activation des compteurs Calorie + Eau.
--
-- Si OFF (false), le FAB correspondant est masque pour TOUS les
-- abonnees. Les ADMINS gardent acces (pour tester / preparer la
-- mise en service). Decision Didier 2026-06-04.
-- =============================================================

alter table public.app_settings
  add column if not exists calorie_tracker_enabled boolean not null default true,
  add column if not exists water_tracker_enabled boolean not null default true;

comment on column public.app_settings.calorie_tracker_enabled is
  'Si false, masque le FAB Calorie (et sa sheet) pour les abonnees. Les admins voient toujours pour pouvoir tester. Decision Didier 2026-06-04.';
comment on column public.app_settings.water_tracker_enabled is
  'Si false, masque le FAB Eau (et sa sheet) pour les abonnees. Les admins voient toujours pour pouvoir tester. Decision Didier 2026-06-04.';
