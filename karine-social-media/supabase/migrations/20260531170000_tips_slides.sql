-- Plusieurs images par astuce (slides), comme pour les recettes.
-- Migration data-safe : on garde l'éventuelle image_url existante en la
-- copiant dans slides[0], puis on supprime la colonne image_url.

alter table public.tips
  add column if not exists slides text[] not null default array[]::text[];

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tips' and column_name = 'image_url'
  ) then
    execute $sql$
      update public.tips
      set slides = array[image_url]
      where image_url is not null
        and (slides is null or slides = array[]::text[])
    $sql$;
    execute 'alter table public.tips drop column image_url';
  end if;
end$$;
