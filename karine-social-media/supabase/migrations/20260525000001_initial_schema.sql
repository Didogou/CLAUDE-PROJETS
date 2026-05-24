-- ============================================================
-- Karine Social Media — Schema initial
-- 6 tables : profiles, subscriptions, menus, recipes, advice, tips, favorites
-- ============================================================

-- ============================================================
-- 1. PROFILES — extension de auth.users
-- ============================================================
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  role         text not null default 'visitor' check (role in ('admin', 'subscriber', 'visitor')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);

-- Auto-créer un profile à chaque signup auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. SUBSCRIPTIONS — état Stripe
-- ============================================================
create table public.subscriptions (
  id                      bigserial primary key,
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  stripe_customer_id      text,
  stripe_subscription_id  text unique,
  status                  text not null check (status in ('trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid','paused')),
  price_id                text,
  trial_end               timestamptz,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index subscriptions_user_id_idx       on public.subscriptions(user_id);
create index subscriptions_stripe_customer_idx on public.subscriptions(stripe_customer_id);
create index subscriptions_status_idx        on public.subscriptions(status);

-- Helper : utilisateur a-t-il un abo actif (trialing ou active) ?
create or replace function public.has_active_subscription(uid uuid)
returns boolean
language sql
stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = uid
      and status in ('trialing', 'active')
      and (current_period_end is null or current_period_end > now())
  );
$$;

-- Helper : utilisateur est-il admin ?
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = uid and role = 'admin'
  );
$$;

-- ============================================================
-- 3. MENUS — menu hebdo (cover + 5 jours + liste courses)
-- ============================================================
create table public.menus (
  id                bigserial primary key,
  title             text not null,
  week_start_date   date not null,
  week_end_date     date not null,
  cover_image_url   text,
  intro_text        text,
  days              jsonb not null default '[]'::jsonb,
  shopping_list     jsonb not null default '{}'::jsonb,
  tags              text[] not null default array[]::text[],
  status            text not null default 'draft' check (status in ('draft','scheduled','published')),
  scheduled_for     timestamptz,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null
);

create index menus_status_published_idx on public.menus(status, published_at desc);
create index menus_week_start_idx       on public.menus(week_start_date desc);

-- ============================================================
-- 4. RECIPES — recettes thématiques (cover + N variantes)
-- ============================================================
create table public.recipes (
  id                bigserial primary key,
  theme_title       text not null,
  theme_subtitle    text,
  cover_image_url   text,
  variants          jsonb not null default '[]'::jsonb,
  tags              text[] not null default array[]::text[],
  status            text not null default 'draft' check (status in ('draft','scheduled','published')),
  scheduled_for     timestamptz,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null
);

create index recipes_status_published_idx on public.recipes(status, published_at desc);

-- ============================================================
-- 5. ADVICE — conseils diététiques
-- ============================================================
create table public.advice (
  id              bigserial primary key,
  title           text not null,
  summary         text,
  body            text not null,
  cover_image_url text,
  tags            text[] not null default array[]::text[],
  status          text not null default 'draft' check (status in ('draft','scheduled','published')),
  scheduled_for   timestamptz,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null
);

create index advice_status_published_idx on public.advice(status, published_at desc);

-- ============================================================
-- 6. TIPS — astuces du moment (format léger plein-format)
-- ============================================================
create table public.tips (
  id              bigserial primary key,
  title           text not null,
  body            text not null,
  cover_image_url text,
  tags            text[] not null default array[]::text[],
  status          text not null default 'draft' check (status in ('draft','scheduled','published')),
  scheduled_for   timestamptz,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null
);

create index tips_status_published_idx on public.tips(status, published_at desc);

-- ============================================================
-- 7. FAVORITES — un user peut favoriser n'importe quel contenu
-- ============================================================
create table public.favorites (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  content_type text not null check (content_type in ('menu','recipe','advice','tip')),
  content_id   bigint not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, content_type, content_id)
);

create index favorites_user_id_idx on public.favorites(user_id);

-- ============================================================
-- updated_at auto via trigger
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at      before update on public.profiles      for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger menus_set_updated_at         before update on public.menus         for each row execute function public.set_updated_at();
create trigger recipes_set_updated_at       before update on public.recipes       for each row execute function public.set_updated_at();
create trigger advice_set_updated_at        before update on public.advice        for each row execute function public.set_updated_at();
create trigger tips_set_updated_at          before update on public.tips          for each row execute function public.set_updated_at();

-- ============================================================
-- RLS — Row Level Security
-- ============================================================

-- PROFILES : on voit/modifie son propre profil, admin voit tout
alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin(auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

create policy "profiles_admin_update_all" on public.profiles
  for update using (public.is_admin(auth.uid()));

-- SUBSCRIPTIONS : on voit son propre abo, admin voit tout, INSERT/UPDATE/DELETE = service_role uniquement (Stripe webhook)
alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own_or_admin" on public.subscriptions
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- (Pas de policy INSERT/UPDATE/DELETE → service_role bypass RLS, anon/authenticated bloqués)

-- CONTENUS (menus, recipes, advice, tips) :
--   SELECT : admin = tout, abonné actif = published only
--   INSERT/UPDATE/DELETE : admin uniquement

-- Menus
alter table public.menus enable row level security;

create policy "menus_select_admin_or_subscriber" on public.menus
  for select using (
    public.is_admin(auth.uid())
    or (public.has_active_subscription(auth.uid()) and status = 'published')
  );

create policy "menus_admin_all" on public.menus
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Recipes
alter table public.recipes enable row level security;

create policy "recipes_select_admin_or_subscriber" on public.recipes
  for select using (
    public.is_admin(auth.uid())
    or (public.has_active_subscription(auth.uid()) and status = 'published')
  );

create policy "recipes_admin_all" on public.recipes
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Advice
alter table public.advice enable row level security;

create policy "advice_select_admin_or_subscriber" on public.advice
  for select using (
    public.is_admin(auth.uid())
    or (public.has_active_subscription(auth.uid()) and status = 'published')
  );

create policy "advice_admin_all" on public.advice
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Tips
alter table public.tips enable row level security;

create policy "tips_select_admin_or_subscriber" on public.tips
  for select using (
    public.is_admin(auth.uid())
    or (public.has_active_subscription(auth.uid()) and status = 'published')
  );

create policy "tips_admin_all" on public.tips
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- FAVORITES : un user gère ses propres favoris
alter table public.favorites enable row level security;

create policy "favorites_select_own" on public.favorites
  for select using (user_id = auth.uid());

create policy "favorites_insert_own" on public.favorites
  for insert with check (user_id = auth.uid());

create policy "favorites_delete_own" on public.favorites
  for delete using (user_id = auth.uid());

-- ============================================================
-- Storage : bucket "content-images" pour les visuels uploadés
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-images', 'content-images', true, 10485760, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

-- Storage policies : tout le monde peut lire (bucket public), admin peut upload/update/delete
create policy "content_images_public_read" on storage.objects
  for select using (bucket_id = 'content-images');

create policy "content_images_admin_insert" on storage.objects
  for insert with check (bucket_id = 'content-images' and public.is_admin(auth.uid()));

create policy "content_images_admin_update" on storage.objects
  for update using (bucket_id = 'content-images' and public.is_admin(auth.uid()));

create policy "content_images_admin_delete" on storage.objects
  for delete using (bucket_id = 'content-images' and public.is_admin(auth.uid()));
