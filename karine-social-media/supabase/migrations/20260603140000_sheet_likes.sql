-- =============================================================
-- Likes par utilisateur sur les fiches détaillées (recipe_sheets).
--
-- Chaque sheet (= une recette à part entière) peut être likée
-- par un user. Une seule ligne par couple (user, sheet) — un user
-- ne peut pas liker 2x la même fiche.
--
-- Compteur : likes_count sur recipe_sheets, maintenu par triggers
-- INSERT/DELETE. Permet d'afficher le total sans recalcul.
-- =============================================================

alter table public.recipe_sheets
  add column if not exists likes_count integer not null default 0;

create table if not exists public.sheet_likes (
  user_id   uuid not null references auth.users(id) on delete cascade,
  sheet_id  uuid not null references public.recipe_sheets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sheet_id)
);

create index if not exists sheet_likes_user_idx on public.sheet_likes(user_id, created_at desc);
create index if not exists sheet_likes_sheet_idx on public.sheet_likes(sheet_id);

-- RLS : un user voit/modifie seulement ses propres likes ; les
-- autres users ne lisent QUE leurs lignes (on filtre l'agrégation
-- via le compteur likes_count côté serveur).
alter table public.sheet_likes enable row level security;

create policy "sheet_likes_select_own" on public.sheet_likes
  for select using (auth.uid() = user_id);

create policy "sheet_likes_insert_own" on public.sheet_likes
  for insert with check (auth.uid() = user_id);

create policy "sheet_likes_delete_own" on public.sheet_likes
  for delete using (auth.uid() = user_id);

-- Trigger : maintien automatique du compteur likes_count sur recipe_sheets.
create or replace function public.sheet_likes_update_count()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.recipe_sheets
      set likes_count = likes_count + 1
      where id = new.sheet_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.recipe_sheets
      set likes_count = greatest(0, likes_count - 1)
      where id = old.sheet_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists sheet_likes_count_trigger on public.sheet_likes;
create trigger sheet_likes_count_trigger
  after insert or delete on public.sheet_likes
  for each row execute function public.sheet_likes_update_count();

comment on table public.sheet_likes is
  'Likes par utilisateur sur les fiches détaillées. Anti double-like via PK composite.';
comment on column public.recipe_sheets.likes_count is
  'Compteur dénormalisé, maintenu par triggers sur sheet_likes.';
