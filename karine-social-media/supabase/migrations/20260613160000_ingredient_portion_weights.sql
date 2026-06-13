-- =============================================================
-- Cache des POIDS DE PORTION par libellé d'ingrédient.
--
-- Le poids d'« 1 gousse d'ail » (5 g), « 1 tranche de jambon » (40 g),
-- « 1 grosse tomate » (180 g)… dépend de la FORMULATION (mot d'unité +
-- adjectif), pas seulement de l'aliment Ciqual. On résout ce poids via
-- Mistral à partir du label tel qu'écrit, et on le met en cache ici.
--
-- Clé = label normalisé (accents/ligatures retirés, tokens singularisés)
-- → réutilisé par toutes les recettes qui emploient la même formulation.
-- grams NULL = « pas de sens en pièce » (liquide, poudre, fromage râpé…)
-- → on ne re-questionne pas Mistral, et le calcul l'ignore.
-- =============================================================
create table if not exists public.ingredient_portion_weights (
  label_key     text primary key,
  grams         numeric,
  example_label text,
  source        text not null default 'mistral',
  updated_at    timestamptz not null default now()
);

comment on table public.ingredient_portion_weights is
  'Poids d''une portion par libellé normalisé (« 1 gousse d''ail » → 5g). Alimenté par Mistral. grams NULL = non-comptable en pièce.';

-- Référence interne : lu/écrit uniquement par le service role (calcul
-- Nutri-Score server-side). On active RLS sans policy publique → seul le
-- service role (qui bypass RLS) y accède.
alter table public.ingredient_portion_weights enable row level security;
