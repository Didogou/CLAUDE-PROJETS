-- =============================================================
-- Retire le ON DELETE CASCADE sur ciqual_aliases.ciqual_id.
--
-- Pourquoi : le mode "replaceAll" de /api/admin/ciqual/import
-- supprimait toute la table ciqual_foods, ce qui purgeait en
-- cascade TOUS les aliases (résolutions manuelles validées par
-- Karine + générations Mistral). Perte de travail à chaque ré-
-- import du fichier ANSES.
--
-- Après cette migration, la contrainte devient NO ACTION (default
-- Postgres ≈ RESTRICT). Une tentative de DELETE sur un ciqual_foods
-- encore référencé par un alias ÉCHOUE avec une erreur FK explicite,
-- au lieu de wiper silencieusement les aliases.
--
-- Conséquence pour l'import : tant qu'il existe des aliases, le
-- DELETE all dans /api/admin/ciqual/import (mode replaceAll) sera
-- bloqué par Postgres. C'est volontaire — sécurité contre la perte
-- de données. L'import mode UPSERT pur (sans replaceAll) continue
-- de fonctionner normalement.
-- =============================================================

alter table public.ciqual_aliases
  drop constraint if exists ciqual_aliases_ciqual_id_fkey;

alter table public.ciqual_aliases
  add constraint ciqual_aliases_ciqual_id_fkey
  foreign key (ciqual_id) references public.ciqual_foods(id);
  -- Pas de ON DELETE → NO ACTION (default). DELETE ciqual_foods
  -- échoue tant qu'un alias y fait référence.
