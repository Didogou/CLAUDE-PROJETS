-- Ajoute un cover par jour (annonce du menu du jour, affiché en grand
-- au-dessus des fiches déjeuner / dîner).
alter table public.weekly_menu_days
  add column if not exists cover_image_url text;
