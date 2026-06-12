-- Index préfixe text_pattern_ops sur ciqual_aliases.alias pour accélérer
-- les LIKE 'xxx%' utilisés par /api/nutrition/suggest (saisie naturelle
-- compteur calorie). Sans cet index, chaque keystroke debouncé déclenche
-- un seq scan partiel → ressenti 100-300 ms entre la frappe et l'affichage
-- des suggestions.
--
-- text_pattern_ops permet à l'index B-tree de matcher les comparaisons
-- LIKE par préfixe (alias LIKE 'qNorm%'). Ne couvre PAS '%qNorm%' (pour
-- ça il faut un GIN trgm, qui existe déjà sur ce projet via
-- ciqual_aliases_alias_trgm_idx).
--
-- Filtré sur status in ('resolved','pending') pour exclure les
-- 'rejected' du chemin chaud (gain RAM + WAL).
--
-- Audit perf agent C #5 — 2026-06-12.

create index if not exists ciqual_aliases_alias_prefix_idx
  on public.ciqual_aliases (alias text_pattern_ops)
  where status in ('resolved', 'pending');
