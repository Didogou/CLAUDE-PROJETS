-- =============================================================
-- Regles d estimation des portions pour le parsing nutritionnel.
--
-- 3 tables maintenues par Karine via /admin/portions :
--  1) portion_foods : portion standard de chaque aliment (g) +
--     size_variability ('low'/'medium'/'high') qui dicte si l UI
--     propose des chips P/M/G a l abonnee quand aucun adjectif
--     n est dans la phrase.
--  2) portion_modifiers : multiplicateurs des adjectifs Mistral
--     ("petit"=0.7, "grand"=1.4, etc.)
--  3) portion_followups : questions de relance (sauce, sucre…)
--     declenchees par certains mots-cles.
-- =============================================================

create table if not exists public.portion_foods (
  id bigserial primary key,
  name text unique not null,
  portion_g int not null check (portion_g > 0 and portion_g <= 10000),
  size_variability text not null default 'medium'
    check (size_variability in ('low', 'medium', 'high')),
  notes text,
  updated_at timestamptz not null default now()
);

create index if not exists portion_foods_name_trgm_idx
  on public.portion_foods using gin (lower(name) gin_trgm_ops);

create table if not exists public.portion_modifiers (
  id bigserial primary key,
  keyword text unique not null,
  multiplier numeric(4,2) not null check (multiplier > 0 and multiplier <= 10),
  updated_at timestamptz not null default now()
);

create table if not exists public.portion_followups (
  id bigserial primary key,
  trigger_keyword text not null,
  question text not null,
  suggested_food text not null,
  default_g int not null check (default_g > 0 and default_g <= 1000),
  exclude_keywords text[] not null default array[]::text[],
  updated_at timestamptz not null default now()
);

create index if not exists portion_followups_trigger_idx
  on public.portion_followups (lower(trigger_keyword));

-- RLS : lecture publique, ecriture admin only
alter table public.portion_foods enable row level security;
alter table public.portion_modifiers enable row level security;
alter table public.portion_followups enable row level security;

create policy "portion_foods_read_all" on public.portion_foods
  for select using (true);
create policy "portion_foods_admin_write" on public.portion_foods
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "portion_modifiers_read_all" on public.portion_modifiers
  for select using (true);
create policy "portion_modifiers_admin_write" on public.portion_modifiers
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "portion_followups_read_all" on public.portion_followups
  for select using (true);
create policy "portion_followups_admin_write" on public.portion_followups
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- =============================================================
-- SEED : valeurs FR standards
-- size_variability :
--   low    = portion unique (yaourt, oeuf, fruit unique...)
--   medium = peut etre demandee si pas d adjectif
--   high   = systematiquement demande P/M/G si pas d adjectif
-- =============================================================

insert into public.portion_foods (name, portion_g, size_variability, notes) values
  -- Fruits (low : 1 unite = 1 unite)
  ('pomme', 150, 'low', '1 fruit moyen'),
  ('orange', 150, 'low', '1 fruit'),
  ('banane', 120, 'low', '1 fruit pele'),
  ('poire', 150, 'low', '1 fruit'),
  ('clementine', 80, 'low', '1 unite'),
  ('mandarine', 80, 'low', '1 unite'),
  ('fraise', 12, 'low', '1 unite'),
  ('raisin', 5, 'low', '1 grain'),
  ('kiwi', 80, 'low', '1 fruit'),
  ('peche', 130, 'low', '1 fruit'),
  ('abricot', 40, 'low', '1 unite'),
  ('prune', 30, 'low', '1 unite'),
  -- Laitages (low)
  ('yaourt', 125, 'low', '1 pot standard'),
  ('yogourt', 150, 'low', '1 pot'),
  ('fromage blanc', 100, 'medium', '1 portion'),
  ('petit suisse', 60, 'low', '1 pot'),
  ('skyr', 150, 'low', '1 pot'),
  -- Boissons (medium : verre/grand verre)
  ('lait', 200, 'medium', '1 verre standard'),
  ('jus', 200, 'medium', '1 verre'),
  ('jus de fruit', 200, 'medium', '1 verre'),
  ('vin', 125, 'medium', '1 verre'),
  ('biere', 250, 'medium', '1 chope'),
  ('cafe', 100, 'medium', '1 tasse'),
  ('the', 200, 'medium', '1 tasse'),
  ('chocolat chaud', 250, 'medium', '1 mug'),
  ('eau', 200, 'low', '1 verre'),
  ('smoothie', 250, 'medium', '1 verre'),
  -- Cereales (medium)
  ('cereales', 40, 'medium', '1 bol cereales sechees'),
  ('muesli', 50, 'medium', '1 bol'),
  ('flocons avoine', 40, 'medium', '1 bol secs'),
  ('porridge', 200, 'medium', '1 bol prepare'),
  -- Feculents (high : varient enormement entre assiette enfant et adulte)
  ('riz', 200, 'high', '1 portion cuit'),
  ('pates', 250, 'high', '1 portion cuites'),
  ('boulgour', 200, 'high', '1 portion cuit'),
  ('quinoa', 200, 'high', '1 portion cuit'),
  ('semoule', 180, 'high', '1 portion cuite'),
  ('pommes de terre', 200, 'high', '1 portion'),
  ('frites', 250, 'high', '1 assiette'),
  ('puree', 200, 'high', '1 portion'),
  -- Pains (medium pour pain seul, low pour tranches)
  ('pain', 60, 'medium', '2 tranches'),
  ('tranche de pain', 30, 'low', '1 tranche'),
  ('baguette', 250, 'high', '1 entiere'),
  ('demi-baguette', 125, 'low', '1 demi'),
  ('croissant', 60, 'low', '1 unite'),
  ('pain au chocolat', 70, 'low', '1 unite'),
  ('biscotte', 10, 'low', '1 unite'),
  -- Plats (high : tres variable)
  ('sandwich', 200, 'medium', '1 unite'),
  ('wrap', 180, 'medium', '1 unite'),
  ('pizza', 130, 'medium', '1 part'),
  ('hamburger', 220, 'high', '1 unite'),
  ('lasagnes', 300, 'high', '1 portion'),
  ('quiche', 150, 'medium', '1 part'),
  ('soupe', 300, 'high', '1 bol'),
  ('salade', 150, 'high', '1 portion'),
  ('aligot', 250, 'high', '1 portion'),
  ('ratatouille', 200, 'high', '1 portion'),
  ('tartiflette', 300, 'high', '1 portion'),
  -- Viandes / poisson (medium)
  ('viande', 150, 'medium', '1 portion'),
  ('boeuf', 150, 'medium', '1 portion'),
  ('poulet', 130, 'medium', '1 blanc'),
  ('porc', 150, 'medium', '1 portion'),
  ('agneau', 150, 'medium', '1 portion'),
  ('jambon', 30, 'low', '1 tranche'),
  ('saucisse', 80, 'low', '1 unite'),
  ('poisson', 130, 'medium', '1 portion'),
  ('saumon', 150, 'medium', '1 portion'),
  ('thon', 100, 'low', '1 portion'),
  ('crevette', 8, 'low', '1 unite'),
  -- Legumes (medium)
  ('legumes cuits', 150, 'medium', '1 portion'),
  ('haricots verts', 150, 'medium', '1 portion'),
  ('carotte', 80, 'low', '1 unite'),
  ('tomate', 120, 'low', '1 fruit'),
  ('concombre', 200, 'medium', '1 unite'),
  ('avocat', 150, 'low', '1 unite'),
  -- Fromages (low)
  ('fromage', 30, 'medium', '1 portion'),
  ('camembert', 30, 'low', '1 portion'),
  ('comte', 30, 'low', '1 portion'),
  ('mozzarella', 50, 'low', '1 boule'),
  ('parmesan', 15, 'low', '1 cuillere'),
  -- Œufs
  ('oeuf', 50, 'low', '1 unite'),
  -- Sucres / matieres grasses (low)
  ('chocolat', 6, 'low', '1 carre'),
  ('tablette chocolat', 100, 'low', '1 tablette'),
  ('biscuit', 10, 'low', '1 unite'),
  ('gateau', 100, 'medium', '1 part'),
  ('glace', 100, 'medium', '1 boule'),
  ('huile', 15, 'low', '1 cuillere a soupe'),
  ('vinaigrette', 15, 'low', '1 cuillere a soupe'),
  ('beurre', 10, 'low', '1 noix'),
  ('miel', 15, 'low', '1 cuillere a soupe'),
  ('confiture', 15, 'low', '1 cuillere a cafe'),
  ('sucre', 5, 'low', '1 cuillere a cafe'),
  ('nutella', 15, 'low', '1 cuillere a soupe'),
  ('mayonnaise', 15, 'low', '1 cuillere a soupe'),
  ('ketchup', 15, 'low', '1 cuillere a soupe'),
  ('moutarde', 5, 'low', '1 cuillere a cafe')
on conflict (name) do nothing;

insert into public.portion_modifiers (keyword, multiplier) values
  -- Diminutifs
  ('petit', 0.7),
  ('petite', 0.7),
  ('leger', 0.7),
  ('legere', 0.7),
  ('mini', 0.5),
  ('minuscule', 0.5),
  -- Standard
  ('moyen', 1.0),
  ('moyenne', 1.0),
  ('normal', 1.0),
  ('normale', 1.0),
  -- Augmentatifs
  ('grand', 1.4),
  ('grande', 1.4),
  ('gros', 1.4),
  ('grosse', 1.4),
  ('bon', 1.4),
  ('bonne', 1.4),
  ('belle', 1.4),
  -- Tres augmentatifs
  ('enorme', 1.8),
  ('geant', 1.8),
  ('geante', 1.8),
  ('xl', 1.8),
  ('xxl', 2.0),
  ('immense', 2.0),
  -- Multiplicatifs explicites
  ('double', 2.0),
  ('triple', 3.0)
on conflict (keyword) do nothing;

insert into public.portion_followups (trigger_keyword, question, suggested_food, default_g, exclude_keywords) values
  ('salade', 'Tu as mis de la sauce dans ta salade ?', 'vinaigrette', 15, array['fruit', 'fruits', 'composee de fruits']),
  ('pates', 'Tu as ajoute du fromage rape ?', 'parmesan', 15, array[]::text[]),
  ('pizza', 'Avec une sauce supplementaire ?', 'mayonnaise', 15, array[]::text[]),
  ('pain', 'Avec quelque chose dessus ?', 'beurre', 10, array['sandwich', 'tartine']),
  ('tartine', 'Avec quoi sur la tartine ?', 'confiture', 15, array[]::text[]),
  ('cafe', 'Avec du sucre ?', 'sucre', 5, array['sans sucre']),
  ('the', 'Avec du sucre ?', 'sucre', 5, array['sans sucre']),
  ('sandwich', 'Avec de la sauce ?', 'mayonnaise', 15, array[]::text[]),
  ('hamburger', 'Avec de la sauce ?', 'ketchup', 15, array[]::text[]),
  ('frites', 'Avec une sauce a tremper ?', 'ketchup', 15, array[]::text[]),
  ('crepe', 'Avec quoi sur la crepe ?', 'nutella', 15, array[]::text[]),
  ('yaourt', 'Tu as ajoute du sucre ou du miel ?', 'sucre', 5, array['nature']),
  ('cereales', 'Tu as ajoute du sucre ?', 'sucre', 5, array['sans sucre'])
on conflict do nothing;

comment on table public.portion_foods is
  'Portion standard 1 unite par aliment + size_variability (low/medium/high). Editable Karine /admin/portions.';
comment on table public.portion_modifiers is
  'Multiplicateurs des adjectifs de taille pour Mistral. Editable Karine.';
comment on table public.portion_followups is
  'Questions de relance posees a l abonnee quand certains mots-cles apparaissent (sauce, sucre…). Editable Karine.';
