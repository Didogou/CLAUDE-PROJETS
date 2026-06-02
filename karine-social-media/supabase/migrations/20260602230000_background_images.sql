-- ============================================================
-- Fonds d'écran personnalisables depuis /admin/parametres/fonds.
-- Karine uploade un portrait (mobile) + un paysage (PC) pour chaque
-- variant. Si le variant n'a pas d'entree ici, l'app retombe sur les
-- fichiers /images/fond-*.webp livrés avec le code.
-- ============================================================

create table if not exists public.background_images (
  variant      text primary key,           -- 'default' | 'astuces' | 'conseils' | 'salade' | 'dessert' | 'accueil'
  portrait_url text,                       -- mobile/tel
  paysage_url  text,                       -- tablette/PC
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);

alter table public.background_images enable row level security;

-- Lecture publique (FloralBackground lit côté serveur via service-role
-- mais on garde une policy ouverte pour ne pas bloquer).
drop policy if exists background_images_read_public on public.background_images;
create policy background_images_read_public on public.background_images
  for select using (true);

drop policy if exists background_images_write_admin on public.background_images;
create policy background_images_write_admin on public.background_images
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop trigger if exists background_images_set_updated_at on public.background_images;
create trigger background_images_set_updated_at
  before update on public.background_images
  for each row execute function public.set_updated_at();

comment on table public.background_images is 'Fonds d''ecran personnalisables par variant (default, astuces, conseils, salade, dessert, accueil). Edites depuis /admin/parametres/fonds.';
