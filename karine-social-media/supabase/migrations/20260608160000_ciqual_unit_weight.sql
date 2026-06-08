-- =============================================================
-- Ciqual ANSES ne fournit que des valeurs par 100 g d'aliment —
-- pas de poids unitaire. Pour calculer le Nutri-Score sur des
-- ingrédients saisis en unités (« 8 tomates cerises »), on doit
-- connaître le poids moyen d'une unité.
--
-- On enrichit donc ciqual_foods avec un poids unitaire alimenté
-- de manière hybride :
--   - source 'mistral' : généré par Mistral au premier ingrédient
--                        qui a besoin de ce Ciqual sans unit
--   - source 'karine'  : override manuel en admin (autorité finale)
--
-- Une fois le poids connu, toutes les recettes futures avec le
-- même Ciqual le réutilisent gratuitement (lookup BDD).
-- =============================================================

alter table public.ciqual_foods
  add column if not exists avg_unit_weight_g numeric
    check (avg_unit_weight_g is null or avg_unit_weight_g > 0),
  add column if not exists avg_unit_weight_source text
    check (avg_unit_weight_source is null
           or avg_unit_weight_source in ('mistral', 'karine')),
  add column if not exists avg_unit_weight_updated_at timestamptz;

comment on column public.ciqual_foods.avg_unit_weight_g is
  'Poids moyen en grammes d''UNE unité (1 tomate, 1 œuf, etc.). Null si non pertinent (liquides, condiments). Alimenté par Mistral puis validé/corrigé par Karine.';

comment on column public.ciqual_foods.avg_unit_weight_source is
  'Origine de la valeur : mistral (auto) ou karine (override manuel, autorité finale).';
