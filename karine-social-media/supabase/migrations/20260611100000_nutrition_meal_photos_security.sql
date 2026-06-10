-- =============================================================
-- Sécurité photos repas (donnée santé Art. 9 RGPD)
--
-- Avant : path prédictible (user_id/Date.now().jpg), bucket public,
-- colonne photo_url ABSENTE de food_log_entries (INSERT échouait).
--
-- Après :
--   1. Colonne photo_url (stocke maintenant un PATH, pas une URL)
--   2. Bucket nutrition-meal-photos PRIVÉ + RLS strictes
--   3. Accès via signed URLs (1h) côté code
-- =============================================================

-- 1. Colonne manquante : photo_url stocke maintenant le PATH Storage
--    (ex. "{user_uuid}/{photo_uuid}.jpg") au lieu d'une URL publique.
alter table public.food_log_entries
  add column if not exists photo_url text;

comment on column public.food_log_entries.photo_url is
  'Path Storage de la photo repas (ex. user_uuid/photo_uuid.jpg). NULL = pas de photo. Accès via /api/nutrition/photo/[photoId] qui retourne une signed URL 1h.';

create index if not exists food_log_entries_photo_url_idx
  on public.food_log_entries(user_id, photo_url)
  where photo_url is not null;

-- 2. Bucket privé pour les photos repas.
--    - public = false → URL publique retourne 403, on doit passer par signed URL
--    - file_size_limit 10 MB → garde-fou anti-upload massif
--    - allowed_mime_types image only → bloque polyglot files (SVG XSS, etc.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nutrition-meal-photos',
  'nutrition-meal-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- 3. RLS policies storage : chaque utilisatrice ne voit que son propre
--    dossier (path commence par son auth.uid()).

drop policy if exists "nutrition_photos_insert_own" on storage.objects;
create policy "nutrition_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'nutrition-meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "nutrition_photos_select_own" on storage.objects;
create policy "nutrition_photos_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'nutrition-meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "nutrition_photos_delete_own" on storage.objects;
create policy "nutrition_photos_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'nutrition-meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Note : pas de COMMENT ON TABLE storage.objects (Supabase hosted
-- réserve cette table système à supabase_admin). Le service_role
-- bypasse la RLS pour les ops admin (cleanup, audit) sans policy
-- explicite — c'est le comportement standard PostgreSQL.
