-- Photos réelles par jour (pellicule sous les tuiles déjeuner/dîner).
-- Karine pourra uploader plusieurs photos de son quotidien pour chaque jour.
alter table public.weekly_menu_days
  add column if not exists prep_photos text[] not null default array[]::text[];
