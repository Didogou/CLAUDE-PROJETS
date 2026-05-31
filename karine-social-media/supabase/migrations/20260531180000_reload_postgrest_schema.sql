-- Force PostgREST à recharger son schema cache après les modifications de `tips`.
-- Un simple NOTIFY dans une transaction ne réveille pas PostgREST en pratique
-- (chez Supabase). Un changement DDL (ici un COMMENT) déclenche l'event trigger
-- Supabase `pgrst_ddl_watch` qui force le reload immédiat.

comment on table public.tips is 'Astuces (tips) — fiches photo multi-slides avec label et tags';

-- Belt & suspenders : on émet aussi le notify explicite.
select pg_notify('pgrst', 'reload schema');
