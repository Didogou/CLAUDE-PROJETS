-- Généralise la table `comments` pour qu'elle accepte aussi des avis sur les
-- astuces (`tips`), pas seulement sur les recettes.
--   - recipe_slug devient nullable
--   - nouvelle colonne tip_slug (FK vers tips)
--   - check constraint : exactement l'une des deux doit être renseignée

alter table public.comments alter column recipe_slug drop not null;

alter table public.comments
  add column if not exists tip_slug text references public.tips(slug) on delete cascade;

alter table public.comments drop constraint if exists comments_target_check;
alter table public.comments add constraint comments_target_check check (
  (recipe_slug is not null and tip_slug is null)
  or (recipe_slug is null and tip_slug is not null)
);

create index if not exists comments_tip_slug_idx
  on public.comments(tip_slug, created_at desc)
  where status = 'visible';
