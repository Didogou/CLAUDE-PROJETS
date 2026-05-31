-- Extensions sur la table comments :
-- - photos (max 2 en pratique, géré côté code)
-- - likes_count (anonyme V1, comme pour les recettes)
-- - parent_id (réponses à un commentaire)

alter table public.comments
  add column if not exists photos text[] not null default array[]::text[],
  add column if not exists likes_count integer not null default 0,
  add column if not exists parent_id uuid references public.comments(id) on delete cascade;

create index if not exists comments_parent_id_idx
  on public.comments(parent_id)
  where parent_id is not null;
