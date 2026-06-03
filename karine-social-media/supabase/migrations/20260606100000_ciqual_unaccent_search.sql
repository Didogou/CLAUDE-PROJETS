-- =============================================================
-- Recherche Ciqual robuste : unaccent + nom + groupe + sous-groupe
--
-- Problème observé : ILIKE '%boeuf%' ne matchait pas "Bœuf" (œ),
-- ni "côte" si on tapait "cote". Cas : "côte de bœuf" → 0 résultat.
--
-- Fix :
--  1) Extension `unaccent` activée
--  2) Wrapper IMMUTABLE pour pouvoir indexer
--  3) Index trigram sur le name normalisé (perf)
--  4) Fonction RPC `search_ciqual_foods` qui :
--     - prend un array de tokens
--     - match chaque token (AND) en mode unaccent+lower
--     - cherche dans name, group_name ET subgroup_name
--     - retourne setof ciqual_foods (le scoring de pertinence
--       reste côté JS)
-- =============================================================

create extension if not exists unaccent;

-- Wrapper IMMUTABLE de unaccent (le natif est STABLE → non-indexable)
create or replace function public.f_unaccent(input text)
returns text
language sql
immutable parallel safe strict
as $$
  select public.unaccent('public.unaccent', input);
$$;

-- Index trigram sur le nom normalisé (pour les filtres LIKE rapides)
create index if not exists ciqual_foods_name_unaccent_trgm_idx
  on public.ciqual_foods
  using gin (lower(public.f_unaccent(name)) gin_trgm_ops);

-- Index aussi sur le groupe + sous-groupe normalisés (perf fallback)
create index if not exists ciqual_foods_group_unaccent_trgm_idx
  on public.ciqual_foods
  using gin (lower(public.f_unaccent(coalesce(group_name, ''))) gin_trgm_ops);

create index if not exists ciqual_foods_subgroup_unaccent_trgm_idx
  on public.ciqual_foods
  using gin (lower(public.f_unaccent(coalesce(subgroup_name, ''))) gin_trgm_ops);

-- Fonction RPC : recherche multi-tokens dans name + group + subgroup
create or replace function public.search_ciqual_foods(
  query_tokens text[],
  limit_n int default 15
)
returns setof public.ciqual_foods
language plpgsql
stable parallel safe
as $$
declare
  cleaned text[];
begin
  -- Normalise les tokens (lower + unaccent + filter empty)
  select array_agg(lower(public.f_unaccent(t)))
  into cleaned
  from unnest(query_tokens) as t
  where length(t) > 0;

  if cleaned is null or array_length(cleaned, 1) = 0 then
    return;
  end if;

  return query
  select cf.*
  from public.ciqual_foods cf
  where (
    select bool_and(
      lower(public.f_unaccent(cf.name)) like '%' || tok || '%'
      or lower(public.f_unaccent(coalesce(cf.group_name, ''))) like '%' || tok || '%'
      or lower(public.f_unaccent(coalesce(cf.subgroup_name, ''))) like '%' || tok || '%'
    )
    from unnest(cleaned) as tok
  )
  limit limit_n;
end;
$$;

-- Accès lecture : tous les users authentifiés (la fonction respecte
-- la RLS via la table sous-jacente).
grant execute on function public.search_ciqual_foods(text[], int)
  to authenticated, anon;

comment on function public.search_ciqual_foods is
  'Recherche Ciqual multi-tokens unaccent+lower sur name+group+subgroup. Retourne setof ciqual_foods, le scoring de pertinence est côté JS.';
