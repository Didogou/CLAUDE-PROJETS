-- =============================================================
-- Recherche Ciqual TOLERANTE AUX FAUTES D'ORTHOGRAPHE.
--
-- Probleme : l'utilisatrice tape "frmage", "yourt", "tomatte" et
-- le matching exact (LIKE '%X%' meme avec unaccent) rate.
--
-- Solution : RPC qui utilise pg_trgm.similarity() avec un seuil
-- (>= 0.3 = mots quasi-identiques avec 1-2 caracteres differents).
-- L'extension pg_trgm est deja activee par la migration unaccent
-- (gin_trgm_ops y est utilise). L'index trigram existant rend la
-- query rapide.
--
-- Strategie : on cherche en SIMILARITY sur le nom unaccent+lower,
-- on retourne classe par similarite decroissante. C'est un
-- COMPLEMENT au search_ciqual_foods exact (LIKE) : on l'appelle
-- en fallback cote API quand le LIKE ne donne pas assez de
-- resultats.
-- =============================================================

create or replace function public.search_ciqual_foods_fuzzy(
  q text,
  threshold real default 0.3,
  limit_n int default 8
)
returns table(
  id bigint,
  alim_code int,
  name text,
  group_name text,
  subgroup_name text,
  kcal_per_100g numeric,
  proteins_g numeric,
  lipids_g numeric,
  carbs_g numeric,
  image_url text,
  similarity_score real
)
language plpgsql
stable parallel safe
as $$
declare
  q_norm text;
begin
  -- Normalise la query (lower + unaccent), comme la fonction exacte
  q_norm := lower(public.f_unaccent(coalesce(q, '')));
  if length(q_norm) < 2 then
    return;
  end if;

  return query
  select
    cf.id,
    cf.alim_code,
    cf.name,
    cf.group_name,
    cf.subgroup_name,
    cf.kcal_per_100g,
    cf.proteins_g,
    cf.lipids_g,
    cf.carbs_g,
    cf.image_url,
    similarity(lower(public.f_unaccent(cf.name)), q_norm) as similarity_score
  from public.ciqual_foods cf
  -- L'operateur % (sim avec threshold global pg_trgm.similarity_threshold)
  -- utilise l'index trigram → rapide meme sur 3500 lignes. On combine
  -- avec similarity() explicite pour pouvoir filtrer / classer.
  where similarity(lower(public.f_unaccent(cf.name)), q_norm) >= threshold
  order by similarity_score desc, length(cf.name) asc
  limit limit_n;
end;
$$;

grant execute on function public.search_ciqual_foods_fuzzy(text, real, int)
  to authenticated, anon;

comment on function public.search_ciqual_foods_fuzzy(text, real, int) is
  'Recherche fuzzy (trigram similarity) sur ciqual_foods.name. Tolere les fautes de frappe. Threshold 0.3 = mots avec 1-2 caracteres differents max. Appele en fallback de search_ciqual_foods quand le LIKE exact ne donne pas assez de resultats.';
