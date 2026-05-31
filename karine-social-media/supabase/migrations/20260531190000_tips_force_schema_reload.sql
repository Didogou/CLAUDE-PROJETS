-- Le push précédent (20260531180000_reload_postgrest_schema) n'a pas
-- effectivement réveillé PostgREST (NOTIFY dans une tx n'est pas reçu à temps).
-- Un COMMENT ON TABLE est une DDL change qui déclenche l'event trigger Supabase
-- `pgrst_ddl_watch`, ce qui force le reload immédiat du schema cache.

comment on table public.tips is 'Astuces (tips) — fiches photo multi-slides avec label et tags';
