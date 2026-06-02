-- ============================================================
-- Section "Le saviez-vous ?" sur la home : table featured_photos.
-- Karine y poste des photos courtes (légumes de saison, anecdotes)
-- via /admin/le-saviez-vous. La home lit les photos publiées
-- ordonnées par sort_order.
-- ============================================================

create table if not exists public.featured_photos (
  id           bigserial primary key,
  image_url    text not null,
  caption      text,
  likes_count  int not null default 0 check (likes_count >= 0),
  sort_order   int not null default 0,
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null
);

create index if not exists featured_photos_publish_idx
  on public.featured_photos (published, sort_order, created_at desc)
  where published = true;

alter table public.featured_photos enable row level security;

-- Lecture publique des photos PUBLIÉES (visibles par tous : visiteurs inclus)
drop policy if exists featured_photos_read_published on public.featured_photos;
create policy featured_photos_read_published on public.featured_photos
  for select using (published = true);

-- Lecture admin (drafts, dépublié, etc.)
drop policy if exists featured_photos_read_admin on public.featured_photos;
create policy featured_photos_read_admin on public.featured_photos
  for select using (public.is_admin(auth.uid()));

-- Écriture admin uniquement
drop policy if exists featured_photos_write_admin on public.featured_photos;
create policy featured_photos_write_admin on public.featured_photos
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop trigger if exists featured_photos_set_updated_at on public.featured_photos;
create trigger featured_photos_set_updated_at
  before update on public.featured_photos
  for each row execute function public.set_updated_at();

comment on table public.featured_photos is 'Section "Le saviez-vous ?" : photos courtes éditées par Karine et affichées sur la home en polaroids.';

-- ----- Storage bucket pour les images uploadées -----
-- Bucket public (lecture par tous, écriture admin via service role API).
insert into storage.buckets (id, name, public)
values ('featured-photos', 'featured-photos', true)
on conflict (id) do nothing;

-- RLS sur storage.objects : lecture publique du bucket featured-photos.
drop policy if exists "Public read featured-photos" on storage.objects;
create policy "Public read featured-photos" on storage.objects
  for select using (bucket_id = 'featured-photos');
