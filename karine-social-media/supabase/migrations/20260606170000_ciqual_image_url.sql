-- =============================================================
-- Vignettes Ciqual : URL d'une illustration douce-pastel (Z-Image
-- + rembg, fond transparent) pour chaque entrée alimentaire.
--
-- - Nullable : on remplit progressivement par batch (cf. script
--   côté hero/admin /editor-test/batch-ciqual-images).
-- - Lookup index sur les entrées AVEC image (pour pouvoir vite
--   filtrer ce qui reste à générer).
-- =============================================================

alter table public.ciqual_foods
  add column if not exists image_url text;

create index if not exists ciqual_foods_image_url_present_idx
  on public.ciqual_foods((image_url is not null));

-- Bucket public pour les vignettes Ciqual (lecture anonyme — on
-- affiche dans l'app abonnée). Écriture protégée par service role.
insert into storage.buckets (id, name, public)
values ('ciqual-images', 'ciqual-images', true)
on conflict (id) do nothing;

-- Lecture anonyme du bucket (toute vignette est publique)
create policy if not exists "ciqual_images_select_all"
  on storage.objects for select
  using (bucket_id = 'ciqual-images');
