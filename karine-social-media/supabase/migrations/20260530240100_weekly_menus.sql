-- Menus de la semaine : 1 PNG global + 7 plats (lundi → dimanche).
-- Chaque plat peut éventuellement pointer vers une recette publiée (recipe_slug),
-- mais c'est optionnel : Karine peut juste mettre un nom de plat et linker plus tard.

create table if not exists public.weekly_menus (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,         -- lundi de la semaine
  cover_image_url text,                    -- PNG global du menu
  title text,                              -- optionnel, ex. "Semaine du 26 mai"
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists weekly_menus_published_idx
  on public.weekly_menus(published_at desc)
  where status = 'published';

create table if not exists public.weekly_menu_days (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.weekly_menus(id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 6), -- 0=lundi, 6=dimanche
  dish_label text not null,                                       -- nom du plat (toujours rempli)
  recipe_slug text references public.recipes(slug) on delete set null, -- lien optionnel
  unique (menu_id, day_index)
);

create index if not exists weekly_menu_days_menu_idx
  on public.weekly_menu_days(menu_id, day_index);

alter table public.weekly_menus enable row level security;
alter table public.weekly_menu_days enable row level security;

-- Lecture publique : tout le monde voit les menus publiés (et leurs jours)
drop policy if exists "weekly_menus_read_published" on public.weekly_menus;
create policy "weekly_menus_read_published" on public.weekly_menus
  for select using (status = 'published');

drop policy if exists "weekly_menu_days_read" on public.weekly_menu_days;
create policy "weekly_menu_days_read" on public.weekly_menu_days
  for select using (
    exists (
      select 1 from public.weekly_menus m
      where m.id = weekly_menu_days.menu_id and m.status = 'published'
    )
  );

-- Insert/Update/Delete : service_role only (admin via API)
