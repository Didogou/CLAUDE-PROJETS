-- =============================================================
-- Aliases en langage naturel pour les aliments Ciqual.
--
-- Pourquoi : Ciqual indexe en "catégorie, descripteur"
-- (« Porc, côte, cuite », « Gâteau, au chocolat »). Quand
-- l'utilisatrice tape « côte de porc » ou « gâteau au chocolat »
-- en langage naturel, le scoring startsWith de ciqual.ts rate.
--
-- Solution : pour chaque aliment, on stocke 3-5 expressions
-- naturelles que Mistral a générées (cf. scripts/batch-ciqual-aliases.mjs)
-- et qui pointent vers ce ciqual_id. La recherche cherche dans
-- (name OR aliases.alias).
--
-- Workflow en 2 passes :
--   1. Batch Mistral génère librement → status='pending'
--   2. Détection auto des conflits (un alias qui pointe vers >1
--      ciqual_id ambigu) → écran admin → status='resolved'/'rejected'
--
-- Seuls les aliases status='resolved' participent à la recherche
-- en prod (les 'pending' peuvent apparaître en preview admin).
-- =============================================================

create table if not exists public.ciqual_aliases (
  id          bigserial primary key,
  ciqual_id   bigint not null references public.ciqual_foods(id) on delete cascade,
  -- Texte normalisé en MINUSCULES sans accents pour le matching.
  -- (Le score Ciqual fait déjà sa propre normalisation côté code,
  -- mais on garde la version dénormalisée ici pour l'affichage.)
  alias       text not null check (char_length(alias) between 2 and 100),
  alias_display text not null,
  -- Origine de l'alias :
  --   'mistral_batch_v1' : généré par le batch initial
  --   'admin_manual'     : ajouté à la main par Karine
  --   'mistral_batch_v2' : régénération future
  source      text not null default 'mistral_batch_v1',
  -- Cycle de vie :
  --   'pending'  : pas encore validé, possiblement en conflit
  --   'resolved' : Karine a validé pour CE ciqual_id (peut servir au scoring)
  --   'rejected' : Karine a explicitement écarté (ne participe plus jamais)
  status      text not null default 'pending'
                check (status in ('pending', 'resolved', 'rejected')),
  created_at  timestamptz not null default now()
);

-- Unicité : un alias par ciqual_id (pas de doublons intra-aliment).
-- Le même alias PEUT être présent sur plusieurs ciqual_id différents :
-- c'est précisément le cas qu'on détectera comme "conflit".
create unique index if not exists ciqual_aliases_unique_per_food
  on public.ciqual_aliases (ciqual_id, alias);

-- Index principal pour le scoring : recherche par alias normalisé.
-- Trigram pour fuzzy match si typo (banane vs bananes).
create index if not exists ciqual_aliases_alias_trgm_idx
  on public.ciqual_aliases
  using gin (alias gin_trgm_ops);

-- Index pour la détection des conflits (alias qui pointe vers >1 ciqual_id).
create index if not exists ciqual_aliases_alias_status_idx
  on public.ciqual_aliases (alias, status);

-- Index pour le scoring filtré par status (récupère vite tous les
-- aliases d'un aliment validé).
create index if not exists ciqual_aliases_food_status_idx
  on public.ciqual_aliases (ciqual_id, status);

-- RLS : lecture publique (même règle que ciqual_foods). Écriture admin.
alter table public.ciqual_aliases enable row level security;

create policy "ciqual_aliases_select_all" on public.ciqual_aliases
  for select using (true);

create policy "ciqual_aliases_admin_write" on public.ciqual_aliases
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

comment on table public.ciqual_aliases is
  'Expressions naturelles (côté utilisateur) pointant vers une entrée Ciqual. Générées par batch Mistral + validation manuelle par Karine.';
