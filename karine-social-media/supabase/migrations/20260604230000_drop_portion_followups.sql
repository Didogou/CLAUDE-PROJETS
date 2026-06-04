-- =============================================================
-- Drop portion_followups : remplace par des suggestions Mistral
-- dynamiques (max 3 accompagnements tries par kcal decroissant,
-- generes a chaque parse). Plus admin-controlled.
--
-- Decision Didier 2026-06-04 : Mistral connait deja les
-- associations classiques (pates -> parmesan, salade ->
-- vinaigrette, cafe -> sucre/lait...) et peut s adapter au plat
-- precis. Karine n a plus a maintenir une table.
-- =============================================================

drop table if exists public.portion_followups cascade;
