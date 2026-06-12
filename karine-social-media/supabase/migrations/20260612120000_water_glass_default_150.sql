-- Aligne le DEFAULT SQL sur le DEFAULT_GLASS_ML code (150 ml).
-- Sans cette migration, les nouvelles utilisatrices créaient leur ligne
-- user_water_settings avec glass_size_ml=250 → compteur eau faussé de +67 %.
--
-- Référence : audit agent C 2026-06-12 (priorité 1).
-- Décision : un "verre" français standard = 150 ml.

alter table public.user_water_settings
  alter column glass_size_ml set default 150;

-- Backfill : les lignes qui ont la valeur historique 250 ET qui n'ont
-- pas été modifiées (updated_at = created_at, signe d'une création
-- silencieuse via INSERT par défaut) sont mises à 150 pour cohérence.
-- On NE TOUCHE PAS aux utilisatrices qui ont explicitement choisi 250.
update public.user_water_settings
   set glass_size_ml = 150,
       updated_at    = now()
 where glass_size_ml = 250
   and updated_at = created_at;
