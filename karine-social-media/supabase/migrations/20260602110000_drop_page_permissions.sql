-- Refonte autorisations : page_permissions remplacée par capabilities.
-- L'ancienne table n'est plus lue par le code. On la drop pour ne pas
-- garder de schéma mort.

drop table if exists public.page_permissions cascade;
